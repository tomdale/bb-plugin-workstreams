/**
 * The elastic drum: a model of the queue's card stack in which every card has one coordinate on a single
 * closed ring path, and one critically damped spring along it.
 *
 * Ring coordinate `c` of card `i`:
 *   c ≥ 0        pile slot (0 front, 1–2 peeking above the front card, 3 hidden behind it)
 *   −1 < c < 0   FRONT segment: in front of the pile, from the front pose down to the TURN pose below it
 *   −2 ≤ c ≤ −1  BEHIND segment: behind the pile, from the turn pose up to the TUCK pose (flush, hidden)
 *   c ≤ −2       parked, hidden
 *
 * Keys move one integer, `front`. Each card's spring target is a pure function of `(i, front)`:
 *   i ≥ front: i − front          (the pile)
 *   i <  front: i − front − 1     (parked: a leaver's target is two units away, so it passes the turn still
 *                                  moving and decelerates into the tuck; a returning card runs the same ring
 *                                  backwards)
 * `c = −1` is the one place draw order changes, and a card crosses it only when it is clear of everything it
 * swaps with; otherwise its target is held at −1 and it waits at the turn. Cards never pass through each
 * other because of that single guarded crossing.
 *
 * What sets the pace:
 * - A press is taken once every card in transit has passed its flip (`accepts`), so the rate is whatever the
 *   trips allow: a trip must clear the height of the card it uncovers, at no more than `vcap` px/s on any edge.
 * - `tempo` spaces presses by a planned interval, so the pace does not follow each card's height from step to
 *   step. `holdBeats` is a schedule for a held key: each stage sets the least interval once the key has been held
 *   for its `after` ms, and the beat glides to the next stage over `BEAT_TAU`, so a long hold tightens rather
 *   than snapping. Single presses are not held to it.
 * - `ramp` stiffens the springs and raises the edge budget while a key is held. `fold` does the same and also
 *   shrinks every card's drawn height toward `H0` (a level of detail), which removes the height term.
 * - `loose` leaves every card drawn whole but measures the clearing geometry with heights that shrink toward `H0`
 *   as a key is held, as `fold` does. A leaving card then drops only as far as it would clear a folded card, so
 *   it passes over the card it uncovers instead of around it, and washes out as it does. The speed-up comes with it.
 * - A hold only starts, and only folds, while another card lies ahead in its direction.
 * - One press may wait for the gate; any further press before it is taken is dropped, so a release rests on a
 *   whole card with at most one more card after it.
 */
export const LEAD = 34;
const P = 1000,
  DY = 10,
  DZ = 52,
  VIS = 3,
  ZDROP = 170,
  HIDE_Y = 4,
  GAP = 16;
const sc = (z: number) => P / (P - z);
const S0 = sc(-ZDROP);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const smooth = (u: number) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};
const TAU = 2 * Math.PI;
/** Spring rate of λ, the held state: how fast the speed-up and the fold ramp in once the hold delay has passed. */
const LAMBDA_OMEGA = TAU * 1.6;
/** Extra travel below the clear line, px: the visible dip of a returning card. It shrinks to `DIP_HELD` as λ → 1. */
const DIP_TAP = 20;
const DIP_HELD = 6;
/** How far a leaving card washes out at the turn when `loose` lets it pass over the card it uncovers, at λ = 1. */
/** Time constant, ms, of the covered card's fade in and out: a fade that follows its target cannot jump when the target does. */
/** The most a card's shade along its path may change per second, 1/s, when it is not coming back: at 60 Hz that is 0.175 a frame, under the checker's 0.2. */
const PATH_RATE = 10.5;
/** The fastest the drawn bottom of the cards behind the front card may shrink, px per second: 12 px a frame at 60 Hz, under the checker's 16. */
const SHRINK_RATE = 720;
const COVER_TAU = 50;
/** The content of a card moving into the front comes back faster than it goes, ms: a card that is nearly in front must not be empty. */
const CONTENT_BACK_TAU = 20;
/** Time constant, ms, of a held key's beat as it glides from one stage of `holdBeats` to the next. */
const BEAT_TAU = 70;
/** How much of the rising card's way from the tuck to the front it takes for the covered card's fade to reach its target. */
const COVER_RISE = 0.35;
const LOOSE_WASH = 0.6;

