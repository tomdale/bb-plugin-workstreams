/**
 * Every control on the lab page, as data with no DOM. The page draws its inspector from these lists, `help.ts` must
 * hold one entry for each id in `CONTROLS` and no other (`verify.ts` and `npm run smoke` check it), and
 * `drumCfg` and `cascadeCfg` turn the page's state into a configuration for each model.
 */
// The drum is the product's own (`drum.ts`); the headless sims import both models too.
import {
  Drum,
  PRESETS,
  type DrumPatch,
} from "../../../src/app/page/queue/drum.ts";
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

/**
 * The card decks the Cards switch offers: `items` are indexes into `ITEMS` (items.js), repeated to fill
 * `DECK_SIZE` cards. `lab` is the page's own set; `w2` and `alt` match the sims' height sets of those names
 * (`HEIGHTS` in sim/lib.mjs) as closely as real cards can.
 */
export const DECKS: readonly { id: string; label: string; items: number[] }[] =
  [
    { id: "lab", label: "lab", items: [0, 1, 2, 3, 4, 5] },
    { id: "w2", label: "mixed 330", items: [3, 4, 2, 6, 7, 5] },
    { id: "alt", label: "330 and 73", items: [6, 1] },
  ];
export const DECK_SIZE = 12;

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
 * The inspector's modules, top to bottom. A setting names the module it sits in as its `group`; `run`, `drive`,
 * `measured` and `about` hold the page's buttons, readouts and the panel instead. A module with nothing to show
 * under the current model and configuration is hidden whole, and `FOLDED` modules start folded.
 */
export const MODULES = [
  { id: "run", label: "Run" },
  { id: "drive", label: "Drive" },
  { id: "measured", label: "Measured" },
  { id: "taps", label: "Taps" },
  { id: "held", label: "Held keys" },
  { id: "route", label: "Route" },
  { id: "finish", label: "Finish" },
  { id: "page", label: "Page" },
  { id: "overlay", label: "Overlay" },
  { id: "about", label: "About" },
] as const;
export type ModuleId = (typeof MODULES)[number]["id"];
export type GroupId = Exclude<ModuleId, "run" | "drive" | "measured" | "about">;
/** The modules that start folded: what is looked at once, after the motion is settled. */
export const FOLDED: readonly ModuleId[] = [
  "finish",
  "page",
  "overlay",
  "about",
];

/**
 * What a setting's note may quote besides the configuration: the Measured module's latest hold each way and
 * tap each way, and the shortest card on the stage, px.
 */
export type NoteContext = {
  hold: Partial<Record<1 | -1, { rate: number }>>;
  tap: Partial<Record<1 | -1, { land: number }>>;
  shortest: number;
};

type Base<C> = {
  /** The setting's short name: its key in the URL hash and in `sim/sweep.mjs`. */
  key: string;
  group: GroupId;
  label: string;
  /** Whether the setting changes anything under this configuration; a setting that does not is hidden. */
  shown: (c: C) => boolean;
  /** Folded under its module's `more` line: shaping that is looked at once. */
  more?: boolean;
  /** It changes what is drawn even with no motion, so it stays under reduced motion. */
  still?: boolean;
  /** A line under the setting: what its value amounts to, and what the page measured of it. */
  note?: (c: C, n: NoteContext) => string;
};
/**
 * One setting of a model whose configuration is `C`; `write` returns the patch that sets it, of type `P`. A
 * `derived` slider's patch depends on the rest of the configuration (`c`, with every other setting the state
 * asks for applied): pace in cards/s is written as an interval or a spacing at the current top speed.
 */
export type Setting<C = Cfg, P = Patch> =
  | (Base<C> & {
      kind: "range";
      unit: string;
      min: number;
      /** A number, or a function of the configuration for a limit that depends on another setting. */
      max: number | ((c: C) => number);
      step: number;
      read: (c: C) => number;
      write: (v: number, c: C) => P;
      derived?: boolean;
    })
  | (Base<C> & {
      kind: "toggle";
      read: (c: C) => boolean;
      write: (on: boolean) => P;
    })
  | (Base<C> & {
      kind: "select";
      options: readonly string[];
      /** What each option reads as on the page; an option with none reads as itself. */
      labels?: Record<string, string>;
      /** Drawn as a column of radio buttons rather than a menu. */
      radio?: boolean;
      read: (c: C) => string;
      write: (v: string) => P;
    });
