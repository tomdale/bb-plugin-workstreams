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
 * The heading fades in at its new content. The receipt crossfades separately,
 * and the replies use copies taken just before the change (`capture`), drawn
 * over the page where they were so nothing in the layout moves. The
 * replies fade out at once and in again on the engine's clock, once
 * no moving card passes over them. The column is pinned at a fixed top; when a
 * new item's heading wraps far enough that the card would sit under it, the
 * card glides down by the difference, and Reply and ⇧ never move it. Under
 * reduced motion everything only fades. Without `requestAnimationFrame` and
 * Web Animations (tests) every change applies at once.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  StackEngine,
  type Direction as EngineDirection,
  type StackFrame,
} from "./stackEngine.ts";

export type Direction = EngineDirection;

/** The glide to a card's new place and its corner radius (twice `rounded-lg`, zoomed). */
const SETTLE_MS = 420;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const CORNER = 11.5;
/** The most the clock advances in one frame, so a stalled tab doesn't leap. */
const MAX_FRAME_MS = 50;

/** The replies fade on the engine's clock. */
const FADED = ["actions"] as const;
type Faded = (typeof FADED)[number];

/**
 * The heading's and receipt's crossfade. The outgoing text drifts `DRIFT`px
 * one way as it fades and the incoming rises from the other, easing out; the
 * title follows the path line by `STAGGER` ms. The incoming text waits
 * `IN_DELAY_MS`, by which time the outgoing text is mostly gone, so the two
 * never read as overlapping lines. A change that starts while the
 * last is still running takes `RAPID` of the time, so held keys read as one
 * steady flick. Reduced motion drops the drift and the stagger.
 */
const DRIFT = 6;
const FADE_OUT_MS = 140;
const IN_DELAY_MS = 70;
const FADE_IN_MS = 240;
const STAGGER = 40;
const RAPID = 0.6;
const REDUCED_MS = 160;
const FADE_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
/** A direction recorded by `capture` speaks for a change this soon after it. */
const DIRECTION_MS = 600;

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

/** A composer opened while the replies were inert couldn't take focus then;
 * it takes it once they are live, unless the user has focused something. */
