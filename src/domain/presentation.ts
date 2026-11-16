/**
 * Presentation facts derived from BB's live thread state. BB resolves a
 * thread's status into an `indicator`; the SDK ships no glyphs, so each list
 * draws its own. Unknown indicator kinds (BB adds them over time) fall back to
 * no glyph rather than a wrong one.
 */

/**
 * What BB's live indicator says about a thread on its own: a turn running, a
 * BB interaction waiting on the user, a background agent or command that
 * resumes the thread when it finishes, or a failure. A message queued behind
 * a busy turn is part of that turn's work, and nothing once the thread is
 * idle: it goes out on its own.
 */
type StatusRole = "working" | "needs-input" | "waiting" | "error";

export function statusRole(
  indicator: string,
  status?: string,
): StatusRole | null {
  switch (indicator) {
    case "runtime":
    case "workflow":
    case "plan-mode":
      return "working";
    case "queued-waiting":
      return status === "idle" ? null : "working";
    case "background-agent":
    case "background-command":
      return "waiting";
    case "waiting-for-input":
      return "needs-input";
    case "unread-error":
    case "queued-failed":
      return "error";
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
 * A thread's status, decided once by `threadStatus` and read by every
 * surface: row marks, labels, colors, Up Next, the header count, wake events,
 * queue and recap cards, and the CLI. Listed in precedence order.
 *
 * - working: a turn is running.
 * - failed: the system errored (BB's thread status, or a queued message that
 *   failed to send), not the agent's judgment.
 * - needs-input: an explicit ask, a BB pending interaction, or a turn that
 *   stopped with requested work left.
 * - blocked: the agent likely cannot proceed unless the user intervenes.
 * - review: a finished result awaits the user's inspection.
 * - waiting: the thread resumes on its own once an external task finishes.
 * - complete: the turn finished what was asked.
 */
export const THREAD_STATUSES = [
  "working",
  "failed",
  "needs-input",
  "blocked",
  "review",
  "waiting",
  "complete",
] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

/** One label per status, on every surface. */
export const STATUS_LABEL: Record<ThreadStatus, string> = {
  working: "Working",
  failed: "Failed",
  "needs-input": "Needs input",
  blocked: "Blocked",
  review: "Ready for review",
  waiting: "Waiting",
  complete: "Complete",
};

type StatusThread = {
  readonly indicator: string;
  readonly status: string;
  readonly hasPendingInteraction: boolean;
};

type StatusWork = {
  readonly kind: "none" | "pending" | "current";
  readonly analysis?: { readonly state: string };
};

/**
 * The thread's status, or null when nothing is known about its latest turn.
 * Live BB facts outrank the agent's recap, which outranks analysis (see
 * `workView`). A failure follows the turn, not the row's unread dot: BB's
 * indicator drops to "none" once the thread is read, while its status stays
 * "error" until the thread runs again.
 */
export function threadStatus(
  thread: StatusThread,
  work: StatusWork,
): ThreadStatus | null {
  const role = statusRole(thread.indicator, thread.status);
  if (role === "working") return "working";
  if (role === "error" || thread.status === "error") return "failed";
  const state = work.kind === "current" ? work.analysis?.state : undefined;
  if (
    role === "needs-input" ||
    thread.hasPendingInteraction ||
    state === "needs-input"
  )
    return "needs-input";
  if (state === "blocked") return "blocked";
  if (state === "review") return "review";
  if (role === "waiting" || state === "waiting") return "waiting";
  if (state === "complete") return "complete";
  return null;
}

/**
 * The mark a thread row's leading slot shows, at most one per row: the
 * thread's status, except that a completed turn is news only while unread,
 * so its dot is the whole mark and a read one shows nothing.
 *
 * Unread is never a slot mark of its own. The dots (`dotMark`) carry it in
 * their fill, other marks carry it as an inline dot beside the title, and
 * markless rows carry it by title weight alone (see the sidebar's Row).
 */
export type SlotMarkKind = ThreadStatus;

export type SlotMark = {
  readonly kind: SlotMarkKind;
  readonly label: string;
};

/** The marks drawn as a dot, whose fill says whether the row is unread. */
export function dotMark(kind: SlotMarkKind): boolean {
  return kind === "needs-input" || kind === "review" || kind === "complete";
}

export function slotMarkFor(
  thread: StatusThread & { readonly isUnread: boolean },
  work: StatusWork,
): SlotMark | null {
  const status = threadStatus(thread, work);
  if (status === null) return null;
  if (status === "complete" && !thread.isUnread) return null;
  return { kind: status, label: STATUS_LABEL[status] };
}

/** A stored work state as words, for places that narrate rather than mark. */
export function workStateLabel(state: string): string {
  return state in STATUS_LABEL
    ? STATUS_LABEL[state as ThreadStatus]
    : STATUS_LABEL["needs-input"];
}

/** The header count as words: "1 needs you", "3 need you". */
export function needYouLabel(count: number): string {
  return `${count} ${count === 1 ? "needs" : "need"} you`;
}
