/**
 * Every control on the lab page, as data with no DOM. The page draws its inspector from these lists, `help.ts` must
 * hold one entry for each id in `CONTROLS` and no other (`verify.ts` and `npm run smoke` check it), and
 * `drumCfg` and `cascadeCfg` turn the page's state into a configuration for each model.
 */
// The drum is the product's own (`drum.ts`); the headless sims import both models too.
import { Drum, PRESETS } from "../../../src/app/page/queue/drum.ts";
import { INNER_KNOTS } from "./ring.ts";
import {
  Cascade,
  PRESETS as CASCADE_PRESETS,
  type CascadeConfig,
  type CascadePatch,
} from "./cascade.ts";

export const TAU = 2 * Math.PI;

export type Mode = "product" | "drum" | "cascade";
export const MODES: readonly { id: Mode; label: string }[] = [
  { id: "product", label: "Product now" },
  { id: "drum", label: "Elastic drum" },
  { id: "cascade", label: "Cascade" },
];
export const SPEEDS: readonly { id: string; label: string }[] = [
  { id: "0.25", label: "¼×" },
  { id: "0.5", label: "½×" },
  { id: "1", label: "1×" },
];
export const PRESET_NAMES: string[] = Object.keys(PRESETS);
export const CASCADE_PRESET_NAMES: string[] = Object.keys(CASCADE_PRESETS);
/** The presets a mode offers; the product has none. */
export const presetsOf = (mode: string): readonly string[] =>
  mode === "drum"
    ? PRESET_NAMES
    : mode === "cascade"
      ? CASCADE_PRESET_NAMES
      : [];

/** The drum configuration fields the page reads and writes. */
export type Cfg = {
  omega0: number;
  omega1: number;
  vcap: number;
  vcap1: number;
  holdDelay: number;
  coverFade: number;
  incomingFade: number;
  washTauIn: number;
  washTauOut: number;
  hidePx: number;
  tuckRate: number;
  fold: boolean;
  loose: boolean;
  ramp: boolean;
  H0: number;
  tempo: {
    kind: string;
    window: number;
    scale: number;
    ms: number;
    a: number;
    b: number;
  };
};
type Patch = Partial<Omit<Cfg, "tempo">> & { tempo?: Partial<Cfg["tempo"]> };

/** The cascade configuration the page holds: the model's, and the edge fade, which only the page draws. */
export type CascadeCfg = CascadeConfig & { fade: number };
type CascadePagePatch = CascadePatch & { fade?: number };

/**
 * The inspector's modules, top to bottom. A setting names the module it sits in as its `group`; `model`,
 * `playback` and `about` also hold the page's buttons, the held readout and the panel. A module with nothing to
 * show under the current model and configuration is hidden whole.
 */
export const MODULES = [
  { id: "model", label: "Model" },
  { id: "playback", label: "Playback" },
  { id: "taps", label: "Taps" },
  { id: "pace", label: "Pace" },
  { id: "held", label: "Held keys" },
  { id: "stage", label: "Stage" },
  { id: "path", label: "Path" },
  { id: "overlay", label: "Overlay" },
  { id: "about", label: "About" },
] as const;
export type ModuleId = (typeof MODULES)[number]["id"];
export type GroupId = Exclude<ModuleId, "model" | "about">;

type Base<C> = {
  /** The setting's short name: its key in the URL hash and in `sim/sweep.mjs`. */
  key: string;
  group: GroupId;
  label: string;
  /** Whether the setting changes anything under this configuration; a setting that does not is hidden. */
  shown: (c: C) => boolean;
};
/** One setting of a model whose configuration is `C`; `write` returns the patch that sets it, of type `P`. */
export type Setting<C = Cfg, P = Patch> =
  | (Base<C> & {
      kind: "range";
      unit: string;
      min: number;
      /** A number, or a function of the configuration for a limit that depends on another setting. */
      max: number | ((c: C) => number);
      step: number;
      read: (c: C) => number;
      write: (v: number) => P;
    })
  | (Base<C> & {
      kind: "toggle";
      read: (c: C) => boolean;
      write: (on: boolean) => P;
    })
  | (Base<C> & {
      kind: "select";
      options: readonly string[];
      read: (c: C) => string;
      write: (v: string) => P;
    });