/** The interval planner's settings; see `DEFAULT_CFG`. */
export type Tempo = {
  kind: "none" | "constant" | "lookahead";
  ms: number;
  window: number;
  a: number;
  b: number;
  scale: number;
};

/** One stage of a held key's beat: `beat` ms between presses once the key has been held for `after` ms. */
export type HoldBeat = { after: number; beat: number };

/** Every setting of a drum. */
export type DrumConfig = {
  omega0: number;
  omega1: number;
  vcap: number;
  vcap1: number;
  fold: boolean;
  loose: boolean;
  ramp: boolean;
  H0: number;
  holdDelay: number;
  holdBeats: readonly HoldBeat[];
  coverFade: number;
  incomingFade: number;
  washTauIn: number;
  washTauOut: number;
  hidePx: number;
  tuckRate: number;
  tempo: Tempo;
};

/** A setting overlay: any field, with `tempo` given field by field. */
export type DrumPatch = Partial<Omit<DrumConfig, "tempo">> & {
  tempo?: Partial<Tempo>;
};

/** What the page draws for one card; see `Drum.views`. */
export type DrumView = {
  key: string;
  i: number;
  c: number;
  painted: boolean;
  layer: number;
  scale: number;
  y: number;
  h: number;
  top: number;
  bottom: number;
  /** The bottom the card is heading for; `bottom` follows it at a limited rate. */
  targetBottom: number;
  natBottom: number;
  shade: number;
  /** The opacity of the card's content, 0 to 1; its frame and background keep their shade. */
  content: number;
  group: number;
  interactive: boolean;
};

type Pose = {
  y: number;
  z: number;
  shade: number;
  group: number;
  painted: boolean;
  g: number;
};

export const DEFAULT_CFG: DrumConfig = {
  omega0: TAU * 3.0, // spring rate at λ = 0 (taps), rad/s
  omega1: TAU * 4.5, // at λ = 1 (held, when `ramp` or `fold` is on)
  vcap: 1440, // edge-speed budget at λ = 0, px/s (24 px/frame at 60 Hz); 0 = off
  vcap1: 1800, // at λ = 1 (30 px/frame)
  fold: false, // while held, fold every card toward H0 (level of detail)
  loose: false, // while held, clear a virtual height that shrinks toward H0, with every card still drawn whole
  ramp: false, // while held, ramp the spring rate and edge budget toward their λ = 1 values without folding
  H0: 73, // folded (header) height, or the virtual height `loose` clears, px
  holdDelay: 250, // ms a key is held before λ heads to 1
  holdBeats: [], // the beat a held key keeps, stage by stage; none leaves the pace to `tempo` and the gate
  incomingFade: 8, // how fast, in shade per second, a card coming back (a ↑) regains its colour from the moment it starts; 0 lets it follow its path
  coverFade: 1, // how far the content of a card a rising card is about to cover fades before the rising card reaches it, 0 to 1
  washTauIn: 40, // ms: the drawn wash of a too-tall card follows its path value, falling
  washTauOut: 120, // and rising
  hidePx: 3, // the tuck ends with the card's bottom this far inside the pile's lower edge
  tuckRate: 1.4, // the tuck (behind the pile, heading home) runs on a stiffer spring
  // Interval planner. kind "none": the flip gate alone. "constant": at least `ms` between presses.
  // "lookahead": the smoothed slowest estimated clear time among the `window` cards on each side of the one
  // being covered, where a card of height h takes `scale × (a + b·h)` ms.
  tempo: { kind: "none", ms: 285, window: 2, a: 60, b: 0.62, scale: 1 },
};

