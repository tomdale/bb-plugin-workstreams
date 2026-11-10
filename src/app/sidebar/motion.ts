/**
 * Motion for the sidebar and phone Home. Up Next's rows own slots that open
 * and close on one spring, so the card, Show more, Pinned, and everything
 * below follow through layout, and a re-ranked row travels to its new slot
 * on the same spring (see `useSlotList`). Elsewhere in the sidebar, rows,
 * bands, and group folds open and close their height over a fixed duration
 * and curve, so everything below slides, and workstreams glide to their new
 * place when a priority change reorders them.
 *
 * Motion is skipped where Web Animations are unavailable (tests, old
 * engines); there every change applies at once. Under reduced motion,
 * layout changes apply at once, and only Up Next's joining rows fade in.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type RefObject,
} from "react";

/**
 * How long a row or band takes to open, and to close (`.ws-presence` in
 * styles.css). One duration and curve for both, so a row closing while
 * another opens nets out without the list bobbing.
 */
export const ENTER_MS = 260;
const LEAVE_MS = 260;
const FLIP_MS = 320;
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Up Next's motion (see `useSlotList`). Every slot height and every travel
 * runs on one critically damped spring at mass 1: stiffness (2π/response)²
 * and damping coefficient 4π·damping/response. Travel time therefore does
 * not depend on distance, and a change that lands mid-flight keeps each
 * value's velocity. Contents fade on {@link EASE_OUT}.
 */
export const UP_NEXT_MOTION = {
  responseMs: 340,
  damping: 1,
  /** An entering row's contents fade in over this, starting after the delay. */
  enterMs: 180,
  enterDelayMs: 70,
  /** A leaving row's contents fade out over this while its slot closes. */
  leaveMs: 120,
  /** A burst of row changes redraws once, this long after its last change. */
  burstMs: 120,
  /** Under reduced motion, a joining row fades in over this and nothing moves. */
  reducedFadeMs: 150,
} as const;

type MotionMode = "none" | "reduced" | "full";

/** How much motion runs here and now. */
function motionMode(): MotionMode {
  if (typeof window === "undefined") return "none";
  if (typeof Element === "undefined" || !("animate" in Element.prototype))
    return "none";
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "reduced"
    : "full";
}

/** Whether this motion runs here and now. */
function canAnimate(): boolean {
  return motionMode() === "full";
}

/** A CSS cubic Bézier timing function, solved for x by bisection. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bx = (u: number) =>
    3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u * u * (1 - u) + u ** 3;
  const by = (u: number) =>
    3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u * u * (1 - u) + u ** 3;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let u = t;
    for (let i = 0; i < 40; i++) {
      u = (lo + hi) / 2;
      if (bx(u) < t) lo = u;
      else hi = u;
    }
    return by(u);
  };
}
const easeOut = cubicBezier(0.23, 1, 0.32, 1);

/** One sprung number, in pixels. */
export type Spring = { value: number; velocity: number; target: number };

const RESPONSE_S = UP_NEXT_MOTION.responseMs / 1000;
const STIFFNESS = ((2 * Math.PI) / RESPONSE_S) ** 2;
const DAMPING = (4 * Math.PI * UP_NEXT_MOTION.damping) / RESPONSE_S;

const springMoving = (spring: Spring) =>
  spring.value !== spring.target || spring.velocity !== 0;

/**
 * Advances `spring` by `ms` in 1ms steps of semi-implicit Euler, snapping it
 * to its target once it is within `epsilon` pixels and nearly still. Returns
 * whether it is still moving.
 */
export function stepSpring(spring: Spring, ms: number, epsilon: number) {
  for (let left = ms; left > 0 && springMoving(spring); left -= 1) {
    const h = Math.min(1, left) / 1000;
    spring.velocity +=
      (-STIFFNESS * (spring.value - spring.target) -
        DAMPING * spring.velocity) *
      h;
    spring.value += spring.velocity * h;
    if (
      Math.abs(spring.value - spring.target) < epsilon &&
      Math.abs(spring.velocity) < epsilon * 20
    ) {
      spring.value = spring.target;
      spring.velocity = 0;
    }
  }
  return springMoving(spring);
}

/** An opacity fade on {@link easeOut}, in document time. */
type Fade = {
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly duration: number;
};
function fadeAt(fade: Fade, now: number): number {
  const progress = (now - fade.start) / fade.duration;
  if (progress <= 0) return fade.from;
  if (progress >= 1) return fade.to;
  return fade.from + (fade.to - fade.from) * easeOut(progress);
}