/** A range setting's largest value under configuration `c`. */
export const maxOf = <C>(
  s: Extract<Setting<C, unknown>, { kind: "range" }>,
  c: C,
) => (typeof s.max === "number" ? s.max : s.max(c));

const always = () => true;
const heldState = (c: Cfg) => c.fold || c.ramp || c.loose;

export const SETTINGS: readonly Setting<Cfg, Patch>[] = [
  {
    kind: "range",
    key: "w0",
    group: "taps",
    label: "spring Hz, tap",
    unit: "Hz",
    min: 1.5,
    max: 6,
    step: 0.1,
    read: (c) => c.omega0 / TAU,
    write: (v) => ({ omega0: TAU * v }),
    shown: always,
  },
  {
    kind: "range",
    key: "cap",
    group: "taps",
    label: "edge budget, tap px/frame",
    unit: "px/frame",
    min: 12,
    max: 44,
    step: 1,
    read: (c) => c.vcap / 60,
    write: (v) => ({ vcap: 60 * v }),
    shown: always,
  },
  {
    kind: "range",
    key: "fadein",
    group: "taps",
    label: "incoming fade-in per s",
    unit: "/s",
    min: 0,
    max: 12,
    step: 0.5,
    read: (c) => c.incomingFade,
    write: (incomingFade) => ({ incomingFade }),
    shown: always,
  },
  {
    kind: "range",
    key: "cover",
    group: "taps",
    label: "covered card fade",
    unit: "×",
    min: 0,
    max: 1,
    step: 0.05,
    read: (c) => c.coverFade,
    write: (coverFade) => ({ coverFade }),
    shown: always,
  },
  {
    kind: "range",
    key: "tuck",
    group: "taps",
    label: "tuck spring ×",
    unit: "×",
    min: 1,
    max: 2.5,
    step: 0.05,
    read: (c) => c.tuckRate,
    write: (tuckRate) => ({ tuckRate }),
    shown: always,
  },
  {
    kind: "range",
    key: "hide",
    group: "taps",
    label: "tuck depth px",
    unit: "px",
    min: 0,
    max: 12,
    step: 1,
    read: (c) => c.hidePx,
    write: (hidePx) => ({ hidePx }),
    shown: always,
  },
  {
    kind: "range",
    key: "wrise",
    group: "taps",
    label: "tall-card wash rise ms",
    unit: "ms",
    min: 10,
    max: 400,
    step: 10,
    read: (c) => c.washTauOut,
    write: (washTauOut) => ({ washTauOut }),
    shown: always,
  },
  {
    kind: "range",
    key: "wclear",
    group: "taps",
    label: "tall-card wash clear ms",
    unit: "ms",
    min: 10,
    max: 400,
    step: 10,
    read: (c) => c.washTauIn,
    write: (washTauIn) => ({ washTauIn }),
    shown: always,
  },
  {
    kind: "select",
    key: "tk",
    group: "pace",
    label: "tempo",
    options: ["none", "constant", "lookahead"],
    read: (c) => c.tempo.kind,
    write: (kind) => ({ tempo: { kind } }),
    shown: always,
  },
  {
    kind: "range",
    key: "tw",
    group: "pace",
    label: "tempo window",
    unit: "cards",
    min: 1,
    max: 3,
    step: 1,
    read: (c) => c.tempo.window,
    write: (window) => ({ tempo: { window } }),
    shown: (c) => c.tempo.kind === "lookahead",
  },
  {
    kind: "range",
    key: "ts",
    group: "pace",
    label: "tempo scale",
    unit: "×",
    min: 0.5,
    max: 1.4,
    step: 0.05,
    read: (c) => c.tempo.scale,
    write: (scale) => ({ tempo: { scale } }),
    shown: (c) => c.tempo.kind === "lookahead",
  },
  {
    kind: "range",
    key: "ta",
    group: "pace",
    label: "estimate base ms",
    unit: "ms",
    min: 0,
    max: 200,
    step: 5,
    read: (c) => c.tempo.a,
    write: (a) => ({ tempo: { a } }),
    shown: (c) => c.tempo.kind === "lookahead",
  },
  {
    kind: "range",
    key: "tb",
    group: "pace",
    label: "estimate ms per px",
    unit: "ms/px",
    min: 0,
    max: 1.5,
    step: 0.02,
    read: (c) => c.tempo.b,
    write: (b) => ({ tempo: { b } }),
    shown: (c) => c.tempo.kind === "lookahead",
  },
  {
    kind: "range",
    key: "tms",
    group: "pace",
    label: "constant interval ms",
    unit: "ms",
    min: 60,
    max: 400,
    step: 5,
    read: (c) => c.tempo.ms,
    write: (ms) => ({ tempo: { ms } }),
    shown: (c) => c.tempo.kind === "constant",
  },
  {
    kind: "toggle",
    key: "ramp",
    group: "held",
    label: "held speed-up",
    read: (c) => c.ramp,
    write: (ramp) => ({ ramp }),
    // Fold and loose clearing already include the speed-up, so with either on this toggle changes nothing.
    shown: (c) => !c.fold && !c.loose,
  },
  {
    kind: "toggle",
    key: "fold",
    group: "held",
    label: "fold while held",
    read: (c) => c.fold,
    write: (fold) => ({ fold }),
    shown: always,
  },
  {
    kind: "toggle",
    key: "loose",
    group: "held",
    label: "loosen clearing while held",
    read: (c) => c.loose,
    write: (loose) => ({ loose }),
    // Fold already shrinks the heights that clearing uses, so with fold on this toggle changes nothing.
    shown: (c) => !c.fold,
  },
  {
    kind: "range",
    key: "delay",
    group: "held",
    label: "hold delay ms",
    unit: "ms",
    min: 0,
    max: 800,
    step: 10,
    read: (c) => c.holdDelay,
    write: (holdDelay) => ({ holdDelay }),
    shown: heldState,
  },
  {
    kind: "range",
    key: "w1",
    group: "held",
    label: "spring Hz, held",
    unit: "Hz",
    min: 2,
    max: 8,
    step: 0.1,
    read: (c) => c.omega1 / TAU,
    write: (v) => ({ omega1: TAU * v }),
    shown: heldState,
  },
  {
    kind: "range",
    key: "cap1",
    group: "held",
    label: "edge budget, held px/frame",
    unit: "px/frame",
    min: 12,
    max: 44,
    step: 1,
    read: (c) => c.vcap1 / 60,
    write: (v) => ({ vcap1: 60 * v }),
    shown: heldState,
  },
  {
    kind: "range",
    key: "h0",
    group: "held",
    label: "held height px",
    unit: "px",
    min: 40,
    max: 200,
    step: 1,
    read: (c) => c.H0,
    write: (H0) => ({ H0 }),
    shown: (c) => c.fold || c.loose,
  },
];

