import {
  Drum,
  LEAD,
  PRESETS as DRUM_PRESETS,
} from "../../../src/app/page/queue/drum.ts";
import { Cascade, PRESETS as CASCADE_PRESETS } from "../src/cascade.ts";
import { problems, maxJump, summarize } from "./check.mjs";

/**
 * A model the scenarios below can drive: its constructor `Model(heights, config)` and the named settings
 * `PRESETS` it ships with. Every scenario takes one in its options, `{ model, onFrames }`, and defaults to the
 * drum. `onFrames(frames, info)` is called with the frames of each scenario run, so a caller can measure what
 * the scenario's own result leaves out; `info.kind` says which scenario it was.
 */
export const DRUM = { name: "drum", Model: Drum, PRESETS: DRUM_PRESETS };
export const CASCADE = {
  name: "cascade",
  Model: Cascade,
  PRESETS: CASCADE_PRESETS,
};

export const HEIGHTS = {
  w1: [284, 73, 218, 96, 162, 140],
  w2: [262, 92, 170, 330, 118, 150],
  alt: [330, 73],
};
const N = 24;
export const heightsOf = (name) =>
  Array.from({ length: N }, (_, i) => HEIGHTS[name][i % HEIGHTS[name].length]);

/** Drives a model on a stepped clock. presses: [{t, dir}] or key holds via `hold`. */
export function record(
  drum,
  { dur, hz = 60, presses = [], holds = [], until = null },
) {
  const frameMs = 1000 / hz;
  const frames = [],
    fronts = [];
  const pr = [...presses].sort((a, b) => a.t - b.t);
  let pi = 0;
  const hs = holds.map((h) => ({ ...h, next: h.t0, done: false, up: false }));
  for (let n = 0; n * frameMs <= dur; n++) {
    const t = n * frameMs;
    while (pi < pr.length && pr[pi].t <= t + 1e-6) {
      drum.press(pr[pi].dir);
      pi++;
    }
    for (const h of hs) {
      if (h.done) continue;
      if (t + 1e-6 >= h.t0 && !h.started) {
        h.started = true;
        drum.keyDown(h.dir);
        h.next = h.t0 + h.delay;
      }
      if (h.started) {
        const stop =
          (h.untilFront !== undefined && drum.front === h.untilFront) ||
          (h.t1 !== undefined && t + 1e-6 >= h.t1);
        if (stop) {
          drum.keyUp();
          h.done = true;
          h.tEnd = t;
          continue;
        }
        while (h.next <= t + 1e-6) {
          drum.press(h.dir);
          h.next += h.repeat;
        }
      }
    }
    if (n === 0) {
      frames.push(drum.views());
      fronts.push({ t: 0, front: drum.front });
    }
    drum.step(frameMs);
    frames.push(drum.views());
    fronts.push({ t: (n + 1) * frameMs, front: drum.front });
    if (until && until(drum, t)) break;
  }
  return { frames, fronts, holds: hs };
}

/** Frame index at which card `i` has landed at the front (|c| < 0.01 and edge speed < 0.5 px/frame). */
function landFrame(frames, i) {
  const fin = frames.at(-1)[i];
  for (let n = 1; n < frames.length; n++) {
    const v = frames[n][i],
      p = frames[n - 1][i];
    if (
      Math.abs(v.top - fin.top) < 2 &&
      Math.abs(v.natBottom - fin.natBottom) < 2 &&
      Math.abs(v.top - p.top) < 1 &&
      Math.abs(v.natBottom - p.natBottom) < 1
    )
      return n;
  }
  return -1;
}
function firstChange(frames) {
  for (let n = 1; n < frames.length; n++) {
    const a = new Map(frames[n - 1].map((c) => [c.key, c]));
    for (const c of frames[n]) {
      const p = a.get(c.key);
      if (c.painted !== p.painted) return n;
      if (
        c.painted &&
        (Math.abs(c.top - p.top) > 0.5 || Math.abs(c.bottom - p.bottom) > 0.5)
      )
        return n;
    }
  }
  return -1;
}
function landingSpeed(frames, i, land) {
  let m = 0;
  for (let n = Math.max(1, land - 5); n <= land && n < frames.length; n++) {
    const v = frames[n][i],
      p = frames[n - 1][i];
    if (!v.painted || !p.painted) continue;
    m = Math.max(
      m,
      Math.abs(v.top - p.top),
      Math.abs(v.natBottom - p.natBottom),
    );
  }
  return m;
}

