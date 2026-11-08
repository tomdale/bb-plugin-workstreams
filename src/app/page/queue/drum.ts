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
 *   step. `gateSlack` lets a press start while the card before it is still short of its flip.
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
const COVER_TAU = 50;
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
  coverFade: number;
  washTauIn: number;
  washTauOut: number;
  hidePx: number;
  tuckRate: number;
  gateSlack: number;
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
  coverFade: 0.7, // how far the card a rising card is about to cover fades before the rising card reaches it, 0 to 1
  washTauIn: 40, // ms: the drawn wash of a too-tall card follows its path value, falling
  washTauOut: 120, // and rising
  hidePx: 3, // the tuck ends with the card's bottom this far inside the pile's lower edge
  tuckRate: 1.4, // the tuck (behind the pile, heading home) runs on a stiffer spring
  gateSlack: 0, // ring units: a press may start while a leaver is this far short of its flip (0.1 stays clean)
  // Interval planner. kind "none": the flip gate alone. "constant": at least `ms` between presses.
  // "lookahead": the smoothed slowest estimated clear time among the `window` cards on each side of the one
  // being covered, where a card of height h takes `scale × (a + b·h)` ms.
  tempo: { kind: "none", ms: 285, window: 2, a: 60, b: 0.62, scale: 1 },
};

/** Named settings the page and the sweeps share. Each overlays DEFAULT_CFG. */
export const PRESETS: Record<string, DrumPatch> = {
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

/**
 * The settings the queue ships with: the `even + held speed` preset with a constant 150 ms between presses, so
 * every card takes the same time however tall it is, and a held key that stiffens the springs (3 to 5 Hz) and
 * raises the edge budget (17 to 30 px/frame) after a 250 ms hold. Taps and holds never fold the cards.
 */
export const QUEUE_CFG: DrumPatch = {
  ramp: true,
  omega0: TAU * 3,
  omega1: TAU * 5,
  vcap: 17 * 60,
  vcap1: 30 * 60,
  holdDelay: 250,
  tempo: { kind: "constant", ms: 150 },
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
  /** The fade of each pile card that a rising card is about to cover (lagged); see `coverTarget`. */
  cf: number[];
  /** The held state, 0 to 1. */
  lam = 0;
  lamV = 0;
  hold: { dir: 1 | -1; t: number } | null = null;
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
    this.cf = heights.map(() => 0);
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
    this.N++;
    if (at <= this.front) this.front++;
    this.g[at] = this.washTarget(at);
  }
  /** Takes out the card at index `at`, which must not be the front card; `front` keeps naming the same card. */
  remove(at: number) {
    this.h.splice(at, 1);
    this.c.splice(at, 1);
    this.v.splice(at, 1);
    this.g.splice(at, 1);
    this.cf.splice(at, 1);
    this.N--;
    if (at < this.front) this.front--;
  }
  /** Puts every card exactly at its target, still: what a drum at rest is, with the spring's last fractions gone. */
  settle() {
    for (let i = 0; i < this.N; i++) {
      this.c[i] = this.target(i);
      this.v[i] = 0;
      this.g[i] = this.washTarget(i);
      this.cf[i] = 0;
    }
    this.lam = 0;
    this.lamV = 0;
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
  /** Whether a press may be taken now: the planned interval has passed, and every card in transit has passed its flip (less `gateSlack`). */
  accepts(dir: number) {
    const gap = this.tempoGap(dir);
    if (gap > 0 && this.time - this.lastTake < gap) return false;
    for (let i = 0; i < this.N; i++) {
      const t = this.target(i),
        c = this.c[i]!;
      const slack = this.cfg.gateSlack;
      if (t < 0 && c > -1 + slack + 1e-6) return false; // a leaver still in front
      if (t >= 0 && c < -1 - slack - 1e-6) return false; // an arriver still behind
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
    const k = 1 - Math.exp((-dt * 1000) / COVER_TAU);
    for (let i = 0; i < this.N; i++)
      this.cf[i]! += (this.coverTarget(i) - this.cf[i]!) * k;
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
    if (this.cf.some((x) => x > 1e-3)) return true;
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
  /**
   * How far card `i`, in the pile, has faded because the card before it is rising to cover it (a ↑). The fade
   * starts as the rising card leaves the tuck, well before it overlaps, reaches `coverFade` by the time it
   * is a third of the way up, and lifts again as it lands, when the card behind it is clipped to its height.
   */
  coverTarget(i: number) {
    const j = i - 1;
    if (this.cfg.coverFade <= 0 || j < 0 || this.target(j) < 0) return 0;
    const cj = this.c[j]!;
    if (cj >= 0) return 0;
    const p = clamp((cj + 2) / 2, 0, 1);
    return (
      this.cfg.coverFade *
      easeOut(clamp(p / COVER_RISE, 0, 1)) *
      (1 - smooth(clamp((p - 0.85) / 0.15, 0, 1)))
    );
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
        shade: 1 - (1 - p.depth) * (1 - this.cf[i]!),
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
      const leave = 0.35 * smooth(u);
      const g = this.g[i]!;
      return {
        y: (T - LEAD) / sc(z),
        z,
        shade: 1 - (1 - leave) * (1 - g) * (1 - this.cf[i]!),
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
    const depth = 0.48 * smooth(r);
    const shade = 1 - (1 - depth) * (1 - 0.35) * (1 - g) * (1 - this.cf[i]!);
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
    let cover = Infinity;
    order.forEach((i, rank) => {
      const p = raw[i]!,
        s = sc(p.z),
        h = this.hd(i);
      const top = LEAD + s * p.y,
        nat = LEAD + s * (p.y + h);
      let bottom = nat;
      if (p.group !== 2) {
        if (p.painted && cover < nat) bottom = Math.max(top, cover - 1.5);
        // A loose leaver passes over the card behind it, so it does not clip that card to its own lower edge.
        const passing = this.cfg.loose && this.lam > 0.02 && p.group === 0;
        if (p.painted && !passing) cover = Math.min(cover, bottom);
      }
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
        natBottom: nat,
        shade: p.shade,
        group: p.group,
        interactive: i === this.front && Math.abs(this.c[i]!) < 1e-3,
      };
    });
    return out;
  }
}
