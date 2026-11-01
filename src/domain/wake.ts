/**
 * Wake events: what can end a snooze before its time. A snooze that wakes on
 * events (every "Until there's an update" snooze, and a timed one whose preset or
 * Custom… choice says so) ends at the first enabled event that happens after
 * it was set, or at its time, whichever comes first.
 *
 * The list is deliberately narrow. Only outcomes that ask something of the
 * user count: a turn that ends needing a decision, ready for review, done, or
 * failed; a queued message that failed to send; a delegate that needs the
 * user or whose failure left the work stuck; a machine restart that left a
 * run stuck; and pull request feedback. Progress inside a turn (a turn
 * starting, an automatic retry, a background job) never wakes a thread, and
 * neither does bookkeeping (titles, moves, pins, re-analysis).
 *
 * The user turns each event on or off in the Snooze settings section. The
 * rules here are pure; the server gathers the facts and acts on the answer.
 */
import type { WorkState } from "./analysis.ts";
import type { ThreadSnooze } from "./snooze.ts";

/** Every wake event, grouped and ordered as settings lists them. */
export const WAKE_EVENTS = [
  { id: "needs-you", group: "thread", label: "Needs you" },
  { id: "review", group: "thread", label: "Ready for review" },
  { id: "done", group: "thread", label: "Done" },
  { id: "error", group: "thread", label: "Error" },
  { id: "send-failed", group: "thread", label: "Message fails to send" },
  { id: "host-stalled", group: "thread", label: "Machine restart stops it" },
  { id: "delegate-needs-you", group: "delegates", label: "Needs you" },
  { id: "delegate-stalled", group: "delegates", label: "Fails and work stops" },
  { id: "changes-requested", group: "pr", label: "Changes requested" },
  { id: "checks-failed", group: "pr", label: "Checks failed" },
  { id: "ready-to-merge", group: "pr", label: "Ready to merge" },
] as const;

export type WakeEvent = (typeof WAKE_EVENTS)[number]["id"];
export const WAKE_EVENT_IDS = WAKE_EVENTS.map((event) => event.id) as [
  WakeEvent,
  ...WakeEvent[],
];

export const WAKE_EVENT_GROUPS = [
  { id: "thread", label: "Wake on thread events" },
  { id: "delegates", label: "Wake on delegate events" },
  { id: "pr", label: "Wake on pull request events" },
] as const;

/** Which wake events are on. Every event is on unless the user turns it off. */
type WakeEvents = Readonly<Record<WakeEvent, boolean>>;

export const DEFAULT_WAKE_EVENTS: WakeEvents = Object.fromEntries(
  WAKE_EVENT_IDS.map((id) => [id, true]),
) as Record<WakeEvent, boolean>;

/** Stored wake events with anything missing or malformed turned back on. */
export function parseWakeEvents(raw: unknown): WakeEvents {
  const stored =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    WAKE_EVENT_IDS.map((id) => [
      id,
      typeof stored[id] === "boolean" ? stored[id] : true,
    ]),
  ) as Record<WakeEvent, boolean>;
}

/** Whether a stored snooze ends on wake events as well as (or instead of) a time. */
export const wakesOnEvents = (snooze: ThreadSnooze): boolean =>
  snooze.until === null || snooze.events === true;

/**
 * How long a failed turn waits before it wakes a thread, so BB's automatic
 * retry after an overload or rate limit can queue first and keep it asleep.
 */
export const ERROR_GRACE_MS = 60_000;

/**
 * How long work must stay stuck (a delegate failed and nothing recovered, or
 * a run waits for its machine) before it wakes the thread. Long enough for a
 * parent to react to its delegate's failure, or a machine to reconnect.
 */
export const STALL_GRACE_MS = 5 * 60_000;

/** BB's statuses for a turn underway, from queued to winding down. */
const RUNNING = new Set(["pending", "starting", "active", "stopping"]);

/** The facts about one thread that wake rules read. */
export type WakeThread = {
  readonly id: string;
  /** BB's execution status: idle, error, or a running status. */
  readonly status: string;
  readonly hasPendingInteraction: boolean;
  /** BB's turn-end time for the thread. */
  readonly latestAttentionAt: number;
  /** A message, such as an automatic retry, is queued to run. */
  readonly queued: boolean;
  /** A background agent, command, or workflow is still running. */
  readonly busy: boolean;
  /**
   * How the latest turn ended, when its status is current (see
   * `workView`); null while unknown, or while a turn is running.
   */
  readonly work: WorkState | null;
  /** When the thread's latest turn failed, if the server saw it happen. */
  readonly failedAt?: number;
};

const isRunning = (thread: WakeThread) => RUNNING.has(thread.status);

/**
 * The event a turn that ended after `since` raises: a needed decision, a
 * review, or done. A turn that ended waiting or blocked on something else
 * raises nothing.
 */
