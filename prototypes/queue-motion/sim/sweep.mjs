/**
 * One-at-a-time sweeps over a model's settings, on a stepped 60 Hz clock.
 *
 *   node sim/sweep.mjs params [cascade]   each setting's effect on tap landing, held pace and checker problems
 *   node sim/sweep.mjs presets [cascade]  the named presets side by side
 *   node sim/sweep.mjs held               how fast the held state ramps in, and how far a short tap pushes it
 *   node sim/sweep.mjs limits [cascade]   the checker's thresholds, the sample card heights and the planner's estimates
 *
 * `params` and `presets` sweep the drum unless `cascade` follows; `held` is about the drum's held state, and `limits` is shared: with `cascade` it adds the rule for a card to count as shown.
 *
 * Held numbers are 14-card holds in both directions over the three height sets in lib.mjs. Each cell is one
 * run. A setting changes alone, on top of the context named beside it, so an interaction between settings shows
 * as the difference between two contexts. The page's tooltips quote these numbers: `build.mjs` calls
 * `computeFacts` below, so every figure in them can be reproduced with the command above that prints it.
 */
import { Drum, PRESETS } from "../../../src/app/page/queue/drum.ts";
import {
  DRUM,
  CASCADE,
  HEIGHTS,
  channelPeak,
  heightsOf,
  holdRun,
  legibility,
  singles,
} from "./lib.mjs";
import { LIMITS } from "./check.mjs";
import { SHOWN_FRAMES, SHOWN_PX, run, summary } from "./suite.mjs";

const TAU = 2 * Math.PI;
/** The refresh rate every sweep runs at. */
export const HZ = 60;
const SETS = ["w1", "w2", "alt"];
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const sum = (a) => a.reduce((x, y) => x + y, 0);

const preset = (name, presets = PRESETS) => {
  if (!presets[name])
    throw new Error(`sweep context names a missing preset: ${name}`);
  return presets[name];
};
/**
 * The configurations a setting is swept on. A preset's name means that preset; the others are named in the
 * page's words: `speed up` is the while-held choice of that name, and `steady beat` the pacing of that name.
 */
export const CONTEXTS = {
  natural: preset("natural"),
  even: preset("even"),
  "even + held speed": preset("even + held speed"),
  fold: preset("fold"),
  "speed up": { ramp: true },
  "steady beat": { tempo: { kind: "constant" } },
  "speed up, steady beat": { ramp: true, tempo: { kind: "constant" } },
  "fold, steady beat": { fold: true, tempo: { kind: "constant" } },
  loose: preset("loose"),
};
const withTempo = (base, patch) => ({
  ...base,
  ...patch,
  tempo: { ...base.tempo, ...patch.tempo },
});

