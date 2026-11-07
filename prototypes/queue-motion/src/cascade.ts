/**
 * The cascade: a model of the queue's card stack in which a card that leaves never goes behind the pile. It
 * slides down an exit channel in front of the pile and parks below the visible area, so a held key sends a
 * train of cards down the screen, each one uncovering the top strip of the card behind it. A step does not
 * wait for a card to drop clear of the one it uncovers, so the pace does not follow the card heights.
 *
 * Coordinate `c` of card `i`, with one critically damped spring along it:
 *   c ≥ 0        pile slot, exactly as in the drum (0 front, 1–2 peeking above the front card, 3 hidden behind it)
 *   −1 < c < 0   exit channel: in front of the pile at full scale, its top at LEAD + (−c)·`park` px
 *   c ≤ −1       parked below the clip line, which is `park` px below the front pose; not painted
 *
 * Keys move one integer, `front`. Each card's spring target is a pure function of `(i, front)`:
 *   i ≥ front: i − front   (the pile)
 *   i <  front: −1.25      (a leaver aims past the clip line, so its slowing happens out of sight; when its
 *                           `c` reaches −1 it is parked there at rest, which no one can see)
 * ↑ runs the same channel the other way: a parked card rises from the clip line and slows into the front
 * pose. Nothing tucks behind the pile, turns or flips, so draw order never changes and cards cannot pass
 * through each other. Nearest first it is the channel cards by index, then the pile cards by index.
 *
 * What is drawn:
 * - A channel card is cut at the clip line. The page clips there too, and `natBottom` stops at the line, so a
 *   card sliding through it is not an edge moving in view.
 * - Each card is drawn no taller than the card in front of it, over channel and pile cards together, so the
 *   stack never shows more than the cards it covers. Channel cards stay in that chain. Without it the new front
 *   reaches its full height at once, while the leaver is still sliding away, and the frame checker reports edge
 *   flashes.
 * - The pile's poses are the drum's. Its slot constants are not exported, so they are repeated here, and
 *   `sim/suite.mjs` checks that the two models draw the same pile.
 *
 * What sets the pace:
 * - The edge budget caps how far any painted edge moves in a step. A card slides at the budget's speed for
 *   most of its trip, so the budget, not the springs, is what limits a train's speed.
 * - A press in the direction of the last one is taken once `spacing` ÷ the budget's speed has passed since
 *   the last press was taken: the time a card at full speed needs to clear `spacing` px. Cards leave the
 *   front, and the clip line, `spacing` px apart whatever their heights, and ↑ and ↓ take the same time per
 *   card. A gate on how far the last card has travelled would not: a card released while it is still
 *   settling into the front slot spends part of each step in the pile region, a few px tall on screen, and
 *   ↓ would run slower than ↑. A press in the other direction is taken at once.
 * - `spacing` runs from `spacing0` at λ = 0 to `spacing1` at λ = 1. λ is the held state: it rises on a 1.6 Hz
 *   spring once a key has been held for `holdDelay`, falls on release, and stays 0 against either end of the
 *   queue. The spring rate and the edge budget follow λ the same way. With `ramp` off, λ changes nothing: the
 *   train runs at `spacing1` on the tap spring and the tap budget from the first repeat.
 * - A hold only starts while another card lies ahead in its direction, so a hold at either end moves nothing.
 * - One press may wait for the gate; any further press before it is taken is dropped, so a release rests on a
 *   whole card with at most one more card after it.
 */
export const LEAD = 34;
const P = 1000,
  DY = 10,
  DZ = 52,
  VIS = 3,
  HIDE_Y = 4;
const sc = (z: number) => P / (P - z);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (u: number) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};
const TAU = 2 * Math.PI;
/** Spring rate of λ, the held state: how fast the speed-up ramps in once the hold delay has passed. */
const LAMBDA_OMEGA = TAU * 1.6;
/** Where a leaver's spring aims, in units of `c`: past the clip line at −1. */
const LEAVE_AIM = -1.25;