export function singles(hset, cfg, hz, { model = DRUM, onFrames } = {}) {
  const h = heightsOf(hset);
  const frameMs = 1000 / hz;
  const rows = { up: [], down: [] };
  for (const dir of [-1, 1]) {
    for (let s = 1; s <= 11; s++) {
      const d = new model.Model(h, cfg);
      d.jump(s);
      const { frames } = record(d, { dur: 1500, hz, presses: [{ t: 0, dir }] });
      onFrames?.(frames, { kind: "tap", hset, dir, start: s });
      const i = s + dir;
      const land = landFrame(frames, i);
      const po = problems(frames, "orig"),
        pc = problems(frames, "corrected");
      const mover = dir > 0 ? s : i; // ↓: the leaver; ↑: the arriver
      const flip = frames.findIndex(
        (f, n) => n > 0 && (dir > 0 ? f[mover].c <= -1 : f[mover].c >= -1),
      );
      const uncover =
        dir > 0
          ? frames.findIndex((f, n) => n > 0 && f[s].top >= f[i].natBottom)
          : -1;
      const loop =
        dir > 0
          ? frames.findIndex(
              (f, n) => n > 0 && (Math.abs(f[s].c + 2) < 0.02 || !f[s].painted),
            )
          : -1;
      rows[dir < 0 ? "up" : "down"].push({
        start: s,
        hFront: h[s],
        hNew: h[i],
        first: firstChange(frames) * frameMs,
        land: land * frameMs,
        flip: flip * frameMs,
        uncover: uncover * frameMs,
        loop: loop * frameMs,
        landSpeed: landingSpeed(frames, i, land),
        maxJump: maxJump(frames),
        probOrig: po.length,
        probCorr: pc.length,
        kinds: summarize(pc),
        settle: (frames.length - 1) * frameMs,
      });
    }
  }
  return rows;
}

export function holdRun(
  hset,
  cfg,
  hz,
  { dir, from, to, delay = 250, repeat = 33, model = DRUM, onFrames },
) {
  const h = heightsOf(hset);
  const d = new model.Model(h, cfg);
  d.jump(from);
  const { frames, fronts, holds } = record(d, {
    dur: 8000,
    hz,
    holds: [{ t0: 0, dir, delay, repeat, untilFront: to }],
    until: (dr, t) => !dr.isHeld() && !dr.isBusy() && t > 300,
  });
  onFrames?.(frames, { kind: "hold", hset, dir, from, to });
  const changes = [];
  for (let n = 1; n < fronts.length; n++)
    if (fronts[n].front !== fronts[n - 1].front) changes.push(fronts[n].t);
  const intervals = changes.slice(1).map((t, k) => t - changes[k]);
  const po = problems(frames, "orig"),
    pc = problems(frames, "corrected");
  return {
    dir,
    from,
    to,
    cards: changes.length,
    heldMs: holds[0].tEnd,
    settledMs: ((frames.length - 1) * 1000) / hz,
    intervals,
    ratePerCard: intervals.map((ms) => 1000 / ms),
    meanRate: intervals.length
      ? 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length)
      : 0,
    maxRate: intervals.length ? 1000 / Math.min(...intervals) : 0,
    maxJump: maxJump(frames),
    probOrig: po.length,
    probCorr: pc.length,
    kinds: summarize(pc),
    frames,
  };
}

export function reversal(hset, cfg, hz, seq, { model = DRUM, onFrames } = {}) {
  const h = heightsOf(hset);
  const d = new model.Model(h, cfg);
  d.jump(6);
  const { frames } = record(d, { dur: 2500, hz, presses: seq });
  onFrames?.(frames, { kind: "reversal", hset, seq });
  // velocity continuity: per painted card, |Δ(edge velocity)| between consecutive frames, max over the frames right after each press vs overall
  let maxDv = 0,
    maxDvAtPress = 0;
  const pressFrames = new Set(seq.map((p) => Math.round((p.t * hz) / 1000)));
  for (let n = 2; n < frames.length; n++) {
    for (let i = 0; i < frames[n].length; i++) {
      const a = frames[n - 2][i],
        b = frames[n - 1][i],
        c = frames[n][i];
      if (!a.painted || !b.painted || !c.painted) continue;
      const dv = Math.abs(c.top - b.top - (b.top - a.top));
      maxDv = Math.max(maxDv, dv);
      if (pressFrames.has(n - 1) || pressFrames.has(n - 2))
        maxDvAtPress = Math.max(maxDvAtPress, dv);
    }
  }
  const pc = problems(frames, "corrected"),
    po = problems(frames, "orig");
  return {
    maxJump: maxJump(frames),
    probCorr: pc.length,
    probOrig: po.length,
    kinds: summarize(pc),
    maxDv,
    maxDvAtPress,
    settle: ((frames.length - 1) * 1000) / hz,
  };
}

export function releaseTest(hset, cfg, hz, { model = DRUM, onFrames } = {}) {
  const h = heightsOf(hset);
  const out = [];
  for (const holdMs of [300, 450, 600, 800, 1000, 1300]) {
    const d = new model.Model(h, cfg);
    d.jump(14);
    const { frames, fronts, holds } = record(d, {
      dur: 6000,
      hz,
      holds: [{ t0: 0, dir: -1, delay: 250, repeat: 33, t1: holdMs }],
      until: (dr, t) => !dr.isHeld() && !dr.isBusy() && t > holdMs + 200,
    });
    onFrames?.(frames, { kind: "release", hset, holdMs });
    const relFrame = Math.round((holdMs * hz) / 1000);
    const frontAtRelease = fronts[relFrame].front;
    const final = fronts.at(-1).front;
    const last = frames.at(-1);
    const rest = last.every((v) => Math.abs(v.c - Math.round(v.c)) < 1e-3);
    out.push({
      holdMs,
      frontAtRelease,
      final,
      extraCards: frontAtRelease - final,
      restsOnCard: rest,
      probCorr: problems(frames, "corrected").length,
      settleAfterRelease: ((frames.length - 1) * 1000) / hz - holdMs,
    });
  }
  return out;
}

