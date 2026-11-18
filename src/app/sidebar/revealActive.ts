import { useLayoutEffect, useRef, type RefObject } from "react";

/** Room left between a revealed row and the scroll region's edge. */
const REVEAL_MARGIN_PX = 8;

/**
 * Scrolls the sidebar just enough to show the active thread's row whenever a
 * thread becomes active, including the one open when the list mounts.
 *
 * A thread can be listed more than once (Up Next, Pinned, Recents, and its
 * workstream), and any one of its rows in view is enough. A row inside a
 * collapsed fold is not drawn, so a thread whose every row is folded away
 * leaves the scroll position alone: the list never opens a fold to reveal it.
 *
 * The reveal waits until `listed(threadId)` says the list holds the thread,
 * so a thread opened before its row arrives (a new one, or before the
 * sidebar loads) is revealed when the row is drawn. It runs at most once per
 * activation, so a row that later moves out of view stays where it went.
 */
export function useRevealActiveThread(
  listRef: RefObject<HTMLElement | null>,
  activeThreadId: string | null,
  listed: (threadId: string) => boolean,
): void {
  const pending = useRef<string | null>(null);
  useLayoutEffect(() => {
    pending.current = activeThreadId;
  }, [activeThreadId]);
  // Runs after every commit, so the reveal happens in the first one that
  // draws the thread's row.
  useLayoutEffect(() => {
    const threadId = pending.current;
    const list = listRef.current;
    if (!threadId || !list || !listed(threadId)) return;
    pending.current = null;
    revealThreadRow(list, threadId);
  });
}

/**
 * Scrolls `list`'s scrolling ancestor the least distance that brings one of
 * `threadId`'s drawn rows fully into view, unless one already is.
 *
 * Rows scrolling under the sticky Up Next and Pinned plate are hidden by it,
 * so for them the visible region starts below the plate. A row on the plate
 * itself is visible wherever the list is scrolled, and scrolling cannot move
 * it, so it is never the row scrolled to. Rows in a closing fold are leaving
 * and do not count.
 */
export function revealThreadRow(list: HTMLElement, threadId: string): void {
  const scroller = scrollerOf(list);
  if (!scroller) return;
  const rows = [
    ...list.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]"),
  ]
    .filter(
      (anchor) =>
        anchor.dataset.sidebarThreadId === threadId &&
        !anchor.closest('[inert], [data-presence="leave"]'),
    )
    .map((anchor) => anchor.closest<HTMLElement>(".ws-row") ?? anchor)
    .filter((row) => row.getClientRects().length > 0);
  if (rows.length === 0) return;

  const frame = scroller.getBoundingClientRect();
  const top = frame.top + scroller.clientTop;
  const bottom = top + scroller.clientHeight;
  const plate = list.querySelector<HTMLElement>(".ws-up-next-sticky");
  const belowPlate = Math.max(
    top,
    plate ? plate.getBoundingClientRect().bottom : top,
  );

  let scrollBy: number | null = null;
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    const onPlate = plate?.contains(row) ?? false;
    const regionTop = onPlate ? top : belowPlate;
    if (box.top >= regionTop - 0.5 && box.bottom <= bottom + 0.5) return;
    if (onPlate) continue;
    const delta =
      box.top < regionTop
        ? box.top - regionTop - REVEAL_MARGIN_PX
        : box.bottom - bottom + REVEAL_MARGIN_PX;
    if (scrollBy === null || Math.abs(delta) < Math.abs(scrollBy))
      scrollBy = delta;
  }
  if (scrollBy !== null) scroller.scrollTop += scrollBy;
}

/**
 * The nearest ancestor that scrolls vertically. `scrollIntoView` isn't used
 * because it also scrolls BB's `overflow-hidden` layout containers.
 */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}
