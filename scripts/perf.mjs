#!/usr/bin/env node
/**
 * Measures what a piece of this plugin's UI costs the browser, in headless
 * Chrome against fixture pages. `npm run perf -- --help` is the manual.
 *
 * The five tables below are the whole configuration. A page names a fixture
 * that gallery/perf/main.tsx mounts, plus the selectors scenarios act on. A
 * scenario is an interaction written against those selector names, so it runs
 * on every page that defines them. A switch turns one suspect off for a
 * comparison. A metric is one row of the report.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";

/**
 * `size` is how many `unit`s the fixture draws by default, `ready` a selector
 * that exists once the page has drawn, and `targets` the elements scenarios
 * act on. Any Playwright selector works.
 */
const pages = {
  sidebar: {
    description:
      "The production thread list: Up Next, Recent, and eight workstreams of threads in every status",
    size: 64,
    unit: "threads",
    viewport: { width: 360, height: 1000 },
    ready: "[data-fold-control]",
    targets: {
      hover: ".ws-row",
      tooltip: '.ws-row >> nth=0 >> role=button[name="Archive"]',
      fold: "[data-fold-control]",
    },
  },
  question: {
    description:
      "The production question card: one question whose options have descriptions and previews",
    size: 8,
    unit: "options",
    viewport: { width: 800, height: 1000 },
    ready: '[role="radio"]',
    targets: { hover: '[role="radio"]' },
  },
};

/**
 * `run(page, find, targets)` performs the interaction; `find(name, limit)`
 * returns up to `limit` elements of the page's target `name`. `needs` lists
 * the targets a page must define. A `fromLoad` scenario is measured from
 * before navigation, so loading is its interaction; the others start on a
 * loaded page at rest.
 */
const scenarios = {
  render: {
    description: "Load the page and draw it for the first time",
    fromLoad: true,
  },
  hover: {
    description: "Cross up to 16 hover targets, then open a tooltip if any",
    needs: ["hover"],
    async run(page, find, targets) {
      const rows = await find("hover", 16);
      for (const row of rows) {
        await row.hover();
        await page.waitForTimeout(40);
      }
      if (targets.tooltip) {
        await rows[0].hover();
        await (await find("tooltip", 1))[0].hover();
        await page.getByRole("tooltip").first().waitFor({ timeout: 2000 });
        await page.waitForTimeout(150);
      }
      await page.mouse.move(1, 1);
      await page.waitForTimeout(250);
    },
  },
  fold: {
    description: "Collapse and expand the first two folds, 350 ms apart",
    needs: ["fold"],
    async run(page, find) {
      for (const control of await find("fold", 2))
        for (let click = 0; click < 2; click++) {
          await control.click();
          // Long enough for the fold and the rows gliding below it to finish.
          await page.waitForTimeout(350);
        }
      await page.mouse.move(1, 1);
    },
  },
  idle: {
    description: "Two seconds untouched: what animations cost at rest",
    run: (page) => page.waitForTimeout(2000),
  },
  updates: {
    description: "20 re-renders from the root, a frame apart: React commits",
    run: (page) =>
      page.evaluate(async () => {
        for (let update = 0; update < 20; update++) {
          window.__perf.rerender();
          await new Promise(requestAnimationFrame);
        }
      }),
  },
};

/** What `--without <name>` turns off, as CSS the page adds to itself. */
const still = (selector) =>
  `${selector} { animation: none !important; transition: none !important; }`;
const switches = {
  animations: {
    description: "Every CSS animation and transition",
    css: still("*, *::before, *::after"),
  },
  spinners: {
    description: "The spinners on working and waiting threads",
    css: still(".ws-spin, .ws-spin *, .ws-spin::before, .ws-spin::after"),
  },
  shimmer: {
    description: "The Up Next band's shimmer",
    css: still(".ws-needs, .ws-needs::after"),
  },
  nothing: {
    description: "Nothing: equal arms, which shows the spread between runs",
    css: "",
  },
};