// ---- the cascade's settings ------------------------------------------------------------------------

/** The tallest sample card, px (`HEIGHTS` in sim/lib.mjs). */
export const TALLEST_CARD = 330;
/** Room kept between the tallest pile card and the fade, px: a card's shadow reaches about this far below it. */
export const PILE_CLEARANCE = 16;
/**
 * The most px of the stage's bottom edge that may fade when the clip line is `park` px below the front pose.
 * The fade stays below the front card at its tallest and that card's shadow, so no pile card is faded.
 */
export const fadeCap = (park: number) =>
  Math.max(0, park - TALLEST_CARD - PILE_CLEARANCE);
/** Edge fade with nothing overridden: the last 100 px above the clip line fade, so a card thins out instead of being cut in one line. */
const FADE_DEFAULT = 100;

/** With the ramp off the held state changes nothing, so the settings that shape it are hidden. */
const ramps = (c: CascadeCfg) => c.ramp;

export const CASCADE_SETTINGS: readonly Setting<
  CascadeCfg,
  CascadePagePatch
>[] = [
  {
    kind: "range",
    key: "cw0",
    group: "taps",
    label: "spring Hz, tap",
    unit: "Hz",
    min: 1.5,
    max: 6,
    step: 0.1,
    read: (c) => c.omega0 / TAU,
    write: (v) => ({ omega0: TAU * v }),
    shown: always,
  },
  {
    kind: "range",
    key: "ccap",
    group: "taps",
    label: "edge budget, tap px/frame",
    unit: "px/frame",
    min: 12,
    max: 44,
    step: 1,
    read: (c) => c.vcap / 60,
    write: (v) => ({ vcap: 60 * v }),
    shown: always,
  },
  {
    kind: "range",
    key: "sp0",
    group: "pace",
    label: "spacing at rest px",
    unit: "px",
    min: 150,
    max: 300,
    step: 1,
    read: (c) => c.spacing0,
    write: (spacing0) => ({ spacing0 }),
    shown: ramps,
  },
  {
    kind: "range",
    key: "sp1",
    group: "pace",
    label: "spacing held px",
    unit: "px",
    min: 100,
    max: 216,
    step: 1,
    read: (c) => c.spacing1,
    write: (spacing1) => ({ spacing1 }),
    shown: always,
  },
  {
    kind: "range",
    key: "cdelay",
    group: "pace",
    label: "hold delay ms",
    unit: "ms",
    min: 0,
    max: 800,
    step: 10,
    read: (c) => c.holdDelay,
    write: (holdDelay) => ({ holdDelay }),
    shown: ramps,
  },
  {
    kind: "range",
    key: "cw1",
    group: "pace",
    label: "spring Hz, held",
    unit: "Hz",
    min: 2,
    max: 8,
    step: 0.1,
    read: (c) => c.omega1 / TAU,
    write: (v) => ({ omega1: TAU * v }),
    shown: ramps,
  },
  {
    kind: "range",
    key: "ccap1",
    group: "pace",
    label: "edge budget, held px/frame",
    unit: "px/frame",
    min: 12,
    max: 44,
    step: 1,
    read: (c) => c.vcap1 / 60,
    write: (v) => ({ vcap1: 60 * v }),
    shown: ramps,
  },
  {
    kind: "range",
    key: "park",
    group: "stage",
    label: "park px",
    unit: "px",
    min: 360,
    max: 560,
    step: 10,
    read: (c) => c.park,
    write: (park) => ({ park }),
    shown: always,
  },
  {
    kind: "range",
    key: "fade",
    group: "stage",
    label: "edge fade px",
    unit: "px",
    min: 0,
    max: (c) => fadeCap(c.park),
    step: 2,
    read: (c) => Math.min(c.fade, fadeCap(c.park)),
    write: (fade) => ({ fade }),
    shown: always,
  },
  {
    kind: "range",
    key: "shade",
    group: "stage",
    label: "leave shade",
    unit: "",
    min: 0,
    max: 0.5,
    step: 0.05,
    read: (c) => c.leaveShade,
    write: (leaveShade) => ({ leaveShade }),
    shown: always,
  },
];

