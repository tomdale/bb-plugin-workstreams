import { Drum } from "../../../src/app/page/queue/drum.ts";
import { problems, maxJump, summarize } from "./check.mjs";

export const HEIGHTS = {
  w1: [284, 73, 218, 96, 162, 140],
  w2: [262, 92, 170, 330, 118, 150],
  alt: [330, 73],
};
const N = 24;
export const heightsOf = (name) =>
  Array.from({ length: N }, (_, i) => HEIGHTS[name][i % HEIGHTS[name].length]);

/** Drives a Drum on a stepped clock. presses: [{t, dir}] or key holds via `hold`. */
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

export function singles(hset, cfg, hz) {
  const h = heightsOf(hset);
  const frameMs = 1000 / hz;
  const rows = { up: [], down: [] };
  for (const dir of [-1, 1]) {
    for (let s = 1; s <= 11; s++) {
      const d = new Drum(h, cfg);
      d.jump(s);
      const { frames } = record(d, { dur: 1500, hz, presses: [{ t: 0, dir }] });
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
  { dir, from, to, delay = 250, repeat = 33 },
) {
  const h = heightsOf(hset);
  const d = new Drum(h, cfg);
  d.jump(from);
  const { frames, fronts, holds } = record(d, {
    dur: 8000,
    hz,
    holds: [{ t0: 0, dir, delay, repeat, untilFront: to }],
    until: (dr, t) => !dr.isHeld() && !dr.isBusy() && t > 300,
  });
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

export function reversal(hset, cfg, hz, seq) {
  const h = heightsOf(hset);
  const d = new Drum(h, cfg);
  d.jump(6);
  const { frames } = record(d, { dur: 2500, hz, presses: seq });
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

export function releaseTest(hset, cfg, hz) {
  const h = heightsOf(hset);
  const out = [];
  for (const holdMs of [300, 450, 600, 800, 1000, 1300]) {
    const d = new Drum(h, cfg);
    d.jump(14);
    const { frames, fronts, holds } = record(d, {
      dur: 6000,
      hz,
      holds: [{ t0: 0, dir: -1, delay: 250, repeat: 33, t1: holdMs }],
      until: (dr, t) => !dr.isHeld() && !dr.isBusy() && t > holdMs + 200,
    });
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
