/**
 * The measured numbers the tooltips quote. `build.mjs` runs the sweeps (`computeFacts` in `sim/sweep.mjs`) and
 * hands the result to the page as `__FACTS__`. Every figure in `help.ts` goes through the `Facts` view below,
 * which formats it, records the command that prints it, and throws for a figure nobody measured, so a tooltip
 * cannot quote a number the sims do not produce. `t` rejects a digit typed into the text.
 */
import { defaultOf } from "./controls.ts";

type Kinds = Record<"jump" | "band" | "shade" | "swap", number>;
/** The model a sweep or preset row was measured on. */
export type ModelName = "drum" | "cascade";
/** One measured value of one setting; see `measure` in `sim/sweep.mjs`. Tap fields are null for held-only settings. */
export type Row = {
  value: number;
  upLand: number | null;
  dnLand: number | null;
  landSpeed: number | null;
  heldUp: number;
  heldDn: number;
  ivMin: number;
  ivMax: number;
  step: number;
  heldJump: number;
  problems: number;
  kinds: Kinds;
  /** The most cards in front of the pile at once in a hold. */
  channel: number;
  /** The fewest frames any card shows at least min(height, 100) px in a hold. */
  framesMin: number;
  /** The median, over the cards a hold passes, of the most px of a card no nearer card covers. */
  visible: number;
  /** How far the held pace differs between the three height sets: highest over lowest, minus one. */
  spread: number;
};
export type Sweep = {
  id: string;
  model: ModelName;
  label: string;
  context: string;
  def: number;
  taps: boolean;
  rows: Row[];
};
export type PresetRow = {
  name: string;
  model: ModelName;
  /** How far the held pace differs between the three height sets: highest over lowest, minus one. */
  spread: number;
  heldUp: number;
  heldDn: number;
  ivMin: number;
  ivMax: number;
  step: number;
  heldJump: number;
  problems: { taps: number; holds: number; reversals: number };
  tapUp: number;
  tapDn: number;
  landSpeed: number;
};
export type TapRow = { delay: number; peaks: { ms: number; peak: number }[] };
export type RawFacts = {
  hz: number;
  limits: { jump: number; band: number; shade: number };
  /** The rule for a card in a hold to count as shown: this many px of it uncovered for this many frames. */
  shown: { px: number; frames: number };
  cards: { min: number; max: number };
  estimate: { short: number; tall: number };
  rise: { to: number; ms: number };
  presets: PresetRow[];
  sweeps: Sweep[];
  taps: TapRow[];
};

const n0 = (x: number) => String(Math.round(x));
const n1 = (x: number) => x.toFixed(1);
const n2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
/** The held pace as one figure; a tooltip that quotes one pace for ↑ and ↓ fails the build when they stop matching. */
const onePace = (up: number, down: number) => {
  if (up !== down)
    throw new Error(
      `held ↑ (${n1(up)}) and ↓ (${n1(down)}) differ, so there is no single pace to quote`,
    );
  return n1(up);
};
const num = (x: number | null, what: string): number => {
  if (x === null) throw new Error(`${what} was not measured for this setting`);
  return x;
};
/** The frame checker's four kinds of problem, in the words a tooltip uses. */
const KIND_WORDS: Record<keyof Kinds, [one: string, many: string]> = {
  jump: ["jump", "jumps"],
  band: ["edge flash", "edge flashes"],
  shade: ["fade flicker", "fade flickers"],
  swap: ["swap", "swaps"],
};
const countKind = (kind: keyof Kinds, n: number) =>
  `${n} ${KIND_WORDS[kind][n === 1 ? 0 : 1]}`;
/** "clean", "2 swaps", or "7 problems: 2 jumps, 1 edge flash, 4 swaps". */
const verdict = (n: number, k: Kinds) => {
  if (n === 0) return "clean";
  const named = (Object.keys(KIND_WORDS) as (keyof Kinds)[]).filter(
    (x) => k[x],
  );
  if (named.length === 1) return countKind(named[0]!, n);
  return `${n} problems: ${named.map((x) => countKind(x, k[x])).join(", ")}`;
};

