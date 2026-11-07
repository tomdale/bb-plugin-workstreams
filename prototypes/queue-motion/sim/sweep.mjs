/**
 * One-at-a-time sweeps over the drum model's settings, on a stepped 60 Hz clock.
 *
 *   node sim/sweep.mjs params   each setting's effect on tap landing, held pace and checker problems
 *   node sim/sweep.mjs slack    how far the next press may start before the previous card flips
 *   node sim/sweep.mjs presets  the named presets side by side
 *   node sim/sweep.mjs held     how fast the held state ramps in, and how far a short tap pushes it
 *   node sim/sweep.mjs limits   the checker's thresholds, the sample card heights and the planner's estimates
 *
 * Held numbers are 14-card holds in both directions over the three height sets in lib.mjs. Each cell is one
 * run. A setting changes alone, on top of the context named beside it, so an interaction between settings shows
 * as the difference between two contexts. The page's tooltips quote these numbers: `build.mjs` calls
 * `computeFacts` below, so every figure in them can be reproduced with the command above that prints it.
 */
import { Drum, PRESETS } from "../src/drum.mjs";
import { HEIGHTS, heightsOf, holdRun, singles } from "./lib.mjs";
import { LIMITS } from "./check.mjs";
import { run, summary } from "./suite.mjs";

const TAU = 2 * Math.PI;
/** The refresh rate every sweep runs at. */
export const HZ = 60;
const SETS = ["w1", "w2", "alt"];
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const sum = (a) => a.reduce((x, y) => x + y, 0);

const preset = (name) => {
  if (!PRESETS[name])
    throw new Error(`sweep context names a missing preset: ${name}`);
  return PRESETS[name];
};
/** The configurations a setting is swept on. A preset's name means that preset. */
export const CONTEXTS = {
  natural: preset("natural"),
  even: preset("even"),
  "even + held speed": preset("even + held speed"),
  fold: preset("fold"),
  "held speed-up alone": { ramp: true },
  constant: { tempo: { kind: "constant" } },
  "constant with held speed-up": { ramp: true, tempo: { kind: "constant" } },
  "fold with constant": { fold: true, tempo: { kind: "constant" } },
};
const withTempo = (base, patch) => ({
  ...base,
  ...patch,
  tempo: { ...base.tempo, ...patch.tempo },
});

/**
 * A setting's sweep. `id` is the setting's short name on the page (the hash key). `values` are the points
 * measured and `def` the one the context starts at (marked `*` in the table). `taps` is true for a setting that
 * changes a single press; the others only act while a key is held or between presses, so their tap numbers do
 * not move and are skipped.
 */
const sweep = (id, label, context, make, values, def, taps = false) => ({
  id,
  label,
  context,
  make,
  values,
  def,
  taps,
});
const heldSweeps = (id, label, make, byContext) =>
  Object.entries(byContext).map(([context, [values, def]]) =>
    sweep(id, label, context, make, values, def),
  );

