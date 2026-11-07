/**
 * Every control on the lab page, as data with no DOM. The page draws its bars from these lists, `help.ts` must
 * hold one entry for each id in `CONTROLS` and no other (`verify.ts` and `npm run smoke` check it), and
 * `drumCfg` turns the page's state into a drum configuration.
 */
// @ts-ignore: plain JS model, shared with the headless sims
import { Drum, PRESETS } from "./drum.mjs";

export const TAU = 2 * Math.PI;
/** How long the new front card fades in under reduced motion, ms. */
export const FADE_MS = 160;

export type Mode = "product" | "drum";
export const MODES: readonly { id: Mode; label: string }[] = [
  { id: "product", label: "Product now" },
  { id: "drum", label: "Elastic drum" },
];
export const SPEEDS: readonly { id: string; label: string }[] = [
  { id: "0.25", label: "¼×" },
  { id: "0.5", label: "½×" },
  { id: "1", label: "1×" },
];
export const PRESET_NAMES: string[] = Object.keys(PRESETS);

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

export const GROUPS = [
  { id: "taps", label: "Taps" },
  { id: "pace", label: "Pace" },
  { id: "held", label: "Held keys" },
] as const;
export type GroupId = (typeof GROUPS)[number]["id"];

type Base = {
  /** The setting's short name: its key in the URL hash and in `sim/sweep.mjs`. */
  key: string;
  group: GroupId;
  label: string;
  /** Whether the setting changes anything under this configuration; a setting that does not is hidden. */
  shown: (c: Cfg) => boolean;
};
export type Setting =
  | (Base & {
      kind: "range";
      unit: string;
      min: number;
      max: number;
      step: number;
      read: (c: Cfg) => number;
      write: (v: number) => Patch;
    })
  | (Base & {
      kind: "toggle";
      read: (c: Cfg) => boolean;
      write: (on: boolean) => Patch;
    })
  | (Base & {
      kind: "select";
      options: readonly string[];
      read: (c: Cfg) => string;
      write: (v: string) => Patch;
    });

const always = () => true;
const heldState = (c: Cfg) => c.fold || c.ramp;

export const SETTINGS: readonly Setting[] = [
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

/** One control a tooltip can describe: the id the page puts in `data-help`, its name, kind, and range. */
export type Control = { id: string; label: string; kind: string; meta: string };

const round = (v: number) => Math.round(v * 1000) / 1000;
/** The setting's value in a configuration with nothing overridden. */
export const defaultOf = <S extends Setting>(s: S) =>
  s.read(Drum.config()) as ReturnType<S["read"]>;

function describeSetting(s: Setting): Control {
  const id = `setting.${s.key}`;
  if (s.kind === "range") {
    const unit = s.unit ? ` ${s.unit}` : "";
    return {
      id,
      label: s.label,
      kind: "slider",
      meta: `${s.min}–${s.max}${unit}, default ${round(defaultOf(s))}${unit}`,
    };
  }
  if (s.kind === "toggle")
    return {
      id,
      label: s.label,
      kind: "toggle",
      meta: `default ${defaultOf(s) ? "on" : "off"}`,
    };
  return {
    id,
    label: s.label,
    kind: "choice",
    meta: `${s.options.join(", ")}; default ${defaultOf(s)}`,
  };
}

/** Every control the page can draw, in page order. */
export const CONTROLS: readonly Control[] = [
  ...MODES.map((m) => ({
    id: `model.${m.id}`,
    label: m.label,
    kind: "model",
    meta: "button",
  })),
  ...PRESET_NAMES.map((p) => ({
    id: `preset.${p}`,
    label: p,
    kind: "preset",
    meta: "button",
  })),
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
  ...SETTINGS.map(describeSetting),
];

// ---- page state ------------------------------------------------------------------------------------

/** The page's state, as the URL hash holds it: `v`, `preset`, `speed`, `reduced`, and one entry per setting key. */
export type Opt = Record<string, string>;
const OPT_KEYS = new Set([
  "v",
  "preset",
  "speed",
  "reduced",
  ...SETTINGS.map((s) => s.key),
]);
export const SETTING_KEYS: readonly string[] = SETTINGS.map((s) => s.key);

/** The known keys of a URL hash; anything else is dropped. */
export function parseOpt(hash: string): Opt {
  const out: Opt = {};
  for (const [k, v] of new URLSearchParams(hash.replace(/^#/, "")))
    if (OPT_KEYS.has(k)) out[k] = v;
  return out;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
function patchFor(s: Setting, raw: string): Patch | null {
  if (s.kind === "toggle")
    return raw === "1" ? s.write(true) : raw === "0" ? s.write(false) : null;
  if (s.kind === "select") return s.options.includes(raw) ? s.write(raw) : null;
  const v = Number(raw);
  return raw !== "" && Number.isFinite(v)
    ? s.write(clamp(v, s.min, s.max))
    : null;
}

/** The preset's configuration with every setting the state overrides. */
export function drumCfg(opt: Opt): Cfg {
  const base: Cfg = Drum.config(PRESETS[opt.preset]);
  const over: Patch = {};
  for (const s of SETTINGS) {
    const raw = opt[s.key];
    if (raw === undefined) continue;
    const p = patchFor(s, raw);
    if (p) Object.assign(over, { ...p, tempo: { ...over.tempo, ...p.tempo } });
  }
  return Drum.config({
    ...base,
    ...over,
    tempo: { ...base.tempo, ...over.tempo },
  });
}
