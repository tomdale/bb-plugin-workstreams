/**
 * The queue's change of item as a physical stack of cards, drawn by
 * `StackEngine` (the simulation, with no DOM) through this thin layer.
 *
 * Each item's card is one element for as long as it is in the pile, so cards
 * move between places rather than remount. The layer measures the cards'
 * natural heights (the content's layout box, which includes `CARD_ZOOM`),
 * tells the engine which items the pile should hold (`pile`) and which way the
 * last change went (`capture`), steps the engine on `requestAnimationFrame`,
 * and writes each card's transform, drawn height, shade, shadow, draw order,
 * and visibility, without re-rendering React. Only the settled front card is
 * interactive; every other card is `inert` and `aria-hidden`.
 *
 * The heading and the replies fade through to the new item's, on the same
 * clock: the old ones are copies taken just before the change (`capture`) that
 * fade out where they were, and the live ones are held back until the engine
 * lets them in (the replies only once no moving card passes over them). The
 * page glides to its new center when the item or receipt changes, and never for
 * Reply or ⇧. Under reduced motion the new item only fades in. Without
 * `requestAnimationFrame` and Web Animations (tests) every change applies at
 * once.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  LEAD,
  StackEngine,
  type Direction as EngineDirection,
  type StackFrame,
} from "./stackEngine.ts";

export type Direction = EngineDirection;

/** The page glide and the card's corner radius (twice `rounded-lg`, zoomed). */
const SETTLE_MS = 420;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const CORNER = 11.5;
/** The least space kept above the heading. */
const MIN_TOP = 24;
/** The most the clock advances in one frame, so a stalled tab doesn't leap. */
const MAX_FRAME_MS = 50;

/** The parts the engine fades, by `data-queue-part`. */
const FADED = ["heading", "actions"] as const;
type Faded = (typeof FADED)[number];

/** A copy of a heading or the replies as they were, fading out in place. */
type Piece = {
  copy: HTMLElement;
  /** Its place in layout: page coordinates down, the viewport's across. */
  y: number;
  x: number;
  /** How far below it its first child sat, since that child's margin may
   * have collapsed through the part, which a positioned copy won't do. */
  childOffset: number;
  width: number;
};

type Snapshot = {
  /** The item shown when captured; a capture applies only to a change from it. */
  from: string | null;
  at: number;
  unitY: number;
  pieces: Partial<Record<Faded, Piece>>;
};

/** The elements of one card, found by the data attributes `CardStack` sets. */
type CardParts = {
  el: HTMLElement;
  content: HTMLElement;
  base: HTMLElement;
  frame: HTMLElement;
  shade: HTMLElement;
};

const motionAvailable = () =>
  typeof Element !== "undefined" &&
  "animate" in Element.prototype &&
  typeof requestAnimationFrame === "function";
const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const partOf = (root: ParentNode, part: string) =>
  root.querySelector<HTMLElement>(`[data-queue-part="${part}"]`);

/** A card's natural height: its content's layout box, whatever transform the
 * card itself is drawn with. */
function heightOf(content: HTMLElement): number {
  const height = parseFloat(getComputedStyle(content).height);
  return Number.isFinite(height) ? height : 0;
}

/** Copies an element to draw while it leaves: inert, with no ids or hooks. */
function copyOf(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const withId of copy.querySelectorAll("[id]"))
    withId.removeAttribute("id");
  copy.removeAttribute("data-queue-part");
  copy.style.opacity = "";
  copy.removeAttribute("inert");
  copy.setAttribute("aria-hidden", "true");
  copy.setAttribute("inert", "");
  return copy;
}

const toggle = (el: HTMLElement, name: string, on: boolean, value = "") => {
  if (on !== el.hasAttribute(name))
    on ? el.setAttribute(name, value) : el.removeAttribute(name);
};

/**
 * Centers the unit (stack and replies) in the page with the receipt and
 * heading above it, and runs each change of item as one motion.
 *
 * `item` is the item shown; `centerKey` changes whenever the page should
 * center again (the item or receipt changed), never for Reply or ⇧; `pile` is
 * the shown item and the next ones, in order. Call `capture` just before
 * changing the item, from the event that changes it, so the old heading and
 * replies can fade where they were; `accept` first when the change is a skip
 * from a key or button, so held keys queue no more than two.
 */