type Slot = {
  /** The contents' own height, measured without the slot's inline height. */
  natural: number;
  /** The space the slot takes in layout. */
  height: Spring;
  /** Travel from the slot's layout position to where the row is drawn. */
  offset: Spring;
  /** The contents' fade; none means fully shown. */
  fade: Fade | null;
  leaving: boolean;
  /** A leaving slot that has closed, reported once and waiting to unmount. */
  closed: boolean;
  /** Whether the slot's element carries inline motion styles. */
  styled: boolean;
};

/** One commit's decisions about a slot list (see `SlotSprings.commit`). */
type SlotCommit = {
  readonly entries: readonly { key: string; leaving: boolean }[];
  readonly mode: Exclude<MotionMode, "none">;
  /** The first commit: everything appears at rest. */
  readonly first: boolean;
  /** Entering rows that open without fading, rising from under Show more. */
  readonly rise: ReadonlySet<string>;
  /** Leaving rows that close without fading, sinking under Show more. */
  readonly sink: ReadonlySet<string>;
};

/**
 * The z-index a slot draws at: a row moving up passes over the rows moving
 * down, and both pass over the rows at rest. Slots at the same level draw in
 * list order.
 */
function stackLevel(offset: number) {
  return Math.abs(offset) <= 0.05 ? 1 : offset > 0 ? 3 : 2;
}

/**
 * A `clip-path` that shows a slot of `height` pixels except the `covered`
 * bands, each a pair of pixel offsets from the slot's top. The bands still
 * showing are one polygon whose seams run along the left edge, where they
 * enclose nothing.
 */
export function clipPathShowing(
  height: number,
  covered: readonly (readonly [number, number])[],
): string {
  const shown: string[] = [];
  let at = 0;
  for (const [from, to] of [
    ...[...covered].sort((a, b) => a[0] - b[0]),
    [height, height],
  ] as const) {
    if (from > at)
      shown.push(`0 ${at}px, 100% ${at}px, 100% ${from}px, 0 ${from}px`);
    at = Math.max(at, to);
  }
  return shown.length > 0 ? `polygon(${shown.join(", ")})` : "inset(100%)";
}

const SLOT_STYLES = [
  "height",
  "overflow",
  "opacity",
  "transform",
  "position",
  "zIndex",
  "clipPath",
] as const;

/**
 * Drives one list of slots: stacked siblings, each a box around its whole
 * contents, with one CSS margin between neighbors (`li + li`). A slot's
 * height, travel offset, opacity, and clip are written as inline styles while
 * it moves and cleared once it rests, so a resting slot is laid out by CSS
 * alone. While any slot moves, every gap is written too, opening and closing
 * with the slots on either side of it, so the rows below never jump by a
 * gap. Positions come from the slots' heights and gaps in order; nothing is
 * measured per frame.
 */