// ---- the path every model's moving cards follow -------------------------------------------------------

/**
 * The sideways shape of the path a moving card follows (`ring.ts`). It belongs to no model: every model, the
 * product included, shows these settings, and a preset button leaves them as they are. `loop` says whether
 * the running model has a leg behind the pile (the drum and the product do, the cascade does not). The path
 * shows on screen while cards sway (`moving`: reduced motion is off) or while `Bezier path` draws it
 * (`overlay`); with neither, its settings change nothing and hide.
 */
export type PathCfg = {
  sway: number;
  swayBehind: number;
  peak: number;
  peakBehind: number;
  cross: number;
  bank: number;
  loop: boolean;
  moving: boolean;
  overlay: boolean;
};
export const PATH_DEFAULT: PathCfg = {
  sway: 24,
  swayBehind: -24,
  peak: 0.5,
  peakBehind: 0.5,
  cross: 0,
  bank: 0,
  loop: true,
  moving: true,
  overlay: false,
};
const pathShows = (c: PathCfg) => c.moving || c.overlay;
/** Whether either leg sways at all: with no sway, the settings that shape it change nothing. */
const swaying = (c: PathCfg) => c.sway !== 0 || (c.loop && c.swayBehind !== 0);

export const PATH_SETTINGS: readonly Setting<PathCfg, Partial<PathCfg>>[] = [
  {
    kind: "range",
    key: "sway",
    group: "path",
    label: "sway in front px",
    unit: "px",
    min: -80,
    max: 80,
    step: 1,
    read: (c) => c.sway,
    write: (sway) => ({ sway }),
    shown: pathShows,
  },
  {
    kind: "range",
    key: "swayb",
    group: "path",
    label: "sway behind px",
    unit: "px",
    min: -80,
    max: 80,
    step: 1,
    read: (c) => c.swayBehind,
    write: (swayBehind) => ({ swayBehind }),
    shown: (c) => pathShows(c) && c.loop,
  },
  {
    kind: "range",
    key: "peak",
    group: "path",
    label: "widest point",
    unit: "",
    min: 0.25,
    max: 0.75,
    step: 0.05,
    read: (c) => c.peak,
    write: (peak) => ({ peak }),
    shown: (c) => pathShows(c) && swaying(c),
  },
  {
    kind: "range",
    key: "peakb",
    group: "path",
    label: "widest point behind",
    unit: "",
    min: 0.25,
    max: 0.75,
    step: 0.05,
    read: (c) => c.peakBehind,
    write: (peakBehind) => ({ peakBehind }),
    shown: (c) => pathShows(c) && c.loop && swaying(c),
  },
  {
    kind: "range",
    key: "cross",
    group: "path",
    label: "column crossing",
    unit: "",
    min: -0.3,
    max: 0.3,
    step: 0.05,
    read: (c) => c.cross,
    write: (cross) => ({ cross }),
    shown: (c) => pathShows(c) && c.loop && swaying(c),
  },
  {
    kind: "range",
    key: "bank",
    group: "path",
    label: "bank deg",
    unit: "°",
    min: -10,
    max: 10,
    step: 0.5,
    read: (c) => c.bank,
    write: (bank) => ({ bank }),
    // Only the cards turn: the overlay alone shows no bank.
    shown: (c) => c.moving && swaying(c),
  },
];

