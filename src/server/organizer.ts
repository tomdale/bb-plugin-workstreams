import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { buildForest } from "../domain/tree.ts";
import type { Recap } from "../domain/recap.ts";
import { isComplete, workView } from "../domain/status.ts";
import type { Analyzer } from "./analyzer.ts";
import type { CleanupMember } from "./cleanup.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import type { WorkstreamStore } from "./workstreams.ts";
import { activeHome } from "../domain/regroup.ts";
import { layoutGroups, type LayoutNode } from "../domain/layout.ts";
import { assignmentEvidence } from "./evidence.ts";
import { workstreamPath } from "../domain/workstream-path.ts";
import type {
  WorkstreamAssignment,
  Workstream,
} from "../domain/workstreams.ts";
import { listSections, type InventoryThread } from "./inventory.ts";
import type { WorkstreamService } from "./service.ts";
import type { Journal, NewEntry } from "./journal.ts";
import type {
  OrganizerState,
  OrganizerStateCounts,
  OrganizerStateGroup,
  OrganizerStateNoWorkstream,
} from "./contract.ts";

type OrganizerDeps = {
  sdk: () => BbPluginApi["sdk"];
  db: Database;
  service: WorkstreamService;
  workstreamStore: WorkstreamStore;
  analyzer: Analyzer;
  /** The agent recap for a thread's latest turn; it outranks analysis. */
  recap?: (threadId: string) => Recap | undefined;
  members: (sectionId: string) => Promise<CleanupMember[]>;
  /** Records each pass's section changes in Activity. */
  journal?: Journal;
  onChange: () => void;
  /** A pass applied; organizing suggestions may be due. */
  onPass?: (rebuild: boolean) => void;
  now?: () => number;
};

const KEY = "live_organization";
/** The last applied workstream layout, shared by sidebar and Home. */
const LAYOUT_KEY = "layout";

type StoredLayout = { nodes: LayoutNode[] };
class SupersededPlan extends Error {}

const DEFAULT_COUNTS: OrganizerStateCounts = {
  activeThreads: 0,
  completedThreads: 0,
  totalThreads: 0,
  noWorkstreamThreads: 0,
  activeWorkstreams: 0,
};

const DEFAULT_STATE: OrganizerState = {
  status: "idle",
  error: null,
  lastUpdatedAt: null,
  groups: [],
  noWorkstream: [],
  counts: DEFAULT_COUNTS,
};

export class Organizer {
  private running = false;
  private factRevision = 0;
  private rerunQueued = false;
  private disposed = false;
  private controller: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncedHash: string | null = null;
  /** The latest trigger came with an inventory no later trigger predates. */
  private inventoryFresh = false;
  private forceNextRun = false;
  private activeRun: Promise<OrganizerState> | null = null;

