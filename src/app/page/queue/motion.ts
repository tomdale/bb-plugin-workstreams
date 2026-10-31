/**
 * The queue's change of item as one calm motion: the card on top lifts away
 * (or, going back, sinks into the stack) while the next settles into front
 * from its place in the stack, the stack's edges each move up or down a
 * slot, and the page glides to its new center instead of jumping.
 *
 * The outgoing heading, card, and actions are copies of their DOM, taken
 * just before the change (`capture`) and drawn over the page while they
 * fade. They fade out before the new item fades in ("fade through"), so two
 * items' text never overlaps. Everything that moves uses one duration and
 * curve, so the heading, card, stack, and actions travel together; the card
 * stack's height is the one animated size, so the stack's edges and the
 * actions below follow a card of a new height.
 *
 * A change that follows another within `RAPID_MS` (a held arrow key) leaves
 * no copies and just fades the new item in, and each change takes over
 * from wherever the last one had got to, so held keys never stack up
 * motion or leave stray cards behind. Under reduced motion the new item
 * only fades in. Without Web Animations (tests) every change applies at
 * once.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { layerPose } from "./QueueItem.tsx";

export type Direction = "forward" | "back";

/** The page glide, the stack's resize, and the new card's settle. */
const MOVE_MS = 280;
/** The outgoing item fades out over this long, quickly at first... */
const OUT_MS = 110;
/** ...and the new one fades in once it has nearly gone. */
const IN_DELAY_MS = 80;
const IN_MS = 200;
/** A change this soon after the last one is a held key. */
const RAPID_MS = 200;
/** Matches `.ws-stack-layer`'s transition in styles.css. */
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const FADE_OUT = "cubic-bezier(0.2, 0, 0.4, 1)";
/** The least space kept above the heading. */
const MIN_TOP = 24;

/** The page's parts the motion finds by `data-queue-part`. */
const PARTS = ["heading", "front", "actions"] as const;
type Part = (typeof PARTS)[number];

type Piece = {
  part: Part;
  /** A copy of the part as it looked, for its exit. */
  copy: HTMLElement;
  /** Its place: page coordinates down, the viewport's across. */
  y: number;
  x: number;
  /** Where its first child sat, since that child's margin may have
   * collapsed through the part, which a positioned copy won't do. */
  childY: number;
  width: number;
  opacity: number;
};

type Snapshot = {
  direction: Direction;
  /** The item shown when captured; a capture applies only to a change from it. */
  from: string | null;
  at: number;
  rapid: boolean;
  unitY: number;
  stackHeight: number | null;
  pieces: Piece[];
  layers: Set<string>;
};

const motionAvailable = () =>
  typeof Element !== "undefined" && "animate" in Element.prototype;
const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const partOf = (root: HTMLElement, part: string) =>
  root.querySelector<HTMLElement>(`[data-queue-part="${part}"]`);
const layersOf = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("[data-queue-layer]")].map(
    (el) => [el.dataset.queueLayer!, el] as const,
  );

/**
 * Centers the unit (card and actions) in the page with the receipt and
 * heading above it, and runs each change of item as one motion.
 *
 * `item` is the item shown; `centerKey` changes whenever the page should
 * center again (the item or the receipt changed), never for Reply or ⇧.
 * Call `capture` just before changing the item, from the event that changes
 * it, so the outgoing item can be drawn as it leaves.
 */