// ---- what the page draws: playback fades and the Bezier path overlay -------------------------------

/**
 * Settings of the page itself, which no model reads and a preset button keeps. `reduced` is whether reduced
 * motion is in force (the button or the system setting) and `overlay` whether `Bezier path` is on; the
 * inspector shows each setting only while it changes what is drawn.
 */
export type ViewCfg = {
  reduced: boolean;
  overlay: boolean;
  /** How long the new front card fades in under reduced motion, ms. */
  fadeMs: number;
  /** How long the heading fades in when the front card changes, ms; 0 swaps it at once. */
  headMs: number;
  /** A simulated hold's wait before its first repeat, ms, as the OS's key repeat delay. */
  repeatDelay: number;
  /** A simulated hold's interval between repeats, ms, as the OS's key repeat rate. */
  repeatMs: number;
  handles: boolean;
  allKnots: boolean;
  inner: number;
  spine: boolean;
  arrows: boolean;
  labels: boolean;
  dots: boolean;
};
export const VIEW_DEFAULT: ViewCfg = {
  reduced: false,
  overlay: false,
  fadeMs: 160,
  headMs: 160,
  repeatDelay: 250,
  repeatMs: 33,
  handles: true,
  allKnots: false,
  inner: INNER_KNOTS,
  spine: true,
  arrows: true,
  labels: true,
  dots: true,
};
const drawn = (c: ViewCfg) => c.overlay;

