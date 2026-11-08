/**
 * The standard scenarios for the queue's motion models, run headless on a stepped clock.
 *
 *   node sim/suite.mjs [presets] [--hz 60,120] [--check] [--json file]
 *
 * `presets` is a comma list of names from the drum's PRESETS (default: all). Output is a markdown table per
 * preset. `--check` exits non-zero when an invariant fails; see `invariants` below for what is asserted and for
 * which presets. The frame checker's "corrected" rule is the one enforced (sim/check.mjs says how it differs
 * from the product test's rule); the original rule's count is reported alongside.
 *
 * `cascade` in the list runs the cascade's presets, with the drum's `natural` and `even` beside them as
 * controls, and prints one table per refresh rate with a column for each: the acceptance table. `cascade:<name>`
 * runs one cascade preset. With `--check` only the cascade columns are asserted (`cascadeInvariants`); the
 * controls are measured, not held to the cascade's promises.
 */
import fs from "node:fs";
import { Drum } from "../../../src/app/page/queue/drum.ts";
import { Cascade } from "../src/cascade.ts";
import {
  DRUM,
  CASCADE,
  HEIGHTS,
  heightsOf,
  singles,
  holdRun,
  reversal,
  releaseTest,
  record,
  legibility,
  channelPeak,
  lowestEdge,
  drainMs,
  repeatPace,
} from "./lib.mjs";
import { orderChanges } from "./check.mjs";
import { SETTINGS } from "../src/controls.ts";

const PRESETS = DRUM.PRESETS;

