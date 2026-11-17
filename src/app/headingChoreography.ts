/**
 * The choreographed title transitions (Scroll, Morph, Stagger, Flip, Rack focus
 * and Cascade), kept pure so the poses they draw can be tested without a
 * browser.
 *
 * Fade (goalHeading.ts) hands the expanded heading to the minimized one as two
 * copies that move together. These transitions give each line its own timing:
 * every frame is a pose for the expanded lines (workstream, title, summary) and
 * the minimized ones (workstream, title), taken from one progress that
 * headingHandoff.ts derives from the scroll position.
 *
 * Coordinates are in one frame: x from the heading's left text edge, y from the
 * top of the message scroller, so the title bar lies above zero.
 */

import type { HandoffConfig } from "./headingHandoff.ts";

export type Curve = "product" | "linear" | "smooth" | "quick" | "slow";

export const CHOREOGRAPHED = [
  "current",
  "morph",
  "stagger",
  "flip",
  "rack",
  "cascade",
] as const;
export type Choreographed = (typeof CHOREOGRAPHED)[number];

export function isChoreographed(value: string): value is Choreographed {
  return (CHOREOGRAPHED as readonly string[]).includes(value);
}

/** The choreography a Title transition setting draws; Fade has none. */
export function choreographyOf(setting: string): Choreographed | null {
  if (setting === "scroll") return "current";
  return isChoreographed(setting) ? setting : null;
}

/** Scroll distance of the handoff, in px at the 14px body size. */
export const RUNWAY = 360;
export const RUNWAY_BASE = 14;
/** Scroll distance of the latch point, in px at the 14px body size. */
export const LATCH_AT = 48;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Progress of `t` through the window from `a` to `b`, held at 0 and 1 outside. */
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));

/**
 * How much of the timeline a fade still hides at a point u along it (0 at the
 * start, 1 at the end), and the shape of each easing that runs from 1 to 0.
 */
export const CURVES: Record<Curve, (u: number) => number> = {
  product: (u) => {
    const stops = [1, 0.9, 0.65, 0.4, 0.18, 0];
    const at = u * 5;
    const i = Math.min(4, Math.floor(at));
    return lerp(stops[i]!, stops[i + 1]!, at - i);
  },
  linear: (u) => 1 - u,
  smooth: (u) => 1 - smooth(u),
  quick: (u) => (1 - u) ** 2,
  slow: (u) => 1 - u * u,
};

// ---------------------------------------------------------------------------
// Tuning

/** The shadow each old line casts over the timeline while it is still drawn. */
export type ShadowTuning = {
  /** Length of the feather under a line at full strength, in px. */
  length: number;
  /** Where the solid part ends, relative to the line's bottom edge, in px. */
  solidEdge: number;
  /** Share of the feather kept fully opaque, 0 to 1. */
  hold: number;
  curve: Curve;
  /** The window of the handoff over which the shadow shortens. */
  collapse: {
    from: number;
    to: number;
    curve: Curve;
    /** Feather length once collapsed, in px. */
    length: number;
    /** Share of the solid part kept once collapsed, 0 to 1. */
    solidKept: number;
  };
  /** The window over which the shadows fade away. */
  fadeOut: { from: number; to: number; curve: Curve };
};

export type RackTuning = {
  /** The large title and workstream line blur out over this window. */
  leaving: readonly [number, number];
  /** The minimized title sharpens in over this one. */
  arriving: readonly [number, number];
  /** The summary leaves over this one. */
  summary: readonly [number, number];
  /** Blur at the far end of either fade, in px. */
  blur: number;
  /** Size the leaving title recedes to, and the arriving title grows from. */
  leaveScale: number;
  arriveScale: number;
  opacityCurve: Curve;
  blurCurve: Curve;
};

const SHARED_SHADOW: ShadowTuning = {
  length: 104,
  solidEdge: -24,
  hold: 0.13,
  curve: "smooth",
  collapse: { from: 0, to: 1, curve: "slow", length: 40, solidKept: 0.16 },
  fadeOut: { from: 0, to: 0.89, curve: "slow" },
};

/** Rack focus is tuned on its own: its text holds legible longer. */
const RACK_SHADOW: ShadowTuning = {
  ...SHARED_SHADOW,
  collapse: { ...SHARED_SHADOW.collapse, curve: "smooth" },
  fadeOut: { from: 0.4, to: 0.77, curve: "slow" },
};

export const RACK: RackTuning = {
  leaving: [0.36, 0.72],
  arriving: [0.14, 0.59],
  summary: [0.24, 0.62],
  blur: 8,
  leaveScale: 0.95,
  arriveScale: 0.91,
  opacityCurve: "quick",
  blurCurve: "linear",
};

