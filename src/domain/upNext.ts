/**
 * Up Next's membership and order, shared by the sidebar, the phone Home
 * screen, and the next-Up-Next command so they always list the same threads.
 *
 * Every top-level thread that is in a group (not archived, hidden, or
 * snoozed) is a candidate, except one whose turn is still under way or
 * waiting on something else: a working thread has nothing to act on yet, and a
 * Waiting thread (see `isRunning` and `upNextKind`) belongs in its workstream
 * until it asks for the user or finishes. A question or a review is blocked on
 * the user; anything else (done, failed) is not. A review or a needed decision
 * whose turn ended more than {@link UP_NEXT_STALE_AFTER_MS} ago has gone stale
 * and ranks as neither (see `agedKind`). While a focused workstream has a
 * thread blocked on the user, only focused workstreams' threads are
 * candidates; the threads blocked on the user elsewhere wait outside Up Next.
 *
 * Candidates rank by tier, then by latest attention (BB's turn-end time,
 * the one unread compares against), newest first. With "Prioritize unread
 * threads" on, every unread thread leads every read thread, and the unread
 * threads rank by what their turn leaves the user with: a failed turn first,
 * then a thread blocked on the user, then the rest. Read threads follow in
 * their kind's order:
 *
 * 1. unread, failed   2. unread, blocked on the user   3. unread, other
 * 4. read questions   5. read reviews   6. other read
 *
 * With that setting off (`unreadFirst`), each thread keeps its kind's tier and
 * unread only breaks ties, so a read question leads an unread review:
 *
 * 1. questions  2. reviews  3. other
 *
 * "Prioritize recent threads" (`freshWithinMs`) puts the threads whose turn
 * ended inside that window above every other thread, before any of this
 * applies; inside each of the two groups the order is the same one above.
 *
 * Up Next then shows the `shown` most urgent of them (see
 * {@link UP_NEXT_LIMIT}), and never more: the rest are Trimmed, and those that
 * are unread or blocked on the user wait behind Show more. So the list stays
 * short enough to act on, and a thread blocked on the user is never a reason
 * to grow it. A thread that is read and not blocked on the user only fills a
 * row nothing more urgent wants, and with `fill` off ("Show read threads" in
 * settings) none of them fills one: Up Next lists just the threads that are
 * unread or blocked on the user, and can be empty.
 *
 * Nested threads never appear on their own (BB doesn't mark a delegate
 * unread when its turn ends); they show under their root's row. Parent
 * links decide this even when the parent is absent from the visible tree.
 */
import {
  DAY_MS,
  type Projection,
  type Row,
  type WorkstreamThread,
} from "./project.ts";
import type { UpNextKind } from "./status.ts";
import { buildForest } from "./tree.ts";

/**
 * How many rows Up Next shows before Show more unless the user chooses
 * another count (see `UP_NEXT_SHOWN` in domain/prefs.ts).
 */
export const UP_NEXT_LIMIT = 5;
/** The most rows the Threads shown setting allows Up Next to list. */
export const UP_NEXT_MAX = 10;
/** How long a finished turn's review or decision stays blocked on the user. */
export const UP_NEXT_STALE_AFTER_MS = 7 * DAY_MS;

/**
 * The windows "Prioritize recent threads" offers, in milliseconds. `off`
 * leaves the order to tiers and attention alone.
 */
export const UP_NEXT_FRESH_WINDOWS = {
  off: 0,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": DAY_MS,
  "3d": 3 * DAY_MS,
  "7d": 7 * DAY_MS,
} as const;

/** A window from {@link UP_NEXT_FRESH_WINDOWS}. */
export type UpNextFreshWindow = keyof typeof UP_NEXT_FRESH_WINDOWS;

export type UpNextThread = WorkstreamThread & {
  readonly isUnread: boolean;
  /** BB's execution status; unknown values count as idle. */
  readonly status: string;
};

/** BB's statuses for a turn underway, from queued to winding down. */
const RUNNING_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "starting",
  "active",
  "stopping",
]);

/**
 * The thread's turn is underway and asks nothing of the user, so Up Next
 * leaves it out: there is nothing to act on yet, and it returns, unread,
 * when the turn ends. A pending question card or approval keeps a running
 * thread in, since the agent is waiting on the user.
 */
export function isRunning(
  thread: Pick<UpNextThread, "status" | "hasPendingInteraction">,
): boolean {
  return RUNNING_STATUSES.has(thread.status) && !thread.hasPendingInteraction;
}

