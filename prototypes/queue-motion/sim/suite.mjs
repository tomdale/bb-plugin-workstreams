/**
 * The standard scenarios for the drum model, run headless on a stepped clock.
 *
 *   node sim/suite.mjs [presets] [--hz 60,120] [--check] [--json file]
 *
 * `presets` is a comma list of names from PRESETS (default: all). Output is a markdown table per preset.
 * `--check` exits non-zero when an invariant fails; see `invariants` below for what is asserted and for which
 * presets. The frame checker's "corrected" rule is the one enforced (sim/check.mjs says how it differs from
 * the product test's rule); the original rule's count is reported alongside.
 */
import fs from "node:fs";
import { PRESETS, Drum } from "../src/drum.mjs";
import {
  heightsOf,
  singles,
  holdRun,
  reversal,
  releaseTest,
  record,
} from "./lib.mjs";

const SETS = ["w1", "w2", "alt"];
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** Presses at an end of the queue: nothing may move, and a hold that runs into the end unfolds on arrival. */
function edges(cfg, hz) {
  const out = {};
  for (const [name, start, dir] of [
    ["hold ↑ at first card", 0, -1],
    ["hold ↓ at last card", 23, 1],
  ]) {
    const d = new Drum(heightsOf("w1"), cfg);
    d.jump(start);
    const { frames } = record(d, {
      dur: 2200,
      hz,
      holds: [{ t0: 0, dir, delay: 250, repeat: 33, t1: 1000 }],
    });
    const base = frames[0];
    let moved = 0;
    for (const f of frames)
      f.forEach((c, i) => {
        if (c.painted)
          moved = Math.max(
            moved,
            Math.abs(c.top - base[i].top),
            Math.abs(c.natBottom - base[i].natBottom),
          );
      });
    out[name] = moved;
  }
  // A hold that runs into the end: ms from arriving at the last card until the fold is below 5 %.
  const d = new Drum(heightsOf("w1"), cfg);
  d.jump(18);
  let arrive = -1,
    unfold = -1,
    n = 0;
  const step = d.step.bind(d);
  d.step = (ms) => {
    step(ms);
    n++;
    if (arrive < 0 && d.front === 23) arrive = n;
    if (arrive >= 0 && unfold < 0 && d.lam < 0.05) unfold = n;
  };
  record(d, {
    dur: 4000,
    hz,
    holds: [{ t0: 0, dir: 1, delay: 250, repeat: 33, t1: 3000 }],
  });
  out["unfold after arriving at the end (ms)"] =
    unfold < 0 || arrive < 0 ? Infinity : ((unfold - arrive) * 1000) / hz;
  return out;
}

export function run(cfg, hz) {
  const R = {
    singles: {},
    holds: {},
    reversal: {},
    release: {},
    edges: edges(cfg, hz),
  };
  for (const hset of SETS) {
    R.singles[hset] = singles(hset, cfg, hz);
    const strip = ({ frames, ...r }) => r;
    R.holds[hset] = {
      up: strip(holdRun(hset, cfg, hz, { dir: -1, from: 14, to: 1 })),
      down: strip(holdRun(hset, cfg, hz, { dir: 1, from: 1, to: 14 })),
    };
    R.reversal[hset] = {
      udu: reversal(hset, cfg, hz, [
        { t: 0, dir: -1 },
        { t: 100, dir: 1 },
        { t: 200, dir: -1 },
      ]),
      du: reversal(hset, cfg, hz, [
        { t: 0, dir: 1 },
        { t: 120, dir: -1 },
      ]),
    };
    R.release[hset] = releaseTest(hset, cfg, hz);
  }
  return R;
}

/** One row of headline numbers for a result. */
export function summary(R) {
  const all = (dir, k) =>
    SETS.flatMap((h) => R.singles[h][dir].map((r) => r[k]));
  const holds = (dir) => SETS.map((h) => R.holds[h][dir]);
  const rel = SETS.flatMap((h) => R.release[h]);
  const steps = (dir) =>
    holds(dir).map((h) => {
      const iv = h.intervals;
      return Math.max(
        ...iv.slice(1).map((x, i) => Math.max(x / iv[i], iv[i] / x)),
      );
    });
  return {
    "tap ↑ lands, ms (median)": med(all("up", "land")),
    "tap ↓ settles, ms (median)": med(all("down", "land")),
    "first visible change, ms (max)": Math.max(
      ...all("up", "first"),
      ...all("down", "first"),
    ),
    "landing speed, px/frame (max, last 5 frames)": Math.max(
      ...all("up", "landSpeed"),
      ...all("down", "landSpeed"),
    ),
    "tap max jump, px/frame": Math.max(
      ...all("up", "maxJump"),
      ...all("down", "maxJump"),
    ),
    "held ↑ cards/s (mean of sets)":
      sum(holds("up").map((h) => h.meanRate)) / SETS.length,
    "held ↓ cards/s (mean of sets)":
      sum(holds("down").map((h) => h.meanRate)) / SETS.length,
    "held interval range, ms": `${Math.round(Math.min(...[...holds("up"), ...holds("down")].flatMap((h) => h.intervals)))}–${Math.round(Math.max(...[...holds("up"), ...holds("down")].flatMap((h) => h.intervals)))}`,
    "worst step-to-step interval change": Math.max(
      ...steps("up"),
      ...steps("down"),
    ),
    "held max jump, px/frame": Math.max(
      ...[...holds("up"), ...holds("down")].map((h) => h.maxJump),
    ),
    "problems (corrected rule): taps / holds / reversals": [
      sum(
        SETS.flatMap((h) =>
          ["up", "down"].flatMap((d) => R.singles[h][d].map((r) => r.probCorr)),
        ),
      ),
      sum(
        SETS.flatMap((h) => [R.holds[h].up.probCorr, R.holds[h].down.probCorr]),
      ),
      sum(
        SETS.flatMap((h) => [
          R.reversal[h].udu.probCorr,
          R.reversal[h].du.probCorr,
        ]),
      ),
    ].join(" / "),
    "problems (original rule), all scenarios": sum([
      ...SETS.flatMap((h) =>
        ["up", "down"].flatMap((d) => R.singles[h][d].map((r) => r.probOrig)),
      ),
      ...SETS.flatMap((h) => [
        R.holds[h].up.probOrig,
        R.holds[h].down.probOrig,
        R.reversal[h].udu.probOrig,
        R.reversal[h].du.probOrig,
      ]),
    ]),
    "reversal ↑↓↑ max jump, px/frame": Math.max(
      ...SETS.map((h) => R.reversal[h].udu.maxJump),
    ),
    "release: rests on a card / extra cards after release": `${rel.every((r) => r.restsOnCard) ? "all" : "NOT ALL"} / ${Math.max(...rel.map((r) => r.extraCards))}`,
    "hold at an end moves, px": Math.max(
      R.edges["hold ↑ at first card"],
      R.edges["hold ↓ at last card"],
    ),
    "unfold after arriving at the end, ms":
      R.edges["unfold after arriving at the end (ms)"],
  };
}