export function turnOutcome(
  thread: WakeThread,
  since: number,
): "needs-you" | "review" | "done" | null {
  if (thread.status !== "idle" || thread.latestAttentionAt <= since)
    return null;
  if (thread.work === "needs_decision") return "needs-you";
  if (thread.work === "review") return "review";
  if (thread.work === "done") return "done";
  return null;
}

/**
 * A turn that failed after `since` and stayed failed: no retry is queued, and
 * at least {@link ERROR_GRACE_MS} has passed since the failure when the
 * server saw it. A failure the server didn't see (it was restarted) counts
 * when the thread's attention moved after `since`.
 */
export function failedAfter(
  thread: WakeThread,
  since: number,
  now: number,
): boolean {
  if (thread.status !== "error" || thread.queued) return false;
  if (thread.failedAt === undefined) return thread.latestAttentionAt > since;
  return thread.failedAt > since && now - thread.failedAt >= ERROR_GRACE_MS;
}

/**
 * Work under a root is stuck: nothing in the tree is running, queued, or
 * asking the user anything; the root's latest turn didn't end done, ready
 * for review, or needing a decision (those wake it on their own); and a
 * delegate failed after `since`. The server wakes the root once this has
 * held for {@link STALL_GRACE_MS}.
 */
export function isStalled(
  root: WakeThread,
  delegates: readonly WakeThread[],
  since: number,
): boolean {
  const tree = [root, ...delegates];
  if (
    tree.some(
      (t) => isRunning(t) || t.busy || t.hasPendingInteraction || t.queued,
    )
  )
    return false;
  if (root.status !== "idle" || turnOutcome(root, -Infinity) !== null)
    return false;
  return delegates.some(
    (d) => d.status === "error" && (d.failedAt ?? d.latestAttentionAt) > since,
  );
}

/** BB's rolled-up pull request state (`PluginSidebarPullRequest.attention`). */
export type PullRequestAttention = string;

const PR_EVENTS: Readonly<Record<string, WakeEvent>> = {
  changes_requested: "changes-requested",
  checks_failed: "checks-failed",
  ready_to_merge: "ready-to-merge",
};

/**
 * The event a pull request raises by moving from `before` to `now`, or null.
 * Only a change counts: a pull request already failing its checks when the
 * thread was snoozed doesn't wake it, but one that goes green and then fails
 * again does.
 */
export function pullRequestEvent(
  before: PullRequestAttention | null,
  now: PullRequestAttention | null,
): WakeEvent | null {
  if (now === null || now === before) return null;
  return PR_EVENTS[now] ?? null;
}

/**
 * What the server knows about a snoozed root when it checks wake events.
 * Each `…Since` is when a lasting condition began, as the server knows it:
 * no later than its true start, and -Infinity when it began before the
 * server could tell. A condition counts only when it began at or after the
 * snooze, so one the user snoozed through never wakes the thread.
 */
type WakeFacts = {
  readonly snooze: ThreadSnooze;
  readonly root: WakeThread;
  /** The root's delegates, at any depth. */
  readonly delegates: readonly WakeThread[];
  /** Since when work under the root has been stuck (see `isStalled`). */
  readonly stalledSince?: number;
  /** Since when the root or a delegate has been waiting for its machine. */
  readonly hostWaitingSince?: number;
  /** Since when a queued message for the root has failed to send. */
  readonly sendFailedSince?: number;
  /** Since when the root has had a question card or approval pending. */
  readonly askingSince?: number;
  /** Since when a delegate has had a question card or approval pending. */
  readonly delegateAskingSince?: number;
  readonly now: number;
};

const began = (since: number | undefined, snoozedAt: number) =>
  since !== undefined && since >= snoozedAt;

/**
 * The first enabled wake event the facts show, in settings order, or null.
 * Assumes the snooze wakes on events (see `wakesOnEvents`). A pull request
 * change is checked separately (see `pullRequestEvent`).
 */
export function wakeEvent(
  facts: WakeFacts,
  enabled: WakeEvents,
): WakeEvent | null {
  const { snooze, root, delegates, now } = facts;
  const since = snooze.at;
  const raised = new Set<WakeEvent>();
  const outcome = turnOutcome(root, since);
  if (outcome) raised.add(outcome);
  if (began(facts.askingSince, since)) raised.add("needs-you");
  if (began(facts.delegateAskingSince, since)) raised.add("delegate-needs-you");
  if (failedAfter(root, since, now)) raised.add("error");
  if (began(facts.sendFailedSince, since)) raised.add("send-failed");
  if (
    began(facts.hostWaitingSince, since) &&
    now - facts.hostWaitingSince! >= STALL_GRACE_MS
  )
    raised.add("host-stalled");
  if (
    delegates.some((d) => {
      const ended = turnOutcome(d, since);
      return ended === "needs-you" || ended === "review";
    })
  )
    raised.add("delegate-needs-you");
  if (
    facts.stalledSince !== undefined &&
    now - facts.stalledSince >= STALL_GRACE_MS
  )
    raised.add("delegate-stalled");
  return WAKE_EVENT_IDS.find((id) => raised.has(id) && enabled[id]) ?? null;
}
