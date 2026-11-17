import {
  evaluateLimits,
  rangeBounds,
  type LimitKey,
  type SpendState,
  type UsageBucket,
  type UsageFlag,
  type UsageGroup,
  type UsageLimits,
  type UsageRange,
  type UsageReport,
  type UsageTotals,
  type UsageTotalsByWindow,
} from "../../src/domain/usage.ts";

/** Thursday, July 16, 2026 at 3:42 PM, local time, so formatted times are fixed. */
export const NOW = new Date(2026, 6, 16, 15, 42).getTime();

/** The default limits: hour $3 / $10, day $10 / $30, month off, 150 / 500 requests. */
export const LIMITS: UsageLimits = {
  hourSpend: { warn: 3, cap: 10 },
  daySpend: { warn: 10, cap: 30 },
  monthSpend: { warn: null, cap: null },
  hourCalls: { warn: 150, cap: 500 },
};

const QUIET_WINDOWS: UsageTotalsByWindow = {
  hour: { cost: 0.84, calls: 46, unmetered: 9 },
  day: { cost: 6.12, calls: 388, unmetered: 71 },
  month: { cost: 58.4, calls: 4210, unmetered: 912 },
};

/** The windows' totals with `patch` applied, and the limits' state for them. */
export function spendState(
  patch: Partial<UsageTotalsByWindow> = {},
  resumes: Partial<Record<LimitKey, number>> = {},
  limits: UsageLimits = LIMITS,
): { windows: UsageTotalsByWindow; state: SpendState } {
  const windows = { ...QUIET_WINDOWS, ...patch };
  return { windows, state: evaluateLimits(limits, windows, NOW, resumes) };
}

const amounts = (
  cost: number,
  calls: number,
  unmetered: number,
  inputTokens: number,
  outputTokens: number,
): UsageTotals => ({
  cost,
  calls,
  unmetered,
  inputTokens,
  outputTokens,
  failed: 0,
});

const group = (
  key: string,
  label: string,
  totals: UsageTotals,
): UsageGroup => ({
  key,
  label,
  ...totals,
});

/**
 * Buckets for a range: a daytime rise and fall, a few empty buckets, and one
 * whose requests all went through worker threads and reported no cost.
 */
function buckets(range: UsageRange): UsageBucket[] {
  const { from, to, bucketMs } = rangeBounds(range, NOW);
  const all: UsageBucket[] = [];
  for (let start = from, index = 0; start <= to; start += bucketMs, index++) {
    const wave = 1 + Math.sin(index * 0.7) * 0.8 + ((index * 7) % 5) * 0.15;
    const quiet = index % 9 === 4;
    const unreported = index % 11 === 6;
    const calls = quiet ? 0 : Math.round(6 + wave * 9);
    const unmetered = unreported ? calls : Math.round(calls * 0.18);
    const metered = calls - unmetered;
    all.push({
      start,
      ...amounts(
        Math.round(metered * 1.9 * wave) / 100,
        calls,
        unmetered,
        metered * 5200,
        metered * 310,
      ),
    });
  }
  return all;
}

const sum = (rows: readonly UsageTotals[]): UsageTotals =>
  rows.reduce(
    (total, row) =>
      amounts(
        Math.round((total.cost + row.cost) * 100) / 100,
        total.calls + row.calls,
        total.unmetered + row.unmetered,
        total.inputTokens + row.inputTokens,
        total.outputTokens + row.outputTokens,
      ),
    amounts(0, 0, 0, 0, 0),
  );

/** A share of the range's metered usage, with `unmetered` requests on top. */
function share(totals: UsageTotals, part: number, unmetered = 0): UsageTotals {
  const metered = Math.round((totals.calls - totals.unmetered) * part);
  return amounts(
    Math.round(totals.cost * part * 100) / 100,
    metered + unmetered,
    unmetered,
    Math.round(totals.inputTokens * part),
    Math.round(totals.outputTokens * part),
  );
}