class SlotSprings {
  private readonly slots = new Map<string, Slot>();
  private readonly elements = new Map<string, HTMLElement>();
  private order: string[] = [];
  /** The CSS margin between neighboring slots, read when slots are measured. */
  private gap = 0;
  /** Whether the gaps are written inline. */
  private gapped = false;
  private frame: number | null = null;
  private last = 0;
  /** A contents height change waiting for its burst to end (see `remeasure`). */
  private resize: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly closed: (keys: string[]) => void) {}

  attach(key: string, element: HTMLElement | null) {
    if (element) this.elements.set(key, element);
    else this.elements.delete(key);
  }

  /** Whether the slot exists and is still open or opening. */
  holds(key: string) {
    const slot = this.slots.get(key);
    return slot !== undefined && !slot.leaving;
  }

  /**
   * Applies a new arrangement at `now`. Every slot keeps its velocity: an
   * entering one opens from nothing, a leaving one closes, one whose height
   * changed retargets, and one that moved starts where it was drawn and
   * travels to its new place.
   */
  commit(change: SlotCommit, now: number) {
    this.advance(now);
    if (this.resize !== null) clearTimeout(this.resize);
    this.resize = null;
    const full = change.mode === "full";
    const drawn = new Map<string, number>();
    for (const [key, { top }] of this.layout())
      drawn.set(key, top + this.slots.get(key)!.offset.value);
    const naturals = this.measure(
      change.entries.filter((entry) => !entry.leaving).map(({ key }) => key),
    );
    const placed = new Set<string>();
    const arriving = new Set<string>();
    for (const { key, leaving } of change.entries) {
      let slot = this.slots.get(key);
      const opacity = slot ? this.opacityOf(slot, now) : 0;
      if (leaving) {
        if (!slot) continue;
        placed.add(key);
        if (!slot.leaving) {
          slot.leaving = true;
          slot.closed = false;
          slot.height.target = 0;
          slot.fade = change.sink.has(key)
            ? null
            : {
                from: opacity,
                to: 0,
                start: now,
                duration: UP_NEXT_MOTION.leaveMs,
              };
        }
        continue;
      }
      placed.add(key);
      const natural = naturals.get(key) ?? slot?.natural ?? 0;
      const enter = (from: number): Fade | null =>
        full && change.rise.has(key)
          ? null
          : {
              from,
              to: 1,
              start: now + (full ? UP_NEXT_MOTION.enterDelayMs : 0),
              duration: full
                ? UP_NEXT_MOTION.enterMs
                : UP_NEXT_MOTION.reducedFadeMs,
            };
      if (!slot) {
        const opening = !change.first;
        slot = {
          natural,
          height: {
            value: full && opening ? 0 : natural,
            velocity: 0,
            target: natural,
          },
          offset: { value: 0, velocity: 0, target: 0 },
          fade: opening ? enter(0) : null,
          leaving: false,
          closed: false,
          styled: false,
        };
        this.slots.set(key, slot);
        arriving.add(key);
        continue;
      }
      if (slot.leaving) {
        slot.leaving = false;
        slot.closed = false;
        slot.fade = enter(opacity);
        arriving.add(key);
      }
      slot.natural = natural;
      slot.height.target = natural;
      if (!full) {
        slot.height.value = natural;
        slot.height.velocity = 0;
      }
    }
    for (const key of this.slots.keys())
      if (!placed.has(key)) this.slots.delete(key);
    this.order = change.entries
      .map(({ key }) => key)
      .filter((key) => this.slots.has(key));

    for (const [key, { top }] of this.layout()) {
      const slot = this.slots.get(key)!;
      if (slot.leaving) continue;
      const from = drawn.get(key);
      if (!full || arriving.has(key) || from === undefined) {
        slot.offset = { value: 0, velocity: 0, target: 0 };
        continue;
      }
      const travel = from - top;
      if (Math.abs(travel) < 0.01 && !springMoving(slot.offset)) continue;
      slot.offset.value = travel;
      slot.offset.target = 0;
    }
    this.draw(now);
    this.schedule();
  }

  /**
   * Picks up a change in a slot's contents height, such as a row gaining a
   * second line, without a change in arrangement. Like an arrangement, the
   * new height waits until changes have been quiet for `burstMs`, so a row
   * that loses its second line as it leaves keeps its slot until it closes;
   * under reduced motion it applies at once.
   */
  remeasure(mode: Exclude<MotionMode, "none">, now: number) {
    const keys = this.order.filter((key) => !this.slots.get(key)!.leaving);
    const naturals = this.measure(keys);
    let changed = false;
    this.advance(now);
    for (const key of keys) {
      const slot = this.slots.get(key)!;
      const natural = naturals.get(key);
      if (natural === undefined || Math.abs(natural - slot.natural) < 0.01)
        continue;
      changed = true;
      slot.natural = natural;
      if (mode !== "full") {
        slot.height = { value: natural, velocity: 0, target: natural };
      }
    }
    if (!changed) return;
    if (mode === "full") {
      if (this.resize !== null) clearTimeout(this.resize);
      this.resize = setTimeout(() => {
        this.resize = null;
        const at = performance.now();
        this.advance(at);
        for (const slot of this.slots.values())
          if (!slot.leaving) slot.height.target = slot.natural;
        this.draw(at);
        this.schedule();
      }, UP_NEXT_MOTION.burstMs);
    }
    // Hold the slot at its height until then.
    this.draw(now);
  }

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.resize !== null) clearTimeout(this.resize);
    this.resize = null;
  }

  /**
   * Each slot's contents height, read with every inline height lifted at
   * once so the reads share one layout.
   */
  private measure(keys: readonly string[]) {
    const lifted: [HTMLElement, string, string][] = [];
    for (const key of keys) {
      const element = this.elements.get(key);
      if (element && (element.style.height || element.style.marginTop)) {
        lifted.push([element, element.style.height, element.style.marginTop]);
        element.style.height = "";
        element.style.marginTop = "";
      }
    }
    const naturals = new Map<string, number>();
    let gap = 0;
    for (const key of keys) {
      const element = this.elements.get(key);
      if (!element) continue;
      naturals.set(key, element.getBoundingClientRect().height);
      gap = Math.max(
        gap,
        Number.parseFloat(getComputedStyle(element).marginTop) || 0,
      );
    }
    if (keys.length > 1) this.gap = gap;
    for (const [element, height, margin] of lifted) {
      element.style.height = height;
      element.style.marginTop = margin;
    }
    return naturals;
  }

  /**
   * Each slot's layout top, without its travel, and the gap above it. A gap
   * is as open as the less open of its slot and the most open slot before
   * it, so a slot opening or closing anywhere, first included, brings its
   * gap with it.
   */
  private layout() {
    const out = new Map<string, { top: number; gap: number }>();
    let y = 0;
    let before = 0;
    for (const key of this.order) {
      const slot = this.slots.get(key)!;
      const open =
        slot.natural > 0
          ? Math.min(1, Math.max(0, slot.height.value / slot.natural))
          : slot.height.value > 0
            ? 1
            : 0;
      const gap = out.size === 0 ? 0 : this.gap * Math.min(open, before);
      before = Math.max(before, open);
      out.set(key, { top: y + gap, gap });
      y += gap + slot.height.value;
    }
    return out;
  }

  private opacityOf(slot: Slot, now: number) {
    if (!slot.fade) return 1;
    const opacity = fadeAt(slot.fade, now);
    if (opacity >= 1 && now >= slot.fade.start + slot.fade.duration)
      slot.fade = null;
    return opacity;
  }

  /** Steps every spring to `now`; a long gap, such as a hidden tab, ends the motion. */
  private advance(now: number) {
    const ms = now - this.last;
    this.last = now;
    if (ms <= 0) return;
    for (const slot of this.slots.values()) {
      for (const [spring, epsilon] of [
        [slot.height, 0.01],
        [slot.offset, 0.02],
      ] as const) {
        if (ms > 250) {
          spring.value = spring.target;
          spring.velocity = 0;
        } else stepSpring(spring, ms, epsilon);
      }
    }
  }

  /**
   * Where a row crossing others hides them. Rows paint in `stackLevel`
   * order, and each is clipped to the part no solid row above it covers, so
   * two titles never show in the same pixels and the row on top draws on the
   * card itself, shimmer included, with no surface of its own. Returns, for
   * each slot with something above it, a `clip-path` showing the rest, from
   * the slots' heights and offsets in painting order.
   */
  private clips(now: number) {
    const boxes = [...this.layout()].map(([key, laid], index) => {
      const slot = this.slots.get(key)!;
      const top = laid.top + slot.offset.value;
      return {
        key,
        top,
        height: Math.max(0, slot.height.value),
        order: stackLevel(slot.offset.value) * this.order.length + index,
        // A row fading in or out lets what is beneath it show through.
        solid: !slot.leaving && this.opacityOf(slot, now) >= 1,
      };
    });
    const clips = new Map<string, string>();
    for (const box of boxes) {
      const covered: [number, number][] = [];
      for (const above of boxes) {
        if (!above.solid || above.order <= box.order) continue;
        const from = Math.max(above.top, box.top) - box.top;
        const to =
          Math.min(above.top + above.height, box.top + box.height) - box.top;
        if (to - from > 0.05) covered.push([from, to]);
      }
      if (covered.length > 0)
        clips.set(box.key, clipPathShowing(box.height, covered));
    }
    return clips;
  }

  private draw(now: number) {
    const closed: string[] = [];
    const clips = this.clips(now);
    for (const [key, slot] of this.slots) {
      const opacity = this.opacityOf(slot, now);
      const moving =
        springMoving(slot.height) ||
        springMoving(slot.offset) ||
        slot.fade !== null ||
        clips.has(key);
      if (slot.leaving && !springMoving(slot.height) && !slot.closed) {
        slot.closed = true;
        closed.push(key);
      }
      const element = this.elements.get(key);
      if (!element) continue;
      if (!moving && !slot.leaving && slot.height.value === slot.natural) {
        if (slot.styled)
          for (const name of SLOT_STYLES) element.style[name] = "";
        slot.styled = false;
        continue;
      }
      slot.styled = true;
      const offset = slot.offset.value;
      const style = element.style;
      style.height = `${Math.max(0, slot.height.value)}px`;
      style.overflow = "hidden";
      style.opacity = opacity < 1 ? String(opacity) : "";
      style.transform =
        Math.abs(offset) >= 0.01 ? `translateY(${offset}px)` : "";
      style.position = "relative";
      style.zIndex = String(stackLevel(offset));
      style.clipPath = clips.get(key) ?? "";
    }
    const moving = [...this.slots.values()].some((slot) => slot.styled);
    if (moving && this.gap > 0) {
      for (const [key, { gap }] of this.layout()) {
        const element = this.elements.get(key);
        if (element) element.style.marginTop = `${gap}px`;
      }
      this.gapped = true;
    } else if (this.gapped) {
      for (const element of this.elements.values())
        element.style.marginTop = "";
      this.gapped = false;
    }
    if (closed.length > 0) this.closed(closed);
  }

  private busy(now: number) {
    for (const slot of this.slots.values()) {
      if (springMoving(slot.height) || springMoving(slot.offset)) return true;
      if (slot.fade && now < slot.fade.start + slot.fade.duration) return true;
    }
    return false;
  }

  private schedule() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (time: number) => {
    this.frame = null;
    this.advance(time);
    this.draw(time);
    if (this.busy(time)) this.schedule();
  };
}

