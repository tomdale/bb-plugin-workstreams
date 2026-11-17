/**
 * Provider usage accounting: the shapes of the usage ledger, the limits a user
 * sets, and the report the Usage page reads. Pure, so the server that records
 * usage and the app that shows it share one definition.
 *
 * The ledger is separate from model traces. A trace explains one call and is
 * pruned or deleted with the debug record; the ledger keeps one small row for
 * every attempt that may have spent provider money, including failed and
 * aborted ones, so totals survive trace retention and recording being off.
 *
 * A row's cost is `null` when the provider reported none (a failed or aborted
 * request, a worker or thread call), never `0`: zero would claim the call was
 * free. Totals add up the costs that were reported and count the rest as
 * `unmetered`, and call-count limits exist because those calls carry no cost.
 */
import { z } from "zod";
import { TRACE_KINDS } from "./trace.ts";
import type { Prefs } from "./prefs.ts";

/**
 * What asked for the spend: a model call kind, a composed enhanced response, a
 * debug thread (a full agent thread, whose cost BB does not report to the
 * plugin), or a recap reminder (an extra turn in a user's own thread).
 */
export const USAGE_SOURCES = [
  ...TRACE_KINDS,
  "presentation",
  "debug-thread",
  "recap-reminder",
] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];

/**
 * How the request reached a provider: a direct AI Gateway completion, a hidden
 * BB worker thread, the enhanced-response composition loop on the analysis
 * machine, or a message that starts a turn in a BB thread.
 */
export const USAGE_PATHS = [
  "gateway",
  "worker",
  "presentation",
  "thread",
] as const;
export type UsagePath = (typeof USAGE_PATHS)[number];

