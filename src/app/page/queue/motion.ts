/**
 * The queue's change of item as flipping through a deck of cards. Every card
 * is a whole, opaque card, so nothing ever shows through one.
 *
 * Moving on, the front card goes to the back of the deck: it lifts, passes
 * behind the stack at the top of its rise, and settles into the back slot as
 * it fades away. The card behind it, already showing its content, slides up
 * into the front (`CardStack` keeps one element per item, so this is the
 * same card moving) and takes its own height. Going back is the reverse: the
 * earlier card comes out from behind the deck, rises over it, and drops onto
 * the front, covering the card it lands on. The heading and actions fade
 * through to the new item's, and the page glides to its new center.
 *
 * The card going to the back, the old heading, and the old actions are
 * copies of their DOM, taken just before the change (`capture`). Each change
 * starts from wherever the last one had got to: the glide, the front card's
 * height, and the stack's CSS transitions all retarget, and an earlier card
 * still in flight is dropped, so held keys never stack up motion or leave
 * stray cards. A change within `RAPID_MS` of the last (a held arrow key)
 * runs quicker and copies no heading or actions. Under reduced motion the
 * new item only fades in. Without Web Animations (tests) every change
 * applies at once.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { layerPose } from "./QueueItem.tsx";

export type Direction = "forward" | "back";

/** The page glide, the cards' moves between slots, and the height change. */
const SETTLE_MS = 420;
/** Matches `.ws-stack-card`'s transition in styles.css. */
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
/** A card going to the back of the deck, or coming out from behind it: up
 * and over (`OVER`), then down into its place (`EASE`). */
const DECK_MS = 560;
const RAPID_DECK_MS = 260;
const OVER = "cubic-bezier(0.4, 0, 0.6, 1)";
/** How high, in card heights, a card rises to pass over or behind the deck. */
const LIFT = 0.55;
/** The slot past the shown ones, where a card waits unseen at the back. */
const STACK_BACK = 2;
/** The old heading and actions fade out; the new ones fade in after. */
const EXIT_MS = 220;
const EXIT_FADE_MS = 120;
const EXIT_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const IN_DELAY_MS = 100;
const IN_MS = 200;
/** A change this soon after the last one is a held key, and runs quicker. */
const RAPID_MS = 200;
const RAPID_MS_EACH = 120;
/** The least space kept above the heading. */
const MIN_TOP = 24;

/** The parts copied as they leave, by `data-queue-part`. */
const PARTS = ["heading", "actions"] as const;

type Piece = {
  /** A copy of the part as it looked, for its exit. */
  copy: HTMLElement;
  /** Its place in layout, without any move it was partway through:
   * page coordinates down, the viewport's across. */
  y: number;
  x: number;
  /** How far below it its first child sat, since that child's margin may
   * have collapsed through the part, which a positioned copy won't do. */
  childOffset: number;
  width: number;
};

type Snapshot = {
  direction: Direction;
  /** The item shown when captured; a capture applies only to a change from it. */
  from: string | null;
  at: number;
  rapid: boolean;
  unitY: number;
  /** The front card's drawn height, which the next front card starts from. */
  frontHeight: number | null;
  card: Piece | null;
  pieces: Piece[];
  /** The items whose cards were in the stack. */
  cards: Set<string>;
};

const motionAvailable = () =>
  typeof Element !== "undefined" && "animate" in Element.prototype;
const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const partOf = (root: HTMLElement, part: string) =>
  root.querySelector<HTMLElement>(`[data-queue-part="${part}"]`);
const cardsOf = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("[data-queue-card]")].map(
    (el) => [el.dataset.queueCard!, el] as const,
  );
/** The card itself inside the front slot (`ThreadCard`, `SuggestionCard`). */
const faceOf = (front: HTMLElement | null) =>
  (front?.firstElementChild as HTMLElement | null) ?? null;

/**
 * The boxes of a card's content, which fade while its surface stays opaque.
 * A `display: contents` wrapper has no box to fade, so its children stand in.
 */
function contentOf(face: Element | null): Element[] {
  return [...(face?.children ?? [])].flatMap((child) =>
    getComputedStyle(child).display === "contents" ? contentOf(child) : [child],
  );
}