/** The queue's selected natural drum configuration, overlaid on the natural preset defaults. */
export const QUEUE_CFG: DrumPatch = {
  ramp: true,
  loose: true,
  vcap: 44 * 60,
  coverFade: 0.25,
  // A held key starts at about 6 cards a second and, after 1.2 s, tightens to about 9.
  holdBeats: [
    { after: 0, beat: 167 },
    { after: 1200, beat: 111 },
  ],
  tempo: { kind: "constant", ms: 120 },
};

/** Named settings the page and the sweeps share. Each overlays DEFAULT_CFG. */
export const PRESETS: Record<string, DrumPatch> = {
  /** What the queue ships with, so the sweeps and the checks measure it with the rest. */
  shipped: QUEUE_CFG,
  /** The defaults: the pace follows the card heights. */
  natural: {},
  /** A planned interval between presses, so the pace changes gently. */
  even: { tempo: { kind: "lookahead", window: 2, scale: 1 } },
  /** The same planner at a shorter interval, which the held speed-up makes possible. */
  "even + held speed": {
    ramp: true,
    tempo: { kind: "lookahead", window: 2, scale: 0.85 },
  },
  /** Every card folds toward its header line while a key is held. */
  fold: { fold: true },
  /** Cards stay whole, but a held key clears a virtual height, so cards pass over one another. */
  loose: { loose: true, tempo: { kind: "constant", ms: 100 } },
};

export class Drum {
  /** DEFAULT_CFG overlaid with `cfg`, merging `tempo` field by field. */
  static config(cfg: DrumPatch = {}): DrumConfig {
    return {
      ...DEFAULT_CFG,
      ...cfg,
      tempo: { ...DEFAULT_CFG.tempo, ...(cfg.tempo ?? {}) },
    };
  }
  h: number[];
  N: number;
  cfg: DrumConfig;
  front = 0;
  c: number[];
  v: number[];
  /** The drawn wash of each too-tall card (lagged). */
  g: number[];
  /**
   * How much of each card's height, px, is trimmed from its drawn bottom, at a limited rate (`SHRINK_RATE`) so the
   * edge never jumps: a card the front card is rising over shrinks to the height it has under the front card
   * and the card behind a front card that is leaving grows back. NaN until the first step sets it.
   */
  trim: number[];
  /** The fade of each card's content, 0 (whole) to 1 (gone), lagged; see `contentTarget`. */
  cf: number[];
  /** The shade along the path off the pile of each card, as drawn: it follows `pathShade` at a limited rate of change. */
  ps: number[];
  /** The held state, 0 to 1. */
  lam = 0;
  lamV = 0;
  hold: { dir: 1 | -1; t: number } | null = null;
  /** The beat a held key is keeping now, ms, gliding toward whichever stage of `holdBeats` the hold has reached. */
  hb = 0;
  /** Whether the key was held at the last step, so a new hold starts at its stage's beat rather than gliding. */
  wasHeld = false;
  /** The one press that may wait for the gate, signed by direction. */
  pending = 0;
  time = 0;
  /** Time the last press was taken. */
  lastTake = -1e9;
  /**
   * Whether the queue goes on past the first or last card. A hold stops where the queue ends, and a drum
   * that holds only a window of a long queue says it does not end at its own edge.
   */
  more = { before: false, after: false };
  constructor(heights: number[], cfg: DrumPatch = {}) {
    this.h = heights.slice();
    this.N = heights.length;
    this.cfg = Drum.config(cfg);
    this.c = heights.map((_, i) => i); // settled at front = 0
    this.v = heights.map(() => 0);
    this.g = heights.map(() => 0);
    this.ps = heights.map(() => 0);
    this.trim = heights.map(() => NaN);
    this.cf = heights.map((_, i) => this.contentTarget(i));
  }
  jump(n: number) {
    this.front = n;
    this.settle();
    this.hold = null;
    this.pending = 0;
    this.lastTake = -1e9;
  }
  /**
   * Puts a card `h` tall at index `at`, already at ring coordinate `c` and at rest. `front` keeps naming
   * the same card, so a card put in before it moves it up one index.
   */
  insert(at: number, h: number, c: number) {
    this.h.splice(at, 0, h);
    this.c.splice(at, 0, c);
    this.v.splice(at, 0, 0);
    this.g.splice(at, 0, 0);
    this.cf.splice(at, 0, 0);
    this.ps.splice(at, 0, 0);
    this.trim.splice(at, 0, NaN);
    this.N++;
    if (at <= this.front) this.front++;
    this.g[at] = this.washTarget(at);
    this.ps[at] = this.pathShade(at);
    this.cf[at] = this.contentTarget(at);
  }
  /** Takes out the card at index `at`, which must not be the front card; `front` keeps naming the same card. */
  remove(at: number) {
    this.h.splice(at, 1);
    this.c.splice(at, 1);
    this.v.splice(at, 1);
    this.g.splice(at, 1);
    this.cf.splice(at, 1);
    this.ps.splice(at, 1);
    this.trim.splice(at, 1);
    this.N--;
    if (at < this.front) this.front--;
  }
  /** Puts every card exactly at its target, still: what a drum at rest is, with the spring's last fractions gone. */
  settle() {
    for (let i = 0; i < this.N; i++) {
      this.c[i] = this.target(i);
      this.v[i] = 0;
      this.g[i] = this.washTarget(i);
      this.ps[i] = this.pathShade(i);
    }
    for (let i = 0; i < this.N; i++) this.cf[i] = this.contentTarget(i);
    this.lam = 0;
    this.lamV = 0;
    this.hb = 0;
    this.wasHeld = false;
    this.trim.fill(NaN);
  }
  /** Replaces the card heights, keeping every card where it is; the next step moves them toward the new poses. */
  setHeights(heights: number[]) {
    this.h = heights.slice();
  }
  hd(i: number) {
    return this.cfg.fold
      ? this.cfg.H0 + (this.h[i]! - this.cfg.H0) * (1 - this.lam)
      : this.h[i]!;
  }
  /** The height the clearing geometry uses: with `loose`, a card's height shrinks toward H0 as the held state rises, though it is drawn whole. */
  hg(i: number) {
    return this.cfg.loose
      ? this.cfg.H0 + (this.h[i]! - this.cfg.H0) * (1 - this.lam)
      : this.hd(i);
  }
  target(i: number) {
    return i >= this.front ? i - this.front : i - this.front - 1;
  }
  omega() {
    return this.cfg.omega0 + (this.cfg.omega1 - this.cfg.omega0) * this.lam;
  }
  dip() {
    return DIP_TAP + (DIP_HELD - DIP_TAP) * this.lam;
  }

