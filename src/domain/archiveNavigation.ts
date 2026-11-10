import type { Projection, Row, WorkstreamThread } from "./project.ts";
import {
  agedKind,
  isBlockedOnUser,
  selectUpNext,
  type UpNextOptions,
  type UpNextThread,
} from "./upNext.ts";

/**
 * Where the recap card's Archive goes once `threadId` is archived: the top of
 * Up Next when that thread is blocked on the user or unread. Otherwise null,
 * and the caller stays in the workstream (see `nextThreadAfterArchive`) rather
 * than jump to a read thread that wants nothing.
 */
export function nextUpNextThreadAfterArchive<T extends UpNextThread>(
  projection: Projection<T>,
  threadId: string,
  options: UpNextOptions<T>,
): string | null {
  const top = selectUpNext(projection, {
    ...options,
    exclude: (thread) => thread.id === threadId,
  }).rows[0]?.thread;
  if (!top) return null;
  const wanted =
    top.isUnread ||
    isBlockedOnUser(agedKind(top, options.kindOf(top), options.now));
  return wanted ? top.id : null;
}

/**
 * The Up Next row after `threadId`, wrapping to the top. A thread Up Next
 * doesn't list (nothing open, or one that just left) starts at the top.
 */
export function nextUpNextThread<T extends UpNextThread>(
  projection: Projection<T>,
  threadId: string | null,
  options: UpNextOptions<T>,
): Row<T> | null {
  return nextUpNextRowAfterLeaving(
    selectUpNext(projection, options).rows,
    threadId,
    new Set(),
  );
}

/**
 * The Up Next row to open once `threadId` has left it along with everything in
 * `leaving` (the threads snoozed or archived with it): the row after it,
 * wrapping to the top, skipping the threads going away too. A thread `rows`
 * doesn't list starts at the top, and null `threadId` asks for the top itself.
 * Null when nothing is left to open.
 *
 * `rows` is Up Next's order as it stood while `threadId` was still listed: a
 * thread that has left Up Next can no longer say where it sat, so the caller
 * reads the order before the thread goes rather than after.
 */
export function nextUpNextRowAfterLeaving<T extends UpNextThread>(
  rows: readonly Row<T>[],
  threadId: string | null,
  leaving: ReadonlySet<string>,
): Row<T> | null {
  // -1 starts the walk at the top, which is where an unlisted thread and a
  // null threadId both hand the user off.
  const start = threadId
    ? rows.findIndex((row) => row.thread.id === threadId)
    : -1;
  for (let step = 1; step <= rows.length; step++) {
    const row = rows[(start + step) % rows.length];
    if (!row) continue;
    if (row.thread.id === threadId || leaving.has(row.thread.id)) continue;
    return row;
  }
  return null;
}

/** Follow group order, wrapping at the end without leaving the workstream. */
export function nextThreadAfterArchive<T extends WorkstreamThread>(
  projection: Projection<T>,
  threadId: string,
): string | null {
  const group = [
    ...projection.groups,
    projection.unsorted,
    ...projection.dormant,
  ].find((group) => group.rows.some((row) => row.thread.id === threadId));
  if (!group) return null;
  const index = group.rows.findIndex((row) => row.thread.id === threadId);
  const current = group.rows[index]!;
  let after = index + 1;
  // Archiving a parent puts away its subtree; don't open a descendant.
  while (after < group.rows.length && group.rows[after]!.depth > current.depth)
    after++;
  const next = group.rows[after] ?? (index > 0 ? group.rows[0] : undefined);
  return next?.thread.id ?? null;
}
