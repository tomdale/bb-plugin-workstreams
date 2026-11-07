/**
 * Frame checker. `problems(frames, mode)`:
 *   mode "orig"      — the product test's rule set (jump 40 px, clip band 16 px must be covered in the NEW
 *                      frame, shade 0.2, draw-order swap while overlapping unless covered by a third card).
 *   mode "corrected" — same, but a clip band must be covered in the frame in which the card was drawn there
 *                      (new frame for an appearing band, OLD frame for a disappearing one), and the band
 *                      threshold is a parameter.
 * Frames are arrays of views {key, painted, layer, scale, top, bottom, natBottom, shade}.
 */
const byKey = (frame) => new Map(frame.map((c) => [c.key, c]));
const overlap = (x, y) => Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
function covered(lo, hi, minScale, all, exclude) {
  return all.some(
    (o) =>
      !exclude.includes(o) &&
      o.painted &&
      o.top <= lo + 0.5 &&
      o.bottom >= hi - 0.5 &&
      o.scale >= minScale - 0.002 &&
      exclude.every((e) => o.layer > e.layer),
  );
}
export function problems(frames, mode = "orig", opts = {}) {
  const jump = opts.jump ?? 40,
    band = opts.band ?? 16,
    shadeMax = opts.shade ?? 0.2;
  const out = [];
  for (let n = 1; n < frames.length; n++) {
    const A = frames[n - 1],
      B = frames[n];
    const a = byKey(A),
      b = byKey(B);
    const both = B.filter((c) => c.painted && a.get(c.key)?.painted);
    for (const c of both) {
      const p = a.get(c.key);
      if (Math.abs(c.top - p.top) > jump)
        out.push({ n, kind: "jump", key: c.key, v: c.top - p.top });
      if (Math.abs(c.natBottom - p.natBottom) > jump)
        out.push({ n, kind: "jump", key: c.key, v: c.natBottom - p.natBottom });
      const clip = c.bottom - p.bottom - (c.natBottom - p.natBottom);
      if (Math.abs(clip) > band) {
        const expected = p.bottom + (c.natBottom - p.natBottom);
        let lo = Math.min(expected, c.bottom),
          hi = Math.max(expected, c.bottom);
        if (mode !== "orig") {
          lo = Math.min(p.bottom, c.bottom);
          hi = Math.max(p.bottom, c.bottom);
        } // rows actually drawn/undrawn
        let hidden;
        if (mode === "orig" || clip > 0)
          hidden = covered(lo, hi, c.scale, B, [c]);
        else hidden = covered(lo, hi, p.scale, A, [p]); // disappearing band: was it under a card when drawn?
        if (!hidden) out.push({ n, kind: "band", key: c.key, v: clip });
      }
      if (Math.abs(c.shade - p.shade) > shadeMax)
        out.push({ n, kind: "shade", key: c.key, v: c.shade - p.shade });
    }
    for (const x of both)
      for (const y of both) {
        if (x.key >= y.key) continue;
        const before = Math.sign(a.get(x.key).layer - a.get(y.key).layer);
        const after = Math.sign(x.layer - y.layer);
        if (before === after) continue;
        if (
          overlap(x, y) > 1 &&
          !covered(
            Math.max(x.top, y.top),
            Math.min(x.bottom, y.bottom),
            Math.min(x.scale, y.scale),
            B,
            [x, y],
          )
        )
          out.push({
            n,
            kind: "swap",
            key: x.key + "/" + y.key,
            v: overlap(x, y),
          });
      }
  }
  return out;
}
/** Largest per-frame motion of any painted card's top or natural bottom, px. */
export function maxJump(frames) {
  let m = 0;
  for (let n = 1; n < frames.length; n++) {
    const a = byKey(frames[n - 1]);
    for (const c of frames[n]) {
      const p = a.get(c.key);
      if (!c.painted || !p?.painted) continue;
      m = Math.max(
        m,
        Math.abs(c.top - p.top),
        Math.abs(c.natBottom - p.natBottom),
      );
    }
  }
  return m;
}
export function summarize(list) {
  const k = { jump: 0, band: 0, shade: 0, swap: 0 };
  for (const p of list) k[p.kind]++;
  return k;
}