export const VIEW_SETTINGS: readonly Setting<ViewCfg, Partial<ViewCfg>>[] = [
  {
    kind: "range",
    key: "rfade",
    group: "playback",
    label: "reduced fade ms",
    unit: "ms",
    min: 0,
    max: 600,
    step: 10,
    read: (c) => c.fadeMs,
    write: (fadeMs) => ({ fadeMs }),
    shown: (c) => c.reduced,
  },
  {
    kind: "range",
    key: "hfade",
    group: "playback",
    label: "heading fade ms",
    unit: "ms",
    min: 0,
    max: 600,
    step: 10,
    read: (c) => c.headMs,
    write: (headMs) => ({ headMs }),
    // Under reduced motion the heading changes at once, so the fade has nothing to draw.
    shown: (c) => !c.reduced,
  },
  // The simulated holds (`hold.down`, `hold.up`) run only while cards move.
  {
    kind: "range",
    key: "krd",
    group: "playback",
    label: "hold repeat delay ms",
    unit: "ms",
    min: 100,
    max: 800,
    step: 10,
    read: (c) => c.repeatDelay,
    write: (repeatDelay) => ({ repeatDelay }),
    shown: (c) => !c.reduced,
  },
  {
    kind: "range",
    key: "kri",
    group: "playback",
    label: "hold repeat interval ms",
    unit: "ms",
    min: 15,
    max: 120,
    step: 1,
    read: (c) => c.repeatMs,
    write: (repeatMs) => ({ repeatMs }),
    shown: (c) => !c.reduced,
  },
  {
    kind: "toggle",
    key: "handles",
    group: "overlay",
    label: "control handles",
    read: (c) => c.handles,
    write: (handles) => ({ handles }),
    shown: drawn,
  },
  {
    kind: "toggle",
    key: "knots",
    group: "overlay",
    label: "handles at every knot",
    read: (c) => c.allKnots,
    write: (allKnots) => ({ allKnots }),
    shown: (c) => c.overlay && c.handles,
  },
  {
    kind: "range",
    key: "inner",
    group: "overlay",
    label: "knots per stretch",
    unit: "knots",
    min: 0,
    max: 6,
    step: 1,
    read: (c) => c.inner,
    write: (inner) => ({ inner }),
    shown: drawn,
  },
  {
    kind: "toggle",
    key: "arrows",
    group: "overlay",
    label: "direction arrows",
    read: (c) => c.arrows,
    write: (arrows) => ({ arrows }),
    shown: drawn,
  },
  {
    kind: "toggle",
    key: "labels",
    group: "overlay",
    label: "labels",
    read: (c) => c.labels,
    write: (labels) => ({ labels }),
    shown: drawn,
  },
  {
    kind: "toggle",
    key: "spine",
    group: "overlay",
    label: "pile spine",
    read: (c) => c.spine,
    write: (spine) => ({ spine }),
    shown: drawn,
  },
  {
    kind: "toggle",
    key: "dots",
    group: "overlay",
    label: "card markers",
    read: (c) => c.dots,
    write: (dots) => ({ dots }),
    shown: drawn,
  },
];

/** The page's cascade configuration with nothing overridden. */
const cascadeBase = (preset?: CascadePatch): CascadeCfg => ({
  ...Cascade.config(preset),
  fade: FADE_DEFAULT,
});

// ---- the controls a tooltip can describe -------------------------------------------------------------

/** One control a tooltip can describe: the id the page puts in `data-help`, its name, kind, and range. */
export type Control = { id: string; label: string; kind: string; meta: string };

const round = (v: number) => Math.round(v * 1000) / 1000;
/** A slider's value in a configuration with nothing overridden, whichever model it belongs to. */
export function defaultOf(key: string): number {
  const drum = SETTINGS.find((x) => x.key === key);
  if (drum?.kind === "range") return drum.read(Drum.config());
  const cascade = CASCADE_SETTINGS.find((x) => x.key === key);
  if (cascade?.kind === "range") return cascade.read(cascadeBase());
  const path = PATH_SETTINGS.find((x) => x.key === key);
  if (path?.kind === "range") return path.read(PATH_DEFAULT);
  const view = VIEW_SETTINGS.find((x) => x.key === key);
  if (view?.kind === "range") return view.read(VIEW_DEFAULT);
  throw new Error(`${key} is not a slider, so it has no numeric default`);
}