export const shadowTuning = (transition: Choreographed): ShadowTuning =>
  transition === "rack" ? RACK_SHADOW : SHARED_SHADOW;

// ---------------------------------------------------------------------------
// Poses

/** One line's pose. Scale pivots on `origin`; rotateX turns it about its middle. */
export type Face = {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  blur: number;
  rotateX: number;
  /** Set while the line's box changes width (Morph's title). */
  width: number | null;
};

export type Line = "eyebrow" | "title" | "goal";

export type HeadingLayout = {
  /** Body font size in px. */
  base: number;
  /** Where each expanded line rests, as y from the scroller's top edge. */
  rest: { eyebrow: number; title: number; goal: number };
  /** Where each minimized line rests in the title bar, in the same frame. */
  bar: { eyebrow: number; title: number };
  /** The minimized lines' x from the heading's left edge, and the title's width. */
  slot: { titleX: number; eyebrowX: number; titleWidth: number };
  /** Heights of the lines the shadows follow, in px. */
  heights: { eyebrow: number; title: number; goal: number };
  /** Width of the expanded title's and summary's boxes. */
  paneWidth: number;
  /** Distance the expanded title travels to leave the scroller. */
  exit: number;
  /** The title wraps to more than one line, so Morph cannot reflow it. */
  wrapped: boolean;
  hasEyebrow: boolean;
  hasGoal: boolean;
  /** Scale of the minimized workstream line. */
  eyebrowScale: number;
  /** Letters in the title (spaces excluded), for Cascade. */
  letters: number;
};

export type Letter = { y: number; opacity: number };

/**
 * Where a line's shadow starts to end (the line's bottom edge, from the
 * scroller's top) and how visible the line still is. A line that has slid under
 * the title bar counts as invisible.
 */
export type Shadow = { bottom: number; visible: number };

export type Pose = {
  /** The handoff's own progress, 0 to 1. */
  progress: number;
  expanded: { eyebrow: Face | null; title: Face; goal: Face | null };
  compact: { eyebrow: Face | null; title: Face };
  /** Cascade moves each letter on its own. */
  letters: { expanded: Letter[]; compact: Letter[] } | null;
  shadows: Partial<Record<Line, Shadow>>;
};

/** How far into the title bar a line slides before it counts as gone, in px. */
const SLIDE_UNDER = 40;
/** Space Cascade's title box reaches above its text, so rising letters fade in open space. */
export const CASCADE_REACH = 24;

const face = (x: number, y: number, o: Partial<Face> = {}): Face => ({
  x,
  y,
  scale: 1,
  opacity: 1,
  blur: 0,
  rotateX: 0,
  width: null,
  ...o,
});

/** How a line looks at progress `w` of leaving: 0 sharp, 1 gone. */
function rackFace(rack: RackTuning, w: number) {
  return {
    opacity: CURVES[rack.opacityCurve](w),
    blur: rack.blur * (1 - CURVES[rack.blurCurve](w)),
  };
}

/**
 * The pose for transition `kind` at progress `t`. The shadow records say where
 * each expanded line's shadow ends.
 */