export const FLAGS: UsageFlag[] = [
  {
    id: "thread-burst:thr_recaps",
    kind: "thread-burst",
    severity: "critical",
    title: "One thread made 212 requests in an hour",
    detail:
      "Thread thr_recaps, 212 requests between 2:38 PM and 3:40 PM, $1.84 reported.",
    at: NOW - 2 * 60_000,
    since: NOW - 64 * 60_000,
    threadId: "thr_recaps",
    source: "turn-end",
    calls: 212,
    cost: 1.84,
  },
  {
    id: "unmetered-calls",
    kind: "unmetered-calls",
    severity: "warning",
    title: "18% of requests in the last 24 hours reported no cost",
    detail:
      "71 of 388 requests have no known cost: 52 worker thread, 19 failed. Totals leave these out; the requests-per-hour limit covers them.",
    at: NOW - 26 * 60_000,
    since: NOW - 23 * 3_600_000,
    threadId: null,
    source: null,
    calls: 71,
    cost: null,
  },
];

/**
 * A report for `range` as the server would send it at `NOW`: usage on most
 * buckets, every grouping, quiet limits, and no flags.
 */
export function usageReport(
  range: UsageRange = "24h",
  patch: Partial<UsageReport> = {},
): UsageReport {
  const bounds = rangeBounds(range, NOW);
  const all = buckets(range);
  const totals = sum(all);
  const worker = totals.unmetered;
  return {
    range,
    ...bounds,
    totals,
    buckets: all,
    byWorkstream: [
      group("ws_plugin", "bb › Workstreams Plugin", share(totals, 0.46, 4)),
      group("ws_vertex", "Vertex", share(totals, 0.31)),
      group("ws_dotfiles", "Dotfiles", share(totals, 0.14, 2)),
      group("none", "No workstream", share(totals, 0.09, worker - 6)),
    ],
    bySource: [
      group("turn-end", "Turn end", share(totals, 0.58, worker - 9)),
      group("presentation", "Enhanced response", share(totals, 0.22)),
      group("start", "New thread", share(totals, 0.12, 3)),
      group("category-fit", "Category check", share(totals, 0.08)),
      group("debug-thread", "Debug thread", amounts(0, 4, 4, 0, 0)),
      group("recap-reminder", "Recap reminder", amounts(0, 2, 2, 0, 0)),
    ],
    byModel: [
      group(
        "anthropic/claude-sonnet-5.5",
        "anthropic/claude-sonnet-5.5",
        share(totals, 0.52),
      ),
      group("openai/gpt-6.1-sol", "openai/gpt-6.1-sol", share(totals, 0.39, 3)),
      group(
        "google/gemini-3.1-flash-lite",
        "google/gemini-3.1-flash-lite",
        share(totals, 0.09),
      ),
      group(
        "codex/gpt-6.1-codex",
        "codex/gpt-6.1-codex",
        amounts(0, worker - 9, worker - 9, 0, 0),
      ),
      group("BB thread", "BB thread", amounts(0, 6, 6, 0, 0)),
    ],
    byPath: [
      group("gateway", "AI Gateway", share(totals, 0.78, 3)),
      group("presentation", "Enhanced response", share(totals, 0.22)),
      group(
        "worker",
        "Worker thread",
        amounts(0, worker - 9, worker - 9, 0, 0),
      ),
      group("thread", "Agent thread", amounts(0, 6, 6, 0, 0)),
    ],
    byThread: [
      group("thr_recaps", "thr_recaps", share(totals, 0.34, 2)),
      group("thr_ledger", "thr_ledger", share(totals, 0.21)),
      group("thr_vertex", "thr_vertex", share(totals, 0.17)),
      group("thr_archived", "Tidying the dotfiles repo", share(totals, 0.06)),
      group("thr_hidden", "thr_hidden", amounts(0, 11, 11, 0, 0)),
    ],
    retainedSince: NOW - 12 * 86_400_000,
    now: NOW,
    ...spendState(),
    flags: [],
    ...patch,
  };
}

/** A report from a ledger that holds no rows. */
export function emptyUsageReport(range: UsageRange = "24h"): UsageReport {
  const zero = amounts(0, 0, 0, 0, 0);
  return usageReport(range, {
    totals: zero,
    buckets: usageReport(range).buckets.map(({ start }) => ({
      start,
      ...zero,
    })),
    byWorkstream: [],
    bySource: [],
    byModel: [],
    byPath: [],
    byThread: [],
    retainedSince: null,
    ...spendState({
      hour: { cost: 0, calls: 0, unmetered: 0 },
      day: { cost: 0, calls: 0, unmetered: 0 },
      month: { cost: 0, calls: 0, unmetered: 0 },
    }),
  });
}
