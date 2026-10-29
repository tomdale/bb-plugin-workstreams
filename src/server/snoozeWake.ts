/**
 * Ends snoozes on wake events (see domain/wake.ts). Most events are read off
 * BB's live inventory each time the server sweeps snoozes; a question card
 * also arrives as an event and wakes its thread at once; a pull request is
 * polled, since BB announces no change to one.
 *
 * Lasting conditions (a question pending, a failed send, a run waiting for
 * its machine) are dated by the inventory read before the one that first
 * showed them, the latest time they are known not to have held. That date is
 * never after the condition began, so a condition already present when the
 * user snoozed (even if the inventory then was a minute old) is never taken
 * for a new one. The dates are stored, so a restart neither forgets them nor
 * mistakes old conditions for new ones.
 *
 * A turn's outcome counts as first known: re-analysis that later changes
 * how a turn reads doesn't wake the thread.
 */
import type { WorkState } from "../domain/analysis.ts";
import type { SnoozePrefs, ThreadSnooze } from "../domain/snooze.ts";
import {
  isStalled,
  pullRequestEvent,
  wakeEvent,
  wakesOnEvents,
  type PullRequestAttention,
  type WakeEvent,
  type WakeThread,
} from "../domain/wake.ts";
import { getMeta, setMeta, type Database } from "./db.ts";
import type { InventoryThread } from "./inventory.ts";
import type { ThreadSnoozes } from "./snooze.ts";

/** How often a snoozed thread's pull request is looked up. */
export const PR_POLL_MS = 5 * 60_000;

/** A snooze to end, named by its thread and when it was set. */
export type SetSnooze = { readonly id: string; readonly at: number };

export type SnoozeWakerDeps = {
  readonly db: Database;
  readonly snoozes: ThreadSnoozes;
  readonly prefs: () => SnoozePrefs;
  /** BB's live inventory, as last reconciled. */
  readonly threads: () => readonly InventoryThread[];
  /** When `threads()` was read; null before the first reconcile. */
  readonly inventoryAt: () => number | null;
  /**
   * A resolver for how each thread's latest turn ended (null while unknown),
   * built once per check from current analysis and agent recaps.
   */
  readonly workOf: () => (thread: InventoryThread) => WorkState | null;
  /**
   * The environment's pull request state: BB's rolled-up attention, null
   * without a pull request, undefined when the lookup couldn't run.
   */
  readonly pullRequest: (
    environmentId: string,
  ) => Promise<PullRequestAttention | null | undefined>;
  /** Ends these snoozes, woken by `event`. */
  readonly wake: (snoozes: SetSnooze[], event: WakeEvent) => Promise<void>;
  readonly now: () => number;
};

/** When each thread began meeting a lasting condition. */
type Since = Map<string, number>;

const CONDITIONS = ["asking", "hostWaiting", "sendFailed"] as const;
type Condition = (typeof CONDITIONS)[number];

const HOLDS: Readonly<Record<Condition, (t: InventoryThread) => boolean>> = {
  asking: (t) => t.hasPendingInteraction,
  hostWaiting: (t) => t.runtimeStatus === "waiting-for-host",
  sendFailed: (t) => t.queuedWork === "failed",
};

const TRACKERS_KEY = "snooze-wake-trackers";

/** The trackers as stored: -Infinity is stored as null. */
type StoredTrackers = {
  inventoryAt: number | null;
} & Record<Condition, Record<string, number | null>>;

export class SnoozeWaker {
  private readonly failedAt = new Map<string, number>();
  private readonly since: Record<Condition, Since> = {
    asking: new Map(),
    hostWaiting: new Map(),
    sendFailed: new Map(),
  };
  private readonly stalled: Since = new Map();
  private readonly prCheckedAt = new Map<string, number>();
  /** Each thread's first known outcome for its latest turn. */
  private readonly outcomes = new Map<
    string,
    { attention: number; work: WorkState }
  >();
  /** When the inventory last checked was read; null before any. */
  private lastInventoryAt: number | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(private readonly deps: SnoozeWakerDeps) {
    this.load();
  }

  /** A thread's turn failed (BB's `thread.failed`). */
  onFailed(threadId: string): void {
    this.failedAt.set(threadId, this.deps.now());
  }

  /** A thread started a turn, so any earlier failure is behind it. */
  onActive(threadId: string): void {
    this.failedAt.delete(threadId);
  }

