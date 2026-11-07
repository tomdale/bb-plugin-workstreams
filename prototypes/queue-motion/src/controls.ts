/**
 * Every control on the lab page, as data with no DOM. The page draws its bars from these lists, `help.ts` must
 * hold one entry for each id in `CONTROLS` and no other (`verify.ts` and `npm run smoke` check it), and
 * `drumCfg` and `cascadeCfg` turn the page's state into a configuration for each model.
 */
// The drum is the product's own (`drum.ts`); the headless sims import both models too.
import { Drum, PRESETS } from "../../../src/app/page/queue/drum.ts";
import {
  Cascade,
  PRESETS as CASCADE_PRESETS,
  type CascadeConfig,
  type CascadePatch,
} from "./cascade.ts";

export const TAU = 2 * Math.PI;
/** How long the new front card fades in under reduced motion, ms. */
export const FADE_MS = 160;

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
  gateSlack: number;
  fold: boolean;
  ramp: boolean;
  H0: number;
  tempo: { kind: string; window: number; scale: number; ms: number };
};
type Patch = Partial<Omit<Cfg, "tempo">> & { tempo?: Partial<Cfg["tempo"]> };

/** The cascade configuration the page holds: the model's, and the edge fade, which only the page draws. */
export type CascadeCfg = CascadeConfig & { fade: number };
type CascadePagePatch = CascadePatch & { fade?: number };

export const GROUPS = [
  { id: "taps", label: "Taps" },
  { id: "pace", label: "Pace" },
  { id: "held", label: "Held keys" },
  { id: "stage", label: "Stage" },
] as const;
export type GroupId = (typeof GROUPS)[number]["id"];

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
const heldState = (c: Cfg) => c.fold || c.ramp;

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
    key: "tms",
    group: "pace",
    label: "constant interval ms",
    unit: "ms",
    min: 150,
    max: 400,
    step: 5,
    read: (c) => c.tempo.ms,
    write: (ms) => ({ tempo: { ms } }),
    shown: (c) => c.tempo.kind === "constant",
  },
  {
    kind: "range",
    key: "slack",
    group: "pace",
    label: "gate slack",
    unit: "ring units",
    min: 0,
    max: 0.3,
    step: 0.05,
    read: (c) => c.gateSlack,
    write: (gateSlack) => ({ gateSlack }),
    shown: (c) => c.tempo.kind === "none",
  },
  {
    kind: "toggle",
    key: "ramp",
    group: "held",
    label: "held speed-up",
    read: (c) => c.ramp,
    write: (ramp) => ({ ramp }),
    // Fold already includes the speed-up, so with fold on this toggle changes nothing.
    shown: (c) => !c.fold,
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
    label: "folded height px",
    unit: "px",
    min: 40,
    max: 200,
    step: 1,
    read: (c) => c.H0,
    write: (H0) => ({ H0 }),
    shown: (c) => c.fold,
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
  { id: "held", label: "held", kind: "readout", meta: "0 to 1" },
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
];

// ---- page state ------------------------------------------------------------------------------------

/** The page's state, as the URL hash holds it: `v`, `preset`, `speed`, `reduced`, and one entry per setting key. */
export type Opt = Record<string, string>;
export const SETTING_KEYS: readonly string[] = [
  ...SETTINGS.map((s) => s.key),
  ...CASCADE_SETTINGS.map((s) => s.key),
];
const OPT_KEYS = new Set(["v", "preset", "speed", "reduced", ...SETTING_KEYS]);

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

/** The part of a page configuration the cascade model reads. */
export function modelCfg({ fade, ...model }: CascadeCfg): CascadeConfig {
  return model;
}
