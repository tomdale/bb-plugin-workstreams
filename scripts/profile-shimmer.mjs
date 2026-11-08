#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

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
  : mkdtempSync(join(tmpdir(), "workstreams-shimmer-"));
mkdirSync(directory, { recursive: true });
const current = readFileSync(
  new URL("../src/app/styles.css", import.meta.url),
  "utf8",
);
const variants = values.baseline
  ? [
      ["baseline", readFileSync(values.baseline, "utf8")],
      ["current", current],
    ]
  : [["current", current]];
const browser = await chromium.launch({ executablePath, headless: true });
const samples = [];
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
  for (let run = 1; run <= runs; run++) {
    for (const [variant, styles] of variants) {
      await page.setContent(`<style>${styles}
        body { margin: 0; background: #141414; }
        .ws-needs { --sidebar: #141414; --ws-needs-you-band: #e2b659;
          width: 280px; height: 180px; margin: 10px; }
        </style><div class="ws-needs"></div>`);
      await page.waitForTimeout(1100);
      const client = await page.context().newCDPSession(page);
      try {
        await client.send("Performance.enable");
        const events = [];
        client.on("Tracing.dataCollected", ({ value }) =>
          events.push(...value),
        );
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
        await page.waitForTimeout(3000);
        const after = await metrics();
        const complete = new Promise((resolve) =>
          client.once("Tracing.tracingComplete", resolve),
        );
        await client.send("Tracing.end");
        await complete;
        const tracePath = join(directory, `${variant}-${run}.trace.json`);
        writeFileSync(tracePath, JSON.stringify({ traceEvents: events }));
        const traceTotals = Object.fromEntries(
          ["UpdateLayoutTree", "Layout", "Paint"].map((name) => {
            const matches = events.filter(
              (event) => event.name === name && event.ph === "X",
            );
            return [
              name,
              {
                count: matches.length,
                milliseconds:
                  matches.reduce(
                    (total, event) => total + (event.dur ?? 0),
                    0,
                  ) / 1000,
              },
            ];
          }),
        );
        samples.push({
          variant,
          run,
          milliseconds: 3000,
          metrics: Object.fromEntries(
            [
              "TaskDuration",
              "LayoutDuration",
              "RecalcStyleDuration",
              "LayoutCount",
              "RecalcStyleCount",
            ].map((name) => [name, after[name] - before[name]]),
          ),
          traceTotals,
          tracePath,
        });
      } finally {
        await client.detach();
      }
    }
  }
} finally {
  await browser.close();
}
const report = {
  node: process.version,
  browser: executablePath,
  metricUnits: {
    TaskDuration: "seconds",
    LayoutDuration: "seconds",
    RecalcStyleDuration: "seconds",
    LayoutCount: "count",
    RecalcStyleCount: "count",
  },
  scenario:
    "One Up Next shimmer, 1100 ms warmup then 3000 ms during its active sweep",
  samples,
};
const reportPath = join(directory, "profile.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log(`Report: ${reportPath}`);
