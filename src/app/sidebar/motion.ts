/**
 * Motion for the sidebar and phone Home. Up Next re-ranks glide rows between
 * positions with transforms. Elsewhere in the sidebar, rows, bands, and group
 * folds open and close their height so everything below slides, and
 * workstreams glide to their new place when a priority change reorders them.
 *
 * Motion is skipped where Web Animations are unavailable (tests, old
 * engines) and under reduced motion; there every change applies at once.
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
const ROW_FLIP_MIN_MS = 240;
const ROW_FLIP_MS_PER_PX = 8;
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const ROW_EASE = "cubic-bezier(0.42, 0, 0.58, 1)";

/** Whether this motion runs here and now. */
function canAnimate(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof Element === "undefined" || !("animate" in Element.prototype))
    return false;
  return !(
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type RowLayout = {
  readonly element: HTMLElement;
  /** Final layout top relative to the list, without this hook's transform. */
  readonly top: number;
};

type RowSnapshot = {
  readonly token: string;
  readonly rows: ReadonlyMap<string, RowLayout>;
};

type RunningRow = {
  readonly element: HTMLElement;
  readonly animations: Set<Animation>;
  readonly opacityElement: HTMLElement | null;
  readonly backgroundColor: string;
  readonly boxShadow: string;
  readonly position: string;
  readonly zIndex: string;
};

/** The Y translation in a computed CSS matrix, or zero for an untransformed row. */
function rowTranslateY(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  const values = transform
    .slice(transform.indexOf("(") + 1, -1)
    .split(",")
    .map(Number);
  const y = transform.startsWith("matrix3d(") ? values[13] : values[5];
  return y === undefined || !Number.isFinite(y) ? 0 : y;
}

function flipRows(root: HTMLElement): ReadonlyMap<string, HTMLElement> {
  return new Map(
    [...root.querySelectorAll<HTMLElement>("[data-flip-row]")].map(
      (element) => [element.dataset.flipRow!, element],
    ),
  );
}

/** Row contents fade over the row's opaque surface when they enter. */
function rowOpacityElements(element: HTMLElement): HTMLElement[] {
  const children = [...element.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  return children.length > 0 ? children : [element];
}

/** The nearest surface that can hide the text beneath a crossing row. */
function rowMotionBackground(element: HTMLElement): string {
  for (
    let current = element.parentElement;
    current;
    current = current.parentElement
  ) {
    const background = getComputedStyle(current).backgroundColor;
    if (
      background &&
      background !== "transparent" &&
      !/[,/] 0(?:\.0+)?\)$/.test(background)
    )
      return background;
  }
  return "var(--sidebar, var(--background))";
}

/**
 * Slides keyed rows from their previous visual positions when `token`
 * changes. The token names the ordering that caused the layout change; other
 * renders only refresh the measurements. A row with no previous layout fades
 * in at its destination rather than traveling from outside the viewport.
 *
 * Running animations are read before they are canceled, so a reversal starts
 * at the row's current translation and opacity. The new layout is measured
 * only after cancellation, which keeps an old inverse transform out of the
 * next target. Reduced motion applies the new layout without either effect.
 */
export function useRowFlip(
  container: RefObject<HTMLElement | null>,
  token: string,
): () => void {
  const committed = useRef<RowSnapshot | null>(null);
  const running = useRef(new Map<string, RunningRow>());
  const cancelRunning = useCallback(() => {
    for (const active of running.current.values()) {
      for (const animation of active.animations) animation.cancel();
      active.element.style.backgroundColor = active.backgroundColor;
      active.element.style.boxShadow = active.boxShadow;
      active.element.style.position = active.position;
      active.element.style.zIndex = active.zIndex;
    }
    running.current.clear();
  }, []);

  /** Capture final layout positions while leaving any visual motion running. */
  const capture = useCallback(() => {
    const root = container.current;
    if (!root) return;
    if (!canAnimate()) {
      committed.current = { token, rows: new Map() };
      return;
    }
    const rootTop = root.getBoundingClientRect().top;
    const rows = new Map<string, RowLayout>();
    for (const [key, element] of flipRows(root)) {
      const active = running.current.get(key);
      const translateY =
        active?.element === element ? rowTranslateY(element) : 0;
      rows.set(key, {
        element,
        top: element.getBoundingClientRect().top - rootTop - translateY,
      });
    }
    committed.current = { token, rows };
  }, [container, token]);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    if (!canAnimate()) {
      cancelRunning();
      committed.current = { token, rows: new Map() };
      return;
    }
    const before = committed.current;
    const changed = before !== null && before.token !== token;
    if (!changed) {
      if (!canAnimate()) cancelRunning();
      capture();
      return;
    }

    const starts = new Map<string, { y: number; opacity: number }>();
    for (const [key, active] of running.current) {
      starts.set(key, {
        y: rowTranslateY(active.element),
        opacity: active.opacityElement
          ? Number(getComputedStyle(active.opacityElement).opacity)
          : 1,
      });
    }
    cancelRunning();

    const rootTop = root.getBoundingClientRect().top;
    const after = new Map<string, RowLayout>();
    for (const [key, element] of flipRows(root))
      after.set(key, {
        element,
        top: element.getBoundingClientRect().top - rootTop,
      });

    if (canAnimate()) {
      for (const [key, current] of after) {
        const previous = before.rows.get(key);
        const start = starts.get(key);
        const previousTop = previous ? previous.top + (start?.y ?? 0) : 0;
        const visible = (top: number) =>
          top >= 0 && top + current.element.offsetHeight <= root.clientHeight;
        const travel = Boolean(
          previous && visible(previousTop) && visible(current.top),
        );
        const dy = previous ? previousTop - current.top : 0;
        const opacity = travel ? (start?.opacity ?? 1) : 0;
        if (travel && Math.abs(dy) < 0.01 && opacity === 1) continue;
        const opacityElements =
          opacity < 1 ? rowOpacityElements(current.element) : [];
        const active: RunningRow = {
          element: current.element,
          animations: new Set(),
          opacityElement: opacityElements[0] ?? null,
          backgroundColor: current.element.style.backgroundColor,
          boxShadow: current.element.style.boxShadow,
          position: current.element.style.position,
          zIndex: current.element.style.zIndex,
        };
        running.current.set(key, active);
        // Opaque surfaces keep crossings and entering fades from blending two
        // titles. Paint styles do not affect layout or animation keyframes.
        const background = rowMotionBackground(current.element);
        current.element.style.backgroundColor = background;
        current.element.style.boxShadow = `0 0 0 3px ${background}`;
        current.element.style.position = "relative";
        current.element.style.zIndex = travel ? (dy > 0 ? "2" : "1") : "3";
        const track = (
          target: HTMLElement,
          frames: Keyframe[],
          options: KeyframeAnimationOptions,
        ) => {
          const animation = target.animate(frames, options);
          active.animations.add(animation);
          animation.onfinish = () => {
            if (running.current.get(key) !== active) return;
            active.animations.delete(animation);
            if (active.animations.size > 0) return;
            current.element.style.backgroundColor = active.backgroundColor;
            current.element.style.boxShadow = active.boxShadow;
            current.element.style.position = active.position;
            current.element.style.zIndex = active.zIndex;
            running.current.delete(key);
          };
        };
        if (travel && Math.abs(dy) >= 0.01)
          track(
            current.element,
            [
              { transform: `translateY(${dy}px)` },
              { transform: "translateY(0px)" },
            ],
            {
              duration: Math.max(
                ROW_FLIP_MIN_MS,
                Math.abs(dy) * ROW_FLIP_MS_PER_PX,
              ),
              easing: ROW_EASE,
              fill: "backwards",
            },
          );
        for (const target of opacityElements)
          track(target, [{ opacity }, { opacity: 1 }], {
            duration: ENTER_MS,
            easing: EASE_OUT,
            fill: "backwards",
          });
      }
    }
    committed.current = { token, rows: after };
  }, [container, token, capture, cancelRunning]);

  useEffect(() => {
    const root = container.current;
    if (!root || !canAnimate() || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => capture());
    observer.observe(root);
    for (const row of flipRows(root).values()) observer.observe(row);
    return () => observer.disconnect();
  }, [container, token, capture]);

  useEffect(
    () => () => {
      cancelRunning();
      committed.current = null;
    },
    [cancelRunning],
  );
  return capture;
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