/** Every setting of a cascade. */
export type CascadeConfig = {
  omega0: number;
  omega1: number;
  vcap: number;
  vcap1: number;
  holdDelay: number;
  spacing0: number;
  spacing1: number;
  park: number;
  leaveShade: number;
  ramp: boolean;
};

/** A setting overlay: any field. */
export type CascadePatch = Partial<CascadeConfig>;

/** What the page draws for one card; the same fields as the drum's views (`group` 0 is the channel, 1 the pile). */
export type CascadeView = {
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
  natBottom: number;
  shade: number;
  group: number;
  interactive: boolean;
};

type Pose = {
  y: number;
  z: number;
  shade: number;
  group: number;
  painted: boolean;
};

export const DEFAULT_CFG: CascadeConfig = {
  omega0: TAU * 3.0, // spring rate at λ = 0 (taps), rad/s
  omega1: TAU * 4.5, // at λ = 1 (held)
  vcap: 1440, // edge-speed budget at λ = 0, px/s (24 px/frame at 60 Hz); also the speed the gate assumes, so above 0
  vcap1: 1800, // at λ = 1 (30 px/frame)
  holdDelay: 250, // ms a key is held before λ heads to 1
  spacing0: 216, // px between cards leaving in a train at λ = 0: a press waits spacing / budget
  spacing1: 150, // at λ = 1
  park: 480, // px below the front pose where the clip line sits and cards park
  leaveShade: 0.25, // how dark a card is at the clip line, 0 to 1; it fades in over the trip
  ramp: true, // whether a held key speeds the train up; off holds spacing1, omega0 and vcap from the first repeat
};

/** Named settings the page and the sweeps share. Each overlays DEFAULT_CFG. */
export const PRESETS: Record<string, CascadePatch> = {
  /** The defaults: a held key speeds the train up. */
  default: {},
  /**
   * Nothing speeds up while a key is held: the train runs at the held spacing from the first repeat, on the
   * tap spring and the tap budget, so its pace is the same from the first card to the last.
   */
  "no held ramp": { ramp: false },
};

export class Cascade {
  /** DEFAULT_CFG overlaid with `cfg`. */
  static config(cfg: CascadePatch = {}): CascadeConfig {
    return { ...DEFAULT_CFG, ...cfg };
  }
  h: number[];
  N: number;
  cfg: CascadeConfig;
  front = 0;
  c: number[];
  v: number[];
  /** The held state, 0 to 1. */
  lam = 0;
  lamV = 0;
  hold: { dir: 1 | -1; t: number } | null = null;
  /** The one press that may wait for the gate, signed by direction. */
  pending: 0 | 1 | -1 = 0;
  /** Model time, ms. */
  time = 0;
  /** The press taken last: its direction and the time it was taken. */
  last: { dir: 1 | -1; at: number } | null = null;
  constructor(heights: number[], cfg: CascadePatch = {}) {
    this.h = heights.slice();
    this.N = heights.length;
    this.cfg = Cascade.config(cfg);
    this.c = heights.map((_, i) => i); // settled at front = 0
    this.v = heights.map(() => 0);
  }
  /** Puts every card at rest for `front = n`: the pile in its slots, every earlier card parked. */
  jump(n: number) {
    this.front = n;
    for (let i = 0; i < this.N; i++) {
      this.c[i] = this.rest(i);
      this.v[i] = 0;
    }
    this.lam = 0;
    this.lamV = 0;
    this.hold = null;
    this.pending = 0;
    this.last = null;
  }
  /** Replaces the card heights, keeping every card where it is; the next views draw the new heights. */
  setHeights(heights: number[]) {
    this.h = heights.slice();
  }
  /** The coordinate card `i`'s spring aims at. */
  target(i: number) {
    return i >= this.front ? i - this.front : LEAVE_AIM;
  }
  /** The coordinate card `i` rests at: its slot, or parked on the clip line. */
  rest(i: number) {
    return i >= this.front ? i - this.front : -1;
  }
  /** A setting that runs from `tap` at λ = 0 to `held` at λ = 1; with the ramp off it stays at `tap`. */
  private ramped(tap: number, held: number) {
    return this.cfg.ramp ? tap + (held - tap) * this.lam : tap;
  }
  /** The spring rate now, rad/s. */
  omega() {
    return this.ramped(this.cfg.omega0, this.cfg.omega1);
  }
  /** The distance between cards leaving in a train now, px; with the ramp off, always `spacing1`. */
  spacing() {
    return this.cfg.ramp
      ? this.ramped(this.cfg.spacing0, this.cfg.spacing1)
      : this.cfg.spacing1;
  }
  /** The edge budget now, px/s. */
  budget() {
    return this.ramped(this.cfg.vcap, this.cfg.vcap1);
  }