/** One measured row, every figure as text. */
export class RowView {
  readonly raw: Row;
  constructor(raw: Row) {
    this.raw = raw;
  }
  get value() {
    return String(this.raw.value);
  }
  /** Tap ↑ landing time, ms. */
  get upLand() {
    return n0(num(this.raw.upLand, "tap ↑ landing"));
  }
  /** Tap ↓ settling time, ms. */
  get dnLand() {
    return n0(num(this.raw.dnLand, "tap ↓ settling"));
  }
  /** Edge speed in the last five frames of a landing, px/frame. */
  get landSpeed() {
    return n1(num(this.raw.landSpeed, "landing speed"));
  }
  get heldUp() {
    return n1(this.raw.heldUp);
  }
  get heldDn() {
    return n1(this.raw.heldDn);
  }
  /** Held pace, cards/s, ↑ then ↓. */
  get pace() {
    return `${this.heldUp} / ${this.heldDn}`;
  }
  /** Held pace, cards/s, for a model that holds ↑ and ↓ at one pace; throws when the two differ. */
  get onePace() {
    return onePace(this.raw.heldUp, this.raw.heldDn);
  }
  /** Shortest and longest interval between cards in a hold, ms. */
  get range() {
    return `${n0(this.raw.ivMin)}–${n0(this.raw.ivMax)}`;
  }
  get ivMax() {
    return n0(this.raw.ivMax);
  }
  /** The largest ratio between two consecutive intervals. */
  get step() {
    return n2(this.raw.step);
  }
  /** The largest edge move in a hold, px/frame. */
  get jump() {
    return n0(this.raw.heldJump);
  }
  get problems() {
    return String(this.raw.problems);
  }
  /** "clean", or the count and the kinds of problem. */
  get verdict() {
    return verdict(this.raw.problems, this.raw.kinds);
  }
  get clean() {
    return this.raw.problems === 0;
  }
  /** The most cards in front of the pile at once. */
  get channel() {
    return n0(this.raw.channel);
  }
  /** The fewest frames a card shows at least min(height, 100) px. */
  get frames() {
    return n0(this.raw.framesMin);
  }
  /** The median px a card shows at its best. */
  get visible() {
    return n0(this.raw.visible);
  }
  /** How far the held pace differs between height sets, as a percentage. */
  get spread() {
    return pct(this.raw.spread);
  }
}

export class SweepView {
  readonly sweep: Sweep;
  private readonly rows: RowView[];
  constructor(sweep: Sweep) {
    this.sweep = sweep;
    this.rows = sweep.rows.map((r) => new RowView(r));
  }
  /** The measured row at `value`; a value the sweep skipped is an error. */
  at(value: number): RowView {
    const row = this.rows.find((r) => r.raw.value === value);
    if (!row)
      throw new Error(
        `${this.sweep.label} on ${this.sweep.context} was not measured at ${value}`,
      );
    return row;
  }
  /** The row at the value the sweep's context starts from. */
  get start(): RowView {
    return this.at(this.sweep.def);
  }
}

export class PresetView {
  readonly raw: PresetRow;
  constructor(raw: PresetRow) {
    this.raw = raw;
  }
  get heldUp() {
    return n1(this.raw.heldUp);
  }
  get heldDn() {
    return n1(this.raw.heldDn);
  }
  get pace() {
    return `${this.heldUp} / ${this.heldDn}`;
  }
  /** Held pace, cards/s, for a model that holds ↑ and ↓ at one pace; throws when the two differ. */
  get onePace() {
    return onePace(this.raw.heldUp, this.raw.heldDn);
  }
  get range() {
    return `${n0(this.raw.ivMin)}–${n0(this.raw.ivMax)}`;
  }
  get step() {
    return n2(this.raw.step);
  }
  get jump() {
    return n0(this.raw.heldJump);
  }
  get tapUp() {
    return n0(this.raw.tapUp);
  }
  get tapDn() {
    return n0(this.raw.tapDn);
  }
  get landSpeed() {
    return n1(this.raw.landSpeed);
  }
  /** How far the held pace differs between height sets, as a percentage. */
  get spread() {
    return pct(this.raw.spread);
  }
  get clean() {
    const p = this.raw.problems;
    return p.taps + p.holds + p.reversals === 0;
  }
  /** "0 / 0 / 0": problems in taps, holds and reversals. */
  get problems() {
    const p = this.raw.problems;
    return `${p.taps} / ${p.holds} / ${p.reversals}`;
  }
}

const COMMANDS = {
  params: "npm run sweep -- params",
  cascadeParams: "npm run sweep -- params cascade",
  presets: "npm run sweep -- presets",
  cascadePresets: "npm run sweep -- presets cascade",
  held: "npm run sweep -- held",
  limits: "npm run sweep -- limits",
  cascadeLimits: "npm run sweep -- limits cascade",
} as const;