/** Report rows, in order. Names ending in "ms" are milliseconds. */
const metrics = {
  "task ms": "Main-thread time: script, style, layout, paint (TaskDuration)",
  "script ms": "JavaScript time (CDP ScriptDuration)",
  "style ms": "Style recalculation time (CDP RecalcStyleDuration)",
  "layout ms": "Layout time (CDP LayoutDuration)",
  "style recalcs": "Style recalculations (CDP RecalcStyleCount)",
  layouts: "Layouts (CDP LayoutCount)",
  paints: "Paint events in the devtools.timeline trace",
  "paint ms": "Time inside those Paint events",
  "react commits": "React commits the page's Profiler recorded",
  "react ms": "Time React spent rendering them (Profiler actualDuration)",
  "wall ms": "The measured window, including the scenario's fixed waits",
  "load average": "The machine's one-minute load average when sampled",
};

/** Command-line options, each with the value it takes. */
const options = {
  "page <name>": "Page to measure (default: sidebar)",
  "samples <count>": "Samples per scenario; durations need 10 (default: 10)",
  "size <count>": "Items the page draws (default: the page's own)",
  "without <switch|css>": "Also measure with a switch off, or your CSS added",
  "baseline <report>": "Compare against a report an earlier --output saved",
  "output <file>": "Where the JSON report goes (default: .perf/report.json)",
  help: "Print this manual",
};

const root = fileURLToPath(new URL("..", import.meta.url));
/** An expected failure: what went wrong, and what to do next. */
const failure = (what, next) => Object.assign(new Error(what), { next });
const mapValues = (table, change) =>
  Object.fromEntries(
    Object.entries(table).map(([name, entry]) => [name, change(entry, name)]),
  );
const supported = (page) =>
  Object.keys(scenarios).filter((name) =>
    (scenarios[name].needs ?? []).every((target) => target in page.targets),
  );
const describe = (table, width = 14, prefix = "") =>
  Object.entries(table)
    .map(([name, entry]) => [prefix + name, entry.description ?? entry])
    .map(([name, text]) => `  ${name.padEnd(width)} ${text}`)
    .join("\n");
const pageDetails = (page) =>
  [
    page.description,
    `${page.size} ${page.unit} by default; runs ${supported(page).join(", ")}`,
    ...Object.entries(page.targets).map((target) => target.join(" target: ")),
  ].join(`\n${" ".repeat(17)}`);

const catalog =
  () => `Scenarios (name any number; default: every one the page supports)
${describe(scenarios)}

Pages (--page)
${describe(mapValues(pages, pageDetails))}

Switches (--without)
${describe(switches)}

Metrics (each reported as median, minimum, and maximum)
${describe(metrics)}

Options
${describe(options, 24, "--")}`;

const help = () => `Usage: npm run perf -- [scenario ...] [options]

Measures what this plugin's UI costs the browser. It builds a fixture page
(gallery/perf.html) itself on every run, opens it in headless Chrome, runs each
scenario ten times after a discarded warm-up, and prints each metric's median,
minimum, and maximum. It draws fixtures only and never reads the running BB app.
The page runs React's profiling build so the Profiler can report commits, which
raises absolute timings: read them as an upper bound and compare arms or
before-and-after runs.

${catalog()}

Examples
  npm run perf
      every scenario on the 64-thread sidebar, in about two minutes
  npm run perf -- list
      the tables above, without this introduction or the examples
  npm run perf -- hover fold --samples 20
      two scenarios, twenty samples each
  npm run perf -- hover --page question --size 24
      the question card instead of the sidebar, with 24 options
  npm run perf -- idle --without spinners
      what the spinners cost at rest: both arms alternate in one session
  npm run perf -- hover --without '.ws-row-actions { transition: none }'
      switch off a suspect of your own, written as CSS
  npm run perf -- idle --without nothing
      the same arm twice: how far two equal runs differ
  npm run perf -- --output .perf/before.json
  npm run perf -- --baseline .perf/before.json
      save a report, change the code, then measure the change against it

To add a scenario, switch, or metric, add an entry to its table at the top of
scripts/perf.mjs. To add a page, add its entry there and its fixture to
gallery/perf/main.tsx.`;

