import { describe, expect, it } from "vitest";
import {
  usageReportSchema,
  type SpendState,
  type UsageFlag,
  type UsageSummary,
  type UsageTotalsByWindow,
} from "../../src/domain/usage.ts";
import {
  buildUsageReport,
  type UsageReportDeps,
} from "../../src/server/usageReport.ts";

const NOW = new Date(2025, 4, 10, 12, 0, 0).getTime();

const SUMMARY: UsageSummary = {
  range: "7d",
  from: NOW - 7 * 24 * 3_600_000,
  to: NOW,
  bucketMs: 6 * 3_600_000,
  totals: {
    cost: 1.5,
    calls: 12,
    unmetered: 2,
    inputTokens: 9_000,
    outputTokens: 800,
    failed: 1,
  },
  buckets: [],
  bySource: [],
  byModel: [],
  byPath: [],
  byThread: [],
  byWorkstream: [],
  retainedSince: NOW - 3_600_000,
};
const WINDOWS: UsageTotalsByWindow = {
  hour: { cost: 0.5, calls: 4, unmetered: 1 },
  day: { cost: 1, calls: 8, unmetered: 2 },
  month: { cost: 1.5, calls: 12, unmetered: 2 },
};
const STATE: SpendState = { level: "ok", limits: [] };
const FLAG: UsageFlag = {
  id: "thread-burst:thr_a",
  kind: "thread-burst",
  severity: "warning",
  title: "One thread made 40 requests in an hour",
  detail: "Thread thr_a, 40 requests at 11:59, $0.40 reported.",
  at: NOW - 60_000,
  since: NOW - 60_000,
  threadId: "thr_a",
  source: "turn-end",
  calls: 40,
  cost: 0.4,
};

describe("buildUsageReport", () => {
  it("reads the summary, windows, state, and flags at one moment", () => {
    const seen: unknown[] = [];
    let lookups = 0;
    const deps: UsageReportDeps = {
      ledger: {
        summary: (range, options) => {
          seen.push(["summary", range, options?.now]);
          expect(options?.groupOfThread?.("thr_a")).toEqual({
            key: "ws_1",
            label: "bb › Plugin",
          });
          expect(options?.groupOfThread?.("thr_b")).toBeNull();
          return SUMMARY;
        },
        totals: (now) => {
          seen.push(["totals", now]);
          return WINDOWS;
        },
      },
      guard: {
        status: () => STATE,
        resume: () => {
          throw new Error("A report never resumes.");
        },
      },
      monitor: { flags: () => [FLAG] },
      workstreamOfThread: () => {
        lookups += 1;
        return (threadId) =>
          threadId === "thr_a" ? { key: "ws_1", label: "bb › Plugin" } : null;
      },
    };

    const report = buildUsageReport(deps, "7d", NOW);

    expect(report).toEqual({
      ...SUMMARY,
      now: NOW,
      windows: WINDOWS,
      state: STATE,
      flags: [FLAG],
    });
    expect(usageReportSchema.parse(report)).toEqual(report);
    expect(seen).toEqual([
      ["summary", "7d", NOW],
      ["totals", NOW],
    ]);
    // One lookup serves every thread in the report.
    expect(lookups).toBe(1);
  });
});