/** What Up Next ranks by; every caller that wants Up Next's rows passes it. */
export type UpNextOptions<T extends UpNextThread> = {
  /** What each thread is blocked on the user for (see `upNextKind`). */
  readonly kindOf: (thread: T) => UpNextKind;
  /** The current time, for aging out stale threads (see `agedKind`). */
  readonly now: number;
  /** Focused workstream ids (`ManualOrder.prioritized`); none, no focus. */
  readonly prioritized?: ReadonlySet<string>;
  /**
   * How many rows Up Next shows before Show more, 1 through
   * {@link UP_NEXT_MAX}. {@link UP_NEXT_LIMIT} when absent.
   */
  readonly shown?: number;
  /**
   * Rank unread threads above every read thread, and within them a failed turn
   * first, then one blocked on the user. False ranks each thread by its kind
   * alone. True when absent.
   */
  readonly unreadFirst?: boolean;
  /**
   * Threads whose turn ended within this window rank above older ones, in
   * milliseconds. `0`, the default, ranks by tier alone.
   */
  readonly freshWithinMs?: number;
  /**
   * Whether read threads that aren't blocked on the user top up the rows the
   * unread and blocked-on-you threads leave, as the most recently active of
   * them. False lists only threads that are unread or blocked on the user, so
   * Up Next can hold fewer than `shown` rows, or none. True when absent.
   */
  readonly fill?: boolean;
};

/** A question or review: the thread is blocked on the user. */
export function isBlockedOnUser(kind: UpNextKind): boolean {
  return kind === "question" || kind === "review";
}

/**
 * `kind` once age is counted: a review or needed decision whose turn ended
 * (its latest attention) more than {@link UP_NEXT_STALE_AFTER_MS} before
 * `now` ranks as `other`, keeping its read state. A pending question card or
 * approval never ages: the agent is waiting right now, and latest attention
 * dates the previous turn's end, not the question.
 */
export function agedKind(
  thread: Pick<UpNextThread, "hasPendingInteraction" | "latestAttentionAt">,
  kind: UpNextKind,
  now: number,
): UpNextKind {
  return isBlockedOnUser(kind) &&
    !thread.hasPendingInteraction &&
    now - thread.latestAttentionAt > UP_NEXT_STALE_AFTER_MS
    ? "other"
    : kind;
}

/** The next review or decision's transition out of its blocked tier. */
export function nextUpNextDeadline<T extends UpNextThread>(
  threads: readonly T[],
  options: Pick<UpNextOptions<T>, "kindOf" | "now"> & {
    readonly snoozedUntil?: (thread: T) => number | null | undefined;
  },
): number | undefined {
  const visible = threads.filter(
    (thread) => !thread.isHidden && !thread.isArchived,
  );
  const wakeOf = options.snoozedUntil ?? (() => undefined);
  let next = Number.POSITIVE_INFINITY;
  for (const root of buildForest(visible).roots) {
    const thread = root.thread;
    if (
      wakeOf(thread) !== undefined ||
      isRunning(thread) ||
      thread.hasPendingInteraction
    )
      continue;
    if (!isBlockedOnUser(options.kindOf(thread))) continue;
    // Staleness uses a strict age comparison, so wake just after the boundary.
    const deadline = thread.latestAttentionAt + UP_NEXT_STALE_AFTER_MS + 1;
    if (deadline > options.now) next = Math.min(next, deadline);
  }
  return Number.isFinite(next) ? next : undefined;
}

type UpNextSelection<T extends WorkstreamThread> = {
  /** Up Next's rows, most urgent first. */
  readonly rows: readonly Row<T>[];
  /**
   * What Show more reveals below `rows`: the trimmed threads that are
   * unread or blocked on the user, most urgent first. Read threads not
   * blocked on the user stay out; Recent and the groups list them.
   */
  readonly more: readonly Row<T>[];
  /** Up Next lists only focused workstreams' threads. */
  readonly focused: boolean;
};

/** The kinds Up Next ranks; a Waiting thread is never a candidate. */
type RankedKind = Exclude<UpNextKind, "waiting">;

/** A kind's tier when unread threads rank with their kind. */
const KIND_TIER: Record<RankedKind, number> = {
  question: 0,
  review: 1,
  other: 2,
};

/** Read threads keep their kind's order below every unread thread. */
const READ_TIER_OFFSET = 3;

