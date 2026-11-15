/**
 * Where Workstreams takes the user next, one rule for every surface: the next
 * Up Next command (shortcut, palette, Stream Deck), and putting away the thread
 * in view (archiving it from the recap card, the sidebar, the header, BB's own
 * shortcut, or anywhere else, and snoozing it).
 *
 * The next thread is Up Next's row after the one in view, wrapping to the top;
 * a thread Up Next doesn't list starts at the top. The order is Up Next as the
 * sidebar draws it (see `upNextOrder`): the open thread keeps its row there
 * after reading it moves its rank, and a delegate sits on its root's row, so
 * "next" is the row the user sees below. A thread being put away when Up Next
 * has nothing else still moves the user on, to the next thread in its
 * workstream and then to the most recently active thread, so it lands on the
 * composer only when no other thread is open.
 */
import {
  arrangeGroups,
  focusedSections,
  type WorkstreamTopics,
} from "./groups.ts";
import type { Projection, Row, WorkstreamThread } from "./project.ts";
import {
  selectUpNext,
  type UpNextOptions,
  type UpNextThread,
} from "./upNext.ts";

/**
 * The sections Up Next's focus covers: every section in a top-level workstream
 * holding a focused one, as the sidebar draws the workstreams, so focusing a
 * workstream covers its subtopics. `prioritized` is `ManualOrder.prioritized`.
 */
export function upNextFocus<T extends WorkstreamThread>(
  projection: Projection<T>,
  prioritized: Iterable<string>,
  topics?: WorkstreamTopics,
): Set<string> {
  const ids = new Set(prioritized);
  if (ids.size === 0) return ids;
  // The sort orders the groups; which sections each one covers doesn't
  // depend on it.
  return focusedSections(arrangeGroups(projection, "manual", topics), ids);
}

/**
 * Up Next's thread ids in order, for a surface that doesn't draw the list
 * itself: `selectUpNext`'s rows under the same focus the sidebar applies. The
 * sidebar's own order also holds the open thread in place and can include Show
 * more (see `sidebar/upNextState.ts`); navigation prefers it when a sidebar is
 * drawing one.
 */
export function upNextOrder<T extends UpNextThread>(
  projection: Projection<T>,
  options: UpNextOptions<T>,
  focus: {
    readonly prioritized: Iterable<string>;
    readonly topics?: WorkstreamTopics;
  },
): string[] {
  return selectUpNext(projection, {
    ...options,
    prioritized: upNextFocus(projection, focus.prioritized, focus.topics),
  }).rows.map((row) => row.thread.id);
}

/**
 * The thread whose Up Next row stands for `threadId`: its root, since Up Next
 * lists only roots and draws a delegate under its root's row.
 */
function upNextPlace<T extends WorkstreamThread>(
  projection: Projection<T>,
  threadId: string,
): string {
  const seen = new Set<string>();
  let at = threadId;
  for (;;) {
    seen.add(at);
    const parent = projection.rowOf.get(at)?.thread.parentThreadId;
    if (!parent || seen.has(parent) || !projection.rowOf.has(parent)) return at;
    at = parent;
  }
}

/**
 * The Up Next thread to open after `threadId`: the row after its place in
 * `order`, wrapping to the top and skipping `threadId` and everything in
 * `leaving`. A thread `order` doesn't list, or null, starts at the top. Null
 * when no other row is left.
 *
 * `order` and `projection` are Up Next as it stood while `threadId` was still
 * listed: a thread that has left can no longer say where it sat.
 */
export function nextUpNextThread<T extends WorkstreamThread>(
  projection: Projection<T>,
  order: readonly string[],
  threadId: string | null,
  leaving: ReadonlySet<string> = new Set(),
): string | null {
  const place = threadId === null ? null : upNextPlace(projection, threadId);
  // -1 starts the walk at the top, where an unlisted thread and no thread both
  // hand the user off.
  const start = place === null ? -1 : order.indexOf(place);
  for (let step = 1; step <= order.length; step++) {
    const id = order[(start + step) % order.length]!;
    if (id === place || id === threadId || leaving.has(id)) continue;
    return id;
  }
  return null;
}

/**
 * Where the user lands once `threadId`, the thread in view, is put away along
 * with everything in `leaving` (an archived subtree, a snoozed workstream):
 * the next Up Next thread (see `nextUpNextThread`). When Up Next has nothing
 * else, a delegate going away leaves the user on its root; a root goes on to
 * the next thread in its workstream past its subtree, wrapping, and then to
 * the most recently active root. Null only when nothing else is open.
 * `projection` and `order` are read before the thread left.
 */
export function nextThreadAfterLeaving<T extends WorkstreamThread>(
  projection: Projection<T>,
  order: readonly string[],
  threadId: string,
  leaving: ReadonlySet<string>,
): string | null {
  const gone = new Set([...leaving, threadId]);
  const upNext = nextUpNextThread(projection, order, threadId, gone);
  if (upNext) return upNext;
  const root = upNextPlace(projection, threadId);
  if (!gone.has(root)) return root;
  const stays = (row: Row<T>) =>
    !gone.has(row.thread.id) && !underAny(projection, row.thread.id, gone);
  const groups = [
    ...projection.groups,
    projection.unsorted,
    ...projection.dormant,
  ];
  const group = groups.find((candidate) =>
    candidate.rows.some((row) => row.thread.id === root),
  );
  if (group) {
    const index = group.rows.findIndex((row) => row.thread.id === root);
    const next = [
      ...group.rows.slice(index + 1),
      ...group.rows.slice(0, index),
    ].find(stays);
    if (next) return next.thread.id;
  }
  const recent = groups
    .flatMap((candidate) => candidate.rows)
    .filter((row) => row.depth === 0 && stays(row))
    .sort(
      (a, b) =>
        b.thread.latestAttentionAt - a.thread.latestAttentionAt ||
        a.thread.id.localeCompare(b.thread.id),
    );
  return recent[0]?.thread.id ?? null;
}

/** Whether any ancestor of `threadId` is in `ids`. */
function underAny<T extends WorkstreamThread>(
  projection: Projection<T>,
  threadId: string,
  ids: ReadonlySet<string>,
): boolean {
  const seen = new Set<string>();
  let parent = projection.rowOf.get(threadId)?.thread.parentThreadId;
  while (parent && !seen.has(parent)) {
    if (ids.has(parent)) return true;
    seen.add(parent);
    parent = projection.rowOf.get(parent)?.thread.parentThreadId;
  }
  return false;
}