const SETS = ["w1", "w2", "alt"];
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** Presses at an end of the queue: nothing may move, and a hold that runs into the end unfolds on arrival. */
function edges(cfg, hz, { model = DRUM, onFrames } = {}) {
  const out = {};
  for (const [name, start, dir] of [
    ["hold ↑ at first card", 0, -1],
    ["hold ↓ at last card", 23, 1],
  ]) {
    const d = new model.Model(heightsOf("w1"), cfg);
    d.jump(start);
    const { frames } = record(d, {
      dur: 2200,
      hz,
      holds: [{ t0: 0, dir, delay: 250, repeat: 33, t1: 1000 }],
    });
    onFrames?.(frames, { kind: "edge" });
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
  const d = new model.Model(heightsOf("w1"), cfg);
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
  const into = record(d, {
    dur: 4000,
    hz,
    holds: [{ t0: 0, dir: 1, delay: 250, repeat: 33, t1: 3000 }],
  });
  onFrames?.(into.frames, { kind: "edge" });
  out["unfold after arriving at the end (ms)"] =
    unfold < 0 || arrive < 0 ? Infinity : ((unfold - arrive) * 1000) / hz;
  return out;
}

export function run(cfg, hz, { model = DRUM, onFrames } = {}) {
  const opts = { model, onFrames };
  const R = {
    singles: {},
    holds: {},
    reversal: {},
    release: {},
    edges: edges(cfg, hz, opts),
  };
  for (const hset of SETS) {
    R.singles[hset] = singles(hset, cfg, hz, opts);
    const strip = ({ frames, ...r }) => r;
    R.holds[hset] = {
      up: strip(holdRun(hset, cfg, hz, { dir: -1, from: 14, to: 1, ...opts })),
      down: strip(holdRun(hset, cfg, hz, { dir: 1, from: 1, to: 14, ...opts })),
    };
    R.reversal[hset] = {
      udu: reversal(
        hset,
        cfg,
        hz,
        [
          { t: 0, dir: -1 },
          { t: 100, dir: 1 },
          { t: 200, dir: -1 },
        ],
        opts,
      ),
      du: reversal(
        hset,
        cfg,
        hz,
        [
          { t: 0, dir: 1 },
          { t: 120, dir: -1 },
        ],
        opts,
      ),
    };
    R.release[hset] = releaseTest(hset, cfg, hz, opts);
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
 * What `--check` asserts for every preset: no draw-order, jump, shade, or clip-band problem (corrected rule;
 * a loose preset may have them in holds),
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
  // A loose preset passes cards over one another while held, so its holds show draw-order swaps and edge
  // flashes by design; its taps and reversals, which never loosen anything, must stay clean.
  const passes = PRESETS[name]?.loose === true;
  expect(
    probs.every((p, i) => p === 0 || (passes && i === 1)),
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

/** The most gate slack the lab's slider offers. */
const SLACK_MAX = SETTINGS.find((s) => s.key === "slack").max;

/**
 * What `--check` asserts about gate slack, once per run: with the slider at its maximum and no tempo (the only
 * setting that shows it), every drum preset settles after a held key, in both directions from either end and
 * released at several points, on the sweep heights and the lab's own. Slack lets several cards reach the turn
 * at once, and a drum that let them hold one another there would never come to rest.
 */
function slackInvariants() {
  const failures = [];
  const frameMs = 1000 / 60;
  for (const [name, preset] of Object.entries(PRESETS))
    for (const set of [...SETS, "lab"])
      for (const dir of [1, -1])
        for (const repeat of [25, 33])
          for (const holdMs of [700, 1500, 6000]) {
            const cfg = {
              ...preset,
              gateSlack: SLACK_MAX,
              tempo: { ...preset.tempo, kind: "none" },
            };
            const d = new Drum(heightsOf(set), cfg);
            d.jump(dir > 0 ? 0 : d.N - 1);
            d.keyDown(dir);
            let t = 0;
            for (let next = 250; t < holdMs; t += frameMs) {
              while (next <= t) {
                d.press(dir);
                next += repeat;
              }
              d.step(frameMs);
            }
            d.keyUp();
            d.step(8000);
            if (d.isBusy())
              failures.push(
                `${name}, gate slack ${SLACK_MAX}, ${set}: a held ${dir > 0 ? "↓" : "↑"} (${repeat} ms repeat, released at ${holdMs} ms) never settled`,
              );
          }
  return failures;
}

// ---- the cascade's acceptance table -----------------------------------------------------------------------

/** The key-down offsets, ms, a held pace is averaged over: the 33 ms key repeat meets the frame grid differently at each. */
const PHASES = [0, 7, 14, 21, 28];
/** The drum presets shown beside the cascade, so the table shows what the cascade changes. */
const CONTROLS = ["natural", "even"];
/** A card that passes the front must show this many px of itself, or all of it when shorter... */
export const SHOWN_PX = 100;
/** ...for this many frames. The budgets are px/frame, so a faster refresh rate runs the train faster and a card is shown for as many frames. */
export const SHOWN_FRAMES = 10;

const mean = (a) => sum(a) / a.length;
/** How far apart two paces are, as a share of the slower. */
const apart = (a, b) => Math.abs(a - b) / Math.min(a, b);
const spread = (a) => (Math.max(...a) - Math.min(...a)) / Math.min(...a);
const pct = (x) => `${(x * 100).toFixed(1)} %`;

/**
 * The largest difference between the cascade's pile and the drum's: over slot poses from 0 to 3, and over every
 * painted card's pose in piles at rest and part way between slots, for each height set. The cascade repeats the
 * drum's slot constants, which the drum does not export, so this is what keeps the two piles one pile. A card
 * painted in one pile and not in the other counts as Infinity.
 */
export function pileGap() {
  let gap = 0;
  const diff = (a, b) => (gap = Math.max(gap, Math.abs(a - b)));
  const slotsD = new Drum([100]),
    slotsC = new Cascade([100]);
  for (let q = 0; q <= 3; q += 0.05) {
    const a = slotsD.slot(q),
      b = slotsC.slot(q);
    diff(a.y, b.y);
    diff(a.z, b.z);
    diff(a.depth, b.depth);
  }
  for (const hset of Object.keys(HEIGHTS)) {
    const h = heightsOf(hset);
    for (let front = 0; front < h.length; front++)
      for (const part of [0, 0.15, 0.4, 0.8]) {
        const d = new Drum(h),
          c = new Cascade(h);
        d.jump(front);
        c.jump(front);
        for (let i = front; i < h.length; i++)
          d.c[i] = c.c[i] = Math.max(0, i - front - part);
        const dv = d.views(),
          cv = c.views();
        // Layers are compared from the lowest painted one: the cascade ranks its parked cards ahead of the
        // pile where the drum ranks them behind it, so only the order of the painted cards is the same.
        const low = (v) =>
          Math.min(...v.filter((x) => x.painted).map((x) => x.layer));
        const dl = low(dv),
          cl = low(cv);
        for (let i = 0; i < h.length; i++) {
          if (dv[i].painted !== cv[i].painted) gap = Infinity;
          else if (dv[i].painted) {
            for (const k of [
              "scale",
              "y",
              "top",
              "bottom",
              "natBottom",
              "shade",
            ])
              diff(dv[i][k], cv[i][k]);
            diff(dv[i].layer - dl, cv[i].layer - cl);
          }
        }
      }
  }
  return gap;
}

/** Collects, from the frames of every scenario `run` drives, what the acceptance numbers need beyond the scenarios' own results. */
function collector(hz) {
  const seen = {
    orders: 0,
    lowest: -Infinity,
    channel: 0,
    drain: 0,
    cards: [],
  };
  seen.onFrames = (frames, info) => {
    seen.orders += orderChanges(frames).length;
    seen.lowest = Math.max(seen.lowest, lowestEdge(frames));
    if (info.kind === "hold") {
      seen.channel = Math.max(seen.channel, channelPeak(frames));
      seen.cards.push(
        ...legibility(frames, heightsOf(info.hset), info.from, info.to),
      );
    }
    if (info.kind === "release")
      seen.drain = Math.max(seen.drain, drainMs(frames, hz, info.holdMs));
  };
  return seen;
}

/**
 * The acceptance numbers `summary` leaves out. `seen` is what `collector` gathered while `run` drove the
 * scenarios; the paces over key-repeat phases and a third reversal (↓↓↓ then ↑↑) run here.
 */
function extras(model, cfg, hz, R, seen) {
  const third = SETS.map((h) =>
    reversal(
      h,
      cfg,
      hz,
      [
        { t: 0, dir: 1 },
        { t: 60, dir: 1 },
        { t: 120, dir: 1 },
        { t: 180, dir: -1 },
        { t: 240, dir: -1 },
      ],
      { model, onFrames: seen.onFrames },
    ),
  );
  const phased = (dir) =>
    SETS.map((h) => mean(repeatPace(h, cfg, hz, dir, PHASES, { model })));
  const up = phased(-1),
    down = phased(1);
  const best = seen.cards.map((c) => c.best).sort((a, b) => a - b);
  return {
    paceUp: SETS.map((h) => R.holds[h].up.meanRate),
    paceDown: SETS.map((h) => R.holds[h].down.meanRate),
    phasedUp: up,
    phasedDown: down,
    phasedApart: Math.max(...SETS.map((_, k) => apart(up[k], down[k]))),
    channel: seen.channel,
    drain: seen.drain,
    idle: Math.max(
      ...SETS.flatMap((h) => R.release[h].map((r) => r.settleAfterRelease)),
    ),
    lowest: seen.lowest,
    bestMin: best[0],
    bestMedian: best[Math.floor(best.length / 2)],
    framesMin: Math.min(...seen.cards.map((c) => c.frames)),
    lacking: seen.cards.filter(
      (c) => c.best < Math.min(c.h, SHOWN_PX) - 0.01 || c.frames < SHOWN_FRAMES,
    ).length,
    orders: seen.orders,
    third: {
      problems: sum(third.map((r) => r.probCorr)),
      maxJump: Math.max(...third.map((r) => r.maxJump)),
    },
    reversalJump: Math.max(
      ...SETS.flatMap((h) => [
        R.reversal[h].udu.maxJump,
        R.reversal[h].du.maxJump,
      ]),
      ...third.map((r) => r.maxJump),
    ),
    releaseProblems: sum(
      SETS.flatMap((h) => R.release[h].map((r) => r.probCorr)),
    ),
    park: cfg.park ?? null,
  };
}

/** The acceptance numbers as table rows, after `summary`'s. */
function extraRows(X) {
  const per = (a) => a.map((v) => v.toFixed(1)).join(" / ");
  return {
    "held ↑ cards/s per set (w1 / w2 / alt)": per(X.paceUp),
    "held ↓ cards/s per set (w1 / w2 / alt)": per(X.paceDown),
    "pace spread between height sets, worst of ↑ and ↓": pct(
      Math.max(spread(X.paceUp), spread(X.paceDown)),
    ),
    "held ↑ / ↓ cards/s over 5 key-repeat phases (mean of sets)": `${mean(X.phasedUp).toFixed(1)} / ${mean(X.phasedDown).toFixed(1)}`,
    "↑ and ↓ apart over the phases, worst set": pct(X.phasedApart),
    "cards in front of the pile at once (max in holds)": String(X.channel),
    "cards still moving after release, ms (max)": X.drain,
    "idle after release, ms (max; includes the held state's tail)": X.idle,
    "lowest drawn edge below the front pose, px (max)": X.lowest,
    "page area the train uses: park, px": X.park ?? "–",
    "visible px: least a card shows at its best / median": `${X.bestMin.toFixed(0)} / ${X.bestMedian.toFixed(0)}`,
    "frames visible: fewest at min(height, 100) px": String(X.framesMin),
    [`cards that fail "every card visible" (need ${SHOWN_FRAMES} frames)`]:
      String(X.lacking),
    "problems: third reversal ↓↓↓↑↑ / releases": `${X.third.problems} / ${X.releaseProblems}`,
    "reversal max jump, px/frame (all three reversals)": X.reversalJump,
    "draw-order changes among painted cards, all scenarios": String(X.orders),
  };
}

/**
 * What `--check` asserts for a cascade column, on top of `invariants`: no problem in releases or the third
 * reversal; no draw-order change among painted cards at all; the same held pace on every height set (within
 * 5 %); no step-to-step interval change over 1.35×; held ↑ and ↓ within 5 % of each other over the
 * key-repeat phases; landing at most 2 px/frame; no reversal jump over the tap budget; every card that passes
 * the front visible; and the pile the drum's. `tapBudget` is the px/frame budget of a tap.
 */
function cascadeInvariants(name, hz, S, X, tapBudget, pile) {
  const failures = [];
  const expect = (ok, what) =>
    ok || failures.push(`${name} @ ${hz} Hz: ${what}`);
  expect(
    X.third.problems === 0 && X.releaseProblems === 0,
    `checker problems in the third reversal (${X.third.problems}) or releases (${X.releaseProblems})`,
  );
  expect(X.orders === 0, `${X.orders} draw-order changes among painted cards`);
  const gap = Math.max(spread(X.paceUp), spread(X.paceDown));
  expect(gap <= 0.05, `held pace differs by ${pct(gap)} between height sets`);
  expect(
    S["worst step-to-step interval change"] <= 1.35,
    `step-to-step interval change ${S["worst step-to-step interval change"].toFixed(2)}`,
  );
  expect(
    X.phasedApart <= 0.05,
    `held ↑ and ↓ differ by ${pct(X.phasedApart)} over the key-repeat phases`,
  );
  expect(
    S["landing speed, px/frame (max, last 5 frames)"] <= 2,
    `landing speed ${S["landing speed, px/frame (max, last 5 frames)"].toFixed(1)} px/frame`,
  );
  expect(
    X.reversalJump <= tapBudget + 0.05,
    `a reversal moved an edge ${X.reversalJump.toFixed(1)} px in a frame, over the tap budget of ${tapBudget}`,
  );
  expect(
    X.lacking === 0,
    `${X.lacking} cards that pass the front are not visible enough`,
  );
  expect(pile < 1e-9, `the pile differs from the drum's by ${pile} px`);
  return failures;
}

/** The columns a list of tokens asks for: `cascade` is every cascade preset and the controls; `cascade:<name>` one cascade preset; any other name a drum preset. */
function columns(tokens) {
  const cols = [];
  const add = (model, name, control) => {
    const label = `${model.name}: ${name}`;
    if (!model.PRESETS[name])
      throw new Error(
        `unknown ${model.name} preset "${name}"; known: ${Object.keys(model.PRESETS).join(", ")}`,
      );
    if (!cols.some((c) => c.label === label))
      cols.push({ label, model, name, control });
  };
  for (const token of tokens) {
    if (token === "cascade") {
      for (const name of Object.keys(CASCADE.PRESETS))
        add(CASCADE, name, false);
      for (const name of CONTROLS) add(DRUM, name, true);
    } else if (token.startsWith("cascade:"))
      add(CASCADE, token.slice("cascade:".length), false);
    else add(DRUM, token, true);
  }
  return cols;
}
const isCascadeToken = (t) => t === "cascade" || t.startsWith("cascade:");

/** Runs each column at each refresh rate and prints one table per rate. Returns the results and the failed invariants. */
function compare(cols, hzs, { check }) {
  const results = {},
    failures = [];
  const pile = cols.some((c) => !c.control) ? pileGap() : 0;
  for (const hz of hzs) {
    const rows = {};
    for (const col of cols) {
      // The edge budgets are px/frame, so a 120 Hz run allows twice the px/s of a 60 Hz run.
      const cfg = { ...col.model.PRESETS[col.name] };
      const base = col.model.Model.config(cfg);
      cfg.vcap = (base.vcap * hz) / 60;
      cfg.vcap1 = (base.vcap1 * hz) / 60;
      const seen = collector(hz);
      const R = run(cfg, hz, { model: col.model, onFrames: seen.onFrames });
      const S = summary(R);
      const X = extras(col.model, { ...base, ...cfg }, hz, R, seen);
      (results[col.label] ??= {})[hz] = { summary: S, extras: X, ...R };
      rows[col.label] = { ...S, ...extraRows(X) };
      if (check && !col.control) {
        failures.push(...invariants(col.label, hz, R, S));
        failures.push(
          ...cascadeInvariants(col.label, hz, S, X, base.vcap / 60, pile),
        );
      }
    }
    const labels = Object.keys(rows);
    console.log(
      `\n### ${hz} Hz\n\n| Metric | ${labels.join(" | ")} |\n|---|${labels.map(() => "---").join("|")}|`,
    );
    for (const k of Object.keys(rows[labels[0]]))
      console.log(
        `| ${k} | ${labels.map((l) => fmt(rows[l][k])).join(" | ")} |`,
      );
  }
  if (pile !== undefined && cols.some((c) => !c.control))
    console.log(
      `\nThe cascade's pile differs from the drum's by at most ${pile} px.`,
    );
  return { results, failures };
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
  let results = {};
  const failures = [];
  const compared = presets.some(isCascadeToken);
  if (compared) {
    const done = compare(columns(presets), hzs, { check: flag("--check") });
    results = done.results;
    failures.push(...done.failures);
  }
  for (const name of compared ? [] : presets) {
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
  if (flag("--check") && !compared) failures.push(...slackInvariants());
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