/**
 * A setting's sweep. `id` is the setting's short name on the page (the hash key), and `values` are in the
 * page's units: edge budgets in px/s, pace in cards/s. `values` are the points measured and `def` the one the
 * context starts at (marked `*` in the table). `taps` is true for a setting that
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
    "tap spring, Hz",
    "natural",
    (v) => ({ omega0: TAU * v }),
    [2, 3, 4.5, 6],
    3,
    true,
  ),
  sweep(
    "cap",
    "top speed, px/s",
    "natural",
    (v) => ({ vcap: v }),
    [960, 1440, 1800, 2160, 2340, 2400, 2640],
    1440,
    true,
  ),
  sweep(
    "fadein",
    "incoming fade-in, /s",
    "natural",
    (v) => ({ incomingFade: v }),
    [0, 4, 8, 9, 12],
    8,
    true,
  ),
  sweep(
    "cover",
    "covered card fade",
    "natural",
    (v) => ({ coverFade: v }),
    [0, 0.35, 0.7, 1],
    1,
    true,
  ),
  sweep(
    "tuck",
    "tuck spring, ×",
    "natural",
    (v) => ({ tuckRate: v }),
    [1, 1.4, 1.8, 2.5],
    1.4,
    true,
  ),
  sweep(
    "hide",
    "tuck depth, px",
    "natural",
    (v) => ({ hidePx: v }),
    [0, 3, 6, 12],
    3,
    true,
  ),
  sweep(
    "wrise",
    "tall-card wash rise, ms",
    "natural",
    (v) => ({ washTauOut: v }),
    [10, 40, 120, 250, 400],
    120,
    true,
  ),
  sweep(
    "wclear",
    "tall-card wash clear, ms",
    "natural",
    (v) => ({ washTauIn: v }),
    [10, 40, 120, 400],
    40,
    true,
  ),
  sweep(
    "tw",
    "plan window",
    "even",
    (v) => ({ tempo: { window: v } }),
    [1, 2, 3, 4, 6],
    2,
  ),
  sweep(
    "ta",
    "plan base, ms",
    "even",
    (v) => ({ tempo: { a: v } }),
    [0, 30, 60, 120, 200],
    60,
  ),
  sweep(
    "tb",
    "plan per px, ms",
    "even",
    (v) => ({ tempo: { b: v } }),
    [0, 0.3, 0.62, 1, 1.5],
    0.62,
  ),
  ...heldSweeps("ts", "plan, ×", (v) => ({ tempo: { scale: v } }), {
    even: [[0.5, 0.7, 0.85, 1, 1.2, 1.4], 1],
    "even + held speed": [[0.7, 0.85, 1], 0.85],
  }),
  // Pace under a steady beat is written as the beat's interval, 1000 / pace ms; each context starts at its own.
  ...heldSweeps("pace", "pace, cards/s", (v) => ({ tempo: { ms: 1000 / v } }), {
    "steady beat": [[2.5, 3, 3.5, 4, 5, 6.5], 3.5],
    "speed up, steady beat": [[3.5, 4, 4.5, 5], 3.5],
    "fold, steady beat": [[4, 5, 6.5, 10, 12.5], 3.5],
    loose: [[5, 6.5, 10, 12.5, 15], 10],
  }),
  ...heldSweeps("delay", "speeds up after, ms", (v) => ({ holdDelay: v }), {
    "speed up": [[0, 250, 600], 250],
    "even + held speed": [[0, 250, 800], 250],
    fold: [[0, 250, 600, 800], 250],
  }),
  ...heldSweeps("w1", "held spring, Hz", (v) => ({ omega1: TAU * v }), {
    "speed up": [[3, 3.5, 4.5, 7], 4.5],
    "even + held speed": [[3, 4.5, 7], 4.5],
    fold: [[3, 4.5, 5, 6, 7], 4.5],
  }),
  ...heldSweeps("cap1", "held top speed, px/s", (v) => ({ vcap1: v }), {
    "speed up": [[1440, 1800, 2340, 2400, 2640], 1800],
    "even + held speed": [[1440, 1800, 2340, 2400, 2640], 1800],
    fold: [[1440, 1800, 2340, 2400, 2640], 1800],
  }),
  sweep(
    "h0",
    "held height, px",
    "fold",
    (v) => ({ H0: v }),
    [50, 60, 73, 110, 130, 160],
    73,
  ),
];

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

/** The spread of a list of paces: the highest over the lowest, minus one. */
const spread = (a) => (Math.max(...a) - Math.min(...a)) / Math.min(...a);

/**
 * One configuration's numbers: tap landing (when `taps`), held pace, interval range, checker problems, and
 * what the holds leave on screen: the most cards in front of the pile at once (`channel`), the fewest frames
 * a card shows min(height, 100) px (`framesMin`), the median px of a card that no nearer card covers at its
 * best (`visible`), and how far the pace differs between the three height sets (`spread`).
 */
