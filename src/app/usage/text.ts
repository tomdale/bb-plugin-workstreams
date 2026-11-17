/**
 * The Usage page's words: the names of ranges and limits, and the sentences
 * a report's numbers are read in.
 *
 * Every sentence about cost says "reported". A request whose provider
 * reported no cost is counted beside the amount, in words, so no figure on
 * the page reads as everything Workstreams spent.
 */
import {
  LIMIT_SUBJECT,
  type LimitKey,
  type LimitState,
  type SpendState,
  type UsageBucket,
  type UsageRange,
  type UsageTotals,
  type UsageWindow,
} from "../../domain/usage.ts";
import { formatCount, formatMoney, formatTokens } from "./format.ts";

export const RANGE_LABEL: Record<UsageRange, string> = {
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

/** A limit's name beside its bar. */
export const LIMIT_LABEL: Record<LimitKey, string> = {
  hourSpend: "Last hour",
  daySpend: "Today",
  monthSpend: "This month",
  hourCalls: "Requests in the last hour",
};

/** `LIMIT_SUBJECT`, capitalized to begin a sentence. */
function subject(key: LimitKey): string {
  const text = LIMIT_SUBJECT[key];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "the $30.00 limit", "the limit of 500": a threshold, as the spend guard names it. */
function threshold(limit: LimitState, amount: number, name: string): string {
  return limit.metric === "spend"
    ? `the ${formatMoney(amount)} ${name}`
    : `the ${name} of ${formatCount(amount)}`;
}

/** `1 request`, `1,204 requests`. */
export function requests(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "request" : "requests"}`;
}

/** A limit's amount: dollars for a spend limit, a count for a request limit. */
export function formatAmount(
  metric: LimitState["metric"],
  amount: number,
): string {
  return metric === "spend" ? formatMoney(amount) : formatCount(amount);
}

const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const HOUR = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
const WEEKDAY_HOUR = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
});
const MONTH_DAY = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const WEEKDAY_DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const DAY_CLOCK = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * When a resume ends, as the end of "until …". A resume's end is stored when
 * it is given, so the rolling hour's is a fixed clock time.
 */
function windowEnd(window: UsageWindow, at: number): string {
  if (window === "hour") return CLOCK.format(at);
  return window === "day" ? "midnight" : MONTH_DAY.format(at);
}

/**
 * When calls resume by themselves: "within the hour", "at midnight", "on Aug
 * 1". The rolling hour has no boundary: spend leaves it continuously, and its
 * `resetsAt` is an hour after every reading, so it names no clock time.
 */
function resumesWhen(window: UsageWindow, at: number): string {
  return window === "hour"
    ? "within the hour"
    : window === "day"
      ? "at midnight"
      : `on ${MONTH_DAY.format(at)}`;
}

const reached = (limit: LimitState, amount: number, name: string) =>
  `${subject(limit.key)} reached ${threshold(limit, amount, name)}.`;

/**
 * Why model calls are paused and when the pause ends without a resume: one
 * sentence per reached cap, and the time the last of them resets.
 */
export function pausedText(
  state: SpendState,
): { reasons: string[]; ends: string } | null {
  const capped = state.limits.filter((limit) => limit.level === "capped");
  if (!capped.length) return null;
  const last = capped.reduce((a, b) => (b.resetsAt > a.resetsAt ? b : a));
  return {
    reasons: capped.map((limit) => reached(limit, limit.cap!, "limit")),
    ends: `Calls resume ${resumesWhen(last.window, last.resetsAt)}.`,
  };
}

/**
 * The one line for a state that warns without pausing: a resumed cap first,
 * then the warning reached, or how many when there are several.
 */
export function warningText(state: SpendState): string | null {
  const warned = state.limits.filter((limit) => limit.level === "warning");
  if (!warned.length) return null;
  const resumed = warned.find((limit) => limit.resumedUntil !== null);
  if (resumed)
    return `${subject(resumed.key)} is past ${threshold(resumed, resumed.cap!, "limit")}. Calls are resumed until ${windowEnd(resumed.window, resumed.resumedUntil!)}.`;
  if (warned.length > 1)
    return `${warned.length} limits have reached their warning.`;
  const [limit] = warned as [LimitState];
  // A limit with a cap and no warning is `warning` only once resumed, so a
  // warning threshold is set here.
  const sentence = reached(limit, limit.warn!, "warning");
  return limit.cap === null
    ? sentence
    : `${sentence} Calls pause at ${formatAmount(limit.metric, limit.cap)}.`;
}

/** Where a limit stands, for the line under its bar. */
export function limitText(limit: LimitState): string {
  const amount = (value: number) => formatAmount(limit.metric, value);
  if (limit.level === "capped")
    return `Reached ${threshold(limit, limit.cap!, "limit")}, calls are paused`;
  if (limit.resumedUntil !== null)
    return `Past ${threshold(limit, limit.cap!, "limit")}, resumed until ${windowEnd(limit.window, limit.resumedUntil)}`;
  if (limit.level === "warning")
    return limit.cap === null
      ? `Past ${threshold(limit, limit.warn!, "warning")}`
      : `Past ${threshold(limit, limit.warn!, "warning")}, pauses at ${amount(limit.cap)}`;
  if (limit.warn !== null && limit.cap !== null)
    return `Warns at ${amount(limit.warn)}, pauses at ${amount(limit.cap)}`;
  return limit.cap !== null
    ? `Pauses at ${amount(limit.cap)}`
    : `Warns at ${amount(limit.warn!)}`;
}

/** The span a bucket covers: "2:05 PM to 2:10 PM", "Thu 2 PM to 3 PM", "Thu, Jul 3". */
export function bucketWhen(start: number, bucketMs: number): string {
  if (bucketMs >= DAY_MS) return WEEKDAY_DAY.format(start);
  const end = start + bucketMs;
  return bucketMs < HOUR_MS
    ? `${CLOCK.format(start)} to ${CLOCK.format(end)}`
    : `${WEEKDAY_HOUR.format(start)} to ${HOUR.format(end)}`;
}

/**
 * What a set of requests cost, one fact per line: the reported amount, then
 * the request count with the requests that reported no cost named beside it.
 */
export function spendLines(
  amounts: Pick<UsageTotals, "cost" | "calls" | "unmetered">,
): string[] {
  const { cost, calls, unmetered } = amounts;
  if (calls === 0) return ["No requests"];
  if (unmetered >= calls) return ["No cost reported", requests(calls)];
  return [
    `${formatMoney(cost)} reported`,
    unmetered > 0
      ? `${requests(calls)}, ${formatCount(unmetered)} with no cost reported`
      : requests(calls),
  ];
}

/**
 * What a limit's window has used, beside its name. A spend window with
 * nothing reported whose requests all reported no cost says so: $0.00 would
 * claim they were free.
 */
export function usedText(
  metric: LimitState["metric"],
  used: number,
  totals: Pick<UsageTotals, "calls" | "unmetered">,
): string {
  return metric === "spend" &&
    used === 0 &&
    totals.calls > 0 &&
    totals.unmetered >= totals.calls
    ? "No cost reported"
    : formatAmount(metric, used);
}

/** A bucket's time and spend in one line: the chart's accessible text. */
export function bucketText(bucket: UsageBucket, bucketMs: number): string {
  return `${bucketWhen(bucket.start, bucketMs)}: ${spendLines(bucket).join(", ")}`;
}

/**
 * The note beside a group's name when its cost leaves requests out: all of
 * them, or how many.
 */
export function unmeteredNote(
  amounts: Pick<UsageTotals, "calls" | "unmetered">,
): string | null {
  const { calls, unmetered } = amounts;
  if (unmetered <= 0) return null;
  if (unmetered >= calls) return "No cost reported";
  return `${formatCount(unmetered)} of ${requests(calls)} reported no cost`;
}

/** The totals of a range, as the sentences under the chart. */
export function totalsText(totals: UsageTotals): {
  /** The reported amount, or null when no request reported one. */
  cost: string | null;
  /** What follows the amount, or the whole sentence when there is none. */
  sentence: string;
  unmetered: string | null;
  tokens: string | null;
} {
  const { cost, calls, unmetered, inputTokens, outputTokens } = totals;
  const metered = calls - unmetered;
  const tokens =
    inputTokens > 0 || outputTokens > 0
      ? `${formatTokens(inputTokens)} tokens in, ${formatTokens(outputTokens)} tokens out.`
      : null;
  if (metered <= 0)
    return {
      cost: null,
      sentence: `No cost reported for ${requests(calls)}.`,
      unmetered: null,
      tokens,
    };
  return {
    cost: formatMoney(cost),
    sentence: `reported for ${requests(metered)}.`,
    unmetered:
      unmetered > 0
        ? `${formatCount(unmetered)} more ${unmetered === 1 ? "request" : "requests"} reported no cost.`
        : null,
    tokens,
  };
}

/** A time on the page: the clock today, the day and clock before that. */
export function formatAt(at: number, now: number): string {
  return new Date(at).toDateString() === new Date(now).toDateString()
    ? CLOCK.format(at)
    : DAY_CLOCK.format(at);
}

/** The chart's first tick: the clock for a short range, the day for a long one. */
export function axisStart(from: number, bucketMs: number): string {
  if (bucketMs >= DAY_MS) return MONTH_DAY.format(from);
  return bucketMs < HOUR_MS ? CLOCK.format(from) : WEEKDAY_HOUR.format(from);
}

/** When the ledger's oldest row dates from, for a range that starts earlier. */
export function retainedText(retainedSince: number, bucketMs: number): string {
  const since =
    bucketMs >= DAY_MS
      ? MONTH_DAY.format(retainedSince)
      : DAY_CLOCK.format(retainedSince);
  return `The oldest recorded call is from ${since}.`;
}
