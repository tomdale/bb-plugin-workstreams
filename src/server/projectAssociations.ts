import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ProjectChoice } from "../domain/projectChoice.ts";
import {
  projectLearningPlan,
  type ProjectLearningDecision,
  type ProjectThread,
} from "../domain/projectLearning.ts";
import { workstreamPath } from "../domain/workstream-path.ts";
import { workstreamAncestors, type Workstream } from "../domain/workstreams.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import type { Journal, JournalEntry } from "./journal.ts";
import type { WorkstreamStore } from "./workstreams.ts";
import { displayTitle, type InventoryThread } from "./inventory.ts";

type Sdk = BbPluginApi["sdk"];
type Thread = Awaited<ReturnType<Sdk["threads"]["list"]>>[number];
type Project = Awaited<ReturnType<Sdk["projects"]["list"]>>[number];
/** The facts about a thread that decide whether and how it votes. */
type Observed = Pick<
  Thread,
  | "id"
  | "projectId"
  | "title"
  | "visibility"
  | "deletedAt"
  | "parentThreadId"
  | "sourceThreadId"
> &
  Partial<Pick<Thread, "titleFallback" | "originPluginId" | "originKind">>;
type Source =
  "unknown" | "historical" | "independent" | "workstreams" | "derived";
type SuggestionRow = {
  id: string;
  workstream_id: string;
  association_revision: number;
  project_id: string | null;
  evidence: string;
  status: string;
};

export type ProjectSuggestion = {
  id: string;
  workstreamId: string;
  workstream: string;
  fromProject: string;
  toProject: string | null;
  reason: string;
  threads: { id: string; name: string; project: string }[];
};

/** A full sweep of BB's threads catches project moves and missed deletes. */
const SWEEP_EVERY_MS = 24 * 60 * 60_000;
/** How long the project list is trusted before it is read again. */
const PROJECTS_EVERY_MS = 10 * 60_000;
const SWEPT_KEY = "project-learning-swept-at";

const derived = (
  thread: Pick<Thread, "parentThreadId" | "sourceThreadId"> &
    Partial<Pick<Thread, "originPluginId" | "originKind">>,
) =>
  Boolean(
    thread.parentThreadId ||
    thread.sourceThreadId ||
    thread.originPluginId ||
    thread.originKind,
  );

/**
 * Learns workstream projects from the threads stored in `ws_project_thread`
 * (who chose each project) and `ws_project_listing` (what BB last reported
 * about each thread that may vote), joined with each thread's workstream.
 * Archived threads keep their rows and keep voting. The rows follow dispatches,
 * deletions, and the reconciler's active threads; a full sweep of BB's threads
 * runs once to bootstrap historical work and daily after that, because BB has
 * no event for a project move and deletions can be missed while the plugin is
 * down.
 */
export class ProjectAssociations {
  private pending: Promise<void> | null = null;
  private disposed = false;
  private projects: Project[] = [];
  /** When `projects` was read; null forces a read before the next plan. */
  private projectsAt: number | null = null;
  /** The inputs of the last plan applied, serialized. */
  private planned: string | null = null;
  private readonly since: number;

  constructor(
    private deps: {
      db: Database;
      sdk: () => Sdk;
      workstreamStore: WorkstreamStore;
      journal: Journal;
      exclusive: <T>(task: () => Promise<T>) => Promise<T>;
      onChange: () => void;
    },
  ) {
    const stored = getMeta(deps.db, "project-learning-since");
    this.since = stored ? Number(stored) : Date.now();
    if (!stored) setMeta(deps.db, "project-learning-since", String(this.since));
  }