export function choreograph(
  kind: Choreographed,
  t: number,
  layout: HeadingLayout,
  rack: RackTuning = RACK,
  scrollDriven = false,
): Pose {
  const L = layout;
  const shadows: Pose["shadows"] = {};
  const see = (
    line: Line,
    y: number,
    height: number,
    scale: number,
    visible: number,
  ) => {
    const bottom = y + height * scale;
    shadows[line] = { bottom, visible: visible * clamp(bottom / SLIDE_UNDER) };
  };
  const expanded: Pose["expanded"] = {
    eyebrow: L.hasEyebrow ? face(0, L.rest.eyebrow) : null,
    title: face(0, L.rest.title),
    goal: L.hasGoal ? face(0, L.rest.goal) : null,
  };
  const compact: Pose["compact"] = {
    eyebrow: L.hasEyebrow
      ? face(L.slot.eyebrowX, L.bar.eyebrow, {
          scale: L.eyebrowScale,
          opacity: 0,
        })
      : null,
    title: face(L.slot.titleX, L.bar.title, { opacity: 0 }),
  };
  let letters: Pose["letters"] = null;

  /** Put an expanded line in `face` and record the shadow it casts. */
  const place = (
    line: Line,
    f: Face,
    visible = f.opacity * Math.cos((f.rotateX * Math.PI) / 180),
  ) => {
    const target = expanded[line];
    if (!target) return;
    Object.assign(target, f);
    see(line, f.y, L.heights[line], f.scale, visible);
  };
  const out = (line: Line, f: Partial<Face> & { x: number; y: number }) =>
    place(line, face(f.x, f.y, f));
  const arrive = (line: "eyebrow" | "title", f: Face) => {
    const target = compact[line];
    if (target) Object.assign(target, f);
  };

  switch (kind) {
    case "current": {
      // Both heading copies slide through the exit distance together. Driven
      // straight from the scroll, progress starts quickly and eases to a stop
      // at the shared endpoint.
      const p = scrollDriven ? t * (0.5 + t * (2 - 1.5 * t)) : t;
      const moved = L.exit * p;
      const remaining = L.exit - moved;
      const leaving = 1 - p * p;
      const arriving = 1 - (1 - p) * (1 - p);
      out("goal", { x: 0, y: L.rest.goal - moved, opacity: leaving });
      out("title", { x: 0, y: L.rest.title - moved, opacity: leaving });
      out("eyebrow", { x: 0, y: L.rest.eyebrow - moved, opacity: leaving });
      arrive(
        "title",
        face(L.slot.titleX, L.bar.title + remaining, { opacity: arriving }),
      );
      arrive(
        "eyebrow",
        face(L.slot.eyebrowX, L.bar.eyebrow + remaining, {
          opacity: arriving,
          scale: L.eyebrowScale,
        }),
      );
      return { progress: p, expanded, compact, letters, shadows };
    }
    case "morph": {
      const p = smooth(t);
      // Sideways travel leads, so the path arcs.
      const px = 1 - (1 - p) ** 2.2;
      const sc = lerp(1, 0.95 / 1.5, p);
      if (L.wrapped) {
        // A wrapped title can't reflow into the bar mid-flight: it travels at its
        // wrapped width, then hands off to the one-line bar title near the end.
        const h = span(t, 0.7, 1);
        out("title", {
          x: lerp(0, L.slot.titleX, px),
          y: lerp(L.rest.title, L.bar.title, p),
          scale: sc,
          opacity: 1 - h,
        });
        arrive("title", face(L.slot.titleX, L.bar.title, { opacity: h }));
      } else {
        out("title", {
          x: lerp(0, L.slot.titleX, px),
          y: lerp(L.rest.title, L.bar.title, p),
          scale: sc,
          width: lerp(L.paneWidth, L.slot.titleWidth, p) / sc,
        });
      }
      out("eyebrow", {
        x: lerp(0, L.slot.eyebrowX, px),
        y: lerp(L.rest.eyebrow, L.bar.eyebrow, p),
        scale: lerp(1, L.eyebrowScale, p),
      });
      const gw = span(t, 0, 0.35);
      out("goal", { x: 0, y: L.rest.goal - 10 * smooth(gw), opacity: 1 - gw });
      return { progress: p, expanded, compact, letters, shadows };
    }
    case "stagger": {
      const gw = span(t, 0, 0.35);
      out("goal", { x: 0, y: L.rest.goal - 12 * smooth(gw), opacity: 1 - gw });
      // The workstream line sits above the title, so it leads in both directions
      // and the two never cross.
      const lines = [
        ["title", L.rest.title, L.bar.title, 0, L.slot.titleX],
        ["eyebrow", L.rest.eyebrow, L.bar.eyebrow, -0.08, L.slot.eyebrowX],
      ] as const;
      for (const [line, ey, cy, d, cx] of lines) {
        const a = span(t, 0.1 + d, 0.6 + d);
        const b = span(t, 0.35 + d, 0.9 + d);
        out(line, { x: 0, y: ey - L.exit * smooth(a), opacity: 1 - a * a });
        arrive(
          line,
          face(cx, cy + L.exit * (1 - smooth(b)), {
            opacity: 1 - (1 - b) * (1 - b),
            scale: line === "eyebrow" ? L.eyebrowScale : 1,
          }),
        );
      }
      return { progress: t, expanded, compact, letters, shadows };
    }
    case "flip": {
      const flipOut = (line: Line, w: number) =>
        out(line, {
          x: 0,
          y: L.rest[line],
          rotateX: -90 * smooth(w),
          opacity: w >= 0.999 ? 0 : 1,
        });
      flipOut("goal", span(t, 0, 0.3));
      flipOut("title", span(t, 0.1, 0.5));
      flipOut("eyebrow", span(t, 0.2, 0.55));
      const flipIn = (line: "eyebrow" | "title", w: number) =>
        arrive(
          line,
          face(
            line === "title" ? L.slot.titleX : L.slot.eyebrowX,
            L.bar[line],
            {
              rotateX: 90 * (1 - smooth(w)),
              opacity: w <= 0.001 ? 0 : 1,
              scale: line === "eyebrow" ? L.eyebrowScale : 1,
            },
          ),
        );
      flipIn("title", span(t, 0.5, 1));
      flipIn("eyebrow", span(t, 0.55, 1));
      return { progress: t, expanded, compact, letters, shadows };
    }
    case "rack": {
      const win = (w: readonly [number, number]) => span(t, w[0], w[1]);
      const leave = (line: Line, w: number) => {
        const f = rackFace(rack, w);
        out(line, {
          x: 0,
          y: L.rest[line],
          opacity: f.opacity,
          blur: f.blur,
          scale: lerp(1, rack.leaveScale, smooth(w)),
        });
      };
      const arriveRack = (line: "eyebrow" | "title", w: number) => {
        const f = rackFace(rack, 1 - w);
        // Rack focus scales about each line's vertical middle, so the minimized
        // workstream line, which rests at a reduced scale, would sit half the
        // height it gives up lower than the same line does with a top-left
        // pivot. Lift it by that amount so it settles where every other
        // transition leaves it.
        const lift =
          line === "eyebrow"
            ? (L.heights.eyebrow * (1 - L.eyebrowScale)) / 2
            : 0;
        arrive(
          line,
          face(
            line === "title" ? L.slot.titleX : L.slot.eyebrowX,
            L.bar[line] - lift,
            {
              opacity: f.opacity,
              blur: f.blur,
              scale:
                lerp(rack.arriveScale, 1, smooth(w)) *
                (line === "eyebrow" ? L.eyebrowScale : 1),
            },
          ),
        );
      };
      leave("goal", win(rack.summary));
      leave("title", win(rack.leaving));
      leave("eyebrow", win(rack.leaving));
      arriveRack("title", win(rack.arriving));
      const [from, to] = rack.arriving;
      arriveRack("eyebrow", span(t, from - 0.05, to - 0.05));
      return { progress: t, expanded, compact, letters, shadows };
    }
    case "cascade": {
      const gw = span(t, 0, 0.3);
      out("goal", { x: 0, y: L.rest.goal - 12 * smooth(gw), opacity: 1 - gw });
      const ew = span(t, 0, 0.25);
      out("eyebrow", {
        x: 0,
        y: L.rest.eyebrow - 30 * smooth(ew),
        opacity: 1 - ew,
      });
      const cw = span(t, 0.55, 0.9);
      arrive(
        "eyebrow",
        face(L.slot.eyebrowX, L.bar.eyebrow + 6 * (1 - smooth(cw)), {
          opacity: cw,
          scale: L.eyebrowScale,
        }),
      );
      // The title's letters carry its opacity.
      expanded.title = face(0, L.rest.title);
      compact.title = face(L.slot.titleX, L.bar.title);
      const n = L.letters;
      const last = Math.max(1, n - 1);
      const barLine = (L.base * 0.95 * 4) / 3;
      const leaving: Letter[] = [];
      const arriving: Letter[] = [];
      let titleVisible = 0; // the brightest letter still on screen
      for (let i = 0; i < n; i++) {
        const a = span(t, (i / last) * 0.4, (i / last) * 0.4 + 0.35);
        leaving.push({ y: -22 * smooth(a), opacity: 1 - a });
        titleVisible = Math.max(titleVisible, 1 - a);
        const b = span(
          t,
          0.25 + (i / last) * 0.4,
          0.25 + (i / last) * 0.4 + 0.35,
        );
        arriving.push({
          y: barLine * (1 - smooth(b)),
          opacity: clamp(b * 1.6),
        });
      }
      letters = { expanded: leaving, compact: arriving };
      see("title", L.rest.title, L.heights.title, 1, titleVisible);
      return { progress: t, expanded, compact, letters, shadows };
    }
  }
}

