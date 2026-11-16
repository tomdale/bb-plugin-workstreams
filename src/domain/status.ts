/**
 * A thread's work status: one rule for every surface and for the organizer.
 *
 * The thread's agent reports how its turn ended through the recap tool, and
 * that report outranks analysis for the turn it describes. Analysis supplies
 * the status of turns the agent didn't report, and the goal either way. The
 * sidebar, the page, the phone Home screen, the CLI, the organizer, and
 * routing all read status through this module so they never disagree about
 * whether a thread is complete or needs you.
 */
import { isCurrent, type StoredAnalysis } from "./analysis.ts";
import { reportedAnalysis, type Recap } from "./recap.ts";

/**
 * What is known about a thread's latest turn: nothing, a pending marker over
 * the previous result, or the current result. `reported` marks a result the
 * thread's agent reported in its recap rather than one analysis inferred.
 */
export type WorkView =
  | { kind: "none" }
  | { kind: "pending"; previous: StoredAnalysis }
  | { kind: "current"; analysis: StoredAnalysis; reported: boolean };

/** The thread fields status depends on. */
type StatusThread = {
  readonly status: string;
  readonly latestAttentionAt: number;
};

const NO_ANALYSIS = {};
const NO_RECAP = {};
/** Identity snapshots keep their own entries when other threads change. */
const workViews = new WeakMap<
  StatusThread,
  WeakMap<object, WeakMap<object, WorkView>>
>();

/**
 * The agent's recap of an idle thread's latest turn outranks analysis for
 * the work state and the one-line summary; a current analysis still supplies
 * the goal. A stored recap always describes the latest turn, because fresh
 * input clears it.
 */
export function workView(
  thread: StatusThread,
  analysis: StoredAnalysis | undefined,
  recap?: Recap,
): WorkView {
  let analyses = workViews.get(thread);
  if (!analyses) {
    analyses = new WeakMap();
    workViews.set(thread, analyses);
  }
  const analysisKey = analysis ?? NO_ANALYSIS;
  let recaps = analyses.get(analysisKey);
  if (!recaps) {
    recaps = new WeakMap();
    analyses.set(analysisKey, recaps);
  }
  const recapKey = recap ?? NO_RECAP;
  const cached = recaps.get(recapKey);
  if (cached) return cached;

  const view = deriveWorkView(thread, analysis, recap);
  recaps.set(recapKey, view);
  return view;
}

function deriveWorkView(
  thread: StatusThread,
  analysis: StoredAnalysis | undefined,
  recap?: Recap,
): WorkView {
  // A failed turn gets neither; BB's own error mark says enough.
  if (thread.status === "error") return { kind: "none" };
  // A cancelled Waiting recap no longer describes what the thread is doing.
  if (recap && !recap.cancelled && thread.status === "idle")
    return {
      kind: "current",
      reported: true,
      analysis: reportedAnalysis(
        recap,
        thread,
        isCurrent(analysis, thread) ? analysis : undefined,
      ),
    };
  if (!analysis) return { kind: "none" };
  return isCurrent(analysis, thread)
    ? { kind: "current", analysis, reported: false }
    : { kind: "pending", previous: analysis };
}

/** Needs input: a pending interaction, or a current needs-input result. */
export function needsInput(
  thread: { readonly hasPendingInteraction: boolean },
  work: WorkView,
): boolean {
  return (
    thread.hasPendingInteraction ||
    (work.kind === "current" && work.analysis.state === "needs-input")
  );
}

/**
 * Needs you: Needs input or Blocked, the threads the header count counts.
 * A finished turn, even one with Next actions, is Complete and not counted.
 */
export function needsYou(
  thread: { readonly hasPendingInteraction: boolean },
  work: WorkView,
): boolean {
  return (
    needsInput(thread, work) ||
    (work.kind === "current" && work.analysis.state === "blocked")
  );
}

/** Up Next also surfaces finished or reviewable turns the user has not read. */
export function needsAttention(
  thread: {
    readonly hasPendingInteraction: boolean;
    readonly isUnread?: boolean;
  },
  work: WorkView,
): boolean {
  return (
    needsYou(thread, work) ||
    Boolean(
      thread.isUnread &&
      work.kind === "current" &&
      (work.analysis.state === "complete" || work.analysis.state === "review"),
    )
  );
}

/**
 * How a thread's latest turn left things, as Up Next ranks it: waiting on
 * the user (a pending question or approval, a turn that ended needing input,
 * or a blocked turn) or a review; still waiting on an external task (the
 * agent reported Waiting); or anything else, such as complete. A thread
 * asking a question is a `question` even when its latest turn is also ready
 * for review.
 */
export type UpNextKind = "question" | "review" | "waiting" | "other";

export function upNextKind(
  thread: { readonly hasPendingInteraction: boolean },
  work: WorkView,
): UpNextKind {
  if (needsYou(thread, work)) return "question";
  if (work.kind !== "current") return "other";
  if (work.analysis.state === "review") return "review";
  return work.analysis.state === "waiting" ? "waiting" : "other";
}

/**
 * Complete: the agent reported its turn complete, or analysis of the current
 * turn found the work finished. Complete threads don't count toward a
 * workstream's active load.
 */
export function isComplete(work: WorkView): boolean {
  return work.kind === "current" && work.analysis.state === "complete";
}