  /**
   * A question card or approval is pending on a thread: wakes the thread if
   * it's snoozed, or the snoozed thread it's a delegate of.
   */
  async onInteraction(thread: {
    id: string;
    parentThreadId: string | null;
  }): Promise<void> {
    const holder = this.snoozedHolder(thread);
    if (!holder) return;
    const event: WakeEvent =
      holder.id === thread.id ? "needs-you" : "delegate-needs-you";
    if (wakesOnEvents(holder.snooze) && this.deps.prefs().events[event])
      await this.deps.wake([{ id: holder.id, at: holder.snooze.at }], event);
  }

  /**
   * Checks every snooze that wakes on events, once BB's inventory has been
   * read. One check runs at a time; a request during one runs another after.
   */
  check(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.checkAll();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async checkAll(): Promise<void> {
    const inventoryAt = this.deps.inventoryAt();
    if (inventoryAt === null) return;
    const now = this.deps.now();
    const threads = this.deps.threads();
    const byId = new Map(threads.map((t) => [t.id, t]));
    const children = new Map<string, InventoryThread[]>();
    for (const thread of threads)
      if (thread.parentThreadId)
        children.set(thread.parentThreadId, [
          ...(children.get(thread.parentThreadId) ?? []),
          thread,
        ]);
    if (inventoryAt !== this.lastInventoryAt) {
      const before = this.lastInventoryAt ?? -Infinity;
      for (const condition of CONDITIONS)
        track(this.since[condition], threads, HOLDS[condition], before);
      this.lastInventoryAt = inventoryAt;
      this.save();
    }

    const snoozes = this.deps.snoozes.all();
    const { events: enabled } = this.deps.prefs();
    const workOf = this.deps.workOf();
    const firstKnown = (thread: InventoryThread): WorkState | null => {
      const known = this.outcomes.get(thread.id);
      if (known?.attention === thread.latestAttentionAt) return known.work;
      const work = workOf(thread);
      if (work)
        this.outcomes.set(thread.id, {
          attention: thread.latestAttentionAt,
          work,
        });
      return work;
    };
    const wakeThread = (thread: InventoryThread): WakeThread => ({
      id: thread.id,
      status: thread.status,
      hasPendingInteraction: thread.hasPendingInteraction,
      latestAttentionAt: thread.latestAttentionAt,
      queued: thread.queuedWork === "waiting",
      busy: thread.busy,
      work: thread.status === "idle" ? firstKnown(thread) : null,
      failedAt: this.failedAt.get(thread.id),
    });
    const woken = new Map<WakeEvent, SetSnooze[]>();
    for (const [id, snooze] of Object.entries(snoozes)) {
      const root = byId.get(id);
      if (!root || !wakesOnEvents(snooze)) continue;
      const delegates = descendants(id, children);
      const rootFacts = wakeThread(root);
      const delegateFacts = delegates.map(wakeThread);
      if (isStalled(rootFacts, delegateFacts, snooze.at)) {
        if (!this.stalled.has(id)) this.stalled.set(id, now);
      } else this.stalled.delete(id);
      const earliest = (condition: Condition, tree: InventoryThread[]) =>
        earliestSince(this.since[condition], tree, snooze.at);
      const event =
        wakeEvent(
          {
            snooze,
            root: rootFacts,
            delegates: delegateFacts,
            stalledSince: this.stalled.get(id),
            hostWaitingSince: earliest("hostWaiting", [root, ...delegates]),
            sendFailedSince: this.since.sendFailed.get(id),
            askingSince: this.since.asking.get(id),
            delegateAskingSince: earliest("asking", delegates),
            now,
          },
          enabled,
        ) ?? (await this.checkPullRequest(id, snooze, root, enabled, now));
      if (event)
        woken.set(event, [...(woken.get(event) ?? []), { id, at: snooze.at }]);
    }
    for (const id of this.stalled.keys())
      if (!(id in snoozes)) this.stalled.delete(id);
    for (const id of this.outcomes.keys())
      if (!byId.has(id)) this.outcomes.delete(id);
    for (const [event, set] of woken) await this.deps.wake(set, event);
  }

  /**
   * Looks up a snoozed thread's pull request, recording what it saw so only
   * a change wakes it. The first look after a snooze only records, and comes
   * at once; later looks come at most every {@link PR_POLL_MS}.
   */
  private async checkPullRequest(
    id: string,
    snooze: ThreadSnooze,
    root: InventoryThread,
    enabled: SnoozePrefs["events"],
    now: number,
  ): Promise<WakeEvent | null> {
    const wanted =
      enabled["changes-requested"] ||
      enabled["checks-failed"] ||
      enabled["ready-to-merge"];
    if (!wanted || !root.environmentId) return null;
    const key = `${id}@${snooze.at}`;
    const last = this.prCheckedAt.get(key);
    if (
      snooze.pr !== undefined &&
      last !== undefined &&
      now - last < PR_POLL_MS
    )
      return null;
    for (const stale of this.prCheckedAt.keys())
      if (stale.startsWith(`${id}@`)) this.prCheckedAt.delete(stale);
    this.prCheckedAt.set(key, now);
    const attention = await this.deps.pullRequest(root.environmentId);
    if (attention === undefined) return null;
    // The snooze may have been replaced or ended while the lookup ran.
    const current = this.deps.snoozes.get(id);
    if (current?.at !== snooze.at) return null;
    if (current.pr === undefined) {
      this.deps.snoozes.setPullRequest(id, attention);
      return null;
    }
    const event = pullRequestEvent(current.pr, attention);
    if (attention !== current.pr)
      this.deps.snoozes.setPullRequest(id, attention);
    return event && enabled[event] ? event : null;
  }

  /** The thread itself if snoozed, else its nearest snoozed ancestor. */
  private snoozedHolder(thread: {
    id: string;
    parentThreadId: string | null;
  }): { id: string; snooze: ThreadSnooze } | null {
    const snoozes = this.deps.snoozes.all();
    const byId = new Map(this.deps.threads().map((t) => [t.id, t]));
    const seen = new Set<string>();
    let id: string | null = thread.id;
    let parent: string | null = thread.parentThreadId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const snooze = snoozes[id];
      if (snooze) return { id, snooze };
      id = parent;
      parent = (id && byId.get(id)?.parentThreadId) ?? null;
    }
    return null;
  }

