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
 * - `ramp` stiffens the springs and raises the edge budget while a key is held. `fold` also shrinks every
 *   card's drawn height toward `H0` while a key is held (a level of detail), which removes the height term.
 * - A hold only starts, and only folds, while another card lies ahead in its direction.
 */
export const LEAD = 34;
const P = 1000,
  DY = 10,
  DZ = 52,
  VIS = 3,
  ZDROP = 170,
  HIDE_Y = 4,
  GAP = 16;
const sc = (z) => P / (P - z);
const S0 = sc(-ZDROP);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (u) => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};
const easeOut = (u) => {
  const x = clamp(u, 0, 1);
  return 1 - (1 - x) * (1 - x);
};
const TAU = 2 * Math.PI;

export const DEFAULT_CFG = {
  omega0: TAU * 3.0, // spring rate at λ = 0 (taps), rad/s
  omega1: TAU * 4.5, // at λ = 1 (held, when `ramp` or `fold` is on)
  vcap: 1440, // edge-speed budget at λ = 0, px/s (24 px/frame at 60 Hz); 0 = off
  vcap1: 1800, // at λ = 1 (30 px/frame)
  dip0: 20, // extra travel below the clear line at λ = 0 (the visible dip of a returning card)
  dip1: 6, // and at λ = 1
  fold: false, // while held, fold every card toward H0 (level of detail)
  ramp: false, // while held, ramp the spring rate and edge budget toward their λ = 1 values without folding
  H0: 73, // folded (header) height, px
  foldOmega: TAU * 1.6, // spring rate of λ
  holdDelay: 250, // ms a key is held before λ heads to 1
  washTauIn: 40, // ms: the drawn wash of a too-tall card follows its path value, falling
  washTauOut: 120, // and rising
  hidePx: 3, // the tuck ends with the card's bottom this far inside the pile's lower edge
  tuckRate: 1.4, // the tuck (behind the pile, heading home) runs on a stiffer spring
  frontEase: "sine", // front segment profile: sine | easeOut | smooth | linear
  accept: "flip", // "flip": a press waits for the flip gate; "none": every press is taken
  gateSlack: 0, // ring units: a press may start while a leaver is this far short of its flip (≤ 0.2 stays clean)
  queue: 1, // presses that may wait for the gate (0: dropped)
  // Interval planner. kind "none": the flip gate alone. "constant": at least `ms` between presses.
  // "lookahead": the smoothed slowest estimated clear time among the `window` cards on each side of the one
  // being covered, where a card of height h takes `scale × (a + b·h)` ms.
  tempo: { kind: "none", ms: 285, window: 2, a: 60, b: 0.62, scale: 1 },
};

/** Named settings the page and the sweeps share. Each overlays DEFAULT_CFG. */
export const PRESETS = {
  natural: {},
  even: { tempo: { kind: "lookahead", window: 2, scale: 1 } },
  "even + held speed": {
    ramp: true,
    tempo: { kind: "lookahead", window: 2, scale: 0.85 },
  },
  "constant + held speed": { ramp: true, tempo: { kind: "constant", ms: 225 } },
  fold: { fold: true },
};

export class Drum {
  /** DEFAULT_CFG overlaid with `cfg`, merging `tempo` field by field. */
  static config(cfg = {}) {
    return {
      ...DEFAULT_CFG,
      ...cfg,
      tempo: { ...DEFAULT_CFG.tempo, ...(cfg.tempo ?? {}) },
    };
  }
  constructor(heights, cfg = {}) {
    this.h = heights.slice();
    this.N = heights.length;
    this.cfg = Drum.config(cfg);
    this.front = 0;
    this.c = heights.map((_, i) => i); // settled at front = 0
    this.v = heights.map(() => 0);
    this.g = heights.map(() => 0); // drawn wash of too-tall cards (lagged)
    this.lam = 0;
    this.lamV = 0;
    this.hold = null; // { dir, t }
    this.pending = 0; // queued presses (signed)
    this.time = 0;
    this.lastTake = -1e9; // time the last press was taken
  }
  jump(n) {
    this.front = n;
    for (let i = 0; i < this.N; i++) {
      this.c[i] = this.target(i);
      this.v[i] = 0;
      this.g[i] = this.washTarget(i);
    }
    this.lam = 0;
    this.lamV = 0;
    this.hold = null;
    this.pending = 0;
    this.lastTake = -1e9;
  }
  /** Replaces the card heights, keeping every card where it is; the next step moves them toward the new poses. */
  setHeights(heights) {
    this.h = heights.slice();
  }
  get cur() {
    return this.front;
  }
  hd(i) {
    return this.cfg.fold
      ? this.cfg.H0 + (this.h[i] - this.cfg.H0) * (1 - this.lam)
      : this.h[i];
  }
  target(i) {
    return i >= this.front ? i - this.front : i - this.front - 1;
  }
  omega() {
    return this.cfg.omega0 + (this.cfg.omega1 - this.cfg.omega0) * this.lam;
  }
  dip() {
    return this.cfg.dip0 + (this.cfg.dip1 - this.cfg.dip0) * this.lam;
  }

