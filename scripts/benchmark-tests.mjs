#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  availableParallelism,
  cpus,
  platform,
  release,
  tmpdir,
  totalmem,
} from "node:os";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    "output-dir": { type: "string" },
  },
});
const count = Number(values.runs);
if (!Number.isInteger(count) || count < 1)
  throw new Error("--runs must be a positive integer");
const directory = values["output-dir"]
  ? resolve(values["output-dir"])
  : mkdtempSync(join(tmpdir(), "workstreams-tests-"));
mkdirSync(directory, { recursive: true });
const samples = [];
const command =
  "npm test -- --reporter=default --reporter=json --outputFile.json=<report>";
for (let run = 1; run <= count; run++) {
  const report = join(directory, `run-${run}.json`);
  const log = join(directory, `run-${run}.log`);
  rmSync(report, { force: true });
  const fd = openSync(log, "w");
  const start = performance.now();
  let result;
  try {
    result = spawnSync(
      "npm",
      [
        "test",
        "--",
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${report}`,
      ],
      { stdio: ["ignore", fd, fd] },
    );
  } finally {
    closeSync(fd);
  }
  const seconds = (performance.now() - start) / 1_000;
  let tests;
  let browserTestsPassed = false;
  try {
    const json = JSON.parse(readFileSync(report, "utf8"));
    tests = {
      total: json.numTotalTests,
      passed: json.numPassedTests,
      failed: json.numFailedTests,
      skipped: json.numPendingTests,
    };
    const browserFiles = [
      "goal-wrapping.test.ts",
      "sidebar-layout.test.ts",
      "sticky-goal-layout.test.ts",
    ];
    browserTestsPassed = browserFiles.every((name) => {
      const file = json.testResults.find((file) =>
        file.name.endsWith(`/tests/app/${name}`),
      );
      return (
        file?.assertionResults.length > 0 &&
        file.assertionResults.every((test) => test.status === "passed")
      );
    });
  } catch {
    // Preserve timings and the command log even when the runner crashes.
  }
  samples.push({
    run,
    seconds,
    exit: result.status,
    signal: result.signal,
    error: result.error?.message,
    tests,
    browserTestsPassed,
    report,
    log,
  });
  console.log(`Run ${run}: ${seconds.toFixed(3)}s (exit ${result.status})`);
  if (result.status !== 0) break;
}
const times = samples.map((sample) => sample.seconds).sort((a, b) => a - b);
const summary = {
  command,
  preparation:
    "Dependencies and Chrome installed; each sample starts a fresh npm/Vitest process; existing transform caches are retained; test results are never reused",
  machine: {
    cpu: cpus()[0]?.model,
    logicalCpus: availableParallelism(),
    memoryGiB: totalmem() / 2 ** 30,
    platform: platform(),
    release: release(),
    node: process.version,
  },
  samples,
  distribution: {
    min: times[0],
    median:
      (times[Math.floor((times.length - 1) / 2)] +
        times[Math.floor(times.length / 2)]) /
      2,
    p95: times[Math.ceil(times.length * 0.95) - 1],
    max: times.at(-1),
  },
  targetSeconds: 10,
  targetMet:
    samples.length === count &&
    samples.every(
      (sample) =>
        sample.exit === 0 && sample.browserTestsPassed && sample.seconds < 10,
    ),
};
const path = join(directory, "benchmark.json");
writeFileSync(path, JSON.stringify(summary, null, 2) + "\n");
console.log(`Report: ${path}`);
process.exitCode = summary.targetMet ? 0 : 1;