  // ---- input --------------------------------------------------------------
  /** Minimum ms between two presses in one direction: what a card at the edge budget's speed needs to clear `spacing` px. */
  interval() {
    const speed = this.budget();
    return speed > 0 ? (1000 * this.spacing()) / speed : 0;
  }
  /** Whether a press in `dir` may be taken now: one in the other direction always may. */
  accepts(dir: 1 | -1) {
    const last = this.last;
    return !last || last.dir !== dir || this.time - last.at >= this.interval();
  }
  /** Moves `front` one card and remembers when. */
  take(dir: 1 | -1) {
    this.front += dir;
    this.last = { dir, at: this.time };
  }
  /** One press. Returns true if taken or left waiting; a press while another one waits is dropped. */
  press(dir: 1 | -1) {
    const nf = this.front + dir;
    if (nf < 0 || nf >= this.N) return false;
    if (this.pending !== 0) return false;
    if (this.accepts(dir)) {
      this.take(dir);
      return true;
    }
    this.pending = dir;
    return true;
  }
  /** A hold starts only if there is a card to move to; against either end it would only raise λ for nothing. */
  keyDown(dir: 1 | -1) {
    this.press(dir);
    this.hold = this.canAdvance(dir) ? { dir, t: 0 } : null;
  }
  /** Whether another card lies ahead in `dir`, or a waiting press is still to be taken. */
  canAdvance(dir: number) {
    const nf = this.front + dir;
    return (nf >= 0 && nf < this.N) || this.pending !== 0;
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
    // the waiting press, once the gate opens
    const waiting = this.pending;
    if (waiting !== 0 && this.accepts(waiting)) {
      this.take(waiting);
      this.pending = 0;
    }
    // λ heads to 1 once the hold delay has passed, and back to 0 on release or at either end
    const lamT =
      this.hold &&
      this.hold.t >= this.cfg.holdDelay &&
      this.canAdvance(this.hold.dir)
        ? 1
        : 0;
    const wl = LAMBDA_OMEGA;
    this.lamV += (wl * wl * (lamT - this.lam) - 2 * wl * this.lamV) * dt;
    this.lam = clamp(this.lam + this.lamV * dt, 0, 1);
    // what was drawn before anything moves (the budget counts edge motion)
    const before = this.views();
    // springs
    const w = this.omega();
    for (let i = 0; i < this.N; i++) {
      const t = this.target(i),
        c = this.c[i]!;
      if (c <= -1 && t <= -1) {
        this.c[i] = -1; // parked: hidden, at rest on the clip line
        this.v[i] = 0;
        continue;
      }
      this.v[i]! += (w * w * (t - c) - 2 * w * this.v[i]!) * dt;
      this.c[i] = c + this.v[i]! * dt;
    }
    // edge-speed clamp, per card, on what it drew
    if (this.cfg.vcap > 0) {
      const after = this.views();
      const lim = this.budget() * dt;
      for (let i = 0; i < this.N; i++) {
        const a = before[i]!,
          b = after[i]!;
        if (!a.painted && !b.painted) continue;
        const own = Math.max(
          Math.abs(b.top - a.top),
          Math.abs(b.natBottom - a.natBottom),
        );
        if (own > lim) {
          const s = lim / own;
          const c0 = this.c[i]! - this.v[i]! * dt;
          this.c[i] = c0 + (this.c[i]! - c0) * s;
          this.v[i]! *= s;
        }
      }
    }
    // a leaver that reached the clip line this step parks there, at rest
    for (let i = 0; i < this.N; i++)
      if (this.c[i]! <= -1 && this.target(i) <= -1) {
        this.c[i] = -1;
        this.v[i] = 0;
      }
  }
  isBusy() {
    if (this.hold || this.pending) return true;
    for (let i = 0; i < this.N; i++) {
      const t = this.rest(i),
        c = this.c[i]!;
      if (c <= -1 && t <= -1) continue;
      if (Math.abs(c - t) > 1e-3 || Math.abs(this.v[i]!) > 1e-2) return true;
    }
    return this.lam > 1e-2;
  }