/** A range setting's largest value under configuration `c`. */
export const maxOf = <C>(
  s: Extract<Setting<C, unknown>, { kind: "range" }>,
  c: C,
) => (typeof s.max === "number" ? s.max : s.max(c));
/** How many decimals a slider's value shows: as many as its step has. */
export const digitsOf = (step: number) =>
  Math.max(0, Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)));

const always = () => true;
const fmt = (v: number, d = 1) => String(Math.round(v * 10 ** d) / 10 ** d);
/** An edge budget in px/s, as px per frame at 60 and 120 Hz. */
const perFrame = (pxs: number) =>
  `${fmt(pxs / 60)} px/frame at 60 Hz, ${fmt(pxs / 120)} at 120 Hz.`;
/** The Measured module's latest hold each way, as a sentence. */
export const measuredPace = (n: NoteContext) => {
  const dn = n.hold[1],
    up = n.hold[-1];
  if (!dn && !up) return "Measured: no hold yet.";
  return `Measured ${[dn && `↓ ${dn.rate.toFixed(1)}`, up && `↑ ${up.rate.toFixed(1)}`].filter(Boolean).join(", ")} cards/s.`;
};
const tapNote = (n: NoteContext) => {
  const up = n.tap[-1],
    dn = n.tap[1];
  if (!up && !dn) return "";
  return `Measured: ${[up && `↑ lands in ${Math.round(up.land)} ms`, dn && `↓ settles in ${Math.round(dn.land)} ms`].filter(Boolean).join(", ")}.`;
};

/**
 * What a held key does to the cards, one choice for both models: `none` keeps the tap behaviour, `ramp` speeds
 * the springs and edge budgets up, `fold` folds every card toward its header line and `loose` lets a leaving
 * card pass over the next one. Fold and loose clearing include the speed-up, so both write `ramp` too.
 */
const HELD_LABELS = {
  none: "same as taps",
  ramp: "speed up",
  fold: "fold to the header line",
  loose: "pass over the next card",
};
const heldOf = (c: Cfg) =>
  c.fold ? "fold" : c.loose ? "loose" : c.ramp ? "ramp" : "none";
const speedsUp = (c: Cfg) => heldOf(c) !== "none";
/** How a held key's presses are spaced, as the page names `tempo.kind`. */
const PACING: Record<string, string> = {
  cards: "none",
  steady: "constant",
  planned: "lookahead",
};
const pacingOf = (c: Cfg) =>
  Object.keys(PACING).find((k) => PACING[k] === c.tempo.kind) ?? "cards";