  // ---- input --------------------------------------------------------------
  /** Estimated time, ms, for a card to clear the card of height `h` (the planner's model of a trip). */
  clearTime(h: number) {
    const t = this.cfg.tempo;
    return t.scale * (t.a + t.b * h);
  }
  /**
   * Minimum interval, ms, since the last press for a press in `dir`. The card a step has to clear is the one
   * that ends up in front (↓) or the one that was in front (↑), so the planner looks along the queue from it.
   * "lookahead" is the moving average of the moving maximum of the clear times over `window` cards each way:
   * a smooth upper envelope that is never below this step's own estimate and eases toward a tall card before
   * it arrives and away after it has passed.
   */
  tempoGap(dir: number) {
    const t = this.cfg.tempo;
    if (t.kind === "constant") return t.ms;
    if (t.kind !== "lookahead") return 0;
    const at = Math.max(this.front, this.front + dir),
      w = t.window;
    let sum = 0,
      n = 0;
    for (let s = -w; s <= w; s++) {
      const j = at + s * dir;
      if (j < 0 || j >= this.N) continue;
      let m = 0;
      for (let k = -w; k <= w; k++) {
        const i = j + k * dir;
        if (i >= 0 && i < this.N) m = Math.max(m, this.clearTime(this.h[i]!));
      }
      sum += m;
      n++;
    }
    return sum / n;
  }
  /** The least interval, ms, since the last press before another may be taken: the planned tempo, and the
   * beat a held key keeps. */
  private gapFor(dir: number) {
    const planned = this.tempoGap(dir);
    return this.hold ? Math.max(planned, this.hb) : planned;
  }
  /** The beat `holdBeats` asks for once a key has been held for `age` ms: the last stage it has reached. */
  private beatAt(age: number) {
    let beat = 0;
    for (const stage of this.cfg.holdBeats)
      if (age >= stage.after) beat = stage.beat;
    return beat;
  }
  /** Whether a press may be taken now: the planned interval has passed, and every card in transit has passed its flip. */
  accepts(dir: number) {
    const gap = this.gapFor(dir);
    if (gap > 0 && this.time - this.lastTake < gap) return false;
    for (let i = 0; i < this.N; i++) {
      const t = this.target(i),
        c = this.c[i]!;
      if (t < 0 && c > -1 + 1e-6) return false; // a leaver still in front
      if (t >= 0 && c < -1 - 1e-6) return false; // an arriver still behind
    }
    return true;
  }
  /** One press. Returns true if taken or left waiting; a press while another one waits is dropped. */
  press(dir: 1 | -1) {
    const nf = this.front + dir;
    if (nf < 0 || nf >= this.N) return false;
    if (this.pending !== 0) return false;
    if (this.accepts(dir)) {
      this.front = nf;
      this.lastTake = this.time;
      return true;
    }
    this.pending = dir;
    return true;
  }
  /** A hold starts only if there is a card to move to; against either end it would fold the pile for no change of state. */
  keyDown(dir: 1 | -1) {
    this.press(dir);
    this.hold = this.canAdvance(dir) ? { dir, t: 0 } : null;
  }
  /** Whether another card lies ahead in `dir` (here or, per `more`, beyond the cards held), or a waiting press is still to be taken. */
  canAdvance(dir: number) {
    const nf = this.front + dir;
    const beyond = nf < 0 ? this.more.before : nf >= this.N && this.more.after;
    return (nf >= 0 && nf < this.N) || beyond || this.pending !== 0;
  }
  keyUp() {
    this.hold = null;
  }
  isHeld() {
    return this.hold !== null;
  }

