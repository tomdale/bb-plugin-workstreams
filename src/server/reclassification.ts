import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { repairPreviewSchema, type RepairPreview } from "./contract.ts";
import type { Analyzer } from "./analyzer.ts";
import type { WorkstreamStore } from "./workstreams.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import { assignmentEvidence, threadEvidence } from "./evidence.ts";
import { PATH_SEPARATOR, workstreamPath } from "../domain/workstream-path.ts";
const KEY = "repair_preview";
const LIFETIME = 30 * 60_000;
function missing(error: unknown): boolean {
  const e = error as { status?: number; statusCode?: number; code?: string };
  return e?.status === 404 || e?.statusCode === 404 || e?.code === "not_found";
}

/** Reviewable workstream repair, independent of goal/title and status application. */
export class Repair {
  private applying = false;
  constructor(
    private readonly deps: {
      db: Database;
      sdk: () => BbPluginApi["sdk"];
      workstreamStore: WorkstreamStore;
      analyzer: Analyzer;
      onChange: (row: RepairPreview["rows"][number]) => void;
    },
  ) {}
  async preview(threadIds: readonly string[]): Promise<RepairPreview> {
    if (this.applying)
      throw new Error(
        "A preview is being applied. Wait before previewing again.",
      );
    if (!threadIds.length || threadIds.length > 100)
      throw new Error(
        "Preview 1–100 threads. For larger sets, preview one thread at a time with bb workstreams preview <thread-id>.",
      );
    const plan: RepairPreview = {
      id: randomUUID(),
      at: Date.now(),
      definitionKey: this.deps.workstreamStore.definitionKey(),
      rows: [],
      excludedManual: 0,
    };
    for (const threadId of new Set(threadIds)) {
      const current = this.deps.workstreamStore.assignment(threadId);
      if (current.provenance === "manual") {
        plan.excludedManual++;
        continue;
      }
      try {
        if (
          this.deps.workstreamStore.findParentmostThread(threadId) !== threadId
        )
          throw new Error("A child thread goes wherever its parent goes.");
        const row = await this.deps.analyzer.previewWorkstream(threadId);
        const proposal = row.answer.proposed;
        const workstreams = this.deps.workstreamStore.list();
        const to = row.answer.workstreamId
          ? workstreamPath(row.answer.workstreamId, workstreams)
          : proposal
            ? [
                ...(proposal.parentId
                  ? [workstreamPath(proposal.parentId, workstreams)]
                  : []),
                ...(proposal.ancestors ?? []).map((a) => a.name),
                proposal.name,
              ].join(PATH_SEPARATOR)
            : null;
        plan.rows.push({ ...row, to, error: null });
      } catch (error) {
        const title = await this.deps
          .sdk()
          .threads.get({ threadId })
          .then((thread) => thread.title?.trim() || threadId)
          .catch(() => threadId);
        plan.rows.push({
          threadId,
          title,
          from: current.label,
          to: current.label,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (this.applying)
      throw new Error(
        "A preview is being applied. Preview again after it finishes.",
      );
    setMeta(this.deps.db, KEY, JSON.stringify(plan));
    return plan;
  }
  private read() {
    try {
      const raw = getMeta(this.deps.db, KEY);
      return raw ? repairPreviewSchema.parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  async apply(planId: string): Promise<{ changed: number; skipped: number }> {
    if (this.applying)
      throw new Error("That preview is already being applied.");
    const plan = this.read();
    if (!plan || plan.id !== planId)
      throw new Error("That reclassification preview is unavailable.");
    if (
      Date.now() - plan.at > LIFETIME ||
      this.deps.workstreamStore.definitionKey() !== plan.definitionKey
    )
      throw new Error(
        "The preview expired or the catalog changed. Preview again.",
      );
    this.applying = true;
    let changed = 0,
      skipped = 0;
    try {
      while (plan.rows.length) {
        const row = plan.rows[0]!;
        let applied = false;
        if (row.error || !row.answer) skipped++;
        else {
          const projects = await this.deps.sdk().projects.list();
          const live = await this.deps
            .sdk()
            .threads.get({ threadId: row.threadId })
            .catch((error) => {
              if (missing(error)) return null;
              throw error;
            });
          const assignment = this.deps.workstreamStore.assignment(row.threadId);
          const hint = live
            ? (projects.find((p) => p.id === live.projectId)?.name ?? null)
            : null;
          if (this.read()?.id !== planId)
            throw new Error("Another preview replaced this plan.");
          if (this.deps.workstreamStore.definitionKey() !== plan.definitionKey)
            throw new Error("The catalog changed; preview again.");
          if (
            !live ||
            assignment.provenance === "manual" ||
            threadEvidence(live) !== row.evidence ||
            (row.projectHint !== undefined && hint !== row.projectHint) ||
            assignmentEvidence(assignment) !== row.assignmentKey
          )
            skipped++;
          else if (
            this.deps.workstreamStore.applyAnalysis(
              row.threadId,
              {
                ...row.answer,
                scopeShift:
                  row.answer.scopeShift ||
                  assignment.provenance === "inherited",
              },
              "automatic",
              row.basis ?? null,
            )
          ) {
            changed++;
            applied = true;
          }
        }
        // A transient read can be retried without replaying this applied prefix.
        plan.rows.shift();
        plan.definitionKey = this.deps.workstreamStore.definitionKey();
        setMeta(this.deps.db, KEY, JSON.stringify(plan));
        // Notifications cannot make a committed row replayable on retry.
        if (applied) this.deps.onChange(row);
      }
      this.deps.db.prepare("DELETE FROM ws_meta WHERE key = ?").run(KEY);
      return { changed, skipped };
    } catch (error) {
      throw new Error(
        `Applying the preview paused after ${changed} moves. ${error instanceof Error ? error.message : String(error)} For a temporary read failure, retry the same preview; the moves it already made are kept.`,
      );
    } finally {
      this.applying = false;
    }
  }
}