  // ---- pose map ----------------------------------------------------------
  slot(q: number) {
    q = clamp(q, 0, VIS);
    const y = q <= 2 ? -DY * q : -2 * DY + (q - 2) * (HIDE_Y + 2 * DY);
    return { y, z: -DZ * q, depth: 0.24 * Math.min(q, 2) };
  }
  /** Raw pose of card i at its c (no clipping): { y, z, shade, group, painted } */
  pose(i: number): Pose {
    const c = this.c[i]!;
    if (c >= 0) {
      const p = this.slot(c);
      return {
        y: p.y,
        z: p.z,
        shade: p.depth,
        group: 1,
        painted: c < VIS - 1e-3,
      };
    }
    const u = clamp(-c, 0, 1);
    return {
      y: u * this.cfg.park,
      z: 0,
      shade: this.cfg.leaveShade * smooth(u),
      group: 0,
      painted: c > -1 + 1e-9,
    };
  }
  /**
   * What the page draws: every card's layer (rank), scale, edges and drawn bottom. Cards are drawn in order,
   * nearest first, no taller than the drawn bottom of the card in front of them; a channel card's bottom is
   * also cut at the clip line.
   */
  views(): CascadeView[] {
    const N = this.N;
    const raw = new Array<Pose>(N);
    for (let i = 0; i < N; i++) raw[i] = this.pose(i);
    // draw order, nearest first: channel by index, then pile by index
    const order: number[] = [];
    for (let i = 0; i < N; i++) if (raw[i]!.group === 0) order.push(i);
    for (let i = 0; i < N; i++) if (raw[i]!.group === 1) order.push(i);
    const clipY = LEAD + this.cfg.park;
    const out = new Array<CascadeView>(N);
    let cover = Infinity;
    order.forEach((i, rank) => {
      const p = raw[i]!,
        s = sc(p.z),
        h = this.h[i]!;
      const top = LEAD + s * p.y;
      let nat = LEAD + s * (p.y + h);
      if (p.group === 0) nat = Math.min(nat, clipY);
      let bottom = nat;
      if (p.painted) {
        if (cover < nat) bottom = Math.max(top, cover - 1.5);
        cover = Math.min(cover, bottom);
      }
      const vis = (bottom - top) / s;
      out[i] = {
        key: "k" + i,
        i,
        c: this.c[i]!,
        painted: p.painted && vis >= 2,
        layer: N - rank,
        scale: s,
        y: p.y,
        h,
        top,
        bottom,
        natBottom: nat,
        shade: p.shade,
        group: p.group,
        interactive: i === this.front && Math.abs(this.c[i]!) < 1e-3,
      };
    });
    return out;
  }
}