// ---------------------------------------------------------------------------
// Shadows

export type ShadowPaint = {
  /** Height of the solid part, in px. */
  solid: number;
  /** Length of the feather below it, in px. */
  feather: number;
  /** Opacity of the whole shadow. */
  opacity: number;
};

/** How far through its window a progress is, for a curve from 1 to 0. */
const windowed = (curve: Curve, t: number, from: number, to: number) =>
  CURVES[curve](span(t, from, Math.max(from + 0.01, to)));

/** The shared strength of every line's shadow at handoff progress `t`. */
export function shadowStrength(tuning: ShadowTuning, t: number): number {
  return windowed(
    tuning.fadeOut.curve,
    t,
    tuning.fadeOut.from,
    tuning.fadeOut.to,
  );
}

/** The shadow a line casts, or null once the shadows have faded away. */
export function shadowPaint(
  tuning: ShadowTuning,
  t: number,
  shadow: Shadow,
): ShadowPaint | null {
  const strength = shadowStrength(tuning, t);
  if (strength < 0.002) return null;
  const kept = windowed(
    tuning.collapse.curve,
    t,
    tuning.collapse.from,
    tuning.collapse.to,
  );
  return {
    solid:
      Math.max(0, shadow.bottom + tuning.solidEdge) *
      lerp(tuning.collapse.solidKept, 1, kept),
    feather: Math.max(1, lerp(tuning.collapse.length, tuning.length, kept)),
    opacity: strength,
  };
}