export function measure(cfg, { taps = true, model = DRUM } = {}) {
  const t = taps ? SETS.map((h) => singles(h, cfg, HZ, { model })) : [];
  const up = t.flatMap((x) => x.up),
    dn = t.flatMap((x) => x.down);
  const seen = { channel: 0, cards: [] };
  const onFrames = (frames, info) => {
    seen.channel = Math.max(seen.channel, channelPeak(frames));
    seen.cards.push(
      ...legibility(frames, heightsOf(info.hset), info.from, info.to),
    );
  };
  const holds = (dir) =>
    SETS.map((h) =>
      holdRun(h, cfg, HZ, {
        dir,
        from: dir > 0 ? 1 : 14,
        to: dir > 0 ? 14 : 1,
        model,
        onFrames,
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
    channel: seen.channel,
    framesMin: Math.min(...seen.cards.map((c) => c.frames)),
    visible: med(seen.cards.map((c) => c.best)),
    spread: Math.max(
      spread(hu.map((h) => h.meanRate)),
      spread(hd.map((h) => h.meanRate)),
    ),
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

/**
 * Everything a model is swept with: its harness model, the configurations its settings are swept on, the
 * sweeps, and how a swept value overlays its context (the drum merges `tempo` field by field).
 */
const DRUM_SWEEPS = {
  model: DRUM,
  contexts: CONTEXTS,
  params: PARAMS,
  merge: withTempo,
};

/** The cascade's contexts: its presets. */
const CASCADE_CONTEXTS = {
  default: preset("default", CASCADE.PRESETS),
  "no held ramp": preset("no held ramp", CASCADE.PRESETS),
};
/** The edge budget a cascade train runs at: the held one with the ramp on, the tap one without. */
const trainSpeed = (c) => (c.ramp ? c.vcap1 : c.vcap);
/**
 * The cascade's sweeps, one per model slider on the page, under the key the page uses for it. Its pace knobs are
 * written as the page writes them: `pace` as the spacing at the speed the train runs at, `pace0` as the resting
 * spacing at the tap budget. They, the hold delay and the held spring and budget act only while a key is held,
 * so their tap numbers are skipped.
 */
export const CASCADE_PARAMS = [
  sweep(
    "pace0",
    "pace before speed-up, cards/s",
    "default",
    (v, c) => ({ spacing0: c.vcap / v }),
    [5, 6, 6.7, 8, 9.6],
    6.7,
  ),
  ...heldSweeps(
    "pace",
    "pace, cards/s",
    (v, c) => ({ spacing1: trainSpeed(c) / v }),
    {
      default: [[8, 10, 12, 14, 18], 12],
      "no held ramp": [[6, 8, 9.6, 12, 14.4], 9.6],
    },
  ),
  sweep(
    "park",
    "park, px",
    "default",
    (v) => ({ park: v }),
    [360, 400, 480, 560],
    480,
    true,
  ),
  sweep(
    "w0",
    "tap spring, Hz",
    "default",
    (v) => ({ omega0: TAU * v }),
    [2, 3, 4.5, 6],
    3,
    true,
  ),
  sweep(
    "cap",
    "top speed, px/s",
    "default",
    (v) => ({ vcap: v }),
    [960, 1440, 1800, 2160, 2400],
    1440,
    true,
  ),
  sweep(
    "delay",
    "speeds up after, ms",
    "default",
    (v) => ({ holdDelay: v }),
    [0, 250, 600],
    250,
  ),
  sweep(
    "w1",
    "held spring, Hz",
    "default",
    (v) => ({ omega1: TAU * v }),
    [3, 4.5, 6, 8],
    4.5,
  ),
  sweep(
    "cap1",
    "held top speed, px/s",
    "default",
    (v) => ({ vcap1: v }),
    [1440, 1800, 2160, 2400, 2640],
    1800,
  ),
  sweep(
    "shade",
    "leave shade",
    "default",
    (v) => ({ leaveShade: v }),
    [0, 0.25, 0.5],
    0.25,
    true,
  ),
];
const CASCADE_SWEEPS = {
  model: CASCADE,
  contexts: CASCADE_CONTEXTS,
  params: CASCADE_PARAMS,
  merge: (base, patch) => ({ ...base, ...patch }),
};

/** Every sweep in a set (the drum's PARAMS by default), measured. */
export function paramRows({ model, contexts, params, merge } = DRUM_SWEEPS) {
  return params.map((p) => ({
    id: p.id,
    model: model.name,
    label: p.label,
    context: p.context,
    def: p.def,
    taps: p.taps,
    rows: p.values.map((value) => ({
      value,
      // `make` may read the context's whole configuration, as a derived page setting does.
      ...measure(
        merge(
          contexts[p.context],
          p.make(value, model.Model.config(contexts[p.context])),
        ),
        { taps: p.taps, model },
      ),
    })),
  }));
}

/** Every preset of a model (the drum's by default) through the full suite at 60 Hz. */
export function presetRows(model = DRUM) {
  return Object.keys(model.PRESETS).map((name) => {
    const R = run(model.PRESETS[name], HZ, { model });
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
      model: model.name,
      spread: Math.max(
        spread(SETS.map((h) => R.holds[h].up.meanRate)),
        spread(SETS.map((h) => R.holds[h].down.meanRate)),
      ),
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
    shown: { px: SHOWN_PX, frames: SHOWN_FRAMES },
    ...cardFacts(),
    sets: HEIGHTS,
    rise: { to: RISE_TO, ms: heldRise() },
    presets: [...presetRows(DRUM), ...presetRows(CASCADE)],
    sweeps: [...paramRows(DRUM_SWEEPS), ...paramRows(CASCADE_SWEEPS)],
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
  const cascade = process.argv[3] === "cascade";
  if (mode === "params") {
    // The cascade's table adds what its holds leave on screen; the drum's table is unchanged.
    console.log(
      `| Setting | On | Value | Tap ↑ lands, ms | Tap ↓ settles, ms | Landing speed, px/frame | Held ↑ / ↓, cards/s | Interval range, ms | Worst step-to-step change | Max held jump, px | Problems |${cascade ? " Cards in front of the pile | Fewest frames a card is visible | Median visible px |" : ""}\n|---|---|---|---|---|---|---|---|---|---|---|${cascade ? "---|---|---|" : ""}`,
    );
    for (const p of paramRows(cascade ? CASCADE_SWEEPS : DRUM_SWEEPS))
      p.rows.forEach((r, i) => {
        const tap = (x, d) => (x === null ? "–" : f(x, d));
        console.log(
          `| ${i ? "" : p.label} | ${i ? "" : p.context} | ${r.value}${r.value === p.def ? "*" : ""} | ${tap(r.upLand, 0)} | ${tap(r.dnLand, 0)} | ${tap(r.landSpeed)} | ${f(r.heldUp)} / ${f(r.heldDn)} | ${f(r.ivMin, 0)}–${f(r.ivMax, 0)} | ${f(r.step, 2)}× | ${f(r.heldJump, 0)} | ${problemsText(r.problems, r.kinds)} |${cascade ? ` ${r.channel} | ${r.framesMin} | ${f(r.visible, 0)} |` : ""}`,
        );
      });
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
    for (const [name, h] of Object.entries(HEIGHTS))
      console.log(`| Height set \`${name}\`, px | ${h.join(", ")} |`);
    console.log(
      `| Planner estimate at scale 1, ms | ${f(estimate.short, 0)} for ${cards.min} px, ${f(estimate.tall, 0)} for ${cards.max} px |`,
    );
    if (cascade)
      console.log(
        `| Card shown: a card in a hold shows at least min(height, ${SHOWN_PX}) px that no nearer card covers, for at least this many frames | ${SHOWN_FRAMES} |`,
      );
  } else if (mode === "presets") {
    console.log(
      `| Preset | Held ↑ / ↓, cards/s | Interval range, ms | Worst step-to-step change | Max held jump, px | Problems (taps / holds / reversals) |${cascade ? " Pace spread between height sets |" : ""}\n|---|---|---|---|---|---|${cascade ? "---|" : ""}`,
    );
    for (const r of presetRows(cascade ? CASCADE : DRUM))
      console.log(
        `| ${r.name} | ${f(r.heldUp)} / ${f(r.heldDn)} | ${f(r.ivMin, 0)}–${f(r.ivMax, 0)} | ${f(r.step, 2)}× | ${f(r.heldJump, 0)} | ${r.problems.taps} / ${r.problems.holds} / ${r.problems.reversals} |${cascade ? ` ${f(100 * r.spread)} % |` : ""}`,
      );
  } else {
    console.error(
      "usage: node sim/sweep.mjs params|presets|held|limits [cascade]",
    );
    process.exit(2);
  }
}