export const SETTINGS: readonly Setting<Cfg, Patch>[] = [
  // ---- taps
  {
    kind: "range",
    key: "w0",
    group: "taps",
    label: "tap spring",
    unit: "Hz",
    min: 1.5,
    max: 6,
    step: 0.1,
    read: (c) => c.omega0 / TAU,
    write: (v) => ({ omega0: TAU * v }),
    shown: always,
    note: (_, n) => tapNote(n),
  },
  {
    kind: "range",
    key: "cap",
    group: "taps",
    label: "top speed",
    unit: "px/s",
    min: 720,
    max: 2640,
    step: 60,
    read: (c) => c.vcap,
    write: (vcap) => ({ vcap }),
    shown: always,
    note: (c) => perFrame(c.vcap),
  },
  // ---- held keys
  {
    kind: "select",
    key: "held",
    group: "held",
    label: "while held",
    radio: true,
    options: ["none", "ramp", "fold", "loose"],
    labels: HELD_LABELS,
    read: heldOf,
    write: (v) => ({
      ramp: v !== "none",
      fold: v === "fold",
      loose: v === "loose",
    }),
    shown: always,
  },
  {
    kind: "select",
    key: "pacing",
    group: "held",
    label: "pacing",
    options: ["cards", "steady", "planned"],
    labels: {
      cards: "follows cards",
      steady: "steady beat",
      planned: "planned",
    },
    read: pacingOf,
    write: (v) => ({ tempo: { kind: PACING[v] } }),
    shown: always,
  },
  {
    kind: "range",
    key: "pace",
    group: "held",
    label: "pace",
    unit: "cards/s",
    min: 2.5,
    max: 17,
    step: 0.1,
    read: (c) => 1000 / c.tempo.ms,
    write: (v) => ({ tempo: { ms: 1000 / v } }),
    shown: (c) => c.tempo.kind === "constant",
    note: (c, n) =>
      `A beat of ${Math.round(c.tempo.ms)} ms at the least: a tall card can take longer. ${measuredPace(n)}`,
  },
  {
    kind: "range",
    key: "ts",
    group: "held",
    label: "plan",
    unit: "×",
    min: 0.5,
    max: 1.4,
    step: 0.05,
    read: (c) => c.tempo.scale,
    write: (scale) => ({ tempo: { scale } }),
    shown: (c) => c.tempo.kind === "lookahead",
    note: (_, n) => measuredPace(n),
  },
  {
    kind: "range",
    key: "delay",
    group: "held",
    label: "speeds up after",
    unit: "ms",
    min: 0,
    max: 800,
    step: 10,
    read: (c) => c.holdDelay,
    write: (holdDelay) => ({ holdDelay }),
    shown: speedsUp,
  },
  {
    kind: "range",
    key: "w1",
    group: "held",
    label: "held spring",
    unit: "Hz",
    min: 2,
    max: 8,
    step: 0.1,
    read: (c) => c.omega1 / TAU,
    write: (v) => ({ omega1: TAU * v }),
    shown: speedsUp,
    note: (c) => `${fmt(c.omega1 / c.omega0, 2)}× the tap spring.`,
  },
  {
    kind: "range",
    key: "cap1",
    group: "held",
    label: "held top speed",
    unit: "px/s",
    min: 720,
    max: 2640,
    step: 60,
    read: (c) => c.vcap1,
    write: (vcap1) => ({ vcap1 }),
    shown: speedsUp,
    note: (c) => perFrame(c.vcap1),
  },
  {
    kind: "range",
    key: "h0",
    group: "held",
    label: "held height",
    unit: "px",
    min: 40,
    max: 200,
    step: 1,
    read: (c) => c.H0,
    write: (H0) => ({ H0 }),
    shown: (c) => c.fold || c.loose,
    note: (_, n) =>
      n.shortest > 0
        ? `The shortest card is ${Math.round(n.shortest)} px.`
        : "",
  },
  // ---- route
  {
    kind: "range",
    key: "hide",
    group: "route",
    label: "tuck depth",
    unit: "px",
    min: 0,
    max: 12,
    step: 1,
    read: (c) => c.hidePx,
    write: (hidePx) => ({ hidePx }),
    shown: always,
  },
  // ---- finish
  {
    kind: "range",
    key: "fadein",
    group: "finish",
    label: "incoming fade-in",
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
    group: "finish",
    label: "covered card fade",
    unit: "",
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
    group: "finish",
    label: "tuck spring",
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
    key: "wrise",
    group: "finish",
    label: "tall-card wash rise",
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
    group: "finish",
    label: "tall-card wash clear",
    unit: "ms",
    min: 10,
    max: 400,
    step: 10,
    read: (c) => c.washTauIn,
    write: (washTauIn) => ({ washTauIn }),
    shown: always,
  },
  {
    kind: "range",
    key: "tw",
    group: "finish",
    label: "plan window",
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
    key: "ta",
    group: "finish",
    label: "plan base",
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
    group: "finish",
    label: "plan per px",
    unit: "ms/px",
    min: 0,
    max: 1.5,
    step: 0.02,
    read: (c) => c.tempo.b,
    write: (b) => ({ tempo: { b } }),
    shown: (c) => c.tempo.kind === "lookahead",
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
/** The edge budget a full train runs at: the held one with the ramp on, the tap one without. */
const trainSpeed = (c: CascadeCfg) => (c.ramp ? c.vcap1 : c.vcap);

/**
 * The cascade's settings. Those it shares with the drum have the drum's key and name, so one hash sets both
 * models alike; `pace` and `pace before speed-up` are written as the spacing between leaving cards at the edge
 * budget the train runs at.
 */
export const CASCADE_SETTINGS: readonly Setting<
  CascadeCfg,
  CascadePagePatch
>[] = [
  {
    kind: "range",
    key: "w0",
    group: "taps",
    label: "tap spring",
    unit: "Hz",
    min: 1.5,
    max: 6,
    step: 0.1,
    read: (c) => c.omega0 / TAU,
    write: (v) => ({ omega0: TAU * v }),
    shown: always,
    note: (_, n) => tapNote(n),
  },
  {
    kind: "range",
    key: "cap",
    group: "taps",
    label: "top speed",
    unit: "px/s",
    min: 720,
    max: 2640,
    step: 60,
    read: (c) => c.vcap,
    write: (vcap) => ({ vcap }),
    shown: always,
    note: (c) => perFrame(c.vcap),
  },
  {
    kind: "select",
    key: "held",
    group: "held",
    label: "while held",
    radio: true,
    options: ["none", "ramp"],
    labels: HELD_LABELS,
    read: (c) => (c.ramp ? "ramp" : "none"),
    write: (v) => ({ ramp: v === "ramp" }),
    shown: always,
  },
  {
    kind: "range",
    key: "pace",
    group: "held",
    label: "pace",
    unit: "cards/s",
    min: 4,
    max: 18,
    step: 0.1,
    read: (c) => trainSpeed(c) / c.spacing1,
    write: (v, c) => ({ spacing1: trainSpeed(c) / v }),
    derived: true,
    shown: always,
    note: (c, n) =>
      `${Math.round(c.spacing1)} px between cards at the ${c.ramp ? "held top speed" : "top speed"}. ${measuredPace(n)}`,
  },
  {
    kind: "range",
    key: "pace0",
    group: "held",
    label: "pace before speed-up",
    unit: "cards/s",
    min: 3,
    max: 12,
    step: 0.1,
    read: (c) => c.vcap / c.spacing0,
    write: (v, c) => ({ spacing0: c.vcap / v }),
    derived: true,
    shown: ramps,
    note: (c) => `${Math.round(c.spacing0)} px between cards at the top speed.`,
  },
  {
    kind: "range",
    key: "delay",
    group: "held",
    label: "speeds up after",
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
    key: "w1",
    group: "held",
    label: "held spring",
    unit: "Hz",
    min: 2,
    max: 8,
    step: 0.1,
    read: (c) => c.omega1 / TAU,
    write: (v) => ({ omega1: TAU * v }),
    shown: ramps,
    note: (c) => `${fmt(c.omega1 / c.omega0, 2)}× the tap spring.`,
  },
  {
    kind: "range",
    key: "cap1",
    group: "held",
    label: "held top speed",
    unit: "px/s",
    min: 720,
    max: 2640,
    step: 60,
    read: (c) => c.vcap1,
    write: (vcap1) => ({ vcap1 }),
    shown: ramps,
    note: (c) => perFrame(c.vcap1),
  },
  {
    kind: "range",
    key: "park",
    group: "route",
    label: "park",
    unit: "px",
    min: 360,
    max: 560,
    step: 10,
    read: (c) => c.park,
    write: (park) => ({ park }),
    shown: always,
    still: true,
  },
  {
    kind: "range",
    key: "fade",
    group: "route",
    label: "edge fade",
    unit: "px",
    min: 0,
    max: (c) => fadeCap(c.park),
    step: 2,
    read: (c) => Math.min(c.fade, fadeCap(c.park)),
    write: (fade) => ({ fade }),
    shown: always,
    still: true,
  },
  {
    kind: "range",
    key: "shade",
    group: "route",
    label: "leave shade",
    unit: "",
    min: 0,
    max: 0.5,
    step: 0.05,
    read: (c) => c.leaveShade,
    write: (leaveShade) => ({ leaveShade }),
    shown: always,
    still: true,
  },
];

// ---- the path every model's moving cards follow -------------------------------------------------------

/**
 * The sideways shape of the path a moving card follows (`ring.ts`). It belongs to no model: every model, the
 * product included, shows these settings in Route, and a preset button leaves them as they are. `loop` says
 * whether the running model has a leg behind the pile (the drum and the product do, the cascade does not). The
 * path shows on screen while cards sway (`moving`: reduced motion is off) or while `Bezier path` draws it
 * (`overlay`); with neither, its settings change nothing and hide. Sway and bank are what the eye sees first;
 * the rest shape the loop and fold under Route's `more` line.
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
    group: "route",
    label: "sway",
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
    key: "bank",
    group: "route",
    label: "bank",
    unit: "°",
    min: -10,
    max: 10,
    step: 0.5,
    read: (c) => c.bank,
    write: (bank) => ({ bank }),
    // Only the cards turn: the overlay alone shows no bank.
    shown: (c) => c.moving && swaying(c),
  },
  {
    kind: "range",
    key: "swayb",
    group: "route",
    label: "sway behind",
    unit: "px",
    min: -80,
    max: 80,
    step: 1,
    read: (c) => c.swayBehind,
    write: (swayBehind) => ({ swayBehind }),
    shown: (c) => pathShows(c) && c.loop,
    more: true,
  },
  {
    kind: "range",
    key: "peak",
    group: "route",
    label: "widest point",
    unit: "",
    min: 0.25,
    max: 0.75,
    step: 0.05,
    read: (c) => c.peak,
    write: (peak) => ({ peak }),
    shown: (c) => pathShows(c) && swaying(c),
    more: true,
  },
  {
    kind: "range",
    key: "peakb",
    group: "route",
    label: "widest point behind",
    unit: "",
    min: 0.25,
    max: 0.75,
    step: 0.05,
    read: (c) => c.peakBehind,
    write: (peakBehind) => ({ peakBehind }),
    shown: (c) => pathShows(c) && c.loop && swaying(c),
    more: true,
  },
  {
    kind: "range",
    key: "cross",
    group: "route",
    label: "column crossing",
    unit: "",
    min: -0.3,
    max: 0.3,
    step: 0.05,
    read: (c) => c.cross,
    write: (cross) => ({ cross }),
    shown: (c) => pathShows(c) && c.loop && swaying(c),
    more: true,
  },
];

// ---- the page itself: its fades, the simulated key repeat, and the Bezier path overlay -------------

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
    group: "page",
    label: "reduced fade",
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
    group: "page",
    label: "heading fade",
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
    group: "page",
    label: "hold repeat delay",
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
    group: "page",
    label: "hold repeat interval",
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
/**
 * A slider's value in a configuration with nothing overridden. A key both models share reads the drum's
 * unless `model` is `cascade`.
 */
export function defaultOf(key: string, model = "drum"): number {
  const drum = SETTINGS.find((x) => x.key === key);
  if (drum?.kind === "range" && model !== "cascade")
    return drum.read(Drum.config());
  const cascade = CASCADE_SETTINGS.find((x) => x.key === key);
  if (cascade?.kind === "range") return cascade.read(cascadeBase());
  const path = PATH_SETTINGS.find((x) => x.key === key);
  if (path?.kind === "range") return path.read(PATH_DEFAULT);
  const view = VIEW_SETTINGS.find((x) => x.key === key);
  if (view?.kind === "range") return view.read(VIEW_DEFAULT);
  throw new Error(`${key} is not a slider, so it has no numeric default`);
}

/** A slider's step, from whichever list holds it; undefined for a key that is not a slider. */
export function stepOf(key: string): number | undefined {
  for (const list of [SETTINGS, CASCADE_SETTINGS, PATH_SETTINGS, VIEW_SETTINGS])
    for (const s of list as readonly Setting<any, unknown>[])
      if (s.key === key && s.kind === "range") return s.step;
  return undefined;
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
  const name = (o: string) => s.labels?.[o] ?? o;
  return {
    id,
    label: s.label,
    kind: "choice",
    meta: `${s.options.map(name).join(", ")}; default ${name(s.read(base))}`,
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
    label: "Save as preset…",
    kind: "button",
    meta: "stored in this browser",
  },
  {
    id: "preset.revert",
    label: "Revert",
    kind: "button",
    meta: "back to the preset",
  },
  {
    id: "copy.cfg",
    label: "Copy as QUEUE_CFG",
    kind: "button",
    meta: "copies TypeScript",
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
    id: "cards",
    label: "Cards",
    kind: "buttons",
    meta: DECKS.map((d) => d.label).join(", "),
  },
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
    id: "pace.cards",
    label: "pace",
    kind: "readout",
    meta: "measured",
  },
  {
    id: "measured.pace",
    label: "pace",
    kind: "readout",
    meta: "the last hold",
  },
  {
    id: "measured.last",
    label: "last",
    kind: "readout",
    meta: "the last hold the other way",
  },
  {
    id: "measured.tap",
    label: "tap",
    kind: "readout",
    meta: "the last tap each way",
  },
  {
    id: "measured.checker",
    label: "checker",
    kind: "readout",
    meta: "the last run",
  },
  {
    id: "reset",
    label: "reset",
    kind: "button",
    meta: "one setting",
  },
  {
    id: "hold.down",
    label: "Hold ↓ from the top",
    kind: "button",
    meta: "simulated key hold", // slop-ok: 2 the existing hold buttons' tooltip meta
  },
  {
    id: "hold.up",
    label: "Hold ↑ from the bottom",
    kind: "button",
    meta: "simulated key hold", // slop-ok: 2 the existing hold buttons' tooltip meta
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
  // A setting both models share is one control, described by the drum's; its tooltip covers both.
  ...SETTINGS.map((s) => describeSetting(s, Drum.config())),
  ...CASCADE_SETTINGS.filter((s) => !SETTINGS.some((d) => d.key === s.key)).map(
    (s) => describeSetting(s, cascadeBase()),
  ),
  ...PATH_SETTINGS.map((s) => describeSetting(s, PATH_DEFAULT)),
  ...VIEW_SETTINGS.map((s) => describeSetting(s, VIEW_DEFAULT)),
];

// ---- page state ------------------------------------------------------------------------------------

/**
 * The page's state, as the URL hash holds it: `v`, `preset`, `speed`, `cards`, `reduced`, `path`, one entry per model
 * setting key (`SETTING_KEYS`, which a preset button clears), and one per path and page setting key
 * (`PATH_KEYS` and `VIEW_KEYS`, which it keeps).
 */
export type Opt = Record<string, string>;
export const SETTING_KEYS: readonly string[] = [
  ...new Set([
    ...SETTINGS.map((s) => s.key),
    ...CASCADE_SETTINGS.map((s) => s.key),
  ]),
];
export const PATH_KEYS: readonly string[] = PATH_SETTINGS.map((s) => s.key);
export const VIEW_KEYS: readonly string[] = VIEW_SETTINGS.map((s) => s.key);
const OPT_KEYS = new Set([
  "v",
  "preset",
  "speed",
  "cards",
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
/**
 * The patch a hash value asks for, or null when the value names nothing; a slider's value is clamped to its range
 * under `base`, and a derived slider is written against `base`.
 */
function patchFor<C, P>(s: Setting<C, P>, raw: string, base: C): P | null {
  if (s.kind === "toggle")
    return raw === "1" ? s.write(true) : raw === "0" ? s.write(false) : null;
  if (s.kind === "select") return s.options.includes(raw) ? s.write(raw) : null;
  const v = Number(raw);
  return raw !== "" && Number.isFinite(v)
    ? s.write(clamp(v, s.min, maxOf(s, base)), base)
    : null;
}

/**
 * `base` with every setting of `list` that the state overrides, through `merge`. Derived settings go last, so
 * each is written against the configuration every other override has made: a pace keeps its cards/s whatever
 * top speed the state asks for.
 */
function applyAll<C, P>(
  list: readonly Setting<C, P>[],
  opt: Opt,
  base: C,
  merge: (c: C, p: P) => C,
): C {
  let cfg = base;
  for (const late of [false, true])
    for (const s of list) {
      const raw = opt[s.key];
      if (raw === undefined || (s.kind === "range" && !!s.derived) !== late)
        continue;
      const p = patchFor(s, raw, cfg);
      if (p) cfg = merge(cfg, p);
    }
  return cfg;
}

/** The preset's configuration with every setting the state overrides. */
export function drumCfg(opt: Opt): Cfg {
  const base: Cfg = Drum.config(PRESETS[opt.preset ?? ""]);
  return applyAll(SETTINGS, opt, base, (c, p) => ({
    ...c,
    ...p,
    tempo: { ...c.tempo, ...p.tempo },
  }));
}

/**
 * The preset's cascade configuration with every setting the state overrides. The fade is capped at what the
 * clip line's distance allows, whatever the state asks for.
 */
export function cascadeCfg(opt: Opt): CascadeCfg {
  const base = cascadeBase(CASCADE_PRESETS[opt.preset ?? ""]);
  const cfg = applyAll(CASCADE_SETTINGS, opt, base, (c, p) => ({
    ...c,
    ...p,
  }));
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