  // ---- stepping -----------------------------------------------------------
  step(ms: number) {
    let r = ms / 1000;
    while (r > 1e-9) {
      const d = Math.min(1 / 240, r);
      this.tick(d);
      r -= d;
    }
  }
  tick(dt: number) {
    this.time += dt * 1000;
    if (this.hold) this.hold.t += dt * 1000;
    const beat = this.hold ? this.beatAt(this.hold.t) : 0;
    if (this.hold && !this.wasHeld) this.hb = beat;
    this.hb += (beat - this.hb) * (1 - Math.exp((-dt * 1000) / BEAT_TAU));
    this.wasHeld = this.hold !== null;
    // the waiting press, once the gate opens
    if (this.pending !== 0 && this.accepts(Math.sign(this.pending))) {
      const nf = this.front + this.pending;
      if (nf >= 0 && nf < this.N) {
        this.front = nf;
        this.lastTake = this.time;
      }
      this.pending = 0;
    }
    // what was drawn before anything moves (the budget counts total edge motion, fold included)
    const before = this.views();
    // fold
    // The fold ends as soon as the hold has nowhere left to go, so the last card unfolds on arrival, not on release.
    const lamT =
      (this.cfg.fold || this.cfg.ramp || this.cfg.loose) &&
      this.hold &&
      this.hold.t >= this.cfg.holdDelay &&
      this.canAdvance(this.hold.dir)
        ? 1
        : 0;
    const wl = LAMBDA_OMEGA;
    this.lamV += (wl * wl * (lamT - this.lam) - 2 * wl * this.lamV) * dt;
    this.lam = clamp(this.lam + this.lamV * dt, 0, 1);
    const folded = this.views();
    // springs
    const w = this.omega();
    for (let i = 0; i < this.N; i++) {
      let t = this.target(i);
      const c = this.c[i]!;
      // The one draw-order change, at c = −1, waits until the card is clear of what it would swap with.
      if (t < -1 && c > -1 && !this.clearToFlip(i, folded)) t = -1;
      if (t > -1 && c < -1 && !this.clearToFlip(i, folded)) t = -1;
      const wi = t <= -2 && c < -1 ? w * this.cfg.tuckRate : w;
      this.v[i]! += (wi * wi * (t - c) - 2 * wi * this.v[i]!) * dt;
      this.c[i] = c + this.v[i]! * dt;
    }
    for (let i = 0; i < this.N; i++) {
      const fast = this.comesBack(i) && this.cfg.incomingFade > 0;
      const step = (fast ? this.cfg.incomingFade : PATH_RATE) * dt;
      const want = fast ? 0 : this.pathShade(i);
      this.ps[i] = this.ps[i]! + clamp(want - this.ps[i]!, -step, step);
    }
    const k = 1 - Math.exp((-dt * 1000) / COVER_TAU);
    const kBack = 1 - Math.exp((-dt * 1000) / CONTENT_BACK_TAU);
    for (let i = 0; i < this.N; i++) {
      const want = this.contentTarget(i);
      this.cf[i]! += (want - this.cf[i]!) * (want < this.cf[i]! ? kBack : k);
    }
    this.trimStep(dt);
    for (let i = 0; i < this.N; i++) {
      const gt = this.washTarget(i);
      const tau = gt < this.g[i]! ? this.cfg.washTauIn : this.cfg.washTauOut;
      this.g[i]! += (gt - this.g[i]!) * (1 - Math.exp((-dt * 1000) / tau));
    }
    // edge-speed clamp, per card, on what it drew
    if (this.cfg.vcap > 0) {
      const after = this.views();
      for (let i = 0; i < this.N; i++) {
        const a = before[i]!,
          b = after[i]!;
        if (!a.painted && !b.painted) continue;
        const moved = Math.max(
          Math.abs(b.top - a.top),
          Math.abs(b.natBottom - a.natBottom),
        );
        const f = folded[i]!;
        const own = Math.max(
          Math.abs(b.top - f.top),
          Math.abs(b.natBottom - f.natBottom),
        );
        const lim =
          (this.cfg.vcap + (this.cfg.vcap1 - this.cfg.vcap) * this.lam) * dt;
        // Own motion may use what the fold's shift of this card leaves of the budget, but at least half of it.
        const allow = Math.max(lim / 2, lim - (moved - own));
        if (own > allow) {
          const s = allow / own;
          const c0 = this.c[i]! - this.v[i]! * dt;
          this.c[i] = c0 + (this.c[i]! - c0) * s;
          this.v[i]! *= s;
        }
      }
    }
  }
  /** The wash a too-tall card's path asks for: nothing until 60 % of the way in, then slowly, then faster (quadratic), gone at the tuck. */
  washTarget(i: number) {
    const c = this.c[i]!;
    // A card coming back regains its colour at once, wash included.
    if (this.comesBack(i) && this.cfg.incomingFade > 0) return 0;
    // A loosened clearing lets a leaving card pass over the card it uncovers, so it washes out on the way.
    if (this.cfg.loose && c > -1 && c < 0)
      return LOOSE_WASH * this.lam * smooth(clamp((-c - 0.3) / 0.7, 0, 1));
    if (c > -1) return 0;
    const h = this.hd(i),
      hn = i + 1 < this.N ? this.hd(i + 1) : h;
    const tall = (hn - this.cfg.hidePx) / S0 - h < HIDE_Y / S0;
    if (!tall) return 0;
    const r = clamp(-1 - c, 0, 1);
    return Math.pow(clamp((r - 0.6) / 0.4, 0, 1), 2); // over the last 40 % of the way in: slowly, then faster
  }
  /** Whether card i, at its turn pose, overlaps nothing it would swap draw order with. */
  clearToFlip(i: number, views: DrumView[]) {
    const top = this.turnTop(i) - GAP / 2;
    for (let j = 0; j < this.N; j++) {
      if (j === i) continue;
      const vj = views[j]!;
      if (!vj.painted) continue;
      // cards it swaps with: everything not behind the pile (pile and front-segment cards)
      if (this.c[j]! < -1) continue;
      const bottom = this.cfg.loose
        ? vj.top + (vj.bottom - vj.top) * (this.hg(j) / Math.max(1, this.hd(j)))
        : vj.bottom;
      if (bottom > top) return false;
    }
    return true;
  }
  isBusy() {
    if (this.hold || this.pending) return true;
    for (let i = 0; i < this.N; i++)
      if (Math.abs(this.cf[i]! - this.contentTarget(i)) > 1e-3) return true;
    for (let i = 0; i < this.N; i++)
      if (
        Math.abs(this.c[i]! - this.target(i)) > 1e-3 ||
        Math.abs(this.v[i]!) > 1e-2
      )
        return true;
    return this.lam > 1e-2;
  }