/** A slot in a {@link useSlotList} list, and the ref its element takes. */
export type SlotEntry<T> = {
  readonly key: string;
  readonly item: T;
  /** Closing; the element is inert and hidden from assistive technology. */
  readonly leaving: boolean;
  readonly ref: (element: HTMLElement | null) => void;
};

type ShownSlots<T> = {
  readonly keys: readonly string[];
  /** Each item as it was when this arrangement was taken. */
  readonly items: ReadonlyMap<string, T>;
  readonly signature: string;
  readonly trimmed: ReadonlySet<string>;
};

/**
 * Up Next's rows as slots that open and close on one spring (see
 * {@link UP_NEXT_MOTION} and {@link SlotSprings}). Render each entry's
 * element with its `ref` and `presenceProps`, in order, as stacked siblings
 * with no style prop of their own: the hook owns their inline styles.
 *
 * A change in which rows show, or their order, waits until the burst it
 * belongs to has been quiet for `burstMs`, then animates once to the newest
 * state; meanwhile each shown row renders its newest item, so selection and
 * marks update at once. A change in `immediate`, such as the user toggling
 * Show more, applies without waiting.
 *
 * `trimmed` names the rows the row limit keeps out and `edge` the Show more
 * entry. A row the limit pushes out closes without fading, so Show more
 * rises over it, and rows arriving at the end that the limit kept out
 * before open without fading, rising from under Show more.
 *
 * `arranged` marks an item whose contents belong to the arrangement, such as
 * Show more's count, so it changes only when the arrangement does.
 *
 * Under reduced motion nothing waits or moves: the new arrangement applies
 * at once, leaving rows go, and entering rows fade in. Without Web
 * Animations (tests) every change applies at once.
 */