/** Fails, suggesting the name in `table` that shares the most letter pairs with `typed`. */
function unknown(kind, typed, table, prefix = "") {
  const pairs = (text) =>
    Array.from(text.slice(1), (_, at) => text.slice(at, at + 2).toLowerCase());
  const wanted = new Set(pairs(typed));
  const shared = (text) =>
    pairs(text).filter((pair) => wanted.has(pair)).length;
  const score = (name) =>
    3 * shared(name) + shared(String(table[name].description ?? table[name]));
  const [best] = Object.keys(table).sort((a, b) => score(b) - score(a));
  const close = wanted.size && score(best) >= wanted.size;
  const all = Object.keys(table).map((name) => prefix + name);
  throw failure(
    `There is no ${kind} named "${typed}".`,
    `${close ? `Did you mean "${prefix}${best}"? ` : ""}Choose from: ${all.join(", ")}. \`npm run perf -- list\` describes each.`,
  );
}

function count(name, text, fallback, max) {
  const value = text === undefined ? fallback : Number(text);
  if (Number.isInteger(value) && value >= 1 && value <= max) return value;
  throw failure(
    `--${name} is "${text}", which is not a whole number from 1 to ${max}.`,
    `Pass a number, as in --${name} ${fallback}.`,
  );
}

async function launchChrome() {
  const { chromium } = await import("playwright-core");
  const app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const places = [process.env.CHROME_PATH, chromium.executablePath(), app];
  const executablePath = places.find((place) => place && existsSync(place));
  if (!executablePath)
    throw failure(
      `No Chrome found. Looked in: ${places.filter(Boolean).join(", ")}.`,
      "Install Google Chrome, or set CHROME_PATH to a Chrome or Chromium executable.",
    );
  return chromium.launch({ executablePath, headless: true });
}

/** Builds gallery/perf.html into .perf/page and returns the built page's URL. */
async function buildPage() {
  console.error("Building the fixture page from gallery/perf.html…");
  process.env.GALLERY_PAGE = "perf";
  const { build } = await import("vite");
  const outDir = join(root, ".perf/page");
  const configFile = join(root, "gallery/vite.config.ts");
  try {
    const output = { outDir, emptyOutDir: true };
    await build({ configFile, logLevel: "error", build: output });
  } catch (error) {
    throw failure(
      `The fixture page did not build. ${stripVTControlCharacters(error.message).trim()}`,
      "Run `npm run typecheck` and fix what it reports in gallery/perf/ or in the component the page mounts.",
    );
  }
  return pathToFileURL(join(outDir, "perf.html")).href;
}

/** Runs `action` between two readings of Chrome's counters, inside one trace. */
async function measure(page, action) {
  const client = await page.context().newCDPSession(page);
  const paints = [];
  client.on("Tracing.dataCollected", ({ value }) =>
    paints.push(...value.filter((e) => e.name === "Paint" && e.ph === "X")),
  );
  const traced = new Promise((done) =>
    client.once("Tracing.tracingComplete", done),
  );
  const counters = async () => {
    const { metrics: read } = await client.send("Performance.getMetrics");
    return Object.fromEntries(read.map(({ name, value }) => [name, value]));
  };
  await client.send("Performance.enable");
  await client.send("Tracing.start", { categories: "devtools.timeline" });
  const load = loadavg()[0];
  const before = await counters();
  const started = performance.now();
  await action();
  // Two animation frames on, so the last change's rendering is counted.
  await page.evaluate(() => window.__perf.settled());
  const wall = performance.now() - started;
  const after = await counters();
  const commits = await page.evaluate(() => window.__perf.commits.splice(0));
  await client.send("Tracing.end");
  await traced;
  await client.detach();
  // Counters are seconds and trace durations microseconds; both leave as milliseconds.
  const ms = (name) => (after[name] - before[name]) * 1000;
  const sum = (list, field) => list.reduce((all, item) => all + item[field], 0);
  const values = {
    "task ms": ms("TaskDuration"),
    "script ms": ms("ScriptDuration"),
    "style ms": ms("RecalcStyleDuration"),
    "layout ms": ms("LayoutDuration"),
    "style recalcs": after.RecalcStyleCount - before.RecalcStyleCount,
    layouts: after.LayoutCount - before.LayoutCount,
    paints: paints.length,
    "paint ms": sum(paints, "dur") / 1000,
    "react commits": commits.length,
    "react ms": sum(commits, "actualDuration"),
    "wall ms": wall,
    "load average": load,
  };
  return { values, commits };
}

