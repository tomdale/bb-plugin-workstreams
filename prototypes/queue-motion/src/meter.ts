/**
 * The Measured module's numbers, taken from the page's own frames: the pace of the last hold each way, the last
 * tap's landing each way, and the frame checker over the last run. It applies the sims' own functions
 * (`problems` and `maxJump` from sim/check.mjs, `landFrame`, `landingSpeed` and `channelPeak` from
 * sim/lib.mjs) to what the page draws, so a number here that disagrees with the sweeps is a finding about the
 * page (its real key repeat and frame clock) rather than a second definition of the measure. The sims remain
 * the reference.
 *
 * A run starts with the first press while nothing moves and ends once the model is at rest with no key down.
 * One card moved makes it a tap; more make it a hold. The page steps its models at its own frame rate and
 * speed, so the meter records a frame once at least about 1/60 s of page clock has passed since the last one:
 * the checker's per-frame limits and the landing speed then read per 1/60 s, as in the sims, at any display
 * rate and at ¼× or ½×.
 */
// @ts-ignore: plain JS, shared with the sims
import { maxJump, problems, summarize } from "../sim/check.mjs";
// @ts-ignore: plain JS, shared with the sims
import { channelPeak, landFrame, landingSpeed } from "../sim/lib.mjs";

/** A card as the frame checker reads it. `group` 0 is in front of the pile (the cascade's channel). */
export type CheckView = {
  key: string;
  painted: boolean;
  layer: number;
  scale: number;
  top: number;
  bottom: number;
  natBottom: number;
  shade: number;
  group?: number;
};
type Dir = 1 | -1;
type Kinds = Record<"jump" | "band" | "shade" | "swap", number>;

/** The sims' frame, ms; a recorded frame is at least `MIN_GAP` of page clock after the last. */
const FRAME = 1000 / 60;
const MIN_GAP = FRAME - 2;
/** A run longer than this many recorded frames keeps counting problems but stops keeping frames for landing. */
const MAX_FRAMES = 3600;

export type HoldResult = {
  dir: Dir;
  cards: number;
  /** Mean cards/s over the hold's intervals. */
  rate: number;
  ivMin: number;
  ivMax: number;
  /** The largest ratio between two consecutive intervals; 1 with a single interval. */
  step: number;
};
export type TapResult = { dir: Dir; land: number; speed: number };
export type CheckResult = {
  frames: number;
  problems: number;
  kinds: Kinds;
  /** The card and the time into the run of the last problem. */
  last: { key: string; t: number } | null;
  /** The most cards painted in front of the pile at once. */
  channel: number;
  /** The largest move of a painted edge between two recorded frames, px. */
  jump: number;
};

type Run = {
  t0: number;
  dir: Dir;
  frames: CheckView[][];
  times: number[];
  /** Page-clock times at which the front moved in the run's direction. */
  changes: number[];
  /** The key of the front card after the last move. */
  frontKey: string;
  lastSample: number;
  prev: CheckView[];
};

const arrow = (d: Dir) => (d > 0 ? "↓" : "↑");
const KIND_WORDS: Record<keyof Kinds, [string, string]> = {
  jump: ["jump", "jumps"],
  band: ["edge flash", "edge flashes"],
  shade: ["fade flicker", "fade flickers"],
  swap: ["swap", "swaps"],
};
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function holdOf(dir: Dir, changes: number[]): HoldResult | null {
  if (changes.length < 2) return null;
  const iv = changes.slice(1).map((t, k) => t - changes[k]!);
  const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
  let step = 1;
  for (let k = 1; k < iv.length; k++)
    step = Math.max(step, iv[k]! / iv[k - 1]!, iv[k - 1]! / iv[k]!);
  return {
    dir,
    cards: changes.length,
    rate: 1000 / mean,
    ivMin: Math.min(...iv),
    ivMax: Math.max(...iv),
    step,
  };
}

export class Meter {
  hold: Partial<Record<Dir, HoldResult>> = {};
  /** The direction of the latest hold, 0 before any. */
  lastHold: Dir | 0 = 0;
  tap: Partial<Record<Dir, TapResult>> = {};
  check: CheckResult | null = null;
  private run: Run | null = null;

  get active() {
    return this.run !== null;
  }

  /** Forgets every result: the configuration or the cards changed, so they no longer describe what runs. */
  clear() {
    this.hold = {};
    this.lastHold = 0;
    this.tap = {};
    this.check = null;
    this.run = null;
  }

  /** A press has been taken or a key went down at page time `t`; `frame` is the state just after it. */
  press(t: number, dir: Dir, frame: CheckView[]) {
    if (this.run) return;
    this.run = {
      t0: t,
      dir,
      frames: [frame],
      times: [t],
      changes: [],
      frontKey: "",
      lastSample: t,
      prev: frame,
    };
    this.check = {
      frames: 1,
      problems: 0,
      kinds: { jump: 0, band: 0, shade: 0, swap: 0 },
      last: null,
      channel: channelPeak([frame]),
      jump: 0,
    };
  }