export const PARAMS = [
  sweep(
    "w0",
    "spring Hz, tap",
    "natural",
    (v) => ({ omega0: TAU * v }),
    [2, 3, 4.5, 6],
    3,
    true,
  ),
  sweep(
    "cap",
    "edge budget, tap, px/frame",
    "natural",
    (v) => ({ vcap: v * HZ }),
    [16, 24, 30, 36, 39, 40, 44],
    24,
    true,
  ),
  sweep(
    "tw",
    "tempo window",
    "even",
    (v) => ({ tempo: { window: v } }),
    [1, 2, 3, 4, 6],
    2,
  ),
  ...heldSweeps("ts", "tempo scale", (v) => ({ tempo: { scale: v } }), {
    even: [[0.5, 0.7, 0.85, 1, 1.2, 1.4], 1],
    "even + held speed": [[0.7, 0.85, 1], 0.85],
  }),
  ...heldSweeps("tms", "constant interval, ms", (v) => ({ tempo: { ms: v } }), {
    constant: [[150, 200, 250, 285, 350, 400], 285],
    "constant with held speed-up": [[200, 225, 250, 285], 285],
    "fold with constant": [[100, 150, 200, 250], 285],
  }),
  ...heldSweeps("slack", "gate slack", (v) => ({ gateSlack: v }), {
    even: [[0, 0.1, 0.3], 0],
    fold: [[0, 0.1, 0.2, 0.3], 0],
  }),
  ...heldSweeps("delay", "hold delay, ms", (v) => ({ holdDelay: v }), {
    "held speed-up alone": [[0, 250, 600], 250],
    "even + held speed": [[0, 250, 800], 250],
    fold: [[0, 250, 600, 800], 250],
  }),
  ...heldSweeps("w1", "spring Hz, held", (v) => ({ omega1: TAU * v }), {
    "held speed-up alone": [[3, 3.5, 4.5, 7], 4.5],
    "even + held speed": [[3, 4.5, 7], 4.5],
    fold: [[3, 4.5, 5, 6, 7], 4.5],
  }),
  ...heldSweeps(
    "cap1",
    "edge budget, held, px/frame",
    (v) => ({ vcap1: v * HZ }),
    {
      "held speed-up alone": [[24, 30, 39, 40, 44], 30],
      "even + held speed": [[24, 30, 39, 40, 44], 30],
      fold: [[24, 30, 39, 40, 44], 30],
    },
  ),
  sweep(
    "h0",
    "folded height, px",
    "fold",
    (v) => ({ H0: v }),
    [50, 60, 73, 110, 130, 160],
    73,
  ),
];

/** Slack values for `slackRows`, on `natural`. */
const SLACKS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5];

const sumKinds = (list) => {
  const k = { jump: 0, band: 0, shade: 0, swap: 0 };
  for (const x of list) for (const key in k) k[key] += x[key];
  return k;
};
/** The largest ratio between two consecutive card intervals in a hold. */
const worstStep = (h) =>
  Math.max(
    ...h.intervals
      .slice(1)
      .map((x, i) => Math.max(x / h.intervals[i], h.intervals[i] / x)),
  );

/** One configuration's numbers: tap landing (when `taps`), held pace, interval range, and checker problems. */
export function measure(cfg, { taps = true } = {}) {
  const t = taps ? SETS.map((h) => singles(h, cfg, HZ)) : [];
  const up = t.flatMap((x) => x.up),
    dn = t.flatMap((x) => x.down);
  const holds = (dir) =>
    SETS.map((h) =>
      holdRun(h, cfg, HZ, {
        dir,
        from: dir > 0 ? 1 : 14,
        to: dir > 0 ? 14 : 1,
      }),
    );
  const hu = holds(-1),
    hd = holds(1),
    held = [...hu, ...hd];
  const mean = (hs) => sum(hs.map((h) => h.meanRate)) / hs.length;
  const intervals = held.flatMap((h) => h.intervals);
  return {
    upLand: taps ? med(up.map((r) => r.land)) : null,
    dnLand: taps ? med(dn.map((r) => r.land)) : null,
    landSpeed: taps
      ? Math.max(...[...up, ...dn].map((r) => r.landSpeed))
      : null,
    heldUp: mean(hu),
    heldDn: mean(hd),
    ivMin: Math.min(...intervals),
    ivMax: Math.max(...intervals),
    step: Math.max(...held.map(worstStep)),
    heldJump: Math.max(...held.map((h) => h.maxJump)),
    problems:
      sum([...up, ...dn].map((r) => r.probCorr)) +
      sum(held.map((h) => h.probCorr)),
    kinds: sumKinds([...up, ...dn, ...held].map((r) => r.kinds)),
  };
}

/**
 * Tap lengths and hold delays for `tapHeldRows`. A tap shorter than the hold delay never starts the held
 * state, so these show how long a delay has to be before a normal tap stays a tap.
 */
const TAP_MS = [60, 100, 150];
const TAP_DELAYS = [0, 50, 100, 150, 250];