/** One sample: a new page with the arm's CSS added, and one scenario measured on it. */
async function sample(browser, { pageName, url }, name, arm) {
  const { viewport, ready, targets } = pages[pageName];
  const scenario = scenarios[name];
  const address = arm.css ? `${url}&css=${encodeURIComponent(arm.css)}` : url;
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const noErrors = () => {
    if (errors.length) throw new Error(`the page threw "${errors[0]}"`);
  };
  const open = async () => {
    await page.goto(address, { waitUntil: "load" });
    noErrors();
    await page.waitForSelector(ready, { timeout: 10_000 }).catch(() => {
      throw new Error(`nothing matched its ready selector, ${ready}`);
    });
  };
  const find = async (target, limit) => {
    const selector = targets[target];
    const found = await page.locator(selector).all();
    if (found.length) return found.slice(0, limit);
    throw new Error(`nothing matches its "${target}" target, ${selector}`);
  };
  try {
    if (!scenario.fromLoad) {
      await open();
      await page.mouse.move(1, 1);
      await page.evaluate(() => window.__perf.rest());
    }
    const result = await measure(page, async () => {
      if (scenario.fromLoad) await open();
      await scenario.run?.(page, find, targets);
    });
    noErrors();
    return { scenario: name, arm: arm.name, ...result };
  } catch (error) {
    throw failure(
      `The ${name} scenario failed on the ${pageName} page: ${error.message.split("\n")[0]}.`,
      `Open ${address} in Chrome to see the page and its console. The page's selectors are pages.${pageName} and the scenario's steps scenarios.${name}, both in scripts/perf.mjs; its fixture is gallery/perf/${pageName}.tsx.`,
    );
  } finally {
    await page.close();
  }
}

