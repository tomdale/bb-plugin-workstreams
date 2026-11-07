/**
 * One-at-a-time sweeps over the drum model's settings, on a stepped 60 Hz clock.
 *
 *   node sim/sweep.mjs params   effect of each setting on tap landing, held pace and checker problems
 *   node sim/sweep.mjs slack    how far the next press may start before the previous card flips
 *   node sim/sweep.mjs presets  the named presets side by side
 *
 * Held numbers are 14-card holds in both directions over the three height sets in lib.mjs. Each cell is one
 * run; settings are changed one at a time, so interactions are not measured.
 */
import { PRESETS } from "../src/drum.mjs";
import { holdRun, singles } from "./lib.mjs";
import { run, summary } from "./suite.mjs";

const TAU = 2 * Math.PI;
const SETS = ["w1", "w2", "alt"];
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

/** Setting name, how a value maps to a config, the values to try, and the default (marked with *). */
const PARAMS = [
  ["spring Hz, tap", (v) => ({ omega0: TAU * v }), [2, 3, 4.5], 3],
  [
    "spring Hz, held (needs ramp)",
    (v) => ({ ramp: true, omega1: TAU * v }),
    [3, 4.5, 7],
    4.5,
  ],
  ["edge budget, tap, px/frame", (v) => ({ vcap: v * 60 }), [16, 24, 40], 24],
  [
    "edge budget, held, px/frame (needs ramp)",
    (v) => ({ ramp: true, vcap1: v * 60 }),
    [20, 30, 50],
    30,
  ],
  [
    "hold delay, ms (needs ramp)",
    (v) => ({ ramp: true, holdDelay: v }),
    [0, 250, 600],
    250,
  ],
  [
    "fold Hz (fold on)",
    (v) => ({ fold: true, foldOmega: TAU * v }),
    [0.8, 1.6, 3.2],
    1.6,
  ],
  [
    "folded height, px (fold on)",
    (v) => ({ fold: true, H0: v }),
    [50, 73, 130],
    73,
  ],
  ["tap dip, px", (v) => ({ dip0: v }), [0, 20, 40], 20],
  ["queued presses", (v) => ({ queue: v }), [0, 1, 2], 1],
];

function row(cfg) {
  const taps = SETS.map((h) => singles(h, cfg, 60));
  const up = taps.flatMap((t) => t.up),
    dn = taps.flatMap((t) => t.down);
  const holds = (dir) =>
    SETS.map((h) =>
      holdRun(h, cfg, 60, {
        dir,
        from: dir > 0 ? 1 : 14,
        to: dir > 0 ? 14 : 1,
      }),
    );
  const hu = holds(-1),
    hd = holds(1);
  const mean = (hs) => hs.reduce((a, h) => a + h.meanRate, 0) / hs.length;
  return {
    upLand: med(up.map((r) => r.land)),
    dnLand: med(dn.map((r) => r.land)),
    landSpeed: Math.max(
      ...up.map((r) => r.landSpeed),
      ...dn.map((r) => r.landSpeed),
    ),
    heldUp: mean(hu),
    heldDn: mean(hd),
    heldJump: Math.max(
      ...hu.map((h) => h.maxJump),
      ...hd.map((h) => h.maxJump),
    ),
    problems:
      [...up, ...dn].reduce((a, r) => a + r.probCorr, 0) +
      [...hu, ...hd].reduce((a, h) => a + h.probCorr, 0),
  };
}
const f = (x, d = 1) => x.toFixed(d);

const mode = process.argv[2];
if (mode === "params") {
  console.log(
    "| Setting | Value | Tap ↑ lands, ms | Tap ↓ settles, ms | Landing speed, px/frame | Held ↑ / ↓, cards/s | Max held jump, px | Problems |\n|---|---|---|---|---|---|---|---|",
  );
  for (const [name, mk, vals, def] of PARAMS)
    for (const v of vals) {
      const r = row(mk(v));
      console.log(
        `| ${vals[0] === v ? name : ""} | ${v}${v === def ? "*" : ""} | ${f(r.upLand, 0)} | ${f(r.dnLand, 0)} | ${f(r.landSpeed)} | ${f(r.heldUp)} / ${f(r.heldDn)} | ${f(r.heldJump, 0)} | ${r.problems} |`,
      );
    }
  for (const [label, cfg] of [
    ["folding off", {}],
    ["folding on", { fold: true }],
  ]) {
    const r = row(cfg);
    console.log(
      `| Folding | ${label} | ${f(r.upLand, 0)} | ${f(r.dnLand, 0)} | ${f(r.landSpeed)} | ${f(r.heldUp)} / ${f(r.heldDn)} | ${f(r.heldJump, 0)} | ${r.problems} |`,
    );
  }
} else if (mode === "slack") {
  console.log(
    "| Slack | Cards/s (mean of 6 holds) | Worst settle, ms | Problems | Kinds |\n|---|---|---|---|---|",
  );
  for (const slack of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.5]) {
    let c = 0,
      settle = 0,
      pr = 0;
    const kinds = { jump: 0, band: 0, shade: 0, swap: 0 };
    for (const h of SETS)
      for (const dir of [1, -1]) {
        const r = holdRun(h, { gateSlack: slack }, 60, {
          dir,
          from: dir > 0 ? 1 : 14,
          to: dir > 0 ? 14 : 1,
        });
        c += r.meanRate / 6;
        settle = Math.max(settle, r.settledMs);
        pr += r.probCorr;
        for (const k in kinds) kinds[k] += r.kinds[k];
      }
    console.log(
      `| ${slack} | ${f(c)} | ${f(settle, 0)}${settle >= 8000 ? " (never settled)" : ""} | ${pr} | ${JSON.stringify(kinds)} |`,
    );
  }
} else if (mode === "presets") {
  console.log(
    "| Preset | Held ↑ / ↓, cards/s | Interval range, ms | Worst step-to-step change | Max held jump, px | Problems (taps / holds / reversals) |\n|---|---|---|---|---|---|",
  );
  for (const name of Object.keys(PRESETS)) {
    const S = summary(run(PRESETS[name], 60));
    console.log(
      `| ${name} | ${f(S["held ↑ cards/s (mean of sets)"])} / ${f(S["held ↓ cards/s (mean of sets)"])} | ${S["held interval range, ms"]} | ${f(S["worst step-to-step interval change"], 2)}× | ${f(S["held max jump, px/frame"], 0)} | ${S["problems (corrected rule): taps / holds / reversals"]} |`,
    );
  }
} else {
  console.error("usage: node sim/sweep.mjs params|slack|presets");
  process.exit(2);
}