/** Cover at fraction u of the feather: opaque through the held part, then the curve. */
export function featherCover(tuning: ShadowTuning, u: number): number {
  return u <= tuning.hold
    ? 1
    : CURVES[tuning.curve](clamp((u - tuning.hold) / (1 - tuning.hold)));
}

/** A shadow's gradient: the solid part, then the feather dissolving into the timeline. */
export function shadowBackground(
  tuning: ShadowTuning,
  paint: ShadowPaint,
): string {
  const stops = Array.from({ length: 13 }, (_, i) => {
    const u = i / 12;
    const cover = (featherCover(tuning, u) * 100).toFixed(1);
    return `color-mix(in oklab, var(--background) ${cover}%, transparent) ${(paint.solid + u * paint.feather).toFixed(2)}px`;
  });
  return `linear-gradient(to bottom in oklab, var(--background) 0px, ${stops.join(", ")})`;
}

/** Scroll distance of the handoff at body size `base`, in px. */
export const runway = (base: number) => (RUNWAY * base) / RUNWAY_BASE;

/**
 * The reduced-motion pose: every line stays put and the expanded lines cross
 * to the minimized ones in place, each shadow following its line's opacity.
 */
export function crossfade(t: number, layout: HeadingLayout): Pose {
  const L = layout;
  const e = smooth(t);
  const shadows: Pose["shadows"] = {};
  const see = (line: Line, y: number) => {
    const bottom = y + L.heights[line];
    shadows[line] = { bottom, visible: (1 - e) * clamp(bottom / SLIDE_UNDER) };
  };
  see("goal", L.rest.goal);
  see("title", L.rest.title);
  see("eyebrow", L.rest.eyebrow);
  return {
    progress: e,
    expanded: {
      eyebrow: L.hasEyebrow
        ? face(0, L.rest.eyebrow, { opacity: 1 - e })
        : null,
      title: face(0, L.rest.title, { opacity: 1 - e }),
      goal: L.hasGoal ? face(0, L.rest.goal, { opacity: 1 - e }) : null,
    },
    compact: {
      eyebrow: L.hasEyebrow
        ? face(L.slot.eyebrowX, L.bar.eyebrow, {
            opacity: e,
            scale: L.eyebrowScale,
          })
        : null,
      title: face(L.slot.titleX, L.bar.title, { opacity: e }),
    },
    letters: null,
    shadows,
  };
}

/** Room kept above the first message once the heading has gone into the bar, in em. */
export const COLLAPSED_GAP = 1.5;

/**
 * The room above the first message follows the old heading's visibility: its
 * own height while it shows, so the space below its last line is the same for
 * a one-, two- or three-line summary or a title alone, and a fixed gap once it
 * has gone into the bar.
 */
export function reserveGap(base: number, height: number, pose: Pose): number {
  const visible = Math.max(
    0,
    ...Object.values(pose.shadows).map((shadow) => shadow.visible),
  );
  return lerp(base * COLLAPSED_GAP, height, smooth(clamp(visible)));
}

/**
 * How a transition turns the scroll into progress, at body size `base`.
 * Rack focus follows the scroll over its runway. The others are hybrids: the
 * scroll carries them to a latch point and a spring finishes the handoff. The
 * current Scroll transition slides its copies over 2.5 times the title's exit
 * distance.
 */
export function handoffFor(
  kind: Choreographed,
  base: number,
  exit: number,
): HandoffConfig {
  const scale = base / RUNWAY_BASE;
  if (kind === "rack") {
    return {
      drive: "scroll",
      follow: "direct",
      runway: RUNWAY * scale,
      latchAt: 64 * scale,
      settle: 860,
    };
  }
  return {
    drive: "hybrid",
    follow: "direct",
    runway: kind === "current" ? 2.5 * exit : RUNWAY * scale,
    latchAt: LATCH_AT * scale,
    settle: 700,
  };
}