function spread(numbers) {
  const sorted = numbers.toSorted((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  const median = (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
  return { median, min: sorted[0], max: sorted.at(-1) };
}

/** Each metric's median, minimum, and maximum, by arm and then scenario. */
function summarize(samples) {
  const lists = {};
  for (const { arm, scenario, values } of samples) {
    const metricLists = ((lists[arm] ??= {})[scenario] ??= {});
    for (const name in metrics) (metricLists[name] ??= []).push(values[name]);
  }
  const spreads = (metricLists) => mapValues(metricLists, spread);
  return mapValues(lists, (arm) => mapValues(arm, spreads));
}

/** One scenario's table: each arm's median and range, and the change between the first two. */
function table(scenario, columns) {
  const arms = columns.filter(({ summary }) => summary[scenario]);
  const show = (value, metric) =>
    metric.endsWith(" ms") ? value.toFixed(1) : `${+value.toFixed(2)}`;
  const rows = Object.keys(metrics).map((metric) => {
    const cells = arms.map(({ summary }) => summary[scenario][metric]);
    const row = cells.flatMap((cell) => [
      show(cell.median, metric),
      `${show(cell.min, metric)} to ${show(cell.max, metric)}`,
    ]);
    if (cells.length < 2) return [metric, ...row];
    const [first, second] = cells;
    const change = second.median - first.median;
    const apart = first.max < second.min || second.max < first.min;
    const sign = change > 0 ? "+" : "";
    const shown = (sign + show(change, metric)).replace(/^[+-]0\.0$/, "0.0");
    const verdict = !+shown ? "" : apart ? "ranges apart" : "ranges overlap";
    return [metric, ...row, shown, verdict];
  });
  const heading = arms.flatMap(({ name }) => [name, "min to max"]);
  if (arms.length > 1) heading.push("change", "");
  return [["metric", ...heading], ...rows]
    .map((row) => row.map((cell, at) => cell[at ? "padStart" : "padEnd"](18)))
    .map((row) => `  ${row.join("  ").trimEnd()}`)
    .join("\n");
}

async function main() {
  const words = process.argv.slice(2);
  if (words.some((word) => ["help", "--help", "-h"].includes(word)))
    return console.log(help());
  if (words.includes("list")) return console.log(catalog());
  if (!existsSync(join(root, "node_modules/vite")))
    throw failure(
      "This checkout has no node_modules, so there is nothing to build or drive Chrome with.",
      "Run `npm ci` in the repository root, then try again.",
    );
  let parsed;
  try {
    const flags = Object.keys(options).map((option) => option.split(" ")[0]);
    const types = flags.map((flag) => [flag, { type: "string" }]);
    const config = {
      allowPositionals: true,
      options: Object.fromEntries(types),
    };
    parsed = parseArgs(config);
  } catch (error) {
    if (error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION")
      unknown("option", /'-*([^' ]+)/.exec(error.message)[1], options, "--");
    throw failure(error.message, "See `npm run perf -- --help`.");
  }
  const { values, positionals: named } = parsed;
  const pageName = values.page ?? "sidebar";
  const page = pages[pageName] ?? unknown("page", pageName, pages);
  for (const name of named) {
    const scenario = scenarios[name] ?? unknown("scenario", name, scenarios);
    const missing = scenario.needs?.find((target) => !page.targets[target]);
    if (missing)
      throw failure(
        `The ${name} scenario needs a "${missing}" target, and the ${pageName} page defines none.`,
        `Run one the page supports (${supported(page).join(", ")}), or add ${missing}: "<selector>" to pages.${pageName}.targets in scripts/perf.mjs.`,
      );
  }
  const names = named.length ? [...new Set(named)] : supported(page);
  const samples = count("samples", values.samples, 10, 100);
  const size = count("size", values.size, page.size, 5000);
  // A comparison's second arm: a named switch, or the caller's own CSS.
  const off = values.without;
  const arms = [{ name: "current", css: "" }];
  if (off?.includes("{")) arms.push({ name: "without your CSS", css: off });
  else if (off) {
    const { css } = switches[off] ?? unknown("switch", off, switches);
    arms.push({ name: `without ${off}`, css });
  }
  let baseline;
  try {
    const saved = values.baseline && readFileSync(values.baseline, "utf8");
    if (saved) baseline = JSON.parse(saved);
    if (saved && !baseline.summary?.current) throw new Error("no summary");
  } catch (error) {
    throw failure(
      `--baseline ${values.baseline} is not a report from this command: ${error.message}.`,
      "Save one with `npm run perf -- --output <file>`, then pass that file.",
    );
  }
  const output = resolve(values.output ?? join(root, ".perf/report.json"));
  mkdirSync(dirname(output), { recursive: true });

  const browser = await launchChrome();
  const recorded = [];
  const run = { pageName, size, arms };
  try {
    run.url = `${await buildPage()}?page=${pageName}&size=${size}`;
    const both = arms[1] ? `, alternating current and ${arms[1].name}` : "";
    const unable = Object.keys(scenarios).filter(
      (name) => !supported(page).includes(name),
    );
    console.error(
      `Measuring ${names.join(", ")} on ${pageName} (${size} ${page.unit}): samples per scenario: ${samples}${both}. Round 0 is a discarded warm-up.`,
    );
    if (unable.length)
      console.error(`The ${pageName} page cannot run ${unable.join(", ")}.`);
    // Arms swap order every round, so drift during the run lands on both.
    for (let round = 0; round <= samples; round++) {
      for (const scenario of names)
        for (const arm of round % 2 ? arms : arms.toReversed()) {
          const result = await sample(browser, run, scenario, arm);
          if (round) recorded.push(result);
        }
      console.error(`  round ${round} of ${samples}`);
    }
  } finally {
    await browser.close();
  }

  const summary = summarize(recorded);
  const columns = arms.map(({ name }) => ({ name, summary: summary[name] }));
  if (baseline)
    columns.unshift({ name: "baseline", summary: baseline.summary.current });
  const command = `npm run perf -- ${words.join(" ")}`;
  const record = { command, date: new Date(), chrome: browser.version() };
  const report = { ...record, ...run, metrics, summary, samples: recorded };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  for (const scenario of names) {
    const { description } = scenarios[scenario];
    const title = `${scenario} on ${pageName}, ${samples} samples: ${description}`;
    console.log(`${title}\n${table(scenario, columns)}\n`);
  }
  if (columns.length > 1)
    console.log(
      `change is ${columns[1].name} minus ${columns[0].name}. "ranges overlap" means the two arms' minimum-to-maximum ranges intersect, so the change may be chance.\n`,
    );
  if (baseline) console.log(`Baseline: ${baseline.command}, ${baseline.date}`);
  console.log(`Report: ${relative(process.cwd(), output)}`);
}

main().catch((error) => {
  const known = `perf: ${error.message}\n  Next: ${error.next}`;
  const bug = `perf: unexpected error, which is a bug in scripts/perf.mjs.\n${error.stack}`;
  console.error(error.next ? known : bug);
  process.exit(1);
});