/** `invalid`: the answer didn't parse. `aborted`: its answer stopped mattering. */
export const USAGE_STATUSES = ["ok", "invalid", "failed", "aborted"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

export const usageEntrySchema = z.object({
  id: z.string(),
  /** When the attempt started, in ms. */
  at: z.number(),
  source: z.enum(USAGE_SOURCES),
  path: z.enum(USAGE_PATHS),
  /** The model's label (`modelLabel`), as traces show it. */
  model: z.string(),
  threadId: z.string().nullable(),
  /** The model trace for the same call, while it is stored. */
  traceId: z.string().nullable(),
  status: z.enum(USAGE_STATUSES),
  /** Provider requests the row stands for; a composition makes several. */
  calls: z.number().int().min(1),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  /** USD the provider reported, or null when it reported none. */
  cost: z.number().nullable(),
  /** A short digest of the prompt, so identical requests can be counted. */
  promptHash: z.string().nullable(),
  promptChars: z.number().int().nullable(),
  durationMs: z.number(),
  /** A replay from the inspector, which spends like any other call. */
  replay: z.boolean(),
});
export type UsageEntry = z.infer<typeof usageEntrySchema>;
export type NewUsageEntry = Omit<UsageEntry, "id">;

/** Rows are kept this long, and never more than `USAGE_MAX_ROWS`. */
export const USAGE_RETAIN_MS = 90 * 24 * 60 * 60 * 1000;
export const USAGE_MAX_ROWS = 250_000;

// ---------------------------------------------------------------------------
// Windows and limits
// ---------------------------------------------------------------------------

/**
 * Limit windows: the last 60 minutes (rolling), since local midnight, and
 * since the first of the local month.
 */
export const USAGE_WINDOWS = ["hour", "day", "month"] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

const HOUR_MS = 3_600_000;

/** Where `window` starts at `now`. */
export function windowStart(window: UsageWindow, now: number): number {
  const at = new Date(now);
  switch (window) {
    case "hour":
      return now - HOUR_MS;
    case "day":
      return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    case "month":
      return new Date(at.getFullYear(), at.getMonth(), 1).getTime();
  }
}

/**
 * When a limit hit in `window` at `now` stops counting everything spent so
 * far: the next local midnight or month start. The rolling hour has no
 * boundary, so it is an hour from now, which is how long a resume lasts.
 */
export function windowResetsAt(window: UsageWindow, now: number): number {
  const at = new Date(now);
  switch (window) {
    case "hour":
      return now + HOUR_MS;
    case "day":
      return new Date(
        at.getFullYear(),
        at.getMonth(),
        at.getDate() + 1,
      ).getTime();
    case "month":
      return new Date(at.getFullYear(), at.getMonth() + 1, 1).getTime();
  }
}

/** One limit: what it measures and over which window. */
export const LIMIT_KEYS = [
  "hourSpend",
  "daySpend",
  "monthSpend",
  "hourCalls",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const LIMIT_WINDOW: Record<LimitKey, UsageWindow> = {
  hourSpend: "hour",
  daySpend: "day",
  monthSpend: "month",
  hourCalls: "hour",
};
export const LIMIT_METRIC: Record<LimitKey, "spend" | "calls"> = {
  hourSpend: "spend",
  daySpend: "spend",
  monthSpend: "spend",
  hourCalls: "calls",
};

/** A limit's thresholds; `null` turns that one off. */
export type LimitThresholds = { warn: number | null; cap: number | null };
export type UsageLimits = Record<LimitKey, LimitThresholds>;

/** The `usage` preference group, as the limits it sets. */
export function limitsOf(usage: Prefs["usage"]): UsageLimits {
  return {
    hourSpend: { warn: usage.hourSpendWarn, cap: usage.hourSpendCap },
    daySpend: { warn: usage.daySpendWarn, cap: usage.daySpendCap },
    monthSpend: { warn: usage.monthSpendWarn, cap: usage.monthSpendCap },
    hourCalls: { warn: usage.hourCallsWarn, cap: usage.hourCallsCap },
  };
}

/** What one window holds so far. */
export type WindowTotals = {
  /** Reported cost, USD. */
  cost: number;
  /** Provider requests (`calls` summed), whatever their status. */
  calls: number;
  /** Requests whose cost was not reported, so `cost` leaves them out. */
  unmetered: number;
};
export type UsageTotalsByWindow = Record<UsageWindow, WindowTotals>;

export const LIMIT_LEVELS = ["ok", "warning", "capped"] as const;
export type LimitLevel = (typeof LIMIT_LEVELS)[number];

export const limitStateSchema = z.object({
  key: z.enum(LIMIT_KEYS),
  window: z.enum(USAGE_WINDOWS),
  metric: z.enum(["spend", "calls"]),
  used: z.number(),
  warn: z.number().nullable(),
  cap: z.number().nullable(),
  level: z.enum(LIMIT_LEVELS),
  /** When the used amount drops back under the thresholds' window. */
  resetsAt: z.number(),
  /** While set and in the future, a resume lets calls through despite `cap`. */
  resumedUntil: z.number().nullable(),
});
export type LimitState = z.infer<typeof limitStateSchema>;

export const spendStateSchema = z.object({
  level: z.enum(LIMIT_LEVELS),
  /** Every limit with a threshold set, in `LIMIT_KEYS` order. */
  limits: z.array(limitStateSchema),
});
export type SpendState = z.infer<typeof spendStateSchema>;

/**
 * Each set limit's state. Reaching a threshold counts (`used >= cap`), so the
 * call that crosses a cap is the last one let through. A window listed in
 * `resumes` with a time after `now` lets calls through past its caps; its
 * warnings still show.
 */
export function evaluateLimits(
  limits: UsageLimits,
  totals: UsageTotalsByWindow,
  now: number,
  resumes: Partial<Record<UsageWindow, number>> = {},
): SpendState {
  const states: LimitState[] = [];
  for (const key of LIMIT_KEYS) {
    const { warn, cap } = limits[key];
    if (warn === null && cap === null) continue;
    const window = LIMIT_WINDOW[key];
    const metric = LIMIT_METRIC[key];
    const used =
      metric === "spend" ? totals[window].cost : totals[window].calls;
    const until = resumes[window];
    const resumedUntil = until !== undefined && until > now ? until : null;
    const overCap = cap !== null && used >= cap;
    const level: LimitLevel =
      overCap && resumedUntil === null
        ? "capped"
        : overCap || (warn !== null && used >= warn)
          ? "warning"
          : "ok";
    states.push({
      key,
      window,
      metric,
      used,
      warn,
      cap,
      level,
      resetsAt: windowResetsAt(window, now),
      resumedUntil: overCap ? resumedUntil : null,
    });
  }
  const level: LimitLevel = states.some((s) => s.level === "capped")
    ? "capped"
    : states.some((s) => s.level === "warning")
      ? "warning"
      : "ok";
  return { level, limits: states };
}

// ---------------------------------------------------------------------------
// Flags: what looks wrong in the recent ledger
// ---------------------------------------------------------------------------

export const USAGE_FLAG_KINDS = [
  "spend-spike",
  "thread-burst",
  "repeated-prompt",
  "cost-unreported",
  "unmetered-calls",
  "oversize-input",
  "failure-run",
] as const;
export type UsageFlagKind = (typeof USAGE_FLAG_KINDS)[number];

export const usageFlagSchema = z.object({
  /** Stable for the same finding, so a view can keep a dismissal or a place. */
  id: z.string(),
  kind: z.enum(USAGE_FLAG_KINDS),
  severity: z.enum(["warning", "critical"]),
  /** One line naming what looks wrong. */
  title: z.string(),
  /** The evidence: counts, amounts, and the window they cover. */
  detail: z.string(),
  /** The newest row behind it, in ms. */
  at: z.number(),
  /** The oldest row behind it, in ms. */
  since: z.number(),
  threadId: z.string().nullable(),
  source: z.enum(USAGE_SOURCES).nullable(),
  /** Provider requests behind it. */
  calls: z.number(),
  /** Reported cost behind it, null when none of its rows reported one. */
  cost: z.number().nullable(),
});
export type UsageFlag = z.infer<typeof usageFlagSchema>;

// ---------------------------------------------------------------------------
// The report the Usage page reads
// ---------------------------------------------------------------------------

/** Ranges the Usage page offers, each ending now, with its bucket width. */
export const USAGE_RANGES = ["1h", "24h", "7d", "30d", "90d"] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

const MINUTE_MS = 60_000;
const DAY_MS = 24 * HOUR_MS;

const RANGE_SPAN: Record<UsageRange, { spanMs: number; bucketMs: number }> = {
  "1h": { spanMs: HOUR_MS, bucketMs: 5 * MINUTE_MS },
  "24h": { spanMs: DAY_MS, bucketMs: HOUR_MS },
  "7d": { spanMs: 7 * DAY_MS, bucketMs: 6 * HOUR_MS },
  "30d": { spanMs: 30 * DAY_MS, bucketMs: DAY_MS },
  "90d": { spanMs: 90 * DAY_MS, bucketMs: DAY_MS },
};

/**
 * The start of the bucket holding `at`. Buckets align to local time, so day
 * buckets begin at local midnight.
 */
export function bucketStart(at: number, bucketMs: number): number {
  const offset = new Date(at).getTimezoneOffset() * MINUTE_MS;
  return Math.floor((at - offset) / bucketMs) * bucketMs + offset;
}

/** The span a range covers at `now`: its first bucket's start, and the bucket width. */
export function rangeBounds(
  range: UsageRange,
  now: number,
): { from: number; to: number; bucketMs: number } {
  const { spanMs, bucketMs } = RANGE_SPAN[range];
  return { from: bucketStart(now - spanMs, bucketMs), to: now, bucketMs };
}

const amountsShape = {
  cost: z.number(),
  calls: z.number(),
  unmetered: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  /** Requests whose status was `failed`, `aborted`, or `invalid`. */
  failed: z.number(),
};

export const usageTotalsSchema = z.object(amountsShape);
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

export const usageBucketSchema = usageTotalsSchema.extend({
  /** The bucket's start, in ms. */
  start: z.number(),
});
export type UsageBucket = z.infer<typeof usageBucketSchema>;

export const usageGroupSchema = usageTotalsSchema.extend({
  /** A source, model, path, thread id, or workstream id. */
  key: z.string(),
  /** A name for it: the key itself unless the server knows a better one. */
  label: z.string(),
});
export type UsageGroup = z.infer<typeof usageGroupSchema>;

export const usageSummarySchema = z.object({
  range: z.enum(USAGE_RANGES),
  from: z.number(),
  to: z.number(),
  bucketMs: z.number(),
  totals: usageTotalsSchema,
  /** Every bucket in the range, empty ones included, oldest first. */
  buckets: z.array(usageBucketSchema),
  /** Each grouping's groups, largest cost first (calls break ties). */
  bySource: z.array(usageGroupSchema),
  byModel: z.array(usageGroupSchema),
  byPath: z.array(usageGroupSchema),
  /** The threads that spent most, at most 25. */
  byThread: z.array(usageGroupSchema),
  /** By the workstream each thread belongs to now; `none` holds the rest. */
  byWorkstream: z.array(usageGroupSchema),
  /** The oldest row the ledger still holds, or null while it is empty. */
  retainedSince: z.number().nullable(),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

const windowTotalsSchema = z.object({
  cost: z.number(),
  calls: z.number(),
  unmetered: z.number(),
});

export const usageReportSchema = usageSummarySchema.extend({
  now: z.number(),
  /** The current windows' totals, whatever the range. */
  windows: z.object({
    hour: windowTotalsSchema,
    day: windowTotalsSchema,
    month: windowTotalsSchema,
  }),
  state: spendStateSchema,
  flags: z.array(usageFlagSchema),
});
export type UsageReport = z.infer<typeof usageReportSchema>;

/** What the Page menu needs to mark a warning or a pause. */
export const usageIndicatorSchema = z.object({
  level: z.enum(LIMIT_LEVELS),
  flags: z.number(),
});
export type UsageIndicator = z.infer<typeof usageIndicatorSchema>;
