import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** Room left between a revealed row and the scroll region's edge. */
const REVEAL_MARGIN_PX = 8;
/**
 * How long after a reveal the list keeps the row in view while its layout
 * settles: bands opening, and data such as pull requests arriving, move rows
 * for a moment after the first draw.
 */
const SETTLE_MS = 2000;
/** Input on the scroller that means the user took over its scrolling. */
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown"] as const;

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
 * sidebar loads) is revealed when the row is drawn. For `SETTLE_MS` after
 * that, each change in the list's size reveals the row again, until the user
 * scrolls the sidebar themselves; after that a row that moves out of view
 * stays where it went.
 */
export function useRevealActiveThread(
  listRef: RefObject<HTMLElement | null>,
  activeThreadId: string | null,
  listed: (threadId: string) => boolean,
): void {
  const pending = useRef<string | null>(null);
  const stopSettling = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    stopSettling.current();
    pending.current = activeThreadId;
  }, [activeThreadId]);
  useEffect(() => () => stopSettling.current(), []);
  // Runs after every commit, so the reveal happens in the first one that
  // draws the thread's row.
  useLayoutEffect(() => {
    const threadId = pending.current;
    const list = listRef.current;
    if (!threadId || !list || !listed(threadId)) return;
    pending.current = null;
    revealThreadRow(list, threadId);
    stopSettling.current = keepRevealed(list, threadId);
  });
}

/**
 * Reveals `threadId`'s row again whenever `list` changes size, for
 * `SETTLE_MS` or until the user scrolls. Returns what stops it early.
 */
function keepRevealed(list: HTMLElement, threadId: string): () => void {
  const scroller = scrollerOf(list);
  if (!scroller || typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver(() => revealThreadRow(list, threadId));
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const type of USER_SCROLL_EVENTS)
      scroller.removeEventListener(type, stop);
  };
  const timer = setTimeout(stop, SETTLE_MS);
  for (const type of USER_SCROLL_EVENTS)
    scroller.addEventListener(type, stop, { passive: true });
  observer.observe(list);
  return stop;
}

/**
 * Scrolls `list`'s scrolling ancestor the least distance that brings one of
 * `threadId`'s drawn rows fully into view, unless one already is.
 *
 * Rows scrolling under the sticky Up Next and Pinned plate are hidden by it,
 * so for them the visible region starts below the plate and its fade. A row on the plate
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
  // The plate's `::after` fades the rows up to `--ws-up-next-heading-gap`
  // below its box (see `.ws-up-next-sticky` in styles.css), so they count as
  // under it too.
  const belowPlate = plate
    ? Math.max(
        top,
        plate.getBoundingClientRect().bottom +
          (parseFloat(
            getComputedStyle(plate).getPropertyValue(
              "--ws-up-next-heading-gap",
            ),
          ) || 0),
      )
    : top;

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
