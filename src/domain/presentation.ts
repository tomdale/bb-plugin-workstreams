/**
 * Presentation facts derived from BB's live thread state. BB resolves a
 * thread's status into an `indicator`; the SDK ships no glyphs, so each list
 * draws its own. Unknown indicator kinds (BB adds them over time) fall back to
 * no glyph rather than a wrong one.
 */

type StatusRole = "working" | "waiting" | "error" | "unread" | "draft";

export function statusRole(indicator: string): StatusRole | null {
  switch (indicator) {
    case "runtime":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
      return "working";
    case "waiting-for-input":
    case "queued-waiting":
      return "waiting";
    case "unread-error":
    case "queued-failed":
      return "error";
    case "unread-success":
      return "unread";
    case "draft":
    case "working-draft":
      return "draft";
    default:
      return null;
  }
}

/** Compact age: "now", "5m", "3h", "2d", "6w". */
export function relativeAge(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** The same age spelled out for assistive technology: "3 minutes ago". */
export function relativeAgeLabel(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  const unit = (count: number, name: string) =>
    `${count} ${name}${count === 1 ? "" : "s"} ago`;
  if (minutes < 1) return "just now";
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 14) return unit(days, "day");
  return unit(Math.floor(days / 7), "week");
}

/**
 * The mark a thread row's leading slot shows, at most one per row. Broken
 * and in-flight states come from BB's live status; needs-you adds the
 * pending card and the analysis verdicts that wait on the user; waiting
 * covers a turn the agent reported waiting on a subagent or timer. Unread
 * is never the slot mark: needs-you rows carry it by the dot's fill, rows
 * with any other slot mark carry it as an inline dot beside the title, and
 * markless rows carry it by title weight alone (see the sidebar's Row).
 */
export type SlotMarkKind =
  "error" | "working" | "needs-you" | "waiting" | "draft";

export type SlotMark = {
  readonly kind: SlotMarkKind;
  readonly label: string;
};

type SlotThread = {
  readonly indicator: string;
  readonly hasPendingInteraction: boolean;
};

type SlotWork = {
  readonly kind: "none" | "pending" | "current";
  readonly analysis?: { readonly state: string };
  readonly reported?: boolean;
};

export function slotMarkFor(
  thread: SlotThread,
  work: SlotWork,
): SlotMark | null {
  const role = statusRole(thread.indicator);
  if (role === "error") return { kind: "error", label: "Failed" };
  if (role === "working") return { kind: "working", label: "Working" };
  const state = work.kind === "current" ? work.analysis?.state : undefined;
  if (
    role === "waiting" ||
    thread.hasPendingInteraction ||
    state === "needs_decision" ||
    state === "review"
  ) {
    return { kind: "needs-you", label: "Needs you" };
  }
  if (state === "in_progress" && work.reported)
    return { kind: "waiting", label: "Waiting" };
  if (role === "draft") return { kind: "draft", label: "Unsent draft" };
  return null;
}

/** The work state as words, for places that narrate rather than mark. */
export function workStateLabel(state: string, reported: boolean): string {
  if (reported && state === "in_progress") return "Waiting";
  if (reported && state === "done") return "Complete";
  switch (state) {
    case "needs_decision":
      return "Needs your decision";
    case "review":
      return "Ready for your review";
    case "blocked":
      return "Blocked on something else";
    case "done":
      return "Done";
    default:
      return "In progress";
  }
}
