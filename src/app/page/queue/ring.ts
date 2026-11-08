/**
 * The screen-space path a moving card's top-centre follows: the model's own vertical motion, with a
 * sideways sway that turns the drum's down-and-back-up into one rounded loop.
 *
 * The models move a card only in `y` and depth, so its top-centre runs straight down the column to the turn,
 * stops there, and runs straight back up behind the pile. The sway is a function of the ring coordinate alone
 * (`u = −c`), roughly `x = sway · sin(π·u)` (see `sideways`), so it adds no state of its own and reverses with the card:
 * - drum, `0 ≤ u ≤ 2`, with the default sliders: out to the right in front of the pile, back across the column at the turn (where the
 *   vertical motion stops, so the card keeps moving instead of reversing in place), and to the left behind
 *   the pile before it hides at the tuck. A returning card runs the same loop backwards.
 * - cascade, `0 ≤ u ≤ 1`: one bow to the side down the exit channel and back to the column at the clip line.
 *
 * The vertical coordinate is the drum's and the cascade's own pose map, written out for the card's top edge,
 * so every vertical edge, spring and budget is unchanged: the sway moves cards sideways only.
 */

/** The sideways shape of the path, set by the Path sliders; see `PATH_SETTINGS` in controls.ts. */
export type Sway = {
  /** Widest offset of the leg in front of the pile, px; positive is to the right. */
  front: number;
  /** Widest offset of the drum's leg behind the pile, px; positive is to the right. */
  behind: number;
  /** How far along the front leg, from the front, the widest point sits: 0.25 to 0.75 of the leg. */
  peak: number;
  /** How far along the drum's behind leg, from the tuck, its widest point sits: 0.25 to 0.75 of the leg. */
  peakBehind: number;
  /**
   * Where the drum's path crosses the column, in ring units from the turn: 0 crosses at the turn, a negative
   * value before it (the card reaches the turn already on the behind leg's side), a positive one after it.
   */
  cross: number;
};

export type Ring =
  | { kind: "drum"; front: number; turn: number; tuck: number; sway: Sway }
  | { kind: "channel"; front: number; park: number; sway: Sway };

/** A point on the ring and its derivative with respect to `u`; `x` is the offset from the column centre. */
export type RingPoint = { x: number; y: number; dx: number; dy: number };
export type Pt = { x: number; y: number };
export type Cubic = [Pt, Pt, Pt, Pt];

const smooth = (r: number) => r * r * (3 - 2 * r);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How far along `u` the ring runs: the drum's front and behind segments, or the cascade's one channel. */
export const ringSpan = (r: Ring) => (r.kind === "drum" ? 2 : 1);

/**
 * The points that shape the sway, as `u` values: where the path leaves the column, each leg's widest point, where
 * it crosses the column, and where it ends. The sine's phase passes a quarter turn at each, so the path is on
 * the column at the even ones and widest at the odd ones.
 */
export function ringShape(r: Ring): number[] {
  const { peak, peakBehind, cross } = r.sway;
  if (r.kind === "channel") return [0, peak, 1];
  const c = 1 + cross;
  return [0, peak * c, c, 2 - peakBehind * (2 - c), 2];
}

/**
 * The phase `Θ(u)` and its slope: a monotone piecewise cubic (Fritsch–Carlson) through a quarter turn at each of
 * `ringShape`'s points, so the widest points and the crossing land where the sliders put them and the slope
 * never jumps. With evenly spaced points it is the straight line `π·u`, a plain sine.
 */
function phase(xs: number[], u: number): { th: number; dth: number } {
  const n = xs.length;
  const ys = xs.map((_, k) => (Math.PI / 2) * k);
  const d = xs.slice(1).map((x, k) => (ys[k + 1]! - ys[k]!) / (x - xs[k]!));
  const m = xs.map((_, k) => {
    if (k === 0)
      return Math.max(
        0,
        ((2 * (xs[1]! - xs[0]!) + (xs[2]! - xs[1]!)) * d[0]! -
          (xs[1]! - xs[0]!) * d[1]!) /
          (xs[2]! - xs[0]!),
      );
    if (k === n - 1) {
      const h0 = xs[k - 1]! - xs[k - 2]!,
        h1 = xs[k]! - xs[k - 1]!;
      return Math.max(
        0,
        ((2 * h1 + h0) * d[k - 1]! - h1 * d[k - 2]!) / (h0 + h1),
      );
    }
    const h0 = xs[k]! - xs[k - 1]!,
      h1 = xs[k + 1]! - xs[k]!;
    const w1 = 2 * h1 + h0,
      w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / d[k - 1]! + w2 / d[k]!);
  });
  let k = 0;
  while (k < n - 2 && u > xs[k + 1]!) k++;
  const h = xs[k + 1]! - xs[k]!;
  const t = (u - xs[k]!) / h;
  const t2 = t * t,
    t3 = t2 * t;
  const th =
    (2 * t3 - 3 * t2 + 1) * ys[k]! +
    (t3 - 2 * t2 + t) * h * m[k]! +
    (-2 * t3 + 3 * t2) * ys[k + 1]! +
    (t3 - t2) * h * m[k + 1]!;
  const dth =
    ((6 * t2 - 6 * t) * ys[k]! +
      (3 * t2 - 4 * t + 1) * h * m[k]! +
      (-6 * t2 + 6 * t) * ys[k + 1]! +
      (3 * t2 - 2 * t) * h * m[k + 1]!) /
    h;
  return { th, dth };
}