/** The peak held state λ that a tap of each length reaches on `fold`, for each hold delay. */
export function tapHeldRows() {
  return TAP_DELAYS.map((delay) => ({
    delay,
    peaks: TAP_MS.map((ms) => {
      const d = new Drum(heightsOf("w1"), {
        ...PRESETS.fold,
        holdDelay: delay,
      });
      d.jump(5);
      d.keyDown(1);
      let peak = 0;
      for (let t = 0; t < ms + 1500; t += 1000 / 240) {
        if (t >= ms) d.keyUp();
        d.step(1000 / 240);
        peak = Math.max(peak, d.lam);
      }
      return { ms, peak };
    }),
  }));
}

/** Every sweep in PARAMS, measured. */
export function paramRows() {
  return PARAMS.map((p) => ({
    id: p.id,
    label: p.label,
    context: p.context,
    def: p.def,
    taps: p.taps,
    rows: p.values.map((value) => ({
      value,
      ...measure(withTempo(CONTEXTS[p.context], p.make(value)), {
        taps: p.taps,
      }),
    })),
  }));
}

/** Gate slack on `natural`: pace over six holds, how long the slowest took to settle, and the problems. */
export function slackRows() {
  return SLACKS.map((slack) => {
    let rate = 0,
      settle = 0,
      problems = 0;
    const kinds = [];
    for (const h of SETS)
      for (const dir of [1, -1]) {
        const r = holdRun(h, { gateSlack: slack }, HZ, {
          dir,
          from: dir > 0 ? 1 : 14,
          to: dir > 0 ? 14 : 1,
        });
        rate += r.meanRate / 6;
        settle = Math.max(settle, r.settledMs);
        problems += r.probCorr;
        kinds.push(r.kinds);
      }
    return {
      slack,
      rate,
      settle,
      neverSettled: settle >= 8000,
      problems,
      kinds: sumKinds(kinds),
    };
  });
}

/** Every preset through the full suite at 60 Hz. */
export function presetRows() {
  return Object.keys(PRESETS).map((name) => {
    const R = run(PRESETS[name], HZ);
    const S = summary(R);
    const held = SETS.flatMap((h) => [R.holds[h].up, R.holds[h].down]);
    const intervals = held.flatMap((h) => h.intervals);
    const [taps, holds, reversals] = S[
      "problems (corrected rule): taps / holds / reversals"
    ]
      .split(" / ")
      .map(Number);
    return {
      name,
      heldUp: S["held ↑ cards/s (mean of sets)"],
      heldDn: S["held ↓ cards/s (mean of sets)"],
      ivMin: Math.min(...intervals),
      ivMax: Math.max(...intervals),
      step: S["worst step-to-step interval change"],
      heldJump: S["held max jump, px/frame"],
      problems: { taps, holds, reversals },
      tapUp: S["tap ↑ lands, ms (median)"],
      tapDn: S["tap ↓ settles, ms (median)"],
      landSpeed: S["landing speed, px/frame (max, last 5 frames)"],
    };
  });
}

/** The level of λ, the held state, that `heldRise` waits for. */
const RISE_TO = 0.9;
/** Milliseconds from the end of the hold delay until λ reaches `RISE_TO`, with held speed-up on. */
export function heldRise() {
  const d = new Drum(heightsOf("w1"), { ramp: true });
  d.jump(2);
  d.keyDown(1);
  let t = 0;
  while (d.lam < RISE_TO && t < 5000) {
    d.step(1000 / 240);
    t += 1000 / 240;
  }
  return t - d.cfg.holdDelay;
}

/** The sample card heights' range and the planner's estimated clear time for each end of it. */
export function cardFacts() {
  const heights = Object.values(HEIGHTS).flat();
  const cards = { min: Math.min(...heights), max: Math.max(...heights) };
  const probe = new Drum([cards.min]);
  return {
    cards,
    estimate: {
      short: probe.clearTime(cards.min),
      tall: probe.clearTime(cards.max),
    },
  };
}

/** Everything the page's tooltips quote, as plain data. */
export function computeFacts() {
  return {
    hz: HZ,
    limits: LIMITS,
    ...cardFacts(),
    rise: { to: RISE_TO, ms: heldRise() },
    presets: presetRows(),
    sweeps: paramRows(),
    slack: slackRows(),
    taps: tapHeldRows(),
  };
}