  /** Keep supplied-project provenance through banner reloads for this draft. */
  draftChoice(
    key: string,
    choice: ProjectChoice | null | undefined,
  ): ProjectChoice | null {
    if (!choice) return null;
    const { db } = this.deps;
    const previous = db
      .prepare(
        "SELECT project_id, source FROM ws_project_draft WHERE draft_key = ?",
      )
      .get(key) as
      { project_id: string; source: ProjectChoice["source"] } | undefined;
    const source =
      previous?.project_id === choice.projectId &&
      previous.source === "workstreams"
        ? "workstreams"
        : choice.source;
    db.prepare(
      `INSERT INTO ws_project_draft (draft_key, project_id, source, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(draft_key) DO UPDATE SET project_id = excluded.project_id, source = excluded.source, at = excluded.at`,
    ).run(key, choice.projectId, source, Date.now());
    db.prepare(
      "DELETE FROM ws_project_draft WHERE draft_key NOT IN (SELECT draft_key FROM ws_project_draft ORDER BY at DESC LIMIT 500)",
    ).run();
    return { projectId: choice.projectId, source };
  }

  /**
   * Records what BB reports about a thread: its project and title while it is a
   * visible, undeleted top-level thread that nothing derived, and nothing
   * otherwise.
   */
  observe(thread: Observed): void {
    if (
      this.projectsAt !== null &&
      !this.projects.some((project) => project.id === thread.projectId)
    )
      this.projectsAt = null;
    if (thread.visibility === "hidden" || thread.deletedAt || derived(thread))
      this.deps.db
        .prepare("DELETE FROM ws_project_listing WHERE thread_id = ?")
        .run(thread.id);
    else
      this.deps.db
        .prepare(
          `INSERT INTO ws_project_listing (thread_id, project_id, name) VALUES (?, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET project_id = excluded.project_id, name = excluded.name`,
        )
        .run(thread.id, thread.projectId, displayTitle(thread));
  }

  /**
   * Refreshes the project and title of observed threads from the
   * reconciler's visible, non-archived threads, without another listing.
   */
  observeActive(threads: readonly InventoryThread[]): void {
    const update = this.deps.db.prepare(
      `UPDATE ws_project_listing SET project_id = ?, name = ?
      WHERE thread_id = ? AND (project_id <> ? OR name <> ?)`,
    );
    this.deps.db.transaction(() => {
      for (const thread of threads)
        update.run(
          thread.projectId,
          thread.title,
          thread.id,
          thread.projectId,
          thread.title,
        );
    })();
  }

  /**
   * A late draft report may confirm an unknown thread, but never rehabilitates
   * a supplied project.
   */
  recordChoice(
    thread: Observed,
    choice: ProjectChoice | null | undefined,
    independentThread = true,
  ): void {
    this.observe(thread);
    const source: Source =
      derived(thread) || !independentThread
        ? "derived"
        : choice?.projectId === thread.projectId
          ? choice.source
          : "unknown";
    const current = this.deps.db
      .prepare("SELECT source FROM ws_project_thread WHERE thread_id = ?")
      .get(thread.id) as { source: Source } | undefined;
    if (
      current &&
      (current.source === "workstreams" ||
        current.source === "derived" ||
        source === "unknown")
    )
      return;
    this.deps.db
      .prepare(
        `INSERT INTO ws_project_thread (thread_id, project_id, source) VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET project_id = excluded.project_id, source = excluded.source`,
      )
      .run(thread.id, thread.projectId, source);
  }

  forget(threadId: string): void {
    this.deps.db
      .prepare("DELETE FROM ws_project_thread WHERE thread_id = ?")
      .run(threadId);
    this.deps.db
      .prepare("DELETE FROM ws_project_listing WHERE thread_id = ?")
      .run(threadId);
  }

  dispose(): void {
    this.disposed = true;
  }