export class Facts {
  private readonly raw: RawFacts;
  private readonly cited = new Map<string, Set<string>>();
  constructor(raw: RawFacts) {
    this.raw = raw;
  }
  private cite(command: keyof typeof COMMANDS, detail?: string) {
    const set = this.cited.get(COMMANDS[command]) ?? new Set<string>();
    if (detail) set.add(detail);
    this.cited.set(COMMANDS[command], set);
  }

  /** The checker's thresholds: an edge moving more than `jump` px in a frame, a bottom edge changing by more than `band` px, a shade by more than `shade`. */
  get limit() {
    this.cite("limits");
    const l = this.raw.limits;
    return {
      jump: String(l.jump),
      band: String(l.band),
      shade: String(l.shade),
    };
  }
  /** A card in a hold counts as shown when it has `px` px (or all of it, if shorter) that no nearer card covers, for `frames` frames. */
  get shown() {
    this.cite("cascadeLimits");
    return { px: n0(this.raw.shown.px), frames: n0(this.raw.shown.frames) };
  }
  /** The refresh rate of every sweep. */
  get hz() {
    this.cite("limits");
    return String(this.raw.hz);
  }
  /** The shortest and tallest sample card, px. */
  get cards() {
    this.cite("limits");
    return { min: n0(this.raw.cards.min), max: n0(this.raw.cards.max) };
  }
  /** The lookahead planner's estimated clear time at scale 1, ms, for the shortest and tallest card. */
  get estimate() {
    this.cite("limits");
    return {
      short: n0(this.raw.estimate.short),
      tall: n0(this.raw.estimate.tall),
    };
  }
  /** The held state's ramp-in: the level (0 to 1) waited for, and the seconds from the end of the hold delay until it is reached. */
  get rise() {
    this.cite("held");
    return {
      level: n2(this.raw.rise.to),
      seconds: n1(this.raw.rise.ms / 1000),
    };
  }

  /** A slider's value with nothing overridden, as the page shows it. */
  def(key: string): string {
    return String(Math.round(defaultOf(key) * 1000) / 1000);
  }

  preset(name: string): PresetView {
    const row = this.raw.presets.find((p) => p.name === name);
    if (!row) throw new Error(`preset ${name} was not measured`);
    this.cite(row.model === "cascade" ? "cascadePresets" : "presets");
    return new PresetView(row);
  }

  /** A setting's sweep. `context` is required when the setting was swept on more than one. */
  sweep(id: string, context?: string): SweepView {
    const all = this.raw.sweeps.filter((s) => s.id === id);
    const found = context ? all.find((s) => s.context === context) : all[0];
    if (!found || (!context && all.length > 1))
      throw new Error(
        `no single sweep of ${id}${context ? ` on ${context}` : ""}; measured on: ${all.map((s) => s.context).join(", ") || "nothing"}`,
      );
    this.cite(
      found.model === "cascade" ? "cascadeParams" : "params",
      `${found.label} on ${found.context}`,
    );
    return new SweepView(found);
  }

  /** A tap of `ms` ms on `fold`: the peak held state (0 to 1) it reaches for a given hold delay. */
  tap(ms: number) {
    this.cite("held");
    return {
      ms: String(ms),
      peak: (delay: number) => {
        const peak = this.raw.taps
          .find((r) => r.delay === delay)
          ?.peaks.find((p) => p.ms === ms)?.peak;
        if (peak === undefined)
          throw new Error(
            `a ${ms} ms tap was not measured at a hold delay of ${delay}`,
          );
        return { delay: String(delay), peak: n2(peak), raw: peak };
      },
    };
  }

  /** Throws when a claim the text makes no longer holds for the measured numbers. */
  expect(ok: boolean, claim: string) {
    if (!ok)
      throw new Error(
        `a tooltip says "${claim}", but the sweeps do not show it`,
      );
  }

  /** The commands behind every figure read so far, one line each. */
  sources(): string[] {
    return [...this.cited].map(([command, details]) =>
      details.size
        ? `\`${command}\`: ${[...details].join("; ")}`
        : `\`${command}\``,
    );
  }
}

/**
 * Template tag for help text. The static text may not contain a digit: a number comes from `Facts`, from a
 * setting's default, or from a named constant, so it moves when the model does.
 */
export function t(strings: TemplateStringsArray, ...values: unknown[]): string {
  strings.forEach((s) => {
    if (/\d/.test(s))
      throw new Error(`help text has a typed number: "${s.trim()}"`);
  });
  return strings.reduce(
    (out, s, i) => out + s + (i < values.length ? String(values[i]) : ""),
    "",
  );
}