  constructor(private readonly deps: OrganizerDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  state(): OrganizerState {
    const raw = getMeta(this.deps.db, KEY);
    if (!raw) return DEFAULT_STATE;
    try {
      return JSON.parse(raw) as OrganizerState;
    } catch {
      return DEFAULT_STATE;
    }
  }

  private save(state: OrganizerState): OrganizerState {
    setMeta(this.deps.db, KEY, JSON.stringify(state));
    this.deps.onChange();
    return state;
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.controller?.abort();
  }

  /** Counts triggers; a caller passes it back to `trigger` as `inventorySince`. */
  revision(): number {
    return this.factRevision;
  }

  /**
   * Schedules a pass. `inventorySince` is the revision a caller read before
   * starting a reconcile that has finished: when no trigger arrived since,
   * the pass plans from that inventory instead of reconciling again.
   */
  trigger(debounceMs = 50, inventorySince?: number): void {
    if (this.disposed) return;
    this.inventoryFresh = inventorySince === this.factRevision;
    this.factRevision++;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.run().catch(() => {});
    }, debounceMs);
  }

  async rebuild(): Promise<OrganizerState> {
    this.lastSyncedHash = null;
    this.forceNextRun = true;
    if (this.running) {
      this.rerunQueued = true;
      await this.activeRun?.catch(() => {});
      return this.run();
    }
    return this.run();
  }

  async run(): Promise<OrganizerState> {
    if (this.disposed) return this.state();

    if (this.running) {
      this.rerunQueued = true;
      return this.activeRun ?? Promise.resolve(this.state());
    }

    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    const isForced = this.forceNextRun;
    this.forceNextRun = false;

    const runPromise = (async () => {
      try {
        const result = await this.executePass(controller.signal, isForced);
        return result;
      } finally {
        this.running = false;
        this.controller = null;
        if (this.rerunQueued && !this.disposed) {
          this.rerunQueued = false;
          // Queue next pass asynchronously
          setTimeout(() => {
            void this.run().catch(() => {});
          }, 0);
        }
      }
    })();

    this.activeRun = runPromise;
    return runPromise;
  }

  private storedLayout(): StoredLayout {
    const raw = getMeta(this.deps.db, LAYOUT_KEY);
    if (raw)
      try {
        const parsed = JSON.parse(raw) as Partial<StoredLayout>;
        if (Array.isArray(parsed.nodes)) return parsed as StoredLayout;
      } catch {
        return { nodes: [] };
      }
    return { nodes: [] };
  }

  /** The groups the last pass applied, which the sidebar and Home draw. */
  layout(): LayoutNode[] {
    return this.storedLayout().nodes;
  }

  /** Whether each thread is done, from only its analysis and recap. */
  private completed(
    topThreads: readonly InventoryThread[],
  ): Map<string, boolean> {
    const current = new Map(
      this.deps.service.threads().map((thread) => [thread.id, thread]),
    );
    return new Map(
      topThreads.map((thread) => [
        thread.id,
        isComplete(
          workView(
            current.get(thread.id) ?? thread,
            this.deps.analyzer.get(thread.id),
            this.deps.recap?.(thread.id),
          ),
        ),
      ]),
    );
  }

  /**
   * What a pass applies from. Every input is the one the pass planned with,
   * so a change that lands while it runs makes the next pass differ.
   */
  private fingerprint(plan: {
    revision: number;
    threads: readonly InventoryThread[];
    completed: ReadonlyMap<string, boolean>;
    assignments: ReadonlyMap<string, WorkstreamAssignment>;
    projected?: ReadonlyMap<string, string | null>;
  }): string {
    const { threads, completed, assignments, projected } = plan;
    return createHash("sha256")
      .update(
        JSON.stringify({
          treeRevision: plan.revision,
          layout: this.storedLayout().nodes,
          threads: threads.map((thread) => [
            thread.id,
            thread.title,
            projected?.has(thread.id)
              ? projected.get(thread.id)
              : thread.sectionId,
            completed.get(thread.id),
            assignmentEvidence(assignments.get(thread.id)!),
          ]),
        }),
      )
      .digest("hex");
  }

  private async executePass(
    signal: AbortSignal,
    isForced = false,
  ): Promise<OrganizerState> {
    const currentState = this.state();
    const sdk = this.deps.sdk();

    let passContext: {
      threads: InventoryThread[];
      isCompletedMap: Map<string, boolean>;
      assignments: ReadonlyMap<string, WorkstreamAssignment>;
      selectedWorkstreamIds: string[];
      workstreamToSection: Map<string, string>;
      appliedSectionIds: Map<string, string | null>;
      evidenceById: Map<string, string>;
      workstreams: Workstream[];
    } | null = null;

    try {
      const fresh = this.inventoryFresh && !isForced;
      this.inventoryFresh = false;
      if (!fresh) await this.deps.service.reconcile();
      const allThreads = this.deps.service.threads();
      const forest = buildForest(allThreads);

      // Only independently actionable visible, non-archived top-level threads
      const topThreads = forest.threads
        .map((r) => r.thread)
        .filter((t) => !t.isHidden && !t.isArchived);

      const factRevision = this.factRevision;
      const revision = this.deps.workstreamStore.revision();
      const isCompletedMap = this.completed(topThreads);
      const threadIds = topThreads.map((thread) => thread.id);
      const assignments = this.deps.workstreamStore.assignmentsOf(threadIds);

      // Check if snapshot is identical to last completed run
      const snapshotHash = this.fingerprint({
        revision,
        threads: topThreads,
        completed: isCompletedMap,
        assignments,
      });

      if (
        !isForced &&
        this.lastSyncedHash === snapshotHash &&
        currentState.status === "idle"
      ) {
        this.deps.onPass?.(false);
        return currentState;
      }

      // What each thread's workstream was settled from, shown for threads with
      // none.
      const evidenceById = new Map<string, string>();
      for (const [id, assignment] of assignments)
        if (assignment.evidence) evidenceById.set(id, assignment.evidence);

      // 2. Derivation stage
      const workstreams = this.deps.workstreamStore.list();

      const counts: Record<string, number> = {};
      for (const root of topThreads) {
        const assignment = assignments.get(root.id);
        if (
          assignment &&
          assignment.status === "assigned" &&
          assignment.workstreamId
        )
          counts[assignment.workstreamId] =
            (counts[assignment.workstreamId] ?? 0) + 1;
      }

      const layout = layoutGroups({
        workstreams: workstreams,
        counts,
      });
      const selectedWorkstreamIds = [...layout.listed];

      // 3. Sync Native Section Projection
      const workstreamToSection = new Map<string, string>();
      const appliedSectionIds = new Map<string, string | null>();

      passContext = {
        threads: topThreads,
        isCompletedMap,
        assignments,
        selectedWorkstreamIds,
        workstreamToSection,
        appliedSectionIds,
        evidenceById,
        workstreams,
      };

      const evidence = (
        workstreams: readonly Workstream[],
        completed: ReadonlyMap<string, boolean>,
        current: ReadonlyMap<string, WorkstreamAssignment>,
      ) =>
        JSON.stringify({
          workstreams: workstreams,
          completed: [...completed],
          assignments: threadIds.map((id) =>
            assignmentEvidence(current.get(id)!),
          ),
        });
      const planEvidence = evidence(workstreams, isCompletedMap, assignments);
      // Workstreams, threads' workstreams, and analysis change only while the
      // pass awaits BB, so the evidence is read again only after an await.
      let awaited = false;
      const awaitBb = async <T>(call: Promise<T>): Promise<T> => {
        try {
          return await call;
        } finally {
          awaited = true;
        }
      };
      const assertCurrent = () => {
        if (
          signal.aborted ||
          this.disposed ||
          this.factRevision !== factRevision
        )
          throw new SupersededPlan();
        if (!awaited) return;
        awaited = false;
        if (
          evidence(
            this.deps.workstreamStore.list(),
            this.completed(topThreads),
            this.deps.workstreamStore.assignmentsOf(threadIds),
          ) !== planEvidence
        )
          throw new SupersededPlan();
      };

      // Section changes run in the service's mutation queue, so a move,
      // retitle, or reconcile never interleaves with them, and whatever
      // changed is recorded in Activity even when the pass fails partway.
      const changes = new SyncChanges();
      await this.deps.service.exclusive(async () => {
        let failed = false;
        try {
          const liveSections = await awaitBb(listSections(sdk));
          for (const section of liveSections)
            changes.name(section.id, section.name);
          const groupBindings = new Map(this.deps.workstreamStore.groups()); // sectionId -> workstreamId
          assertCurrent();
          for (const workstreamId of selectedWorkstreamIds) {
            assertCurrent();
            const expectedName = workstreamPath(workstreamId, workstreams);

            // Check if an existing section is already bound to this workstreamId
            let section = liveSections.find(
              (s) => groupBindings.get(s.id) === workstreamId,
            );

            if (!section) {
              // Check if an existing section matches the name and is not bound
              // to another active workstream
              const candidate = liveSections.find(
                (s) =>
                  s.name.toLowerCase() === expectedName.toLowerCase() &&
                  (!groupBindings.has(s.id) ||
                    groupBindings.get(s.id) === workstreamId ||
                    !selectedWorkstreamIds.includes(groupBindings.get(s.id)!)),
              );
              if (candidate) {
                section = candidate;
                this.deps.workstreamStore.bindGroup(section.id, workstreamId);
                groupBindings.set(section.id, workstreamId);
              }
            }

            if (!section) {
              // Ownership permits cleanup when the projection no longer uses this section.
              const created = await awaitBb(
                sdk.threadSections.create({ name: expectedName }),
              );
              section = { id: created.id, name: created.name };
              changes.created.push(created.id);
              changes.name(created.id, created.name);
              this.deps.db
                .prepare(
                  `INSERT INTO ws_section (section_id, created_by)
               VALUES (?, 'workstreams')
               ON CONFLICT(section_id) DO UPDATE SET created_by = 'workstreams'`,
                )
                .run(created.id);
              this.deps.workstreamStore.bindGroup(created.id, workstreamId);
              groupBindings.set(created.id, workstreamId);
              this.deps.service.seeSection(created.id, created.name);
            } else if (section.name !== expectedName) {
              // Rename section if workstream name changed
              await awaitBb(
                sdk.threadSections.update({
                  id: section.id,
                  name: expectedName,
                }),
              );
              changes.renamed.push({
                id: section.id,
                from: section.name,
                to: expectedName,
              });
              changes.name(section.id, expectedName);
              section = { id: section.id, name: expectedName };
              this.deps.service.seeSection(section.id, expectedName);
            }

            workstreamToSection.set(workstreamId, section.id);
          }

          // Update top-level threads' sectionId in BB
          for (const thread of topThreads) {
            assertCurrent();
            const assignment = assignments.get(thread.id);
            let targetSectionId: string | null = null;

            if (
              assignment &&
              assignment.status === "assigned" &&
              assignment.workstreamId
            ) {
              const homeWorkstreamId = activeHome(
                assignment.workstreamId,
                selectedWorkstreamIds,
                workstreams,
              );
              if (homeWorkstreamId) {
                targetSectionId =
                  workstreamToSection.get(homeWorkstreamId) ?? null;
              }
            }

            if ((thread.sectionId ?? null) !== targetSectionId) {
              // The snapshot is from the start of the pass; classification may
              // have taken a while, so write only what still differs.
              const live = await awaitBb(
                sdk.threads.get({ threadId: thread.id }).catch(() => null),
              );
              const from = live?.sectionId ?? null;
              if (
                live &&
                live.archivedAt === null &&
                live.visibility !== "hidden" &&
                from !== targetSectionId
              ) {
                assertCurrent();
                await awaitBb(
                  sdk.threads.update({
                    threadId: thread.id,
                    sectionId: targetSectionId,
                  }),
                );
                changes.moves.push({
                  threadId: thread.id,
                  title: thread.title,
                  from,
                  to: targetSectionId,
                });
                this.deps.service.seeThread(
                  thread.id,
                  targetSectionId,
                  thread.parentThreadId ?? null,
                  thread.title,
                );
              }
            }
            appliedSectionIds.set(thread.id, targetSectionId);
          }

          // Clean up unused empty sections that belonged to Workstreams
          const activeSectionIds = new Set(workstreamToSection.values());

          for (const section of liveSections) {
            // Selected sections retain their bindings.
            if (activeSectionIds.has(section.id)) continue;

            const boundWorkstreamId = groupBindings.get(section.id);
            if (
              boundWorkstreamId &&
              !selectedWorkstreamIds.includes(boundWorkstreamId)
            ) {
              const members = await awaitBb(this.deps.members(section.id));
              const activeMembers = members.filter(
                (m) => m.archivedAt === null,
              );
              if (activeMembers.length === 0) {
                assertCurrent();
                // Only sections created by Workstreams may be deleted.
                const wsRow = this.deps.db
                  .prepare(
                    "SELECT created_by FROM ws_section WHERE section_id = ?",
                  )
                  .get(section.id) as { created_by: string } | undefined;

                if (wsRow?.created_by === "workstreams") {
                  await awaitBb(sdk.threadSections.delete({ id: section.id }));
                  changes.removed.push(section.id);
                  this.deps.db
                    .prepare("DELETE FROM ws_seen_section WHERE section_id = ?")
                    .run(section.id);
                  this.deps.db
                    .prepare("DELETE FROM ws_section WHERE section_id = ?")
                    .run(section.id);
                }
                this.deps.workstreamStore.unbindGroup(section.id);
                groupBindings.delete(section.id);
              }
            }
          }
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          this.record(changes, failed);
        }
      });

      // Seed visible population after derived moves, before an immediate archive.
      await this.deps.service.reconcile();

      // Workstreams Workstreams discovered that nothing uses any more go away.
      const pruned = this.deps.workstreamStore.prune();
      if (pruned.length)
        this.deps.journal?.add({
          action: "workstream-removed",
          source: "workstreams",
          rationale:
            pruned.length === 1
              ? `Removed the unused workstream ${pruned[0]!.name}`
              : `Removed ${pruned.length} unused workstreams`,
          threads: [],
          workstreams: [],
          undo: null,
          detail: pruned
            .map((workstream) => `Removed ${workstream.name}`)
            .join("\n"),
        });

      // 4. Assemble OrganizerState
      const finalState = this.assembleOrganizerState({
        status: "idle",
        error: null,
        threads: topThreads,
        isCompletedMap,
        assignments,
        selectedWorkstreamIds,
        workstreamToSection,
        evidenceById,
        workstreams,
      });

      setMeta(
        this.deps.db,
        LAYOUT_KEY,
        JSON.stringify({ nodes: layout.nodes }),
      );

      this.lastSyncedHash = this.fingerprint({
        revision,
        threads: topThreads,
        completed: isCompletedMap,
        assignments,
        projected: appliedSectionIds,
      });

      const saved = this.save(finalState);
      this.deps.onPass?.(isForced);
      return saved;
    } catch (err) {
      if (signal.aborted || this.disposed) return this.state();
      if (err instanceof SupersededPlan) {
        this.lastSyncedHash = null;
        this.rerunQueued = true;
        return this.state();
      }
      const errMsg = err instanceof Error ? err.message : String(err);

      // Report the applied prefix rather than claiming the whole plan succeeded.
      if (passContext && passContext.selectedWorkstreamIds.length > 0) {
        const failedState = this.assembleOrganizerState({
          status: "failed",
          error: errMsg,
          threads: passContext.threads,
          isCompletedMap: passContext.isCompletedMap,
          assignments: passContext.assignments,
          selectedWorkstreamIds: passContext.selectedWorkstreamIds,
          workstreamToSection: passContext.workstreamToSection,
          evidenceById: passContext.evidenceById,
          workstreams: passContext.workstreams,
        });
        return this.save(failedState);
      }

      return this.save({
        ...currentState,
        status: "failed",
        error: errMsg,
      });
    }
  }

  /**
   * Records one pass's section changes as one Activity entry. It has no undo:
   * workstreams follow workstreams, so the next pass would redo whatever an undo
   * reverted. Changing a thread's workstream is how to move it.
   */
  private record(changes: SyncChanges, failed: boolean): void {
    const entry = changes.entry(failed);
    if (entry) this.deps.journal?.add(entry);
  }

  private assembleOrganizerState(options: {
    status: OrganizerState["status"];
    error: string | null;
    threads: InventoryThread[];
    isCompletedMap: Map<string, boolean>;
    assignments: ReadonlyMap<string, WorkstreamAssignment>;
    selectedWorkstreamIds: string[];
    workstreamToSection: Map<string, string>;
    evidenceById: Map<string, string>;
    workstreams: Workstream[];
  }): OrganizerState {
    const {
      status,
      error,
      threads: topThreads,
      isCompletedMap,
      assignments,
      selectedWorkstreamIds,
      workstreamToSection,
      evidenceById,
      workstreams,
    } = options;

    const groupsMap = new Map<string, OrganizerStateGroup>();
    for (const workstreamId of selectedWorkstreamIds) {
      const workstream = workstreams.find((e) => e.id === workstreamId);
      const name = workstream
        ? workstreamPath(workstreamId, workstreams)
        : workstreamId;
      groupsMap.set(workstreamId, {
        key: workstreamId,
        sectionId: workstreamToSection.get(workstreamId) ?? null,
        name,
        description: workstream?.description || name,
        activeCount: 0,
        completedCount: 0,
        totalCount: 0,
        threads: [],
      });
    }

    const noWorkstreamThreads: OrganizerStateNoWorkstream[] = [];
    let activeCount = 0;
    let completedCount = 0;

    for (const thread of topThreads) {
      const assignment = assignments.get(thread.id);
      const isCompleted = isCompletedMap.get(thread.id) ?? false;
      if (isCompleted) {
        completedCount++;
      } else {
        activeCount++;
      }

      if (
        !assignment ||
        assignment.status === "none" ||
        !assignment.workstreamId
      ) {
        noWorkstreamThreads.push({
          id: thread.id,
          title: thread.title,
          completed: isCompleted,
          evidence: evidenceById.get(thread.id) ?? null,
          reason: isCompleted
            ? "Complete; no workstream."
            : "It has no workstream, so it's listed under Other.",
        });
        continue;
      }

      const homeWorkstreamId = activeHome(
        assignment.workstreamId,
        selectedWorkstreamIds,
        workstreams,
      );
      const group = homeWorkstreamId ? groupsMap.get(homeWorkstreamId) : null;

      if (group) {
        if (isCompleted) {
          group.completedCount++;
        } else {
          group.activeCount++;
        }
        group.totalCount++;

        const workstream = workstreams.find(
          (e) => e.id === assignment.workstreamId,
        );
        const workstreamLabel = workstream
          ? workstreamPath(workstream.id, workstreams)
          : null;

        let reason: string;
        if (isCompleted) {
          reason = `Complete; kept in ${group.name}.`;
        } else if (assignment.provenance === "manual") {
          reason = `You moved it to ${workstreamLabel}; listed in ${group.name}.`;
        } else if (workstreamLabel && workstreamLabel !== group.name) {
          reason = `Its workstream is ${workstreamLabel}; listed in ${group.name}.`;
        } else {
          reason = `Its workstream is ${group.name}.`;
        }

        group.threads.push({
          id: thread.id,
          title: thread.title,
          completed: isCompleted,
          workstreamId: assignment.workstreamId,
          workstreamLabel,
          provenance: assignment.provenance,
          reason,
        });
      } else {
        noWorkstreamThreads.push({
          id: thread.id,
          title: thread.title,
          completed: isCompleted,
          evidence: evidenceById.get(thread.id) ?? null,
          reason:
            "Its workstream isn't in the sidebar, so it's listed under Other.",
        });
      }
    }

    const finalGroups = Array.from(groupsMap.values()).filter(
      (group) => group.totalCount > 0,
    );

    return {
      status,
      error,
      lastUpdatedAt: this.now(),
      groups: finalGroups,
      noWorkstream: noWorkstreamThreads,
      counts: {
        activeThreads: activeCount,
        completedThreads: completedCount,
        totalThreads: topThreads.length,
        noWorkstreamThreads: noWorkstreamThreads.length,
        activeWorkstreams: finalGroups.length,
      },
    };
  }
}

