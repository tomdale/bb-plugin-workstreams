/**
 * The screen-space path a moving card's top-centre follows in the lab: the model's own vertical motion, with a
 * small sideways sway that turns the drum's down-and-back-up into one rounded loop.
 *
 * The models move a card only in `y` and depth, so its top-centre runs straight down the column to the turn,
 * stops there, and runs straight back up behind the pile. The sway is a function of the ring coordinate alone,
 * `x = RING_SWAY · sin(π·u)` with `u = −c`, so it adds no state of its own and reverses with the card:
 * - drum, `0 ≤ u ≤ 2`: out to the right in front of the pile, back across the column at the turn (where the
 *   vertical motion stops, so the card keeps moving instead of reversing in place), and to the left behind
 *   the pile before it hides at the tuck. A returning card runs the same loop backwards.
 * - cascade, `0 ≤ u ≤ 1`: one bow to the right down the exit channel and back to the column at the clip line.
 *
 * The vertical coordinate is the drum's and the cascade's own pose map, written out for the card's top edge,
 * so every vertical edge, spring and budget is unchanged: the sway moves cards sideways only.
 */
export type Ring =
  | { kind: "drum"; front: number; turn: number; tuck: number; sway: number }
  | { kind: "channel"; front: number; park: number; sway: number };

/** A point on the ring and its derivative with respect to `u`; `x` is the offset from the column centre. */
export type RingPoint = { x: number; y: number; dx: number; dy: number };
export type Pt = { x: number; y: number };
export type Cubic = [Pt, Pt, Pt, Pt];

const smooth = (r: number) => r * r * (3 - 2 * r);

/** How far along `u` the ring runs: the drum's front and behind segments, or the cascade's one channel. */
export const ringSpan = (r: Ring) => (r.kind === "drum" ? 2 : 1);

/** The sideways offset at `u`, px from the column centre; zero on the pile and once the card is hidden. */
export function ringSway(r: Ring, u: number): number {
  if (u <= 0 || u >= ringSpan(r)) return 0;
  return r.sway * Math.sin(Math.PI * u);
}

/**
 * The top-centre of a card at `u` on the ring. The drum's front segment is `drum.ts`'s `T`, which eases into the
 * turn on a quarter sine, and its behind segment rises from the turn to the tuck on a smoothstep; the cascade's
 * channel is linear in `u` down to the clip line.
 */
export function ringPoint(r: Ring, u: number): RingPoint {
  const span = ringSpan(r);
  const v = Math.min(span, Math.max(0, u));
  const x = r.sway * Math.sin(Math.PI * v);
  const dx = r.sway * Math.PI * Math.cos(Math.PI * v);
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

/** The `u` values where the ring's cubic segments join: the front, each lobe's widest point, the turn and the tuck. */
export const ringKnots = (r: Ring) =>
  r.kind === "drum" ? [0, 0.5, 1, 1.5, 2] : [0, 0.5, 1];

/**
 * The ring as cubic Bezier segments between its knots, in stage coordinates (`cx` is the column centre). Each
 * segment is the cubic Hermite interpolant of the ring's position and derivative at its ends, so the curve and
 * its tangent are continuous at every knot and stay within a small fraction of a pixel of the card's path.
 */
export function ringCubics(r: Ring, cx: number): Cubic[] {
  const knots = ringKnots(r);
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