  /** The front moved to card `front` (its key `key`) in direction `dir` at page time `t`. */
  moved(t: number, dir: Dir, key: string) {
    const r = this.run;
    if (!r) return;
    r.frontKey = key;
    if (dir !== r.dir) return;
    r.changes.push(t);
    const h = holdOf(r.dir, r.changes);
    if (h) {
      this.hold[r.dir] = h;
      this.lastHold = r.dir;
    }
  }

  /** The page stepped to time `t`; records `frame` when a sims' frame has passed since the last one. */
  sample(t: number, frame: () => CheckView[]) {
    const r = this.run;
    if (!r || t - r.lastSample < MIN_GAP) return;
    const cur = frame();
    const c = this.check!;
    const found = problems([r.prev, cur], "corrected");
    if (found.length) {
      const k = summarize(found) as Kinds;
      for (const kind of Object.keys(k) as (keyof Kinds)[])
        c.kinds[kind] += k[kind];
      c.problems += found.length;
      c.last = { key: String(found.at(-1).key), t: t - r.t0 };
    }
    c.frames++;
    c.jump = Math.max(c.jump, maxJump([r.prev, cur]));
    c.channel = Math.max(c.channel, channelPeak([cur]));
    if (r.frames.length < MAX_FRAMES) {
      r.frames.push(cur);
      r.times.push(t);
    }
    r.prev = cur;
    r.lastSample = t;
  }

  /** The model is at rest with no key down: a run of one card is a tap, and its landing is measured. */
  end() {
    const r = this.run;
    this.run = null;
    if (!r || r.changes.length !== 1 || !r.frontKey) return;
    // The product engine draws only a short row of cards, so a card coming back joins the frames after the press.
    const track = r.frames.map((f) => f.find((v) => v.key === r.frontKey));
    const from = track.findIndex((v) => v);
    if (from < 0 || track.slice(from).some((v) => !v)) return;
    const one = track.slice(from).map((v) => [v]);
    const n = landFrame(one, 0);
    if (n < 0) return;
    this.tap[r.dir] = {
      dir: r.dir,
      land: r.times[from + n]! - r.t0,
      speed: landingSpeed(one, 0, n),
    };
  }

  // ---- the Measured module's lines ---------------------------------------------------------------------

  paceText(): string {
    const h = this.lastHold ? this.hold[this.lastHold] : undefined;
    if (!h) return "No hold yet.";
    const steps =
      h.cards > 2
        ? `Steps ${Math.round(h.ivMin)} to ${Math.round(h.ivMax)} ms, worst change ${h.step.toFixed(2)}×.`
        : `One step of ${Math.round(h.ivMin)} ms.`;
    return `${arrow(h.dir)} ${h.rate.toFixed(1)} cards/s over ${h.cards} cards. ${steps}`;
  }

  /** The direction the `last` line reports: the other way from the latest hold. */
  otherDir(): Dir {
    return this.lastHold === 1 ? -1 : 1;
  }

  lastText(): string {
    const d = this.otherDir();
    const h = this.hold[d];
    return h
      ? `${arrow(d)} ${h.rate.toFixed(1)} cards/s over ${h.cards} cards.`
      : `No hold ${arrow(d)} yet.`;
  }

  tapText(): string {
    const up = this.tap[-1],
      dn = this.tap[1];
    if (!up && !dn) return "No tap yet.";
    const parts = [
      up ? `↑ lands in ${Math.round(up.land)} ms` : "no tap ↑ yet",
      dn ? `↓ settles in ${Math.round(dn.land)} ms` : "no tap ↓ yet",
    ];
    const speed = Math.max(up?.speed ?? 0, dn?.speed ?? 0);
    const text = parts.join(", ");
    return `${text[0]!.toUpperCase()}${text.slice(1)}. Landing ${speed.toFixed(1)} px/frame.`;
  }

  /** `channel` adds the cards in front of the pile, which only the cascade has. */
  checkerText(channel: boolean): string {
    const c = this.check;
    if (!c) return "No run yet.";
    let text = `${plural(c.problems, "problem", "problems")} in ${c.frames} frames`;
    if (c.problems) {
      const kinds = (Object.keys(KIND_WORDS) as (keyof Kinds)[])
        .filter((k) => c.kinds[k])
        .map((k) => plural(c.kinds[k], ...KIND_WORDS[k]));
      text += `: ${kinds.join(", ")}.`;
      if (c.last) {
        const card = Number(c.last.key.split("/")[0]!.slice(1)) + 1;
        text += ` The last on card ${card}, ${(c.last.t / 1000).toFixed(2)} s in.`;
      }
    } else text += ".";
    text += ` Largest edge move ${Math.round(c.jump)} px/frame.`;
    if (channel)
      text += ` At most ${plural(c.channel, "card", "cards")} in front of the pile.`;
    return text;
  }
}