export function useSlotList<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  options: {
    readonly trimmed: ReadonlySet<string>;
    readonly edge?: string;
    readonly immediate?: string;
    readonly arranged?: (item: T) => boolean;
  },
): SlotEntry<T>[] {
  const mode = motionMode();
  const keys = items.map(keyOf);
  const signature = keys.join("\n");
  const shown = useRef<ShownSlots<T> | null>(null);
  const latest = useRef<ShownSlots<T> | null>(null);
  const immediate = useRef(options.immediate);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  const live: ShownSlots<T> = {
    keys,
    items: byKey,
    signature,
    trimmed: options.trimmed,
  };
  let display = shown.current;
  if (
    display === null ||
    mode !== "full" ||
    options.immediate !== immediate.current
  )
    display = live;
  const displayItems = display.keys.flatMap((key) => {
    const held = display.items.get(key);
    const item =
      held !== undefined && options.arranged?.(held)
        ? held
        : (byKey.get(key) ?? held);
    return item === undefined ? [] : [item];
  });

  const committed = useRef<PresenceEntry<T>[] | null>(null);
  const presence = mergePresence(
    committed.current ?? [],
    displayItems,
    keyOf,
    mode === "full" && committed.current !== null,
  );

  const springs = useRef<SlotSprings | null>(null);
  if (springs.current === null)
    springs.current = new SlotSprings((closedKeys) => {
      const gone = new Set(closedKeys);
      committed.current = (committed.current ?? []).filter(
        (entry) => entry.phase !== "leave" || !gone.has(entry.key),
      );
      redraw();
    });
  const engine = springs.current;
  const refs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const refFor = (key: string) => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (element) => engine.attach(key, element);
      refs.current.set(key, ref);
    }
    return ref;
  };

  const arranged = useRef<{
    signature: string;
    trimmed: ReadonlySet<string>;
    /** Rows shown, not counting leaving ones. */
    present: number;
  } | null>(null);
  useLayoutEffect(() => {
    shown.current = display;
    latest.current = live;
    immediate.current = options.immediate;
    committed.current = presence;
    for (const key of refs.current.keys())
      if (!byKey.has(key) && !presence.some((entry) => entry.key === key))
        refs.current.delete(key);
    if (mode === "none") {
      arranged.current = null;
      return;
    }
    const entries = presence.map((entry) => ({
      key: entry.key,
      leaving: entry.phase === "leave",
    }));
    const arrangement = entries
      .map(({ key, leaving }) => `${leaving ? "-" : ""}${key}`)
      .join("\n");
    const now = performance.now();
    const previous = arranged.current;
    if (previous?.signature === arrangement) {
      engine.remeasure(mode, now);
      return;
    }
    // Rows arriving at the end that the limit kept out come up from under
    // Show more; the rows it pushes out go back under it.
    const rise = new Set<string>();
    const order = display.keys.filter((key) => key !== options.edge);
    for (let i = order.length - 1; i >= 0; i--) {
      const key = order[i]!;
      if (engine.holds(key) || !previous?.trimmed.has(key)) break;
      rise.add(key);
    }
    const sink = new Set(
      entries
        .filter(({ key, leaving }) => leaving && display.trimmed.has(key))
        .map(({ key }) => key),
    );
    engine.commit(
      {
        entries,
        mode,
        // Rows arriving in an empty list appear with it: the list's own
        // container opens around them.
        first: previous === null || previous.present === 0,
        rise,
        sink,
      },
      now,
    );
    arranged.current = {
      signature: arrangement,
      trimmed: display.trimmed,
      present: entries.filter((entry) => !entry.leaving).length,
    };
  });

  const timer = useRef<{
    signature: string;
    id: ReturnType<typeof setTimeout>;
  } | null>(null);
  useEffect(() => {
    if (display.signature === signature) {
      if (timer.current) clearTimeout(timer.current.id);
      timer.current = null;
      return;
    }
    // A burst restarts the wait on each change.
    if (timer.current?.signature === signature) return;
    if (timer.current) clearTimeout(timer.current.id);
    timer.current = {
      signature,
      id: setTimeout(() => {
        timer.current = null;
        shown.current = latest.current;
        redraw();
      }, UP_NEXT_MOTION.burstMs),
    };
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current.id);
      timer.current = null;
      engine.destroy();
    },
    [engine],
  );

  return presence.map((entry) => ({
    key: entry.key,
    item: entry.item,
    leaving: entry.phase === "leave",
    ref: refFor(entry.key),
  }));
}

