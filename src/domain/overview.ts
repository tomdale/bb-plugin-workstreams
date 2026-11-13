/**
 * A workstream's Overview: one row for each root thread the workstream lists,
 * with its status, a one-line summary, and what comes next. Every field comes
 * from the thread's stored recap and analysis, so the Overview asks no model.
 * Pure, so the page and tests share one definition.
 */
import { itemParts, type NextAction, type Recap } from "./recap.ts";
import { statusRole } from "./presentation.ts";
import type { WorkView } from "./status.ts";
import { isRunning } from "./upNext.ts";

/** A row's status, in the order rows are listed. */
export const OVERVIEW_STATUSES = [
  "needs-you",
  "review",
  "failed",
  "working",
  "waiting",
  "complete",
  "other",
] as const;
export type OverviewStatus = (typeof OVERVIEW_STATUSES)[number];

const STATUS_LABEL: Record<OverviewStatus, string> = {
  "needs-you": "Needs you",
  review: "Ready for review",
  failed: "Failed",
  working: "Working",
  waiting: "Waiting",
  complete: "Complete",
  other: "",
};

export const FAILED_SUMMARY =
  "The last turn failed. Open the thread to see why.";

/** The thread fields a row reads. */
export type OverviewThread = {
  readonly id: string;
  readonly status: string;
  readonly indicator: string;
  readonly hasPendingInteraction: boolean;
  readonly isUnread: boolean;
  readonly latestAttentionAt: number;
  readonly runtimeStatus?: string;
  readonly queuedWork?: string;
  readonly activity?: object;
};

/** What a row's Next steps cell holds; a row uses the parts its status calls for. */
export type OverviewNext = {
  /** What the thread asks of the user. */
  readonly prompt: string | null;
  /** A review recap's steps. */
  readonly steps: readonly { text: string; detail?: string }[];
  /** The recap's proposed follow-ups, at most three. */
  readonly actions: readonly NextAction[];
  /** A waiting recap, whose awaited agents and status check the cell shows. */
  readonly waiting: Recap | null;
  /** A finished thread with no follow-up left offers Archive. */
  readonly archive: boolean;
};

export type OverviewRow<T extends OverviewThread> = {
  readonly thread: T;
  readonly status: OverviewStatus;
  readonly label: string;
  /** Inline Markdown, as a recap line is. */
  readonly summary: string | null;
  readonly next: OverviewNext;
  /** The recap an action is sent against, when the row shows one. */
  readonly recapId: string | null;
};

const NO_NEXT: OverviewNext = {
  prompt: null,
  steps: [],
  actions: [],
  waiting: null,
  archive: false,
};

/** Work still attached to the thread, which keeps Archive from being offered. */
function hasActiveWork(thread: OverviewThread): boolean {
  return (
    thread.status !== "idle" ||
    (thread.runtimeStatus !== undefined && thread.runtimeStatus !== "idle") ||
    (thread.queuedWork !== undefined && thread.queuedWork !== "none") ||
    thread.hasPendingInteraction ||
    Object.values(thread.activity ?? {}).some(
      (count) => typeof count === "number" && count > 0,
    )
  );
}

/**
 * A row's status. It follows the sidebar's status mark (`slotMarkFor`), except
 * that a finished thread reads Complete whether or not it has been read, and
 * a message sent from the Overview reads Working until its turn starts.
 */
export function overviewStatus(
  thread: OverviewThread,
  work: WorkView,
  sent = false,
): OverviewStatus {
  const role = statusRole(thread.indicator);
  if (sent) return "working";
  if (role === "error" || thread.status === "error") return "failed";
  if (role === "working" || isRunning(thread)) return "working";
  const state = work.kind === "current" ? work.analysis.state : undefined;
  if (
    role === "waiting" ||
    thread.hasPendingInteraction ||
    state === "needs_decision"
  )
    return "needs-you";
  if (state === "review") return "review";
  if (state === "in_progress" && work.kind === "current" && work.reported)
    return "waiting";
  if (state === "done") return "complete";
  return "other";
}

/** One thread's row. `sent` is a message sent from the Overview and not yet answered. */
export function overviewRow<T extends OverviewThread>(
  thread: T,
  work: WorkView,
  recap: Recap | undefined,
  sent?: string,
): OverviewRow<T> {
  const status = overviewStatus(thread, work, sent !== undefined);
  const base = { thread, status, label: STATUS_LABEL[status] };
  if (sent !== undefined)
    return {
      ...base,
      summary: `You sent: ${sent}`,
      next: NO_NEXT,
      recapId: null,
    };
  if (status === "failed")
    return { ...base, summary: FAILED_SUMMARY, next: NO_NEXT, recapId: null };
  if (status === "working")
    return { ...base, summary: null, next: NO_NEXT, recapId: null };
  const analysis = work.kind === "current" ? work.analysis : null;
  const summary = analysis?.recap || null;
  if (status === "needs-you")
    return {
      ...base,
      summary,
      next: { ...NO_NEXT, prompt: analysis?.needsYou ?? null },
      recapId: null,
    };
  // A stored recap describes the latest turn only while the thread is idle.
  const shown = recap && thread.status === "idle" ? recap : null;
  if (!shown) return { ...base, summary, next: NO_NEXT, recapId: null };
  const actions = shown.state === "waiting" ? [] : shown.next.slice(0, 3);
  return {
    ...base,
    // The agent's own line keeps its Markdown: mentions and commit hashes.
    summary: shown.goal || summary,
    recapId: shown.id,
    next: {
      prompt: null,
      steps: shown.state === "review" ? shown.review.map(itemParts) : [],
      actions,
      waiting: shown.state === "waiting" ? shown : null,
      archive:
        shown.state === "complete" &&
        actions.length === 0 &&
        !hasActiveWork(thread),
    },
  };
}

/** Rows by status in `OVERVIEW_STATUSES` order, newest turn first within one. */
export function sortOverviewRows<T extends OverviewThread>(
  rows: readonly OverviewRow<T>[],
): OverviewRow<T>[] {
  return [...rows].sort(
    (a, b) =>
      OVERVIEW_STATUSES.indexOf(a.status) -
        OVERVIEW_STATUSES.indexOf(b.status) ||
      b.thread.latestAttentionAt - a.thread.latestAttentionAt,
  );
}

/** The line under the workstream's name: "17 threads. 1 needs you and 3 are ready for review." */
export function overviewCounts(
  rows: readonly { readonly status: OverviewStatus }[],
): string {
  const count = (status: OverviewStatus) =>
    rows.filter((row) => row.status === status).length;
  const total = `${rows.length} ${rows.length === 1 ? "thread" : "threads"}.`;
  const needs = count("needs-you");
  const review = count("review");
  const parts = [
    needs ? `${needs} ${needs === 1 ? "needs" : "need"} you` : null,
    review ? `${review} ${review === 1 ? "is" : "are"} ready for review` : null,
  ].filter((part) => part !== null);
  return parts.length ? `${total} ${parts.join(" and ")}.` : total;
}

/** The message a next action sends, and the label its button shows. */
export const nextActionParts = (action: NextAction) =>
  typeof action === "string"
    ? { title: action, message: action, description: undefined }
    : action;
