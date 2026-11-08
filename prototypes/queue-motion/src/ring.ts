/**
 * The screen-space path a moving card's top-centre follows in the lab: the model's own vertical motion, with a
 * sideways sway that turns the drum's down-and-back-up into one rounded loop.
 *
 * The models move a card only in `y` and depth, so its top-centre runs straight down the column to the turn,
 * stops there, and runs straight back up behind the pile. The sway is a function of the ring coordinate alone
 * (`u = −c`), roughly `x = sway · sin(π·u)`, so it adds no state of its own and reverses with the card:
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
  /** How far along each leg the widest point sits, 0.25 to 0.75 of the leg; the behind leg mirrors it. */
  peak: number;
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
 * A monotonic warp of `[0, 1]` that sends `peak` to one half, with finite slopes `1/k` at 0 and `k` at 1, where
 * `k = peak / (1 − peak)`. Running the sine's phase through it moves the widest point without a corner.
 */
function warp(v: number, peak: number): { w: number; dw: number } {
  const k = peak / (1 - peak);
  const d = v + (1 - v) * k;
  return { w: v / d, dw: k / (d * d) };
}

/**
 * The sideways offset at `u` and its derivative: `x = A(u)·sin Θ(u)`. The phase `Θ` runs through `warp` on the
 * front leg and through its mirror image on the behind leg, so both legs meet at the turn with the same slope.
 * The amplitude eases from the front leg's to the behind leg's between their widest points on a smoothstep, so
 * a different width behind adds no corner either.
 */
function sideways(r: Ring, u: number): { x: number; dx: number } {
  const { front, behind, peak } = r.sway;
  if (r.kind === "channel") {
    const { w, dw } = warp(u, peak);
    return {
      x: front * Math.sin(Math.PI * w),
      dx: front * Math.cos(Math.PI * w) * Math.PI * dw,
    };
  }
  let th: number, dth: number;
  if (u <= 1) {
    const { w, dw } = warp(u, peak);
    th = Math.PI * w;
    dth = Math.PI * dw;
  } else {
    const { w, dw } = warp(2 - u, peak);
    th = Math.PI * (2 - w);
    dth = Math.PI * dw;
  }
  // sin Θ is negative behind the pile, so the amplitude there is the negated offset.
  const a0 = front,
    a1 = -behind,
    span = 2 - 2 * peak;
  const t = clamp01((u - peak) / span);
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
 * The `u` values where the ring's cubic segments join: the front, each leg's widest point, the turn and the
 * tuck, with `inner` more knots spaced evenly inside each stretch between them. Two keep the curve within a
 * pixel at any slider setting; fewer show how far a coarse fit strays from the path the cards follow.
 */
export function ringKnots(r: Ring, inner = INNER_KNOTS): number[] {
  const p = r.sway.peak;
  const n = inner + 1;
  const leg = [
    ...Array.from({ length: n }, (_, k) => (p * k) / n),
    ...Array.from({ length: n }, (_, k) => p + ((1 - p) * k) / n),
    1,
  ];
  return r.kind === "drum"
    ? [
        ...leg,
        ...leg
          .slice(0, -1)
          .reverse()
          .map((v) => 2 - v),
      ]
    : leg;
}

/** The knots that mark a named point: each leg's widest point. */
export const ringPeaks = (r: Ring) =>
  r.kind === "drum" ? [r.sway.peak, 2 - r.sway.peak] : [r.sway.peak];
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