  private load(): void {
    let stored: Partial<StoredTrackers> | null = null;
    try {
      stored = JSON.parse(getMeta(this.deps.db, TRACKERS_KEY) ?? "null");
    } catch {
      stored = null;
    }
    if (!stored || typeof stored !== "object") return;
    if (typeof stored.inventoryAt === "number")
      this.lastInventoryAt = stored.inventoryAt;
    for (const condition of CONDITIONS)
      for (const [id, at] of Object.entries(stored[condition] ?? {}))
        this.since[condition].set(id, typeof at === "number" ? at : -Infinity);
  }

  private save(): void {
    const stored: StoredTrackers = {
      inventoryAt: this.lastInventoryAt,
      asking: {},
      hostWaiting: {},
      sendFailed: {},
    };
    for (const condition of CONDITIONS)
      for (const [id, at] of this.since[condition])
        stored[condition][id] = Number.isFinite(at) ? at : null;
    setMeta(this.deps.db, TRACKERS_KEY, JSON.stringify(stored));
  }
}

/**
 * Dates threads that newly meet `holds` with `before`, the last time they
 * were seen not to, and stops dating threads that no longer do.
 */
function track(
  map: Since,
  threads: readonly InventoryThread[],
  holds: (thread: InventoryThread) => boolean,
  before: number,
): void {
  const met = new Set<string>();
  for (const thread of threads)
    if (holds(thread)) {
      met.add(thread.id);
      if (!map.has(thread.id)) map.set(thread.id, before);
    }
  for (const id of map.keys()) if (!met.has(id)) map.delete(id);
}

/**
 * The earliest time a condition began among these threads at or after
 * `snoozedAt`; one that began earlier doesn't hide a newer one.
 */
function earliestSince(
  map: Since,
  threads: readonly InventoryThread[],
  snoozedAt: number,
): number | undefined {
  const times = threads
    .map((t) => map.get(t.id))
    .filter((at): at is number => at !== undefined && at >= snoozedAt);
  return times.length ? Math.min(...times) : undefined;
}

function descendants(
  id: string,
  children: ReadonlyMap<string, readonly InventoryThread[]>,
): InventoryThread[] {
  const found: InventoryThread[] = [];
  const queue = [...(children.get(id) ?? [])];
  const seen = new Set([id]);
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    found.push(next);
    queue.push(...(children.get(next.id) ?? []));
  }
  return found;
}
