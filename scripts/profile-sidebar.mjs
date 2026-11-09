#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({
  options: {
    baseline: { type: "string" },
    runs: { type: "string", default: "3" },
    "output-dir": { type: "string" },
  },
});
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 20)
  throw new Error("--runs must be an integer from 1 to 20");
const executablePath = [
  process.env.CHROME_PATH,
  chromium.executablePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((path) => path && existsSync(path));
if (!executablePath) throw new Error("Install Chrome or set CHROME_PATH");
const directory = values["output-dir"]
  ? resolve(values["output-dir"])
  : mkdtempSync(join(tmpdir(), "workstreams-sidebar-"));
mkdirSync(directory, { recursive: true });
const baseline = values.baseline
  ? JSON.parse(readFileSync(values.baseline, "utf8"))
  : null;

function build(config, galleryPage) {
  const env = { ...process.env };
  if (galleryPage) env.GALLERY_PAGE = galleryPage;
  else delete env.GALLERY_PAGE;
  const result = spawnSync("npx", ["vite", "build", "--config", config], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error(`Sidebar gallery build failed: ${config}`);
}
build("gallery/vite.config.ts", "sidebar");
build("gallery/vite.sidebar-profile.config.ts");
const pageUrl = pathToFileURL(
  join(root, "gallery/dist/sidebar-profile.html"),
).href;

const metricNames = [
  "TaskDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "LayoutCount",
  "RecalcStyleCount",
];
const traceNames = ["UpdateLayoutTree", "Layout", "Paint"];
const emptyReact = {
  commits: 0,
  mountCommits: 0,
  updateCommits: 0,
  actualDurationMilliseconds: 0,
  baseDurationMilliseconds: 0,
};

async function reactSnapshot(page) {
  return page.evaluate(() => {
    const commits = window.__sidebarProfile?.commits ?? [];
    return {
      commits: commits.length,
      mountCommits: commits.filter((commit) => commit.phase === "mount").length,
      updateCommits: commits.filter((commit) => commit.phase !== "mount")
        .length,
      actualDurationMilliseconds: commits.reduce(
        (total, commit) => total + commit.actualDuration,
        0,
      ),
      baseDurationMilliseconds: commits.reduce(
        (total, commit) => total + commit.baseDuration,
        0,
      ),
    };
  });
}
const subtract = (after, before) =>
  Object.fromEntries(
    Object.keys(after).map((name) => [name, after[name] - before[name]]),
  );

async function openProfile(browser) {
  const page = await browser.newPage({
    viewport: { width: 360, height: 1000 },
    deviceScaleFactor: 1,
  });
  await page.goto(pageUrl, { waitUntil: "load" });
  await page.waitForFunction(() => window.__sidebarProfile?.ready === true);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  return page;
}

async function measure(page, scenario, run, action) {
  const client = await page.context().newCDPSession(page);
  const events = [];
  const started = performance.now();
  try {
    await client.send("Performance.enable");
    client.on("Tracing.dataCollected", ({ value }) => events.push(...value));
    await client.send("Tracing.start", {
      categories: "devtools.timeline",
      transferMode: "ReportEvents",
    });
    const metrics = async () =>
      Object.fromEntries(
        (await client.send("Performance.getMetrics")).metrics.map(
          ({ name, value }) => [name, value],
        ),
      );
    const before = await metrics();
    const reactBefore =
      scenario === "initial-render" ? emptyReact : await reactSnapshot(page);
    await action();
    const after = await metrics();
    const reactAfter = await reactSnapshot(page);
    const complete = new Promise((resolve) =>
      client.once("Tracing.tracingComplete", resolve),
    );
    await client.send("Tracing.end");
    await complete;
    const tracePath = join(directory, `${scenario}-${run}.trace.json`);
    writeFileSync(tracePath, JSON.stringify({ traceEvents: events }));
    const traceTotals = Object.fromEntries(
      traceNames.map((name) => {
        const matches = events.filter(
          (event) => event.name === name && event.ph === "X",
        );
        return [
          name,
          {
            count: matches.length,
            milliseconds:
              matches.reduce((total, event) => total + (event.dur ?? 0), 0) /
              1000,
          },
        ];
      }),
    );
    return {
      scenario,
      run,
      milliseconds: performance.now() - started,
      metrics: Object.fromEntries(
        metricNames.map((name) => [
          name,
          (after[name] ?? 0) - (before[name] ?? 0),
        ]),
      ),
      traceTotals,
      react: subtract(reactAfter, reactBefore),
      tracePath,
    };
  } finally {
    await client.detach();
  }
}

async function hover(page) {
  const rows = page.locator(".ws-row");
  const count = Math.min(await rows.count(), 16);
  for (let index = 0; index < count; index++) {
    const row = rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    if (!box) throw new Error(`Hover row ${index} has no bounding box`);
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
    await page.waitForTimeout(65);
  }
  const first = rows.first();
  await first.scrollIntoViewIfNeeded();
  await first.hover({ position: { x: 100, y: 10 } });
  await first.getByRole("button", { name: "Archive", exact: true }).hover();
  await page.getByRole("tooltip").waitFor({ state: "visible", timeout: 2000 });
  await page.waitForTimeout(150);
  await page.mouse.move(1, 1);
  await page.waitForTimeout(250);
}

async function expandCollapse(page) {
  const headings = page.locator("[data-profile-heading]");
  const count = await headings.count();
  for (let index = 0; index < count; index++) {
    const heading = headings.nth(index);
    await heading.click();
    await page.waitForTimeout(60);
    await heading.click();
    await page.waitForTimeout(60);
  }
  await page.mouse.move(1, 1);
}

async function reactCommits(page) {
  await page.evaluate(async () => {
    for (let update = 0; update < 20; update++) {
      window.__sidebarProfile.rerender();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
}

const scenarios = [
  {
    name: "initial-render",
    description: "Navigation and first render of 64 rows in eight workstreams",
  },
  {
    name: "hover",
    description: "Sweep 16 rows, reveal actions, and open an Archive tooltip",
  },
  {
    name: "expand-collapse",
    description: "Collapse and expand each of eight workstream groups",
  },
  {
    name: "animation",
    description: "Three idle seconds with eight production spinner animations",
  },
  {
    name: "react-commits",
    description:
      "Twenty parent updates with React.Profiler commit measurements",
  },
];

const browser = await chromium.launch({ executablePath, headless: true });
const samples = [];
try {
  const warmup = await openProfile(browser);
  await warmup.waitForTimeout(1100);
  await warmup.close();
  for (let run = 1; run <= runs; run++) {
    for (const scenario of scenarios) {
      if (scenario.name === "initial-render") {
        const page = await browser.newPage({
          viewport: { width: 360, height: 1000 },
          deviceScaleFactor: 1,
        });
        try {
          samples.push(
            await measure(page, scenario.name, run, async () => {
              await page.goto(pageUrl, { waitUntil: "load" });
              await page.waitForFunction(
                () => window.__sidebarProfile?.ready === true,
              );
            }),
          );
        } finally {
          await page.close();
        }
        continue;
      }
      const page = await openProfile(browser);
      try {
        await page.mouse.move(1, 1);
        await page.waitForTimeout(1100);
        await page.evaluate(() => window.__sidebarProfile.reset());
        const action =
          scenario.name === "hover"
            ? () => hover(page)
            : scenario.name === "expand-collapse"
              ? () => expandCollapse(page)
              : scenario.name === "animation"
                ? () => page.waitForTimeout(3000)
                : () => reactCommits(page);
        samples.push(await measure(page, scenario.name, run, action));
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}

const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
function summarize(reportSamples) {
  return Object.fromEntries(
    scenarios.map(({ name }) => {
      const matching = reportSamples.filter(
        (sample) => sample.scenario === name,
      );
      if (!matching.length) return [name, null];
      return [
        name,
        {
          milliseconds: median(matching.map((sample) => sample.milliseconds)),
          metrics: Object.fromEntries(
            metricNames.map((metric) => [
              metric,
              median(matching.map((sample) => sample.metrics[metric] ?? 0)),
            ]),
          ),
          traceTotals: Object.fromEntries(
            traceNames.map((trace) => [
              trace,
              {
                count: median(
                  matching.map(
                    (sample) => sample.traceTotals[trace]?.count ?? 0,
                  ),
                ),
                milliseconds: median(
                  matching.map(
                    (sample) => sample.traceTotals[trace]?.milliseconds ?? 0,
                  ),
                ),
              },
            ]),
          ),
          react: Object.fromEntries(
            Object.keys(emptyReact).map((metric) => [
              metric,
              median(matching.map((sample) => sample.react?.[metric] ?? 0)),
            ]),
          ),
        },
      ];
    }),
  );
}
const summary = summarize(samples);
let comparison = null;
if (baseline) {
  const before = summarize(baseline.samples ?? []);
  comparison = Object.fromEntries(
    scenarios.map(({ name }) => {
      if (!summary[name] || !before[name]) return [name, null];
      return [
        name,
        {
          metrics: Object.fromEntries(
            metricNames.map((metric) => [
              metric,
              summary[name].metrics[metric] - before[name].metrics[metric],
            ]),
          ),
          traceTotals: Object.fromEntries(
            traceNames.map((trace) => [
              trace,
              {
                count:
                  summary[name].traceTotals[trace].count -
                  before[name].traceTotals[trace].count,
                milliseconds:
                  summary[name].traceTotals[trace].milliseconds -
                  before[name].traceTotals[trace].milliseconds,
              },
            ]),
          ),
          react: Object.fromEntries(
            Object.keys(emptyReact).map((metric) => [
              metric,
              summary[name].react[metric] - before[name].react[metric],
            ]),
          ),
        },
      ];
    }),
  );
}
const report = {
  node: process.version,
  browser: executablePath,
  browserVersion: browser.version(),
  page: pageUrl,
  viewport: { width: 360, height: 1000 },
  warmupMilliseconds: 1100,
  metricUnits: {
    TaskDuration: "seconds",
    LayoutDuration: "seconds",
    RecalcStyleDuration: "seconds",
    LayoutCount: "count",
    RecalcStyleCount: "count",
  },
  traceUnits: { count: "count", milliseconds: "milliseconds" },
  scenarios,
  samples,
  summary,
  comparison,
};
const reportPath = join(directory, "sidebar.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ summary }, null, 2));
if (comparison) {
  console.log(`Deltas from ${resolve(values.baseline)} (current - baseline):`);
  for (const [scenario, delta] of Object.entries(comparison)) {
    if (!delta) continue;
    console.log(scenario, JSON.stringify(delta));
  }
}
console.log(`Report: ${reportPath}`);