  // ---- pose map ----------------------------------------------------------
  /** Screen y of the top edge of the card's turn pose: clear below the card it covers/uncovers (its ring neighbour i+1). */
  turnTop(i: number) {
    const hn = i + 1 < this.N ? this.hg(i + 1) : this.hg(i);
    return LEAD + hn + GAP + this.dip();
  }
  /** Whether card `i` is on its way back to the pile (a ↑). */
  comesBack(i: number) {
    return this.c[i]! < 0 && this.target(i) >= 0;
  }
  /** The shade of card `i` along its path off the pile: a slight wash leaving the front, deepening behind the pile. */
  pathShade(i: number) {
    const c = this.c[i]!;
    if (c >= 0) return 0;
    if (c > -1) return 0.35 * smooth(-c);
    return 1 - (1 - 0.48 * smooth(clamp(-1 - c, 0, 1))) * (1 - 0.35);
  }
  /**
   * How far the content of card `i` has faded: only the card a rising card is about to cover (a ↑) loses its
   * content, as soon as the rising card leaves its tuck, well before it overlaps. The frame and background are
   * not faded, so the card looks the same as the pile it settles into. Once the rising card has landed the card
   * is hidden behind it, down to a strip with no content, so the content comes back; a card moving into the
   * front (a ↓) never loses its content.
   */
  contentTarget(i: number) {
    const strength = this.cfg.coverFade;
    const j = i - 1;
    if (strength <= 0 || j < 0 || this.target(j) < 0 || this.c[j]! >= 0)
      return 0;
    const p = clamp((this.c[j]! + 2) / 2, 0, 1);
    return strength * easeOut(clamp(p / COVER_RISE, 0, 1));
  }
  /** Moves each card's trim toward what its drawn bottom is heading for, at no more than `SHRINK_RATE`. */
  trimStep(dt: number) {
    const views = this.views();
    const step = SHRINK_RATE * dt;
    for (let i = 0; i < this.N; i++) {
      const v = views[i]!;
      const want = Math.max(0, v.natBottom - v.targetBottom);
      const now = this.trim[i]!;
      this.trim[i] =
        Number.isNaN(now) || !v.painted
          ? want
          : now + clamp(want - now, -step, step);
    }
  }
  slot(q: number) {
    q = clamp(q, 0, VIS);
    const y = q <= 2 ? -DY * q : -2 * DY + (q - 2) * (HIDE_Y + 2 * DY);
    return { y, z: -DZ * q, depth: 0.24 * Math.min(q, 2) };
  }
  /** Raw pose of card i at its c (no clipping): { y, z, layerKey, painted, shade, group } */
  pose(i: number): Pose {
    const c = this.c[i]!,
      h = this.hd(i);
    if (c >= 0) {
      const p = this.slot(c);
      return {
        y: p.y,
        z: p.z,
        shade: p.depth,
        group: 1,
        painted: c < VIS - 1e-3,
        g: 0,
      };
    }
    const turnTop = this.turnTop(i);
    const yTurn = (turnTop - LEAD) / S0;
    if (c > -1) {
      // Front segment, parametrised by the screen position of the card's top edge. The card stays at full
      // scale while its bottom is over the card it uncovers/covers (so it really hides that card's clip
      // band), and recedes only past that point, as the product does.
      const u = -c;
      const T = LEAD + (turnTop - LEAD) * Math.sin((Math.PI / 2) * u);
      const hn = i + 1 < this.N ? this.hg(i + 1) : this.hg(i);
      const Tpass = LEAD + Math.max(0, hn - this.hg(i));
      const z = -ZDROP * smooth((T - Tpass) / Math.max(1, turnTop - Tpass));
      const g = this.g[i]!;
      return {
        y: (T - LEAD) / sc(z),
        z,
        shade: 1 - (1 - this.ps[i]!) * (1 - g),
        group: 0,
        painted: g < 0.98,
        g,
      };
    }
    // behind segment
    const r = clamp(-1 - c, 0, 1);
    const hn = i + 1 < this.N ? this.hd(i + 1) : h;
    let yTuck = (hn - this.cfg.hidePx) / S0 - h;
    let tall = false;
    if (yTuck < HIDE_Y / S0) {
      yTuck = HIDE_Y / S0;
      tall = true;
    }
    const y = yTurn + (yTuck - yTurn) * smooth(r);
    const g = this.g[i]!;
    const shade = 1 - (1 - this.ps[i]!) * (1 - g);
    const parked = c <= -2 + 1e-3; // at or past the tuck: hidden (covered, or washed out)
    return { y, z: -ZDROP, shade, group: 2, painted: !parked && g < 0.98, g };
  }
  /**
   * What the page draws: every card's layer (rank), scale, edges and drawn bottom. Cards not behind the
   * pile are clipped in draw order to the drawn bottom of the card in front of them (the pile looks the
   * size of its front card); cards behind the pile are drawn whole.
   */
  views(): DrumView[] {
    const N = this.N;
    const raw = new Array(N);
    for (let i = 0; i < N; i++) raw[i] = this.pose(i);
    // ring order: front-segment asc, pile asc, parked desc
    const order = [];
    for (let i = 0; i < N; i++) if (raw[i]!.group === 0) order.push(i);
    for (let i = 0; i < N; i++) if (raw[i]!.group === 1) order.push(i);
    for (let i = N - 1; i >= 0; i--) if (raw[i]!.group === 2) order.push(i);
    const out = new Array(N);
    // The bottom each card is heading for: clipped, in draw order, to the lower edge of the card in front of it
    // (the pile looks the size of its front card), where a front card still rising counts at its resting bottom.
    let cover = Infinity;
    order.forEach((i, rank) => {
      const p = raw[i]!,
        s = sc(p.z),
        h = this.hd(i);
      const top = LEAD + s * p.y,
        nat = LEAD + s * (p.y + h);
      let targetBottom = nat;
      if (p.group !== 2) {
        if (p.painted && cover < nat) targetBottom = Math.max(top, cover - 1.5);
        // A loose leaver passes over the card behind it, so it does not clip that card to its own lower edge.
        const passing = this.cfg.loose && this.lam > 0.02 && p.group === 0;
        const rising = i === this.front && this.c[i]! < 0;
        const edge = rising ? Math.min(targetBottom, LEAD + h) : targetBottom;
        if (p.painted && !passing) cover = Math.min(cover, edge);
      }
      const trim = this.trim[i]!;
      const bottom = Number.isNaN(trim)
        ? targetBottom
        : Math.max(top, nat - trim);
      const vis = (bottom - top) / s;
      out[i] = {
        key: "k" + i,
        i,
        c: this.c[i]!,
        painted: p.painted && (h === 0 || vis >= 2),
        layer: N - rank,
        scale: s,
        y: p.y,
        h,
        top,
        bottom,
        targetBottom,
        natBottom: nat,
        shade: p.shade,
        content: 1 - this.cf[i]!,
        group: p.group,
        interactive: i === this.front && Math.abs(this.c[i]!) < 1e-3,
      };
    });
    return out;
  }
}