function focusComposer(actions: HTMLElement) {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  const field = actions.querySelector("textarea");
  if (!field) return;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

/** `1` when the pile went forward (the old text drifts up), `-1` back. */
type Sign = 1 | -1;

/** The lines of a heading, each its own thing to animate; anything else is one line. */
function linesOf(root: HTMLElement) {
  const lines = [...root.querySelectorAll<HTMLElement>("[data-queue-line]")];
  return lines.length
    ? lines.map((el) => ({
        el,
        delay: el.dataset.queueLine === "title" ? 1 : 0,
      }))
    : [{ el: root, delay: 0 }];
}

/**
 * Crossfades a heading or receipt: `entering` (live, in place) comes in while
 * `leaving` (a copy drawn over it) goes out, and the copy is removed once it
 * is gone. Opacity and transform only.
 */
function crossfade(
  entering: HTMLElement | null,
  leaving: HTMLElement | null,
  sign: Sign,
  { rapid, reduced }: { rapid: boolean; reduced: boolean },
) {
  const scale = rapid ? RAPID : 1;
  const drift = reduced ? 0 : DRIFT;
  const stagger = reduced ? 0 : STAGGER * scale;
  const ms = (full: number) => (reduced ? REDUCED_MS : full * scale);
  const options = (
    duration: number,
    delay: number,
  ): KeyframeAnimationOptions => ({
    duration,
    delay,
    easing: FADE_EASE,
    fill: "both",
  });
  if (entering)
    for (const { el, delay } of linesOf(entering))
      el.animate(
        [
          { opacity: 0, transform: `translateY(${sign * drift}px)` },
          { opacity: 1, transform: "translateY(0)" },
        ],
        options(
          ms(FADE_IN_MS),
          (reduced ? 0 : IN_DELAY_MS * scale) + delay * stagger,
        ),
      );
  if (leaving) {
    const done = linesOf(leaving).map(({ el, delay }) => {
      const now = getComputedStyle(el);
      return el.animate(
        [
          { opacity: now.opacity, transform: now.transform },
          { opacity: 0, transform: `translateY(${-sign * drift}px)` },
        ],
        options(ms(FADE_OUT_MS), delay * stagger),
      ).finished;
    });
    Promise.all(done).then(
      () => leaving.remove(),
      () => leaving.remove(),
    );
  }
}

const toggle = (el: HTMLElement, name: string, on: boolean, value = "") => {
  if (on !== el.hasAttribute(name))
    on ? el.setAttribute(name, value) : el.removeAttribute(name);
};

/**
 * Runs each change of item as one motion in a column pinned at a fixed top.
 *
 * `item` is the item shown; `pile` is the shown item and the next ones, in
 * order, and `previous` whether the queue has an item before it. Call `capture`
 * just before changing the item, from the event that changes it, so the old
 * heading and replies can fade where they were; `accept` first when the change
 * is a skip from a key or button, so held keys queue no more than one; `hold`
 * when a skip key goes down and `release` when it is let go.
 */
export function useQueueMotion(
  item: string | null,
  pile: readonly string[],
  previous: boolean,
  before: readonly string[] = [],
) {
  const page = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const unit = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [, released] = useReducer((n: number) => n + 1, 0);
  const [front, setFront] = useState(item);
  const frontRef = useRef(item);
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
  const lastItem = useRef(front);
  const lastFront = useRef<string | undefined>(undefined);
  /** The receipt on show, with a copy kept current to leave as. */
  const lastReceipt = useRef<{ key: string; copy: HTMLElement } | null>(null);
  /** The last change's direction and when, for what changes with it. */
  const lastDirection = useRef<{ direction: Direction; at: number } | null>(
    null,
  );
  /** When the receipt's crossfade last began. */
  const lastCrossfade = useRef({ receipt: -1e9 });
  const shown = useRef(front);
  shown.current = front;
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
    if (frontRef.current !== frame.front) {
      frontRef.current = frame.front;
      setFront(frame.front);
    }
    if (stage.current) stage.current.style.height = `${frame.height}px`;
    const order = [...frame.cards].sort((a, b) => a.layer - b.layer);
    for (const view of frame.cards) {
      const parts = cards.current.get(view.key);
      if (!parts) continue;
      const style = parts.el.style;
      style.visibility = view.painted ? "" : "hidden";
      style.zIndex = String(order.indexOf(view) + 1);
      style.transform = `translateX(${view.x.toFixed(2)}px) translateY(${(view.scale * view.y).toFixed(2)}px) rotate(${view.bank.toFixed(3)}deg) scale(${view.scale.toFixed(5)})`;
      const drawn = `${view.vis.toFixed(2)}px`;
      parts.base.style.height = parts.frame.style.height = drawn;
      parts.shade.style.height = drawn;
      parts.content.style.clipPath =
        view.h > 0 && view.vis < view.h - 0.5
          ? `inset(0 0 ${(view.h - view.vis).toFixed(2)}px 0 round ${CORNER}px)`
          : "";
      parts.shade.style.opacity = view.shade.toFixed(3);
      parts.content.style.opacity =
        view.content < 1 ? view.content.toFixed(3) : "";
      parts.base.style.setProperty("--ws-shadow", (1 - view.shade).toFixed(3));
      toggle(parts.el, "inert", !view.interactive);
      toggle(parts.el, "aria-hidden", !view.interactive, "true");
    }
    if (root) {
      const fade = (part: Faded, now: number, old: number) => {
        const live = partOf(root, part);
        if (live) {
          live.style.opacity = now < 1 ? now.toFixed(3) : "";
          if (part === "actions") {
            const wasInert = live.hasAttribute("inert");
            toggle(live, "inert", now < 0.5);
            if (wasInert && now >= 0.5) focusComposer(live);
          }
        }
        const copy = copies.current[part];
        if (copy) {
          if (old <= 0) {
            copy.remove();
            delete copies.current[part];
          } else copy.style.opacity = old.toFixed(3);
        }
      };
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
      lastDirection.current = { direction, at: performance.now() };
      const root = content.current;
      const unitEl = unit.current;
      if (!root || !unitEl || !page.current || !motionAvailable()) return;
      const reduced = reducedMotion();
      const pieces: Snapshot["pieces"] = {};
      for (const part of FADED) {
        const el = partOf(root, part);
        // Under reduced motion the replies only fade in; no copy is kept.
        if (!el || (reduced && part === "actions")) continue;
        if (Number(getComputedStyle(el).opacity || 1) > 0.05)
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

  /** A key toward `direction` goes down: the stack speeds up while it stays down. */
  const hold = useCallback(
    (direction: Direction) => {
      if (!motionAvailable() || reducedMotion()) return;
      engine.current!.hold(direction);
      wake();
    },
    [wake],
  );

  /** The held key is let go. */
  const release = useCallback(() => {
    engine.current!.release();
    wake();
  }, [wake]);

  // The pile: the engine takes the moves that make it what the page shows.
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
    engine.current!.sync(pile, direction, instant, previous, before);
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
    // `released` re-binds after cards go.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  useLayoutEffect(() => {
    const root = content.current;
    const unitEl = unit.current;
    let snap = pending.current;
    pending.current = null;
    if (snap && (snap.from === front || performance.now() - snap.at > 500))
      snap = null;
    for (const animation of gliding.current) animation.cancel();
    gliding.current = [];
    if (!root || !unitEl || !page.current) return;
    const unitY = yOf(unitEl);
    const fromY = snap?.unitY ?? restY.current;
    restY.current = unitY;
    if (!motionAvailable()) return;
    const itemChanged = front !== lastItem.current;
    lastItem.current = front;
    const reduced = reducedMotion();
    if (reduced && itemChanged)
      partOf(root, "actions")?.animate([{ opacity: 0 }, {}], {
        duration: REDUCED_MS,
        easing: EASE,
      });

    // The card and replies glide from where the unit was to where it now sits
    // (when a longer heading pushes the card down); the heading stays put.
    const shift = fromY === null ? 0 : fromY - unitY;
    if (!reduced && Math.abs(shift) > 0.5)
      gliding.current.push(
        unitEl.animate([{ transform: `translateY(${shift}px)` }, {}], {
          duration: SETTLE_MS,
          easing: EASE,
        }),
      );

    // The old replies stay where they were while they fade.
    const layer = ghosts.current;
    if (!itemChanged) return;
    for (const part of FADED) {
      const piece = snap?.pieces[part];
      if (!layer || !piece) continue;
      copies.current[part]?.remove();
      const y = yOf(layer);
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
      if (part === "actions") copies.current[part] = piece.copy;
    }
    if (!reduced)
      partOf(root, "heading")?.animate([{ opacity: 0.2 }, { opacity: 1 }], {
        duration: 200,
        easing: "ease-out",
      });
    write(engine.current!.frame());
    // Only a change of item moves the column.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [front]);

  /** Which way the last change went, or `1` for one nobody captured. */
  const signOf = (): Sign => {
    const last = lastDirection.current;
    return last?.direction === "back" ? -1 : 1;
  };

  // A new receipt crossfades with the one it replaces, in the same corner of
  // the page; neither takes layout space, so nothing moves. A change nobody
  // directed (a receipt that expires) only fades.
  useLayoutEffect(() => {
    const root = content.current;
    const layer = ghosts.current;
    if (!root || !layer || !motionAvailable()) return;
    const receipt = partOf(root, "receipt");
    const key = receipt?.dataset.receiptKey ?? null;
    const was = lastReceipt.current;
    if ((was?.key ?? null) !== key) {
      const now = performance.now();
      const directed =
        lastDirection.current !== null &&
        now - lastDirection.current.at < DIRECTION_MS;
      const leaving = was?.copy ?? null;
      if (leaving) {
        leaving.dataset.queueGhost = "receipt";
        layer.append(leaving);
      }
      crossfade(receipt, leaving, directed ? signOf() : 1, {
        rapid: now - lastCrossfade.current.receipt < FADE_IN_MS,
        reduced: reducedMotion() || !directed,
      });
      lastCrossfade.current.receipt = now;
    }
    lastReceipt.current =
      receipt && key ? { key, copy: copyOf(receipt) } : null;
  });

  useEffect(() => {
    const clk = clock.current;
    const ghostLayer = ghosts.current;
    return () => {
      if (clk.raf) cancelAnimationFrame(clk.raf);
      clk.raf = 0;
      observer.current?.disconnect();
      observer.current = null;
      for (const animation of gliding.current) animation.cancel();
      gliding.current = [];
      // The remount observes the cards again, so none counts as already seen.
      cards.current = new Map();
      ghostLayer?.replaceChildren();
    };
  }, []);

  /** The items whose cards the page must keep drawing: the pile's, and any
   * still leaving it. */
  const held = () => (motionAvailable() ? engine.current!.keys() : []);

  return {
    page,
    content,
    unit,
    ghosts,
    stage,
    capture,
    accept,
    hold,
    release,
    held,
    front,
  };
}