export function useQueueMotion(item: string | null, centerKey: string) {
  const page = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const above = useRef<HTMLDivElement>(null);
  const unit = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const pending = useRef<Snapshot | null>(null);
  /** The content's glide and the stack's resize, replaced by each change. */
  const running = useRef<Animation[]>([]);
  const lastChange = useRef(-Infinity);
  /** Where the unit rests, for a change nobody captured. */
  const restY = useRef<number | null>(null);
  const lastItem = useRef(item);
  const lastReceipt = useRef<HTMLElement | null>(null);
  const shown = useRef(item);
  shown.current = item;

  const yOf = useCallback((el: Element) => {
    const box = page.current!;
    return (
      el.getBoundingClientRect().top -
      box.getBoundingClientRect().top +
      box.scrollTop
    );
  }, []);

  const center = useCallback(() => {
    const box = page.current;
    const col = column.current;
    if (!box || !col) return;
    const unitHeight = unit.current?.offsetHeight ?? 0;
    const aboveHeight = above.current?.offsetHeight ?? 0;
    const top = Math.max(
      MIN_TOP,
      box.clientHeight / 2 - unitHeight / 2 - aboveHeight,
    );
    col.style.paddingTop = `${top}px`;
  }, []);

  const capture = useCallback(
    (direction: Direction) => {
      const root = content.current;
      const unitEl = unit.current;
      if (!root || !unitEl || !page.current || !motionAvailable()) return;
      const now = performance.now();
      const rapid = now - lastChange.current < RAPID_MS;
      const pieces: Piece[] = [];
      if (!rapid && !reducedMotion()) {
        for (const part of PARTS) {
          const el = partOf(root, part);
          if (!el) continue;
          const copy = el.cloneNode(true) as HTMLElement;
          for (const withId of copy.querySelectorAll("[id]"))
            withId.removeAttribute("id");
          copy.removeAttribute("data-queue-part");
          pieces.push({
            part,
            copy,
            y: yOf(el),
            x: el.getBoundingClientRect().left,
            childY: el.firstElementChild ? yOf(el.firstElementChild) : yOf(el),
            width: el.offsetWidth,
            opacity: Number(getComputedStyle(el).opacity),
          });
        }
      }
      const stack = partOf(root, "stack");
      pending.current = {
        direction,
        from: shown.current,
        at: now,
        rapid,
        unitY: yOf(unitEl),
        stackHeight: stack ? stack.getBoundingClientRect().height : null,
        pieces,
        layers: new Set(layersOf(root).map(([key]) => key)),
      };
    },
    [yOf],
  );

  useLayoutEffect(() => {
    const root = content.current;
    const unitEl = unit.current;
    let snap = pending.current;
    pending.current = null;
    if (snap && (snap.from === item || performance.now() - snap.at > 500))
      snap = null;
    for (const animation of running.current) animation.cancel();
    running.current = [];
    center();
    if (!root || !unitEl || !page.current) return;
    const unitY = yOf(unitEl);
    const fromY = snap?.unitY ?? restY.current;
    restY.current = unitY;
    if (!motionAvailable()) return;
    const itemChanged = item !== lastItem.current;
    lastItem.current = item;
    // A new receipt fades in where it appears; the item's motion is separate.
    const receipt = partOf(root, "receipt");
    if (receipt && receipt !== lastReceipt.current)
      receipt.animate([{ opacity: 0 }, {}], { duration: 200, easing: EASE });
    lastReceipt.current = receipt;

    if (reducedMotion()) {
      if (itemChanged) fadeIn(root, 0, 160, 0);
      return;
    }
    const direction = snap?.direction ?? "forward";
    const toward = direction === "forward" ? 1 : -1;

    // The whole column glides from where the unit was to its new center.
    const shift = fromY === null ? 0 : fromY - unitY;
    // The copies ride the glide too, so measure their layer before it.
    const layer = ghosts.current;
    const layerY = layer ? yOf(layer) + shift : 0;
    const layerX = layer?.getBoundingClientRect().left ?? 0;
    if (Math.abs(shift) > 0.5)
      running.current.push(
        root.animate([{ transform: `translateY(${shift}px)` }, {}], {
          duration: MOVE_MS,
          easing: EASE,
        }),
      );
    if (!itemChanged) return;
    lastChange.current = performance.now();

    // The stack resizes from the last card's height to the new one's; its
    // edges and the actions below follow. The new card is clipped to it, so
    // a taller one never spills over the actions while it grows.
    const stack = partOf(root, "stack");
    const height = stack?.getBoundingClientRect().height;
    if (
      stack &&
      height !== undefined &&
      snap?.stackHeight != null &&
      Math.abs(snap.stackHeight - height) > 0.5
    ) {
      const clip = "inset(-48px -48px 0 -48px)";
      running.current.push(
        stack.animate(
          [
            {
              height: `${snap.stackHeight}px`,
              boxSizing: "border-box",
              clipPath: clip,
            },
            { height: `${height}px`, boxSizing: "border-box", clipPath: clip },
          ],
          { duration: MOVE_MS, easing: EASE },
        ),
      );
    }

    // Cards that join the stack's visible edges come in from the next slot:
    // from below when moving on, from the front card's place going back.
    if (snap) {
      for (const [key, el] of layersOf(root)) {
        if (snap.layers.has(key)) continue;
        const slot = Number(el.dataset.slot);
        const from = layerPose(slot + toward);
        el.animate([{ transform: from.transform, opacity: 0 }, {}], {
          duration: MOVE_MS,
          easing: EASE,
        });
      }
    }

    // A held key or an unseen change: the new item just brightens in place.
    if (snap?.rapid || !snap) {
      fadeIn(root, 0, 140, 0, 0.4);
      return;
    }

    // The new item: its card settles from its slot in the stack (or from
    // above, going back), and it fades in as the old one finishes leaving.
    const front = partOf(root, "front");
    if (front) {
      const from =
        direction === "forward" ? layerPose(0).transform : "translateY(-10px)";
      front.animate([{ transform: from }, {}], {
        duration: MOVE_MS,
        easing: EASE,
      });
    }
    fadeIn(root, IN_DELAY_MS, IN_MS, 4 * toward);

    // The old item, drawn where it was, leaves the other way.
    if (!layer) return;
    while (layer.childElementCount > 8) layer.firstElementChild?.remove();
    for (const piece of snap.pieces) {
      const ghost = piece.copy;
      ghost.setAttribute("aria-hidden", "true");
      ghost.setAttribute("inert", "");
      Object.assign(ghost.style, {
        position: "absolute",
        margin: "0",
        top: `${piece.y - layerY}px`,
        left: `${piece.x - layerX}px`,
        width: `${piece.width}px`,
        opacity: String(piece.opacity),
      });
      layer.append(ghost);
      const child = ghost.firstElementChild;
      const drift = child
        ? yOf(child) - (piece.childY - piece.y) - yOf(ghost)
        : 0;
      if (Math.abs(drift) > 0.5)
        ghost.style.top = `${piece.y - layerY - drift}px`;
      const away =
        piece.part !== "front"
          ? `translateY(${-4 * toward}px)`
          : direction === "forward"
            ? "translateY(-16px)"
            : layerPose(0).transform;
      ghost.animate([{}, { transform: away }], {
        duration: OUT_MS,
        easing: EASE,
        fill: "forwards",
      });
      const exit = ghost.animate([{ opacity: piece.opacity }, { opacity: 0 }], {
        duration: OUT_MS,
        easing: FADE_OUT,
        fill: "forwards",
      });
      const remove = () => ghost.remove();
      exit.onfinish = remove;
      exit.oncancel = remove;
    }
    // `centerKey` covers every change of item and receipt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerKey]);

  // Centering follows the page's size; the item's motion doesn't.
  useEffect(() => {
    const box = page.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => center());
    observer.observe(box);
    return () => observer.disconnect();
  }, [center]);

  useEffect(
    () => () => {
      for (const animation of running.current) animation.cancel();
      running.current = [];
      ghosts.current?.replaceChildren();
    },
    [],
  );

  return { page, column, content, above, unit, ghosts, capture };
}

/**
 * Fades in the new item's parts from opacity `from`, the heading and actions
 * rising `rise` pixels (negative settles down); the card's own move is
 * separate.
 */
function fadeIn(
  root: HTMLElement,
  delay: number,
  duration: number,
  rise: number,
  from = 0,
) {
  for (const part of PARTS) {
    const el = partOf(root, part);
    if (!el) continue;
    const start: Keyframe =
      part === "front" || rise === 0
        ? { opacity: from }
        : { opacity: from, transform: `translateY(${rise}px)` };
    el.animate([start, {}], {
      delay,
      duration,
      easing: EASE,
      fill: "backwards",
    });
  }
}