/** Copies an element to draw while it leaves: inert, with no ids or hooks. */
function copyOf(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const withId of copy.querySelectorAll("[id]"))
    withId.removeAttribute("id");
  for (const name of ["data-queue-part", "data-queue-card", "data-slot"])
    copy.removeAttribute(name);
  copy.classList.remove("ws-stack-card");
  copy.setAttribute("aria-hidden", "true");
  copy.setAttribute("inert", "");
  return copy;
}

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
  /** The glide and the front card's height, replaced by each change. */
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

  const pieceOf = useCallback(
    (el: HTMLElement): Piece => {
      const copy = copyOf(el);
      // Draw it as it looked, partway through a fade or move included.
      const style = getComputedStyle(el);
      copy.style.opacity = style.opacity;
      copy.style.transform = style.transform;
      const faded = contentOf(faceOf(el)).map(
        (child) => getComputedStyle(child).opacity,
      );
      // The copy isn't in the page yet, so it has no computed display; its
      // content boxes are found by the same path through the original.
      const paths = contentOf(faceOf(el)).map((child) => pathTo(el, child));
      paths.forEach((path, i) => {
        const child = path.reduce<Element | undefined>(
          (node, index) => node?.children[index],
          copy,
        ) as HTMLElement | undefined;
        if (child) child.style.opacity = faded[i] ?? "1";
      });
      const top = yOf(el);
      const rect = el.getBoundingClientRect();
      return {
        copy,
        y: top - shiftOf(el),
        x: rect.left + (rect.width - el.offsetWidth) / 2,
        childOffset: el.firstElementChild ? yOf(el.firstElementChild) - top : 0,
        width: el.offsetWidth,
      };
    },
    [yOf],
  );

  const capture = useCallback(
    (direction: Direction) => {
      const root = content.current;
      const unitEl = unit.current;
      if (!root || !unitEl || !page.current || !motionAvailable()) return;
      if (reducedMotion()) return;
      const now = performance.now();
      const rapid = now - lastChange.current < RAPID_MS;
      const front = partOf(root, "front");
      const pieces: Piece[] = [];
      if (!rapid)
        for (const part of PARTS) {
          const el = partOf(root, part);
          if (el) pieces.push(pieceOf(el));
        }
      const card = front ? pieceOf(front) : null;
      pending.current = {
        direction,
        from: shown.current,
        at: now,
        rapid,
        unitY: yOf(unitEl),
        frontHeight: faceOf(front)?.getBoundingClientRect().height ?? null,
        card,
        pieces,
        cards: new Set(cardsOf(root).map(([key]) => key)),
      };
    },
    [pieceOf, yOf],
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
      if (itemChanged) fadeIn(root, 0, 160, 0, 0);
      return;
    }
    const direction = snap?.direction ?? "forward";
    const toward = direction === "forward" ? 1 : -1;
    const rapid = snap?.rapid ?? false;
    const settle = rapid ? RAPID_DECK_MS : SETTLE_MS;

    // The whole column glides from where the unit was to its new center.
    const shift = fromY === null ? 0 : fromY - unitY;
    // The copies ride the glide too, so measure where they go before it.
    const layer = ghosts.current;
    const stackLayer = root.querySelector<HTMLElement>("[data-queue-ghosts]");
    const place = (piece: Piece, into: HTMLElement) => {
      const y = yOf(into) + shift;
      const x = into.getBoundingClientRect().left;
      return () => {
        Object.assign(piece.copy.style, {
          position: "absolute",
          margin: "0",
          top: `${piece.y - y}px`,
          left: `${piece.x - x}px`,
          width: `${piece.width}px`,
        });
        into.append(piece.copy);
        const child = piece.copy.firstElementChild;
        const drift = child
          ? yOf(child) - yOf(piece.copy) - piece.childOffset
          : 0;
        if (Math.abs(drift) > 0.5)
          piece.copy.style.top = `${piece.y - y - drift}px`;
      };
    };
    const placeCard = snap?.card && stackLayer && place(snap.card, stackLayer);
    const placePieces =
      layer && snap ? snap.pieces.map((piece) => place(piece, layer)) : [];
    if (Math.abs(shift) > 0.5)
      running.current.push(
        root.animate([{ transform: `translateY(${shift}px)` }, {}], {
          duration: settle,
          easing: EASE,
        }),
      );
    if (!itemChanged) return;
    lastChange.current = performance.now();

    // The front card grows or shrinks from the last front card's height; the
    // cards behind (which take its height), the actions, and the page's
    // center follow it.
    const front = partOf(root, "front");
    const face = faceOf(front);
    const frontHeight = face?.getBoundingClientRect().height ?? 0;
    if (face && snap?.frontHeight != null) {
      const height = frontHeight;
      const zoom = Number(getComputedStyle(face).zoom) || 1;
      if (Math.abs(snap.frontHeight - height) > 0.5)
        running.current.push(
          face.animate(
            [
              { height: `${snap.frontHeight / zoom}px`, overflow: "hidden" },
              { height: `${height / zoom}px`, overflow: "hidden" },
            ],
            { duration: settle, easing: EASE },
          ),
        );
    }

    const deck = rapid ? RAPID_DECK_MS : DECK_MS;
    const lift = (height: number) =>
      `translateY(${-LIFT * height}px) scale(0.98)`;
    const back = layerPose(STACK_BACK).transform;

    // Cards new to the stack: the earlier card, going back, comes out from
    // behind the deck, rises over it, and drops onto the front; any other
    // comes in from the next slot down.
    if (snap) {
      for (const [key, el] of cardsOf(root)) {
        if (snap.cards.has(key)) continue;
        const slot = Number(el.dataset.slot);
        if (slot < 0 && direction === "back") {
          const height = frontHeight;
          // The card it lands on keeps its content in view until covered.
          const covered = cardsOf(root).find(
            ([, card]) => card.dataset.slot === "0",
          )?.[1];
          for (const child of contentOf(faceOf(covered ?? null)))
            child.animate(
              [
                { opacity: 1 },
                { opacity: 1, offset: 0.55 },
                { opacity: 0, offset: 0.7 },
                { opacity: 0 },
              ],
              { duration: deck },
            );
          el.animate(
            [
              { transform: back, zIndex: -10, opacity: 0 },
              {
                transform: back,
                zIndex: -10,
                opacity: 1,
                offset: 0.1,
                easing: OVER,
              },
              { transform: lift(height), zIndex: -10, offset: 0.549 },
              {
                transform: lift(height),
                zIndex: 3,
                offset: 0.55,
                easing: EASE,
              },
              { transform: "none", zIndex: 3, opacity: 1 },
            ],
            { duration: deck },
          );
        } else
          el.animate(
            [{ transform: layerPose(slot + 1).transform, opacity: 0 }, {}],
            { duration: settle, easing: EASE },
          );
      }
    }

    fadeIn(
      root,
      rapid || !snap ? 0 : IN_DELAY_MS,
      rapid ? RAPID_MS_EACH : IN_MS,
      rapid || !snap ? 0 : 4 * toward,
      rapid ? 0.4 : 0,
    );

    // Moving on, the front card goes to the back of the deck: it lifts, passes
    // behind the stack at the top of its rise, and settles into the back,
    // taking the new front card's height. At most one card is in flight.
    if (stackLayer) stackLayer.replaceChildren();
    if (snap?.card && placeCard && direction === "forward") {
      placeCard();
      const copy = snap.card.copy;
      const from = snap.frontHeight ?? copy.offsetHeight;
      const to = frontHeight || from;
      copy.style.overflow = "hidden";
      const start = copy.style.transform || "none";
      const flight = copy.animate(
        [
          { transform: start, zIndex: 20, height: `${from}px`, easing: OVER },
          {
            transform: lift(from),
            zIndex: 20,
            height: `${from}px`,
            offset: 0.45,
          },
          {
            transform: lift(from),
            zIndex: -10,
            height: `${from}px`,
            offset: 0.451,
            easing: EASE,
          },
          {
            transform: back,
            zIndex: -10,
            height: `${to}px`,
            opacity: 1,
            offset: 0.9,
          },
          { transform: back, zIndex: -10, height: `${to}px`, opacity: 0 },
        ],
        { duration: deck, fill: "forwards" },
      );
      // Behind the deck its content is hidden, as every card's there is.
      for (const child of contentOf(faceOf(copy)))
        child.animate(
          [
            {},
            { opacity: 1, offset: 0.45 },
            { opacity: 0, offset: 0.55 },
            { opacity: 0 },
          ],
          {
            duration: deck,
            fill: "forwards",
          },
        );
      flight.onfinish = flight.oncancel = () => copy.remove();
    }

    // The old heading and actions fade where they were.
    if (!layer) return;
    while (layer.childElementCount > 6) layer.firstElementChild?.remove();
    for (const [index, piece] of (snap?.pieces ?? []).entries()) {
      placePieces[index]?.();
      piece.copy.animate([{}, { transform: `translateY(${-4 * toward}px)` }], {
        duration: EXIT_MS,
        easing: EXIT_EASE,
        fill: "forwards",
      });
      const exit = piece.copy.animate([{}, { opacity: 0 }], {
        duration: EXIT_FADE_MS,
        easing: "ease-out",
        fill: "forwards",
      });
      exit.onfinish = exit.oncancel = () => piece.copy.remove();
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

/** The child indexes leading from `root` down to `node`. */
function pathTo(root: Element, node: Element): number[] {
  const path: number[] = [];
  for (let at: Element = node; at !== root && at.parentElement;) {
    path.unshift([...at.parentElement.children].indexOf(at));
    at = at.parentElement;
  }
  return path;
}

/** How far an element is drawn below its place, partway through a move. */
function shiftOf(el: HTMLElement): number {
  const { transform } = getComputedStyle(el);
  if (!transform || transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m42;
}

/**
 * Fades in the new item's heading and actions from opacity `from`, rising
 * `rise` pixels (negative settles down). The front card's content fades in
 * by its own transition (`.ws-stack-card`).
 */
function fadeIn(
  root: HTMLElement,
  delay: number,
  duration: number,
  rise: number,
  from: number,
) {
  for (const part of PARTS) {
    const el = partOf(root, part);
    if (!el) continue;
    const start: Keyframe =
      rise === 0
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