  // ---- input --------------------------------------------------------------
  /** Estimated time, ms, for a card to clear the card of height `h` (the planner's model of a trip). */
  clearTime(h) {
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
  tempoGap(dir) {
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
        if (i >= 0 && i < this.N) m = Math.max(m, this.clearTime(this.h[i]));
      }
      sum += m;
      n++;
    }
    return sum / n;
  }
  /** Whether a press may be taken now: the planned interval has passed, and every card in transit has passed its flip (less `gateSlack`). */
  accepts(dir) {
    if (this.cfg.accept === "none") return true;
    const gap = this.tempoGap(dir);
    if (gap > 0 && this.time - this.lastTake < gap) return false;
    for (let i = 0; i < this.N; i++) {
      const t = this.target(i),
        c = this.c[i];
      const slack = this.cfg.gateSlack;
      if (t < 0 && c > -1 + slack + 1e-6) return false; // a leaver still in front
      if (t >= 0 && c < -1 - slack - 1e-6) return false; // an arriver still behind
    }
    return true;
  }
  /** One press. Returns true if taken (or queued). */
  press(dir) {
    const nf = this.front + dir;
    if (nf < 0 || nf >= this.N) return false;
    if (this.accepts(dir) && this.pending === 0) {
      this.front = nf;
      this.lastTake = this.time;
      return true;
    }
    if (
      Math.abs(this.pending + dir) <= this.cfg.queue &&
      Math.sign(this.pending || dir) === dir
    ) {
      this.pending += dir;
      return true;
    }
    return false;
  }
  /** A hold starts only if there is a card to move to; against either end it would fold the pile for no change of state. */
  keyDown(dir) {
    this.press(dir);
    this.hold = this.canAdvance(dir) ? { dir, t: 0 } : null;
  }
  /** Whether another card lies ahead in `dir`, or a queued press is still to be taken. */
  canAdvance(dir) {
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
  step(ms) {
    let r = ms / 1000;
    while (r > 1e-9) {
      const d = Math.min(1 / 240, r);
      this.tick(d);
      r -= d;
    }
  }
  tick(dt) {
    this.time += dt * 1000;
    if (this.hold) this.hold.t += dt * 1000;
    // queued presses
    if (this.pending !== 0 && this.accepts(Math.sign(this.pending))) {
      const d = Math.sign(this.pending);
      const nf = this.front + d;
      if (nf >= 0 && nf < this.N) {
        this.front = nf;
        this.lastTake = this.time;
      }
      this.pending -= d;
    }
    // what was drawn before anything moves (the budget counts total edge motion, fold included)
    const before = this.views();
    // fold
    // The fold ends as soon as the hold has nowhere left to go, so the last card unfolds on arrival, not on release.
    const lamT =
      (this.cfg.fold || this.cfg.ramp) &&
      this.hold &&
      this.hold.t >= this.cfg.holdDelay &&
      this.canAdvance(this.hold.dir)
        ? 1
        : 0;
    const wl = this.cfg.foldOmega;
    this.lamV += (wl * wl * (lamT - this.lam) - 2 * wl * this.lamV) * dt;
    this.lam = clamp(this.lam + this.lamV * dt, 0, 1);
    const folded = this.views();
    // springs
    const w = this.omega();
    for (let i = 0; i < this.N; i++) {
      let t = this.target(i);
      const c = this.c[i];
      // The one draw-order change, at c = −1, waits until the card is clear of what it would swap with.
      if (t < -1 && c > -1 && !this.clearToFlip(i, folded)) t = -1;
      if (t > -1 && c < -1 && !this.clearToFlip(i, folded)) t = -1;
      const wi = t <= -2 && c < -1 ? w * this.cfg.tuckRate : w;
      this.v[i] += (wi * wi * (t - c) - 2 * wi * this.v[i]) * dt;
      this.c[i] = c + this.v[i] * dt;
    }
    for (let i = 0; i < this.N; i++) {
      const gt = this.washTarget(i);
      const tau = gt < this.g[i] ? this.cfg.washTauIn : this.cfg.washTauOut;
      this.g[i] += (gt - this.g[i]) * (1 - Math.exp((-dt * 1000) / tau));
    }
    // edge-speed clamp, per card, on what it drew
    if (this.cfg.vcap > 0) {
      const after = this.views();
      for (let i = 0; i < this.N; i++) {
        const a = before[i],
          b = after[i];
        if (!a.painted && !b.painted) continue;
        const moved = Math.max(
          Math.abs(b.top - a.top),
          Math.abs(b.natBottom - a.natBottom),
        );
        const f = folded[i];
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
          const c0 = this.c[i] - this.v[i] * dt;
          this.c[i] = c0 + (this.c[i] - c0) * s;
          this.v[i] *= s;
        }
      }
    }
  }
  /** The wash a too-tall card's path asks for: nothing until 60 % of the way in, then slowly, then faster (quadratic), gone at the tuck. */
  washTarget(i) {
    const c = this.c[i];
    if (c > -1) return 0;
    const h = this.hd(i),
      hn = i + 1 < this.N ? this.hd(i + 1) : h;
    const tall = (hn - this.cfg.hidePx) / S0 - h < HIDE_Y / S0;
    if (!tall) return 0;
    const r = clamp(-1 - c, 0, 1);
    return Math.pow(clamp((r - 0.6) / 0.4, 0, 1), 2); // over the last 40 % of the way in: slowly, then faster
  }
  /** Whether card i, at its turn pose, overlaps nothing it would swap draw order with. */
  clearToFlip(i, views) {
    const top = this.turnTop(i) - GAP / 2;
    for (let j = 0; j < this.N; j++) {
      if (j === i) continue;
      const vj = views[j];
      if (!vj.painted) continue;
      // cards it swaps with: everything not behind the pile (pile and front-segment cards)
      if (this.c[j] < -1) continue;
      if (vj.bottom > top) return false;
    }
    return true;
  }
  isBusy() {
    if (this.hold || this.pending) return true;
    for (let i = 0; i < this.N; i++)
      if (
        Math.abs(this.c[i] - this.target(i)) > 1e-3 ||
        Math.abs(this.v[i]) > 1e-2
      )
        return true;
    return this.lam > 1e-2;
  }

  // ---- pose map ----------------------------------------------------------
  /** Screen y of the top edge of the card's turn pose: clear below the card it covers/uncovers (its ring neighbour i+1). */
  turnTop(i) {
    const hn = i + 1 < this.N ? this.hd(i + 1) : this.hd(i);
    return LEAD + hn + GAP + this.dip();
  }
  slot(q) {
    q = clamp(q, 0, VIS);
    const y = q <= 2 ? -DY * q : -2 * DY + (q - 2) * (HIDE_Y + 2 * DY);
    return { y, z: -DZ * q, depth: 0.24 * Math.min(q, 2) };
  }
  /** Raw pose of card i at its c (no clipping): { y, z, layerKey, painted, shade, group } */
  pose(i) {
    const c = this.c[i],
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
      const e =
        this.cfg.frontEase === "smooth"
          ? smooth(u)
          : this.cfg.frontEase === "linear"
            ? u
            : this.cfg.frontEase === "sine"
              ? Math.sin((Math.PI / 2) * u)
              : easeOut(u);
      const T = LEAD + (turnTop - LEAD) * e;
      const hn = i + 1 < this.N ? this.hd(i + 1) : h;
      const Tpass = LEAD + Math.max(0, hn - h);
      const z = -ZDROP * smooth((T - Tpass) / Math.max(1, turnTop - Tpass));
      const leave = 0.35 * smooth(u);
      const g = this.g[i];
      return {
        y: (T - LEAD) / sc(z),
        z,
        shade: 1 - (1 - leave) * (1 - g),
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
    const g = this.g[i];
    const depth = 0.48 * smooth(r);
    const shade = 1 - (1 - depth) * (1 - 0.35) * (1 - g);
    const parked = c <= -2 + 1e-3; // at or past the tuck: hidden (covered, or washed out)
    return { y, z: -ZDROP, shade, group: 2, painted: !parked && g < 0.98, g };
  }
  /**
   * What the page draws: every card's layer (rank), scale, edges and drawn bottom. Cards not behind the
   * pile are clipped in draw order to the drawn bottom of the card in front of them (the pile looks the
   * size of its front card); cards behind the pile are drawn whole.
   */
  views() {
    const N = this.N;
    const raw = new Array(N);
    for (let i = 0; i < N; i++) raw[i] = this.pose(i);
    // ring order: front-segment asc, pile asc, parked desc
    const order = [];
    for (let i = 0; i < N; i++) if (raw[i].group === 0) order.push(i);
    for (let i = 0; i < N; i++) if (raw[i].group === 1) order.push(i);
    for (let i = N - 1; i >= 0; i--) if (raw[i].group === 2) order.push(i);
    const out = new Array(N);
    let cover = Infinity;
    order.forEach((i, rank) => {
      const p = raw[i],
        s = sc(p.z),
        h = this.hd(i);
      const top = LEAD + s * p.y,
        nat = LEAD + s * (p.y + h);
      let bottom = nat;
      if (p.group !== 2) {
        if (p.painted && cover < nat) bottom = Math.max(top, cover - 1.5);
        if (p.painted) cover = Math.min(cover, bottom);
      }
      const vis = (bottom - top) / s;
      out[i] = {
        key: "k" + i,
        i,
        c: this.c[i],
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
        interactive: i === this.front && Math.abs(this.c[i]) < 1e-3,
      };
    });
    return out;
  }
}