const fmt = (v) =>
  typeof v === "number"
    ? Number.isFinite(v)
      ? Math.abs(v) >= 100
        ? v.toFixed(0)
        : v.toFixed(1)
      : "never"
    : String(v);

/**
 * What `--check` asserts for every preset: no draw-order, jump, shade, or clip-band problem (corrected rule),
 * first response within a frame, no edge moving more than 40 px in a frame, a hold that never moves a card at
 * an end and unfolds when it reaches one, and a release that rests on a card with at most one waiting press.
 * The ramped presets raise the edge budget to 30 px/frame while held, which is close to where problems start;
 * `sweep.mjs params` shows the margin.
 */
function invariants(name, hz, R, S) {
  const failures = [];
  const expect = (ok, what) =>
    ok || failures.push(`${name} @ ${hz} Hz: ${what}`);
  const probs = S["problems (corrected rule): taps / holds / reversals"]
    .split(" / ")
    .map(Number);
  expect(
    probs.every((p) => p === 0),
    `checker problems ${probs.join("/")}`,
  );
  expect(
    S["first visible change, ms (max)"] <= 1000 / hz + 1,
    `first visible change ${S["first visible change, ms (max)"]} ms`,
  );
  expect(
    S["hold at an end moves, px"] === 0,
    `a hold at an end moved ${S["hold at an end moves, px"]} px`,
  );
  expect(
    S["release: rests on a card / extra cards after release"].startsWith("all"),
    "a release did not rest on a card",
  );
  expect(
    Number(
      S["release: rests on a card / extra cards after release"].split(" / ")[1],
    ) <= 1,
    "a release took more than one extra card",
  );
  expect(
    S["unfold after arriving at the end, ms"] < 1500,
    "the fold stayed on after the hold reached the end",
  );
  expect(
    S["held max jump, px/frame"] <= 40 && S["tap max jump, px/frame"] <= 40,
    "a card edge jumped more than 40 px in a frame",
  );
  return failures;
}

if (process.argv[1] && process.argv[1].endsWith("suite.mjs")) {
  const args = process.argv.slice(2);
  const flag = (f) => args.includes(f);
  const val = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
  );
  const presets = positional[0]
    ? positional[0].split(",")
    : Object.keys(PRESETS);
  const hzs = val("--hz", "60,120").split(",").map(Number);
  const results = {};
  const failures = [];
  for (const name of presets) {
    if (!PRESETS[name])
      throw new Error(
        `unknown preset "${name}"; known: ${Object.keys(PRESETS).join(", ")}`,
      );
    results[name] = {};
    const rows = {};
    for (const hz of hzs) {
      // The edge budgets are px/frame, so a 120 Hz run allows twice the px/s of a 60 Hz run.
      const cfg = { ...PRESETS[name] };
      const base = Drum.config(cfg);
      cfg.vcap = (base.vcap * hz) / 60;
      cfg.vcap1 = (base.vcap1 * hz) / 60;
      const R = run(cfg, hz);
      const S = summary(R);
      results[name][hz] = { summary: S, ...R };
      rows[`${hz} Hz`] = S;
      failures.push(...invariants(name, hz, R, S));
    }
    const cols = Object.keys(rows);
    console.log(
      `\n### ${name}\n\n| Metric | ${cols.join(" | ")} |\n|---|${cols.map(() => "---").join("|")}|`,
    );
    for (const k of Object.keys(rows[cols[0]]))
      console.log(`| ${k} | ${cols.map((c) => fmt(rows[c][k])).join(" | ")} |`);
  }
  const out = val("--json", "");
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
  if (flag("--check")) {
    if (failures.length) {
      console.error(
        `\n${failures.length} invariant failure(s):\n- ${failures.join("\n- ")}`,
      );
      process.exit(1);
    }
    console.log("\nAll invariants hold.");
  }
}
