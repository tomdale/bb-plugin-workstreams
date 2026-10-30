/**
 * Renames, on request, the threads Workstreams titled in an earlier title
 * form: each title it wrote and still owns is rewritten in the current form
 * (`GOAL_FORM`) from the title, the thread's objective, and where the thread
 * is listed. Titles renamed elsewhere, by you or BB, stay. The stored goal
 * moves with the title, so the next analysis keeps the new one.
 *
 * Renaming goes through the retitle policy, which renames only idle
 * threads, so a thread whose turn is running is skipped and can be renamed
 * by running this again.
 */
import type { ThreadListing } from "../domain/analysis.ts";
import type { ModelChoice } from "../domain/prefs.ts";
import type { Database } from "./db.ts";
import type { InventoryThread } from "./inventory.ts";
import type { Inference } from "./model.ts";
import { readTitleRecord } from "./titles.ts";

/** Model calls in flight at once. */
const CONCURRENCY = 4;

export type RestyleOutcome = {
  readonly threadId: string;
  readonly from: string;
  /** The new title; null when the model gave none that fits. */
  readonly to: string | null;
  /** Renamed, only proposed (a dry run), already in form, or skipped and why. */
  readonly result: "renamed" | "proposed" | "unchanged" | "skipped";
  readonly reason?: string;
};

export async function restyleTitles(
  deps: {
    db: Database;
    inference: Inference;
    model: () => Promise<ModelChoice>;
    /** Visible threads, roots and children. */
    threads: () => readonly InventoryThread[];
    listing: (thread: InventoryThread) => ThreadListing;
    /** The thread's durable objective, when analysis settled one. */
    objective: (threadId: string) => string | null;
    retitle: (
      threadId: string,
      title: string,
      revision: number,
    ) => Promise<{ skipped: string | null }>;
    renameGoal: (threadId: string, title: string) => void;
  },
  options: { apply: boolean },
): Promise<RestyleOutcome[]> {
  const owned = deps.threads().filter((thread) => {
    if (thread.isArchived || thread.isHidden || !thread.ownTitle) return false;
    const record = readTitleRecord(deps.db, thread.id);
    return (
      record !== undefined &&
      !record.locked &&
      record.written !== null &&
      record.written === thread.ownTitle
    );
  });
  const model = await deps.model();
  const outcomes: RestyleOutcome[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < owned.length) {
        const thread = owned[cursor++]!;
        const from = thread.ownTitle!;
        const listing = deps.listing(thread);
        let to: string | null;
        try {
          ({ title: to } = (
            await deps.inference.run(
              "restyle",
              { title: from, objective: deps.objective(thread.id), listing },
              {
                model,
                threadId: thread.id,
                label: from,
                links: [{ kind: "thread", ref: thread.id }],
              },
            )
          ).value);
        } catch (error) {
          outcomes.push({
            threadId: thread.id,
            from,
            to: null,
            result: "skipped",
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        if (!to) {
          outcomes.push({
            threadId: thread.id,
            from,
            to,
            result: "skipped",
            reason: "no title that fits",
          });
          continue;
        }
        if (to === from) {
          outcomes.push({ threadId: thread.id, from, to, result: "unchanged" });
          continue;
        }
        if (!options.apply) {
          outcomes.push({ threadId: thread.id, from, to, result: "proposed" });
          continue;
        }
        const { skipped } = await deps.retitle(
          thread.id,
          to,
          thread.latestAttentionAt,
        );
        if (skipped) {
          outcomes.push({
            threadId: thread.id,
            from,
            to,
            result: "skipped",
            reason: skipped,
          });
          continue;
        }
        deps.renameGoal(thread.id, to);
        outcomes.push({ threadId: thread.id, from, to, result: "renamed" });
      }
    }),
  );
  return outcomes.sort((a, b) => a.from.localeCompare(b.from));
}