/** What one organizer pass changed in BB, for its Activity entry. */
class SyncChanges {
  readonly created: string[] = [];
  readonly renamed: { id: string; from: string; to: string }[] = [];
  readonly moves: {
    threadId: string;
    title: string;
    from: string | null;
    to: string | null;
  }[] = [];
  readonly removed: string[] = [];
  private readonly names = new Map<string, string>();

  /** Remembers a section's name as of this pass. */
  name(sectionId: string, name: string): void {
    this.names.set(sectionId, name);
  }

  private nameOf(sectionId: string | null): string {
    return sectionId === null
      ? "Other"
      : (this.names.get(sectionId) ?? "a deleted workstream");
  }

  entry(failed: boolean): NewEntry | null {
    const { created, renamed, moves, removed } = this;
    if (!created.length && !renamed.length && !moves.length && !removed.length)
      return null;
    const count = (n: number, one: string, many: string) =>
      n === 0 ? null : `${n} ${n === 1 ? one : many}`;
    const summary = [
      count(moves.length, "thread moved", "threads moved"),
      count(created.length, "workstream created", "workstreams created"),
      count(renamed.length, "workstream renamed", "workstreams renamed"),
      count(
        removed.length,
        "empty workstream removed",
        "empty workstreams removed",
      ),
    ].filter((part): part is string => part !== null);
    const detail = [
      ...created.map((id) => `Created ${this.nameOf(id)}`),
      ...renamed.map((r) => `Renamed ${r.from} to ${r.to}`),
      ...moves.map(
        (m) =>
          `Moved “${m.title}” from ${this.nameOf(m.from)} to ${this.nameOf(m.to)}`,
      ),
      ...removed.map(
        (id) => `Removed ${this.nameOf(id)}, which had no threads`,
      ),
      "Each workstream lists its own threads; move a thread to change where it is listed.",
      ...(failed
        ? ["The pass stopped partway; the next one finishes it."]
        : []),
    ].join("\n");
    const touched = new Set<string>([
      ...created,
      ...renamed.map((r) => r.id),
      ...removed,
      ...moves.flatMap((m) => [m.from, m.to].filter((id) => id !== null)),
    ]);
    // One entry, so one Undo reverses the pass; it is named for its main change.
    const action = moves.length
      ? "thread-moved"
      : created.length
        ? "workstream-created"
        : renamed.length
          ? "workstream-renamed"
          : "workstream-removed";
    const said = summary.join(", ");
    return {
      action,
      source: "workstreams",
      status: failed ? "failed" : "applied",
      rationale: `${said[0]!.toUpperCase()}${said.slice(1)}`,
      threads: moves.map((m) => ({ id: m.threadId, name: m.title })),
      workstreams: [...touched].map((id) => ({ id, name: this.nameOf(id) })),
      undo: null,
      detail,
    };
  }
}