type PresencePhase = "enter" | "idle" | "leave";
export type PresenceEntry<T> = {
  readonly key: string;
  readonly item: T;
  readonly phase: PresencePhase;
};

/**
 * The next rendered list: `items` in order, each new one entering, plus
 * each item that just left, still showing its last value, in its former
 * place after the nearest earlier neighbor that remains. Without `animate`,
 * it is `items` exactly.
 */
export function mergePresence<T>(
  previous: readonly PresenceEntry<T>[],
  items: readonly T[],
  keyOf: (item: T) => string,
  animate: boolean,
): PresenceEntry<T>[] {
  const before = new Map(previous.map((entry) => [entry.key, entry]));
  const out: PresenceEntry<T>[] = items.map((item) => {
    const key = keyOf(item);
    const old = before.get(key);
    const phase: PresencePhase = !animate
      ? "idle"
      : !old || old.phase === "leave"
        ? "enter"
        : old.phase;
    return { key, item, phase };
  });
  if (!animate) return out;
  const present = new Set(out.map((entry) => entry.key));
  previous.forEach((entry, index) => {
    if (present.has(entry.key)) return;
    let at = 0;
    for (let i = index - 1; i >= 0; i--) {
      const found = out.findIndex((o) => o.key === previous[i]!.key);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    out.splice(at, 0, { key: entry.key, item: entry.item, phase: "leave" });
    present.add(entry.key);
  });
  return out;
}

/**
 * `items` with entering and leaving phases (see {@link mergePresence}). The
 * first render enters nothing, so the list appears as it is, and neither does
 * a render with `animate` false. Each phase ends on a timer rather than an
 * animation event, so a missed event never strands a row.
 */
export function usePresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  animate = true,
): PresenceEntry<T>[] {
  const committed = useRef<PresenceEntry<T>[] | null>(null);
  const timers = useRef(
    new Map<string, { phase: PresencePhase; due: number }>(),
  );
  const timeout = useRef<{
    due: number;
    id: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [, settle] = useReducer((n: number) => n + 1, 0);
  const entries = mergePresence(
    committed.current ?? [],
    items,
    keyOf,
    animate && committed.current !== null && canAnimate(),
  );
  useLayoutEffect(() => {
    committed.current = entries;
  });
  useEffect(() => {
    const live = new Set(entries.map((entry) => entry.key));
    for (const [key, timer] of timers.current)
      if (!live.has(key)) timers.current.delete(key);
    for (const entry of entries) {
      const timer = timers.current.get(entry.key);
      if (timer?.phase === entry.phase) continue;
      timers.current.delete(entry.key);
      if (entry.phase === "idle") continue;
      timers.current.set(entry.key, {
        phase: entry.phase,
        due: Date.now() + (entry.phase === "enter" ? ENTER_MS : LEAVE_MS),
      });
    }
    const first = Math.min(
      ...[...timers.current.values()].map((timer) => timer.due),
    );
    if (!Number.isFinite(first)) {
      if (timeout.current) clearTimeout(timeout.current.id);
      timeout.current = null;
      return;
    }
    if (timeout.current?.due === first) return;
    if (timeout.current) clearTimeout(timeout.current.id);
    timeout.current = {
      due: first,
      id: setTimeout(
        () => {
          timeout.current = null;
          const settling = new Map<string, PresencePhase>();
          for (const [key, timer] of timers.current)
            if (timer.due <= first) {
              settling.set(key, timer.phase);
              timers.current.delete(key);
            }
          committed.current = (committed.current ?? []).flatMap((entry) => {
            const phase = settling.get(entry.key);
            if (!phase || entry.phase !== phase) return [entry];
            return phase === "leave"
              ? []
              : [{ ...entry, phase: "idle" as const }];
          });
          // Entries that share a deadline settle in one React commit.
          settle();
        },
        Math.max(0, first - Date.now()),
      ),
    };
  });
  useEffect(() => {
    const pending = timers.current;
    return () => {
      if (timeout.current) clearTimeout(timeout.current.id);
      timeout.current = null;
      pending.clear();
    };
  }, []);
  return entries;
}

/**
 * Props for an element that opens and closes with its phase (`.ws-presence`
 * in styles.css). A leaving element is inert and hidden from assistive
 * technology, so it can't be clicked or read while it closes.
 */
export function presenceProps(phase: PresencePhase) {
  return {
    "data-presence": phase === "idle" ? undefined : phase,
    "aria-hidden": phase === "leave" ? true : undefined,
    inert: phase === "leave" ? true : undefined,
  } as const;
}

/**
 * A fold's contents, and the phase they are in: `render` stays true through
 * `leave` so the contents can close their height before they unmount, and
 * `open` is the state the phase is moving toward, which is where it settles.
 */
export type FoldState = {
  readonly render: boolean;
  readonly phase: PresencePhase;
  readonly open: boolean;
};

/**
 * The fold's next state when `open` changes: opening contents enter, closing
 * ones leave, and both stay rendered until they have finished moving.
 * Without motion, or before the first render, the fold is simply `open`.
 */
export function foldState(
  state: FoldState,
  open: boolean,
  animate: boolean,
): FoldState {
  if (!animate) return { render: open, phase: "idle", open };
  if (open === state.open) return state;
  return { render: true, phase: open ? "enter" : "leave", open };
}

/** Where a finished phase settles: an open fold idles, a closed one unmounts. */
export function settleFold(state: FoldState): FoldState {
  return { render: state.open, phase: "idle", open: state.open };
}

/**
 * A fold's state (see {@link foldState}) and the ref its contents take. The
 * contents are one element whose height the fold animates in pixels, so the
 * space it gives up and the part of its contents still showing are the same
 * edge; a grid track, by contrast, shrinks ahead of the box inside it and
 * leaves a group's tail empty while it closes.
 *
 * Like `usePresence`, the first render enters nothing, so a group that starts
 * folded stays unmounted, and each phase ends on a timer rather than an
 * animation event, so a missed event never strands the contents.
 */
export function useFold(
  open: boolean,
  animate = true,
): FoldState & { readonly ref: (element: HTMLElement | null) => void } {
  const committed = useRef<FoldState | null>(null);
  const timer = useRef<{
    phase: PresencePhase;
    id: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [, settle] = useReducer((n: number) => n + 1, 0);
  const state = foldState(
    committed.current ?? { render: open, phase: "idle", open },
    open,
    animate && committed.current !== null && canAnimate(),
  );
  useLayoutEffect(() => {
    committed.current = state;
  });
  useEffect(() => {
    if (state.phase === "idle") {
      if (timer.current) clearTimeout(timer.current.id);
      timer.current = null;
      return;
    }
    if (timer.current?.phase === state.phase) return;
    if (timer.current) clearTimeout(timer.current.id);
    const phase = state.phase;
    timer.current = {
      phase,
      id: setTimeout(
        () => {
          timer.current = null;
          committed.current = settleFold(committed.current ?? state);
          settle();
        },
        phase === "enter" ? ENTER_MS : LEAVE_MS,
      ),
    };
  });
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current.id);
    };
  }, []);
  /** The contents, and the phase they were last drawn in. */
  const element = useRef<HTMLElement | null>(null);
  const drawn = useRef<PresencePhase>("idle");
  useLayoutEffect(() => {
    const el = element.current;
    const phase = state.phase;
    if (el === null || phase === drawn.current) return;
    const was = drawn.current;
    drawn.current = phase;
    if (phase === "idle") {
      el.style.height = "";
      el.style.overflow = "";
      el.style.opacity = "";
      return;
    }
    // The contents are still at their natural height here, so that is what
    // the fold opens to and closes from.
    const natural = el.scrollHeight;
    const open = phase === "enter";
    // Opening starts from nothing unless the fold is still closing, in which
    // case its contents are partway out and it picks them up there.
    const from = open
      ? was === "leave"
        ? el.getBoundingClientRect().height
        : 0
      : natural;
    const to = open ? natural : 0;
    el.style.overflow = "hidden";
    el.style.height = `${to}px`;
    el.style.opacity = open ? "" : "0";
    if (!canAnimate() || from === to) return;
    el.animate(
      [
        { height: `${from}px`, opacity: open ? 0 : 1 },
        { height: `${to}px`, opacity: open ? 1 : 0 },
      ],
      {
        duration: open ? ENTER_MS : LEAVE_MS,
        easing: EASE_OUT,
      },
    );
  });
  const ref = useCallback((next: HTMLElement | null) => {
    element.current = next;
    // The contents unmount once they finish closing; a fold opened later
    // starts from nothing rather than from where the last one ended.
    if (next === null) drawn.current = "idle";
  }, []);
  return { ...state, ref };
}