function describeSetting<C>(s: Setting<C, unknown>, base: C): Control {
  const id = `setting.${s.key}`;
  if (s.kind === "range") {
    const unit = s.unit ? ` ${s.unit}` : "";
    return {
      id,
      label: s.label,
      kind: "slider",
      meta: `${s.min}–${maxOf(s, base)}${unit}, default ${round(s.read(base))}${unit}`,
    };
  }
  if (s.kind === "toggle")
    return {
      id,
      label: s.label,
      kind: "toggle",
      meta: `default ${s.read(base) ? "on" : "off"}`,
    };
  return {
    id,
    label: s.label,
    kind: "choice",
    meta: `${s.options.join(", ")}; default ${s.read(base)}`,
  };
}

const presetButton = (p: string) => ({
  id: `preset.${p}`,
  label: p,
  kind: "preset",
  meta: "button",
});

/** Every control the page can draw, in page order. */
export const CONTROLS: readonly Control[] = [
  ...MODES.map((m) => ({
    id: `model.${m.id}`,
    label: m.label,
    kind: "model",
    meta: "button",
  })),
  ...PRESET_NAMES.map(presetButton),
  ...CASCADE_PRESET_NAMES.map(presetButton),
  {
    id: "preset.saved",
    label: "Saved preset",
    kind: "button",
    meta: "stored in this browser",
  },
  {
    id: "preset.delete",
    label: "Delete saved preset",
    kind: "button",
    meta: "button",
  },
  {
    id: "preset.save",
    label: "Save preset",
    kind: "button",
    meta: "stored in this browser",
  },
  {
    id: "speed",
    label: "Speed",
    kind: "buttons",
    meta: SPEEDS.map((s) => s.label).join(", "),
  },
  { id: "clock.pause", label: "Pause", kind: "button", meta: "toggle" },
  { id: "clock.step", label: "Step ⅟₆₀ s", kind: "button", meta: "one frame" },
  {
    id: "reduced",
    label: "Reduced motion",
    kind: "toggle",
    meta: "default off",
  },
  {
    id: "path",
    label: "Bezier path",
    kind: "toggle",
    meta: "default off",
  },
  { id: "held", label: "held", kind: "readout", meta: "0 to 1" },
  {
    id: "hold.down",
    label: "Hold ↓ from the top",
    kind: "button",
    meta: "simulated key hold",
  },
  {
    id: "hold.up",
    label: "Hold ↑ from the bottom",
    kind: "button",
    meta: "simulated key hold",
  },
  {
    id: "copy",
    label: "Copy settings",
    kind: "button",
    meta: "copies Markdown",
  },
  {
    id: "about",
    label: "How the drum works",
    kind: "note",
    meta: "opens a panel",
  },
  {
    id: "about.cascade",
    label: "How the cascade works",
    kind: "note",
    meta: "opens a panel",
  },
  ...SETTINGS.map((s) => describeSetting(s, Drum.config())),
  ...CASCADE_SETTINGS.map((s) => describeSetting(s, cascadeBase())),
  ...PATH_SETTINGS.map((s) => describeSetting(s, PATH_DEFAULT)),
  ...VIEW_SETTINGS.map((s) => describeSetting(s, VIEW_DEFAULT)),
];

// ---- page state ------------------------------------------------------------------------------------

/**
 * The page's state, as the URL hash holds it: `v`, `preset`, `speed`, `reduced`, `path`, one entry per model
 * setting key (`SETTING_KEYS`, which a preset button clears), and one per path and page setting key
 * (`PATH_KEYS` and `VIEW_KEYS`, which it keeps).
 */