const f = (x, d = 1) => x.toFixed(d);
const problemsText = (n, kinds) => {
  const named = Object.entries(kinds)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return n ? `${n} (${named})` : "0";
};

if (process.argv[1]?.endsWith("sweep.mjs")) {
  const mode = process.argv[2];
  if (mode === "params") {
    console.log(
      "| Setting | On | Value | Tap ↑ lands, ms | Tap ↓ settles, ms | Landing speed, px/frame | Held ↑ / ↓, cards/s | Interval range, ms | Worst step-to-step change | Max held jump, px | Problems |\n|---|---|---|---|---|---|---|---|---|---|---|",
    );
    for (const p of paramRows())
      p.rows.forEach((r, i) => {
        const tap = (x, d) => (x === null ? "–" : f(x, d));
        console.log(
          `| ${i ? "" : p.label} | ${i ? "" : p.context} | ${r.value}${r.value === p.def ? "*" : ""} | ${tap(r.upLand, 0)} | ${tap(r.dnLand, 0)} | ${tap(r.landSpeed)} | ${f(r.heldUp)} / ${f(r.heldDn)} | ${f(r.ivMin, 0)}–${f(r.ivMax, 0)} | ${f(r.step, 2)}× | ${f(r.heldJump, 0)} | ${problemsText(r.problems, r.kinds)} |`,
        );
      });
  } else if (mode === "slack") {
    console.log(
      "| Slack | Cards/s (mean of 6 holds) | Worst settle, ms | Problems | Kinds |\n|---|---|---|---|---|",
    );
    for (const r of slackRows())
      console.log(
        `| ${r.slack} | ${f(r.rate)} | ${f(r.settle, 0)}${r.neverSettled ? " (never settled)" : ""} | ${r.problems} | ${JSON.stringify(r.kinds)} |`,
      );
  } else if (mode === "held") {
    console.log(
      `The held state reaches ${RISE_TO} ${f(heldRise(), 0)} ms after the hold delay ends.\n`,
    );
    console.log(
      `| Hold delay, ms | ${TAP_MS.map((ms) => `Peak held state, ${ms} ms tap`).join(" | ")} |\n|---|${TAP_MS.map(() => "---").join("|")}|`,
    );
    for (const r of tapHeldRows())
      console.log(
        `| ${r.delay} | ${r.peaks.map((p) => f(p.peak, 2)).join(" | ")} |`,
      );
  } else if (mode === "limits") {
    const { cards, estimate } = cardFacts();
    console.log("| Quantity | Value |\n|---|---|");
    console.log(`| Clock of every sweep | ${HZ} Hz, stepped |`);
    console.log(
      `| Jump: an edge moves farther than, px in a frame | ${LIMITS.jump} |`,
    );
    console.log(
      `| Edge flash: a lower edge changes by more than, px | ${LIMITS.band} |`,
    );
    console.log(
      `| Fade flicker: a fade changes by more than | ${LIMITS.shade} |`,
    );
    console.log(`| Sample card heights, px | ${cards.min}–${cards.max} |`);
    console.log(
      `| Planner estimate at scale 1, ms | ${f(estimate.short, 0)} for ${cards.min} px, ${f(estimate.tall, 0)} for ${cards.max} px |`,
    );
  } else if (mode === "presets") {
    console.log(
      "| Preset | Held ↑ / ↓, cards/s | Interval range, ms | Worst step-to-step change | Max held jump, px | Problems (taps / holds / reversals) |\n|---|---|---|---|---|---|",
    );
    for (const r of presetRows())
      console.log(
        `| ${r.name} | ${f(r.heldUp)} / ${f(r.heldDn)} | ${f(r.ivMin, 0)}–${f(r.ivMax, 0)} | ${f(r.step, 2)}× | ${f(r.heldJump, 0)} | ${r.problems.taps} / ${r.problems.holds} / ${r.problems.reversals} |`,
      );
  } else {
    console.error("usage: node sim/sweep.mjs params|slack|presets|held|limits");
    process.exit(2);
  }
}