/**
 * Glides the gap below a fold while the fold moves. The gap is the next
 * sibling's `margin-top`, which changes the instant the fold's state does, so
 * without this the list below jumps by that gap before the fold has moved.
 * The gap is remembered while the fold holds still, then animated from it to
 * the new one over the fold's own duration and curve; a reversal mid-motion
 * picks the gap up from wherever it is.
 */
export function useFoldGap(
  section: RefObject<HTMLElement | null>,
  phase: PresencePhase,
): void {
  const settled = useRef<string | null>(null);
  const previous = useRef<PresencePhase>("idle");
  useLayoutEffect(() => {
    const next = section.current?.nextElementSibling;
    const was = previous.current;
    previous.current = phase;
    if (!(next instanceof HTMLElement) || !next.style.marginTop) {
      settled.current = null;
      return;
    }
    const to = next.style.marginTop;
    if (phase !== was && canAnimate()) {
      const running =
        typeof next.getAnimations === "function" &&
        next
          .getAnimations()
          .some((animation) => animation.playState === "running");
      const from = running ? getComputedStyle(next).marginTop : settled.current;
      if (from !== null && from !== to)
        next.animate([{ marginTop: from }, { marginTop: to }], {
          duration: ENTER_MS,
          easing: EASE_OUT,
        });
    }
    if (phase === "idle") settled.current = to;
  });
}