export function useQueueMotion(
  item: string | null,
  centerKey: string,
  pile: readonly string[],
) {
  const page = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const above = useRef<HTMLDivElement>(null);
  const unit = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [, released] = useReducer((n: number) => n + 1, 0);
  const engine = useRef<StackEngine | null>(null);
  engine.current ??= new StackEngine(() => released());
  const cards = useRef(new Map<string, CardParts>());
  const observer = useRef<ResizeObserver | null>(null);
  const clock = useRef({ raf: 0, last: 0 });
  /** The glide, replaced by each change. */
  const gliding = useRef<Animation[]>([]);
  const pending = useRef<Snapshot | null>(null);
  const hint = useRef<Direction | undefined>(undefined);
  const copies = useRef<Partial<Record<Faded, HTMLElement>>>({});
  /** Where the unit rests, for a change nobody captured. */
  const restY = useRef<number | null>(null);
  const lastItem = useRef(item);
  const lastFront = useRef<string | undefined>(undefined);
  const lastReceipt = useRef<HTMLElement | null>(null);
  const shown = useRef(item);
  shown.current = item;
  const moving = useRef(false);

  const yOf = useCallback((el: Element) => {
    const box = page.current!;
    return (
      el.getBoundingClientRect().top -
      box.getBoundingClientRect().top +
      box.scrollTop
    );
  }, []);

  /** Writes the engine's frame to the page: no React render involved. */
  const write = useCallback((frame: StackFrame) => {
    const root = content.current;
    if (stage.current) stage.current.style.height = `${frame.height}px`;
    const order = [...frame.cards].sort((a, b) => a.layer - b.layer);
    for (const view of frame.cards) {
      const parts = cards.current.get(view.key);
      if (!parts) continue;
      const style = parts.el.style;
      style.visibility = view.painted ? "" : "hidden";
      style.zIndex = String(order.indexOf(view) + 1);
      style.transform = `scale(${view.scale.toFixed(5)}) translateY(${view.y.toFixed(2)}px)`;
      const drawn = `${view.vis.toFixed(2)}px`;
      parts.base.style.height = parts.frame.style.height = drawn;
      parts.shade.style.height = drawn;
      parts.content.style.clipPath =
        view.h > 0 && view.vis < view.h - 0.5
          ? `inset(0 0 ${(view.h - view.vis).toFixed(2)}px 0 round ${CORNER}px)`
          : "";
      parts.shade.style.opacity = view.shade.toFixed(3);
      parts.base.style.setProperty("--ws-shadow", (1 - view.shade).toFixed(3));
      toggle(parts.el, "inert", !view.interactive);
      toggle(parts.el, "aria-hidden", !view.interactive, "true");
    }
    if (root) {
      const fade = (part: Faded, now: number, old: number) => {
        const live = partOf(root, part);
        if (live) {
          live.style.opacity = now < 1 ? now.toFixed(3) : "";
          if (part === "actions") toggle(live, "inert", now < 0.5);
        }
        const copy = copies.current[part];
        if (copy) {
          if (old <= 0) {
            copy.remove();
            delete copies.current[part];
          } else copy.style.opacity = old.toFixed(3);
        }
      };
      fade("heading", frame.heading.now, frame.heading.old);
      fade("actions", frame.replies.now, frame.replies.old);
    }
    // Cards leave the page's edge while they move; it doesn't scroll for them.
    if (page.current && moving.current !== frame.busy) {
      moving.current = frame.busy;
      toggle(page.current, "data-moving", frame.busy);
    }
  }, []);

  /** Steps the engine on the animation clock until it comes to rest. */
  const wake = useCallback(() => {
    const clk = clock.current;
    if (clk.raf || !motionAvailable()) return;
    const frame = (now: number) => {
      clk.raf = 0;
      const dt = clk.last ? Math.min(MAX_FRAME_MS, now - clk.last) : 1000 / 60;
      clk.last = now;
      engine.current!.step(dt / 1000);
      const drawn = engine.current!.frame();
      write(drawn);
      if (drawn.busy) clk.raf = requestAnimationFrame(frame);
      else clk.last = 0;
    };
    clk.last = 0;
    clk.raf = requestAnimationFrame(frame);
  }, [write]);

  /** Finds the cards in the page, measures them, and follows their size. */
  const bind = useCallback(() => {
    const stageEl = stage.current;
    const found = new Map<string, CardParts>();
    for (const el of stageEl?.querySelectorAll<HTMLElement>(
      "[data-queue-card]",
    ) ?? []) {
      const part = (name: string) =>
        el.querySelector<HTMLElement>(`[data-card-${name}]`)!;
      found.set(el.dataset.queueCard!, {
        el,
        content: part("content"),
        base: part("base"),
        frame: part("frame"),
        shade: part("shade"),
      });
    }
    for (const [key, parts] of cards.current)
      if (found.get(key)?.el !== parts.el)
        observer.current?.unobserve(parts.content);
    for (const [key, parts] of found)
      if (cards.current.get(key)?.el !== parts.el)
        observer.current?.observe(parts.content);
    cards.current = found;
    const heights = new Map<string, number>();
    for (const [key, parts] of found) heights.set(key, heightOf(parts.content));
    engine.current!.setHeights(heights);
  }, []);

  const center = useCallback(() => {
    const box = page.current;
    const col = column.current;
    if (!box || !col) return;
    // The unit as it will be once the stage has grown or shrunk to the front
    // card, and the heading with the room the pile's cards peek out into.
    const stageEl = stage.current;
    const unitHeight =
      (unit.current?.offsetHeight ?? 0) -
      (stageEl?.offsetHeight ?? 0) +
      (stageEl ? engine.current!.frontHeight() : 0);
    const aboveHeight =
      (above.current?.offsetHeight ?? 0) + (stageEl ? LEAD : 0);
    const top = Math.max(
      MIN_TOP,
      box.clientHeight / 2 - unitHeight / 2 - aboveHeight,
    );
    col.style.paddingTop = `${top}px`;
  }, []);

  const pieceOf = useCallback(
    (el: HTMLElement): Piece => {
      const top = yOf(el);
      const rect = el.getBoundingClientRect();
      return {
        copy: copyOf(el),
        y: top,
        x: rect.left,
        childOffset: el.firstElementChild ? yOf(el.firstElementChild) - top : 0,
        width: el.offsetWidth,
      };
    },
    [yOf],
  );

  const capture = useCallback(
    (direction: Direction) => {
      hint.current = direction;
      const root = content.current;
      const unitEl = unit.current;
      if (!root || !unitEl || !page.current || !motionAvailable()) return;
      if (reducedMotion()) return;
      const pieces: Snapshot["pieces"] = {};
      for (const part of FADED) {
        const el = partOf(root, part);
        // A part that is not showing has nothing to fade out.
        if (el && Number(getComputedStyle(el).opacity || 1) > 0.05)
          pieces[part] = pieceOf(el);
      }
      pending.current = {
        from: shown.current,
        at: performance.now(),
        unitY: yOf(unitEl),
        pieces,
      };
    },
    [pieceOf, yOf],
  );

  const accept = useCallback(
    (direction: Direction) =>
      !motionAvailable() ||
      reducedMotion() ||
      engine.current!.accept(direction),
    [],
  );

  // The pile: the engine takes the moves that make it what the page shows.
  const pileKey = pile.join("\u0000");
  useLayoutEffect(() => {
    if (!observer.current && typeof ResizeObserver !== "undefined")
      observer.current = new ResizeObserver(() => {
        bind();
        wake();
        write(engine.current!.frame());
      });
    bind();
    const reduced = reducedMotion();
    const instant = !motionAvailable() || reduced;
    const direction = hint.current;
    hint.current = undefined;
    engine.current!.sync(pile, direction, instant);
    const front = pile[0];
    if (
      reduced &&
      front !== lastFront.current &&
      lastFront.current !== undefined
    )
      cards.current
        .get(front ?? "")
        ?.el.animate?.([{ opacity: 0 }, {}], { duration: 160, easing: EASE });
    lastFront.current = front;
    const frame = engine.current!.frame();
    write(frame);
    if (frame.busy) wake();
    // `pile` is covered by its key; `released` re-binds after cards go.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  useLayoutEffect(() => {
    const root = content.current;
    const unitEl = unit.current;
    let snap = pending.current;
    pending.current = null;
    if (snap && (snap.from === item || performance.now() - snap.at > 500))
      snap = null;
    for (const animation of gliding.current) animation.cancel();
    gliding.current = [];
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
      if (itemChanged)
        for (const part of FADED)
          partOf(root, part)?.animate([{ opacity: 0 }, {}], {
            duration: 160,
            easing: EASE,
          });
      return;
    }

    // The whole column glides from where the unit was to its new center.
    const shift = fromY === null ? 0 : fromY - unitY;
    if (Math.abs(shift) > 0.5)
      gliding.current.push(
        root.animate([{ transform: `translateY(${shift}px)` }, {}], {
          duration: SETTLE_MS,
          easing: EASE,
        }),
      );

    // The old heading and replies fade where they were; the copies ride the
    // glide too, so they are placed against where the page is going.
    const layer = ghosts.current;
    if (!layer || !snap || !itemChanged) return;
    for (const part of FADED) {
      const piece = snap.pieces[part];
      if (!piece) continue;
      copies.current[part]?.remove();
      const y = yOf(layer) + shift;
      const x = layer.getBoundingClientRect().left;
      Object.assign(piece.copy.style, {
        position: "absolute",
        margin: "0",
        top: `${piece.y - y}px`,
        left: `${piece.x - x}px`,
        width: `${piece.width}px`,
      });
      layer.append(piece.copy);
      const child = piece.copy.firstElementChild;
      const drift = child
        ? yOf(child) - yOf(piece.copy) - piece.childOffset
        : 0;
      if (Math.abs(drift) > 0.5)
        piece.copy.style.top = `${piece.y - y - drift}px`;
      copies.current[part] = piece.copy;
    }
    write(engine.current!.frame());
    // `centerKey` covers every change of item and receipt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerKey]);

  // Centering follows the page's size; the item's motion doesn't.
  useEffect(() => {
    const box = page.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => center());
    watch.observe(box);
    return () => watch.disconnect();
  }, [center]);

  useEffect(() => {
    const clk = clock.current;
    const glides = gliding.current;
    const ghostLayer = ghosts.current;
    return () => {
      if (clk.raf) cancelAnimationFrame(clk.raf);
      clk.raf = 0;
      observer.current?.disconnect();
      observer.current = null;
      for (const animation of glides) animation.cancel();
      ghostLayer?.replaceChildren();
    };
  }, []);

  /** The items whose cards the page must keep drawing: the pile's, and any
   * still leaving it. */
  const held = () => (motionAvailable() ? engine.current!.keys() : []);

  return {
    page,
    column,
    content,
    above,
    unit,
    ghosts,
    stage,
    capture,
    accept,
    held,
  };
}