/** Tier rank, 0 most urgent; see the module comment. */
function tierOf(
  kind: RankedKind,
  unread: boolean,
  failed: boolean,
  unreadFirst: boolean,
): number {
  if (!unreadFirst) return KIND_TIER[kind];
  if (!unread) return KIND_TIER[kind] + READ_TIER_OFFSET;
  // What an unread thread leaves the user with, most urgent first.
  if (failed) return 0;
  return isBlockedOnUser(kind) ? 1 : 2;
}

const byAttention = (a: Row<WorkstreamThread>, b: Row<WorkstreamThread>) =>
  b.thread.latestAttentionAt - a.thread.latestAttentionAt ||
  a.thread.id.localeCompare(b.thread.id);

export function selectUpNext<T extends UpNextThread>(
  projection: Projection<T>,
  options: UpNextOptions<T> & {
    /** Threads to leave out before ranking, such as one being archived. */
    readonly exclude?: (thread: T) => boolean;
  },
): UpNextSelection<T> {
  const shownCount = Math.min(
    UP_NEXT_MAX,
    Math.max(1, Math.round(options.shown ?? UP_NEXT_LIMIT)),
  );
  const unreadFirst = options.unreadFirst ?? true;
  const freshWithinMs = options.freshWithinMs ?? 0;
  const fill = options.fill ?? true;
  const ranked = [
    ...projection.groups,
    projection.unsorted,
    ...projection.dormant,
  ]
    .flatMap((group) => group.rows)
    .filter(
      (row) =>
        !row.thread.parentThreadId &&
        !isRunning(row.thread) &&
        !options.exclude?.(row.thread),
    )
    .map((row) => {
      const kind = agedKind(
        row.thread,
        options.kindOf(row.thread),
        options.now,
      );
      // A thread the agent reported Waiting, or one still working, asks nothing
      // of the user: it stays in its workstream until the turn finishes.
      if (kind === "waiting") return null;
      return {
        row,
        onYou: isBlockedOnUser(kind),
        unread: row.thread.isUnread,
        fresh:
          freshWithinMs > 0 &&
          options.now - row.thread.latestAttentionAt <= freshWithinMs,
        tier: tierOf(
          kind,
          row.thread.isUnread,
          row.thread.status === "error",
          unreadFirst,
        ),
        prioritized:
          row.workstreamId !== null &&
          (options.prioritized?.has(row.workstreamId) ?? false),
      };
    })
    .filter((entry) => entry !== null)
    .sort(
      (a, b) =>
        Number(b.fresh) - Number(a.fresh) ||
        a.tier - b.tier ||
        byAttention(a.row, b.row),
    );

  const focused = ranked.some((entry) => entry.prioritized && entry.onYou);
  const pool = focused ? ranked.filter((entry) => entry.prioritized) : ranked;
  // What the user has to act on: everything else is filler, and with `fill`
  // off none of it fills a row, so Up Next may stop short of `shown`.
  const actionable = pool.filter((entry) => entry.onYou || entry.unread).length;
  const target = fill ? shownCount : Math.min(shownCount, actionable);
  const shown = pool.slice(0, target);
  const inUpNext = new Set(shown);
  return {
    rows: shown.map((entry) => entry.row),
    more: pool
      .slice(target)
      .filter((entry) => entry.unread || entry.onYou)
      .map((entry) => entry.row),
    focused,
  };
}

/**
 * Recent: the most recently active threads at the top of their trees that
 * Up Next doesn't show, newest first, so Recent carries on where Up Next
 * stops and the two never repeat a thread. `shown` is what Up Next draws,
 * including any row it holds in place.
 */
export function selectRecent<T extends WorkstreamThread>(
  projection: Projection<T>,
  shown: readonly Row<T>[],
  limit: number,
): Row<T>[] {
  const inUpNext = new Set(shown.map((row) => row.thread.id));
  return [...projection.groups, projection.unsorted, ...projection.dormant]
    .flatMap((group) => group.rows)
    .filter((row) => row.depth === 0 && !inUpNext.has(row.thread.id))
    .sort(byAttention)
    .slice(0, limit);
}

/**
 * `rows` with `held` at `index` (or last, when the list has shrunk), moved
 * there if the rows already list it. The sidebar holds the open thread's
 * row where the user found it, so reading it never moves the row out from
 * under them; a negative index or no row holds nothing.
 */
export function holdInPlace<T extends WorkstreamThread>(
  rows: readonly Row<T>[],
  held: Row<T> | undefined,
  index: number,
): Row<T>[] {
  if (!held || index < 0) return [...rows];
  const rest = rows.filter((row) => row.thread.id !== held.thread.id);
  rest.splice(Math.min(index, rest.length), 0, held);
  return rest;
}