/**
 * The sideways offset at `u` and its derivative: `x = A(u)·sin Θ(u)`, with `Θ` from `phase`. The amplitude eases
 * from the front leg's to the behind leg's between their widest points on a smoothstep, so a different width
 * behind adds no corner.
 */
function sideways(r: Ring, u: number): { x: number; dx: number } {
  const shape = ringShape(r);
  const { th, dth } = phase(shape, u);
  if (r.kind === "channel") {
    const a = r.sway.front;
    return { x: a * Math.sin(th), dx: a * Math.cos(th) * dth };
  }
  // sin Θ is negative behind the pile, so the amplitude there is the negated offset.
  const a0 = r.sway.front,
    a1 = -r.sway.behind;
  const from = shape[1]!,
    span = shape[3]! - from;
  const t = clamp01((u - from) / span);
  const a = a0 + (a1 - a0) * smooth(t);
  const da = t > 0 && t < 1 ? ((a1 - a0) * 6 * t * (1 - t)) / span : 0;
  return {
    x: a * Math.sin(th),
    dx: da * Math.sin(th) + a * Math.cos(th) * dth,
  };
}

/** The sideways offset at `u`, px from the column centre; zero on the pile and once the card is hidden. */
export function ringSway(r: Ring, u: number): number {
  if (u <= 0 || u >= ringSpan(r)) return 0;
  return sideways(r, u).x;
}

/**
 * The top-centre of a card at `u` on the ring. The drum's front segment is `drum.ts`'s `T`, which eases into the
 * turn on a quarter sine, and its behind segment rises from the turn to the tuck on a smoothstep; the cascade's
 * channel is linear in `u` down to the clip line.
 */
export function ringPoint(r: Ring, u: number): RingPoint {
  const span = ringSpan(r);
  const v = Math.min(span, Math.max(0, u));
  const { x, dx } = sideways(r, v);
  if (r.kind === "channel") {
    const d = r.park - r.front;
    return { x, y: r.front + d * v, dx, dy: d };
  }
  if (v <= 1) {
    const d = r.turn - r.front;
    return {
      x,
      y: r.front + d * Math.sin((Math.PI / 2) * v),
      dx,
      dy: d * (Math.PI / 2) * Math.cos((Math.PI / 2) * v),
    };
  }
  const s = v - 1;
  const e = r.tuck - r.turn;
  return { x, y: r.turn + e * smooth(s), dx, dy: e * 6 * s * (1 - s) };
}

/** Knots inside each stretch of the ring when nothing overrides it: enough to keep the fit within a pixel. */
export const INNER_KNOTS = 2;

/**
 * The `u` values where the ring's cubic segments join: `ringShape`'s points and, on the drum, the turn (`u = 1`,
 * where the path passes behind the pile), with `inner` more knots spaced evenly inside each stretch between
 * them. Two keep the curve within a pixel at any slider setting; fewer show how far a coarse fit strays from the
 * path the cards follow.
 */
export function ringKnots(r: Ring, inner = INNER_KNOTS): number[] {
  const named = [...ringShape(r)];
  if (r.kind === "drum" && !named.some((u) => Math.abs(u - 1) < 1e-9))
    named.push(1);
  named.sort((a, b) => a - b);
  const n = inner + 1;
  const out: number[] = [];
  for (let k = 0; k + 1 < named.length; k++)
    for (let j = 0; j < n; j++)
      out.push(named[k]! + ((named[k + 1]! - named[k]!) * j) / n);
  out.push(named[named.length - 1]!);
  return out;
}

/** Each leg's widest point, as `u`. */
export const ringPeaks = (r: Ring) => {
  const shape = ringShape(r);
  return r.kind === "drum" ? [shape[1]!, shape[3]!] : [shape[1]!];
};

/** Where the drum's path crosses the column, as `u`; the cascade's channel never does. */
export const ringCrossing = (r: Ring) =>
  r.kind === "drum" ? ringShape(r)[2]! : null;

/**
 * The ring as cubic Bezier segments between its knots, in stage coordinates (`cx` is the column centre). Each
 * segment is the cubic Hermite interpolant of the ring's position and derivative at its ends, so the curve and
 * its tangent are continuous at every knot; with the default `inner` it stays within a small fraction of a pixel
 * of the card's path.
 */
export function ringCubics(r: Ring, cx: number, inner = INNER_KNOTS): Cubic[] {
  const knots = ringKnots(r, inner);
  const out: Cubic[] = [];
  for (let k = 0; k + 1 < knots.length; k++) {
    const a = knots[k]!;
    const b = knots[k + 1]!;
    const h = (b - a) / 3;
    const p = ringPoint(r, a);
    const q = ringPoint(r, b);
    out.push([
      { x: cx + p.x, y: p.y },
      { x: cx + p.x + h * p.dx, y: p.y + h * p.dy },
      { x: cx + q.x - h * q.dx, y: q.y - h * q.dy },
      { x: cx + q.x, y: q.y },
    ]);
  }
  return out;
}