export type Opt = Record<string, string>;
export const SETTING_KEYS: readonly string[] = [
  ...SETTINGS.map((s) => s.key),
  ...CASCADE_SETTINGS.map((s) => s.key),
];
export const PATH_KEYS: readonly string[] = PATH_SETTINGS.map((s) => s.key);
export const VIEW_KEYS: readonly string[] = VIEW_SETTINGS.map((s) => s.key);
const OPT_KEYS = new Set([
  "v",
  "preset",
  "speed",
  "reduced",
  "path",
  ...SETTING_KEYS,
  ...PATH_KEYS,
  ...VIEW_KEYS,
]);

/** The known keys of a URL hash; anything else is dropped. */
export function parseOpt(hash: string): Opt {
  const out: Opt = {};
  for (const [k, v] of new URLSearchParams(hash.replace(/^#/, "")))
    if (OPT_KEYS.has(k)) out[k] = v;
  return out;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
/** The patch a hash value asks for, or null when the value names nothing; a slider's value is clamped to its range under `base`. */
function patchFor<C, P>(s: Setting<C, P>, raw: string, base: C): P | null {
  if (s.kind === "toggle")
    return raw === "1" ? s.write(true) : raw === "0" ? s.write(false) : null;
  if (s.kind === "select") return s.options.includes(raw) ? s.write(raw) : null;
  const v = Number(raw);
  return raw !== "" && Number.isFinite(v)
    ? s.write(clamp(v, s.min, maxOf(s, base)))
    : null;
}

/** The preset's configuration with every setting the state overrides. */
export function drumCfg(opt: Opt): Cfg {
  const base: Cfg = Drum.config(PRESETS[opt.preset ?? ""]);
  const over: Patch = {};
  for (const s of SETTINGS) {
    const raw = opt[s.key];
    if (raw === undefined) continue;
    const p = patchFor(s, raw, base);
    if (p) Object.assign(over, { ...p, tempo: { ...over.tempo, ...p.tempo } });
  }
  return Drum.config({
    ...base,
    ...over,
    tempo: { ...base.tempo, ...over.tempo },
  });
}

/**
 * The preset's cascade configuration with every setting the state overrides. The fade is capped at what the
 * clip line's distance allows, whatever the state asks for.
 */
export function cascadeCfg(opt: Opt): CascadeCfg {
  const base = cascadeBase(CASCADE_PRESETS[opt.preset ?? ""]);
  const over: CascadePagePatch = {};
  for (const s of CASCADE_SETTINGS) {
    const raw = opt[s.key];
    if (raw === undefined) continue;
    const p = patchFor(s, raw, base);
    if (p) Object.assign(over, p);
  }
  const cfg = { ...base, ...over };
  return { ...cfg, fade: Math.min(cfg.fade, fadeCap(cfg.park)) };
}

/** A list's settings that the state overrides, on top of `base`. */
function overlay<C>(
  list: readonly Setting<C, Partial<C>>[],
  opt: Opt,
  base: C,
) {
  const over: Partial<C> = {};
  for (const s of list) {
    const raw = opt[s.key];
    if (raw === undefined) continue;
    const p = patchFor(s, raw, base);
    if (p) Object.assign(over, p);
  }
  return { ...base, ...over };
}

/** The path settings the state overrides, for the model `opt.v` names; `reduced` is whether reduced motion is in force. */
export const pathCfg = (opt: Opt, reduced = opt.reduced === "1"): PathCfg =>
  overlay(PATH_SETTINGS, opt, {
    ...PATH_DEFAULT,
    loop: opt.v !== "cascade",
    moving: !reduced,
    overlay: opt.path === "1",
  });

/** The page settings the state overrides; `reduced` is whether reduced motion is in force. */
export const viewCfg = (opt: Opt, reduced = opt.reduced === "1"): ViewCfg =>
  overlay(VIEW_SETTINGS, opt, {
    ...VIEW_DEFAULT,
    reduced,
    overlay: opt.path === "1",
  });

/** The part of a page configuration the cascade model reads. */
export function modelCfg({ fade, ...model }: CascadeCfg): CascadeConfig {
  return model;
}