  /**
   * Applies what the stored history now supports. It sweeps BB's threads
   * first when `sweep` asks, when no sweep has completed, or when the last is
   * a day old; otherwise it reads no threads from BB.
   */
  reconcile(options: { sweep?: boolean } = {}): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.pending)
      this.pending = this.learn(options.sweep ?? false)
        .catch((error) => {
          if (!this.disposed) throw error;
        })
        .finally(() => {
          this.pending = null;
        });
    return this.pending;
  }

  private async learn(force: boolean): Promise<void> {
    const sdk = this.deps.sdk();
    const now = Date.now();
    const sweptAt = Number(getMeta(this.deps.db, SWEPT_KEY) ?? 0);
    const sweep = force || !(now - sweptAt < SWEEP_EVERY_MS);
    const refresh =
      sweep ||
      this.projectsAt === null ||
      !(now - this.projectsAt < PROJECTS_EVERY_MS);
    if (!refresh && this.inputs(this.projects) === this.planned) return;
    let threads: Thread[] | null = null;
    if (sweep) {
      threads = [];
      for (const archived of [false, true]) {
        for (let offset = 0; ; offset += 100) {
          const page = await sdk.threads.list({
            archived,
            includeHidden: true,
            limit: 100,
            offset,
          });
          if (this.disposed) return;
          threads.push(...page);
          if (page.length < 100) break;
        }
      }
    }
    const projects = refresh ? await sdk.projects.list({}) : this.projects;
    if (this.disposed) return;
    await this.deps.exclusive(async () => {
      if (this.disposed) return;
      const projectsChanged =
        JSON.stringify(this.projects) !== JSON.stringify(projects);
      this.projects = projects;
      if (refresh) this.projectsAt = now;
      const changed = this.deps.db.transaction(() => {
        if (threads) {
          this.sweep(threads);
          setMeta(this.deps.db, SWEPT_KEY, String(now));
        }
        const inputs = this.inputs(projects);
        if (inputs === this.planned) return false;
        const changed = this.apply();
        this.planned = inputs;
        return changed;
      })();
      if (changed || projectsChanged) this.deps.onChange();
    });
  }

  /** Everything a plan depends on, serialized. */
  private inputs(projects: readonly Project[]): string {
    return JSON.stringify([
      this.deps.workstreamStore.list(),
      this.roots(),
      projects.map((project) => project.id),
    ]);
  }

  /**
   * Records every thread BB lists, forgets the ones it no longer has, and
   * gives eligible threads seen for the first time their provenance: work
   * created before learning began is historical evidence unless its workstream
   * already had a project setting; anything newer is unknown and never votes.
   */
  private sweep(threads: readonly Thread[]): void {
    const { db, workstreamStore } = this.deps;
    const present = new Set(threads.map((thread) => thread.id));
    for (const { thread_id } of db
      .prepare(
        "SELECT thread_id FROM ws_project_thread UNION SELECT thread_id FROM ws_project_listing",
      )
      .all() as { thread_id: string }[])
      if (!present.has(thread_id)) this.forget(thread_id);
    const known = new Set(
      (
        db.prepare("SELECT thread_id FROM ws_project_thread").all() as {
          thread_id: string;
        }[]
      ).map((row) => row.thread_id),
    );
    const workstreams = workstreamStore.list();
    const assigned = new Map(
      (
        db
          .prepare(
            "SELECT thread_id, workstream_id FROM ws_thread_workstream WHERE workstream_id IS NOT NULL",
          )
          .all() as { thread_id: string; workstream_id: string }[]
      ).map((row) => [row.thread_id, row.workstream_id]),
    );
    const insert = db.prepare(
      "INSERT OR IGNORE INTO ws_project_thread (thread_id, project_id, source) VALUES (?, ?, ?)",
    );
    for (const thread of threads) {
      this.observe(thread);
      if (
        known.has(thread.id) ||
        thread.visibility === "hidden" ||
        thread.deletedAt ||
        derived(thread)
      )
        continue;
      const workstreamId = assigned.get(thread.id);
      // Old composers did not report who chose the project. Only unassociated
      // historical work bootstraps learning; new unknown choices never vote.
      const configured =
        workstreamId &&
        workstreamAncestors(workstreamId, workstreams).some((id) => {
          const workstream = workstreams.find(
            (workstream) => workstream.id === id,
          )!;
          return workstream.projectId || workstream.projectSource;
        });
      insert.run(
        thread.id,
        thread.projectId,
        thread.createdAt < this.since && !configured ? "historical" : "unknown",
      );
    }
  }

  /**
   * Independent top-level threads that vote: observed as eligible, outside
   * Personal, still in the project their choice recorded, and in a workstream.
   * Archived threads count.
   */
  private roots(): ProjectThread[] {
    return this.deps.db
      .prepare(
        `SELECT r.thread_id AS id, r.name, r.project_id AS projectId, s.workstream_id AS workstreamId
        FROM ws_project_listing r
        JOIN ws_project_thread p ON p.thread_id = r.thread_id
        JOIN ws_thread_workstream s ON s.thread_id = r.thread_id
        WHERE p.project_id = r.project_id
          AND p.source IN ('historical', 'independent')
          AND r.project_id <> 'proj_personal'
          AND s.workstream_id IS NOT NULL
        ORDER BY r.thread_id`,
      )
      .all() as ProjectThread[];
  }

  private plan(): ProjectLearningDecision[] {
    return projectLearningPlan(
      this.deps.workstreamStore.list(),
      this.roots(),
      new Set(
        this.projects.filter((p) => p.id !== "proj_personal").map((p) => p.id),
      ),
    );
  }

  private apply(): boolean {
    const { db, workstreamStore } = this.deps;
    let changed = false;
    const pending = new Set<string>();
    for (const decision of this.plan()) {
      const workstream = workstreamStore.getById(decision.workstreamId)!;
      if (decision.kind === "learn") {
        const next = workstreamStore.edit(workstream.id, {
          projectId: decision.projectId,
          projectSource: "learned",
        });
        this.record(workstream, next, "workstreams", decision.threads);
        changed = true;
      } else {
        const id = createHash("sha256")
          .update(
            JSON.stringify([
              workstream.id,
              workstream.projectRevision,
              decision.projectId,
            ]),
          )
          .digest("hex");
        pending.add(id);
        const row = db
          .prepare("SELECT * FROM ws_project_suggestion WHERE id = ?")
          .get(id) as SuggestionRow | undefined;
        if (row?.status === "declined" || row?.status === "accepted") continue;
        const evidence = JSON.stringify(decision.threads);
        if (!row || row.status !== "pending" || row.evidence !== evidence) {
          db.prepare(
            `INSERT INTO ws_project_suggestion (id, workstream_id, association_revision, project_id, evidence, status) VALUES (?, ?, ?, ?, ?, 'pending')
            ON CONFLICT(id) DO UPDATE SET evidence = excluded.evidence, status = 'pending'`,
          ).run(
            id,
            workstream.id,
            workstream.projectRevision ?? 0,
            decision.projectId,
            evidence,
          );
          changed = true;
        }
      }
    }
    for (const row of db
      .prepare("SELECT id FROM ws_project_suggestion WHERE status = 'pending'")
      .all() as { id: string }[]) {
      if (pending.has(row.id)) continue;
      db.prepare(
        "UPDATE ws_project_suggestion SET status = 'stale' WHERE id = ?",
      ).run(row.id);
      changed = true;
    }
    db.prepare(
      `DELETE FROM ws_project_suggestion WHERE status = 'stale' OR NOT EXISTS
      (SELECT 1 FROM ws_workstream WHERE id = workstream_id AND project_revision = association_revision)`,
    ).run();
    return changed;
  }

  private projectName(id: string | null | undefined): string {
    return (
      this.projects.find((project) => project.id === id)?.name ??
      "Unavailable project"
    );
  }

  state(): ProjectSuggestion[] {
    return (
      this.deps.db
        .prepare(
          "SELECT * FROM ws_project_suggestion WHERE status = 'pending' ORDER BY workstream_id, id",
        )
        .all() as SuggestionRow[]
    ).flatMap((row) => {
      const workstream = this.deps.workstreamStore.getById(row.workstream_id);
      if (
        !workstream ||
        workstream.projectSource !== "learned" ||
        workstream.projectRevision !== row.association_revision
      )
        return [];
      const roots = JSON.parse(row.evidence) as ProjectThread[];
      return [
        {
          id: row.id,
          workstreamId: workstream.id,
          workstream: workstreamPath(
            workstream.id,
            this.deps.workstreamStore.list(),
          ),
          fromProject: this.projectName(workstream.projectId),
          toProject: row.project_id ? this.projectName(row.project_id) : null,
          reason: row.project_id
            ? "Threads of their own consistently use a different project."
            : new Set(roots.map((thread) => thread.projectId)).size > 1
              ? "Threads of their own use different projects."
              : "The project used by these independent threads is unavailable.",
          threads: roots.map((thread) => ({
            id: thread.id,
            name: thread.name,
            project: this.projectName(thread.projectId),
          })),
        },
      ];
    });
  }

  async decide(
    id: string,
    decision: "accept" | "decline",
  ): Promise<JournalEntry> {
    while (this.pending) await this.pending;
    await this.reconcile({ sweep: true });
    return this.deps.exclusive(async () => {
      const entry = this.deps.db.transaction(() => {
        const row = this.deps.db
          .prepare("SELECT * FROM ws_project_suggestion WHERE id = ?")
          .get(id) as SuggestionRow | undefined;
        const workstream =
          row && this.deps.workstreamStore.getById(row.workstream_id);
        if (
          !row ||
          row.status !== "pending" ||
          !workstream ||
          workstream.projectSource !== "learned" ||
          workstream.projectRevision !== row.association_revision
        )
          throw new Error(
            "This project suggestion is out of date. Review the current history.",
          );
        this.deps.db
          .prepare(
            "UPDATE ws_project_suggestion SET status = ?, evidence = '[]' WHERE id = ?",
          )
          .run(decision === "accept" ? "accepted" : "declined", id);
        const roots = JSON.parse(row.evidence) as ProjectThread[];
        if (decision === "accept") {
          const next = this.deps.workstreamStore.edit(workstream.id, {
            projectId: row.project_id,
          });
          return this.record(workstream, next, "you", roots);
        }
        return this.deps.journal.add({
          action: "project-learned",
          source: "you",
          status: "declined",
          rationale: `Kept the project for ${workstream.name}`,
          threads: roots.map(({ id, name }) => ({ id, name })),
          workstreams: [],
          undo: null,
        });
      })();
      this.deps.onChange();
      return entry;
    });
  }

  updateMetadata(
    workstreamId: string,
    updates: Parameters<WorkstreamStore["updateMetadata"]>[1],
    projects?: Project[],
  ): Workstream {
    if (projects) this.projects = projects;
    return this.deps.db.transaction(() => {
      const before = this.deps.workstreamStore.getById(workstreamId);
      const next = this.deps.workstreamStore.updateMetadata(
        workstreamId,
        updates,
      );
      if (before && before.projectRevision !== next.projectRevision)
        this.record(before, next, "you", []);
      return next;
    })();
  }

  private record(
    before: Workstream,
    after: Workstream,
    source: "you" | "workstreams",
    roots: readonly ProjectThread[],
  ): JournalEntry {
    const name = after.projectId
      ? this.projectName(after.projectId)
      : after.projectSource === "disabled"
        ? "No associated project"
        : "Automatic";
    return this.deps.journal.add({
      action: "project-learned",
      source,
      rationale: `${source === "workstreams" ? "Learned" : "Set"} the project for ${after.name}: ${name}`,
      threads: roots.map(({ id, name }) => ({ id, name })),
      workstreams: [...this.deps.workstreamStore.groups()]
        .filter(([, id]) => id === after.id)
        .map(([id]) => ({ id, name: after.name })),
      detail: `${workstreamPath(after.id, this.deps.workstreamStore.list())} → ${name}${roots.length ? `; ${roots.length} threads of its own` : ""}`,
      undo: {
        kind: "project-association",
        workstreamId: after.id,
        from: {
          projectId: before.projectId ?? null,
          source: before.projectSource ?? null,
        },
        to: {
          projectId: after.projectId ?? null,
          source: after.projectSource ?? null,
          revision: after.projectRevision ?? 0,
        },
        disableLearning:
          source === "workstreams" &&
          !before.projectId &&
          !before.projectSource,
      },
    });
  }
}