/**
 * Glides the list's top-level `[data-flip-key]` children from where they
 * were at `capture()` to where they are once `token` changes. Positions are
 * captured across the whole list, so an item that comes out of a fold starts
 * from its place inside it.
 *
 * `moved` names the item the change is about. It would slide across its
 * neighbors, so instead it fades in at its new place once they have mostly
 * made room.
 */
export function useFlip(
  container: RefObject<HTMLElement | null>,
  token: string,
): (moved?: string) => void {
  const before = useRef<Map<string, number> | null>(null);
  const movedKey = useRef<string | undefined>(undefined);
  const capture = useCallback(
    (moved?: string) => {
      const root = container.current;
      if (!root || !canAnimate()) return;
      movedKey.current = moved;
      const top = root.getBoundingClientRect().top;
      before.current = new Map(
        [...root.querySelectorAll<HTMLElement>("[data-flip-key]")].map((el) => [
          el.dataset.flipKey!,
          el.getBoundingClientRect().top - top,
        ]),
      );
    },
    [container],
  );
  useLayoutEffect(() => {
    const rects = before.current;
    const root = container.current;
    before.current = null;
    if (!rects || !root) return;
    const top = root.getBoundingClientRect().top;
    for (const el of root.querySelectorAll<HTMLElement>(
      ":scope > [data-flip-key]",
    )) {
      const key = el.dataset.flipKey!;
      const from = rects.get(key);
      if (from === undefined) continue;
      const dy = from - (el.getBoundingClientRect().top - top);
      if (Math.abs(dy) < 1) continue;
      if (key === movedKey.current) {
        el.animate(
          [
            { opacity: 0, transform: `translateY(${Math.sign(dy) * 6}px)` },
            {
              opacity: 0,
              transform: `translateY(${Math.sign(dy) * 6}px)`,
              offset: 0.35,
            },
            { opacity: 1, transform: "none" },
          ],
          { duration: FLIP_MS + 80, easing: EASE_OUT },
        );
        continue;
      }
      el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
        { duration: FLIP_MS, easing: EASE_OUT },
      );
    }
    // Runs only when the arrangement token changes; other renders keep any
    // capture for the change it was taken for.
  }, [container, token]);
  return capture;
}