// ---- measurements the scenarios' own results leave out ---------------------------------------------------

/** Screen px of `card` that no nearer painted card covers. */
function unoccluded(frame, card) {
  const spans = frame
    .filter((o) => o.painted && o.layer > card.layer)
    .map((o) => [Math.max(o.top, card.top), Math.min(o.bottom, card.bottom)])
    .filter(([lo, hi]) => hi > lo)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0,
    end = -Infinity;
  for (const [lo, hi] of spans) {
    covered += Math.max(0, hi - Math.max(lo, end));
    end = Math.max(end, hi);
  }
  return Math.max(0, card.bottom - card.top - covered);
}

/**
 * What a hold shows of each card that passes the front: for every card strictly between `from` and `to`, the
 * most px of it that no nearer card covers in any frame (`best`), and in how many frames it shows at least
 * min(height, 100) px (`frames`). `heights` are the cards' own heights.
 */
export function legibility(frames, heights, from, to) {
  const lo = Math.min(from, to),
    hi = Math.max(from, to);
  const best = new Map(),
    shown = new Map();
  for (const frame of frames)
    for (const c of frame) {
      if (!c.painted || c.i <= lo || c.i >= hi) continue;
      const v = unoccluded(frame, c);
      best.set(c.i, Math.max(best.get(c.i) ?? 0, v));
      if (v >= Math.min(heights[c.i], 100))
        shown.set(c.i, (shown.get(c.i) ?? 0) + 1);
    }
  const cards = [];
  for (let i = lo + 1; i < hi; i++)
    cards.push({
      i,
      h: heights[i],
      best: best.get(i) ?? 0,
      frames: shown.get(i) ?? 0,
    });
  return cards;
}

/** The most cards painted in front of the pile at once: the cascade's channel, or the drum's drop. */
export function channelPeak(frames) {
  let m = 0;
  for (const f of frames)
    m = Math.max(m, f.filter((c) => c.painted && c.group === 0).length);
  return m;
}

/** The lowest drawn edge of any painted card, px below the top of the front pose. */
export function lowestEdge(frames) {
  let m = -Infinity;
  for (const f of frames)
    for (const c of f) if (c.painted) m = Math.max(m, c.bottom - LEAD);
  return m;
}

/**
 * Ms from `releaseMs` until the last frame in which a painted edge moved more than half a px, or a card
 * appeared or vanished: how long the cards keep moving after the key is up.
 */
export function drainMs(frames, hz, releaseMs) {
  const frameMs = 1000 / hz;
  let last = Math.ceil(releaseMs / frameMs);
  for (let n = 1; n < frames.length; n++) {
    const prev = new Map(frames[n - 1].map((c) => [c.key, c]));
    const moving = frames[n].some((c) => {
      const p = prev.get(c.key);
      return (
        c.painted !== p.painted ||
        (c.painted &&
          (Math.abs(c.top - p.top) > 0.5 ||
            Math.abs(c.bottom - p.bottom) > 0.5))
      );
    });
    if (moving) last = Math.max(last, n);
  }
  return Math.max(0, last * frameMs - releaseMs);
}

/**
 * Held pace, cards/s, of a 14-card hold started at each of `phases` (ms after the first frame) with the key
 * repeating every 33 ms from 33 ms on. The repeat presses meet the frame grid at a different offset for each
 * phase, so the average is the gate's pace and not one alignment's. Where `holdRun` waits 250 ms for the first
 * repeat, this starts repeating at once, which is the pace the gate sets rather than the keyboard's delay.
 */
export function repeatPace(hset, cfg, hz, dir, phases, { model = DRUM } = {}) {
  const h = heightsOf(hset);
  const from = dir > 0 ? 1 : 14,
    to = dir > 0 ? 14 : 1;
  return phases.map((phase) => {
    const d = new model.Model(h, cfg);
    d.jump(from);
    const { fronts } = record(d, {
      dur: 6000,
      hz,
      holds: [{ t0: phase, dir, delay: 33, repeat: 33, untilFront: to }],
      until: (dr, t) => t > phase + 100 && !dr.isHeld(),
    });
    const changes = [];
    for (let n = 1; n < fronts.length; n++)
      if (fronts[n].front !== fronts[n - 1].front) changes.push(fronts[n].t);
    const intervals = changes.slice(1).map((t, k) => t - changes[k]);
    return 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length);
  });
}
