/**
 * What looks wrong in recent usage: spikes, loops, and spend nobody can see.
 * Pure, over ledger rows, so the same findings come from the server, a test,
 * and a fixture.
 *
 * Nothing is stored. A flag exists while the rows behind it are inside its
 * detector's window and clears when they age out, and its id names the
 * finding's subject (a thread, a source, a prompt), never a time, so the same
 * ongoing finding keeps one id from one reading to the next.
 */
import {
  USAGE_SOURCE_TITLE,
  type UsageEntry,
  type UsageFlag,
  type UsageSource,
} from "./usage.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Every number the detectors compare against; `docs/usage.md` gives the reason
 * for each. A count or amount equal to its threshold raises the flag, except
 * `oversizeInput.multiple`, which a row has to exceed.
 */
export const USAGE_FLAG_THRESHOLDS = {
  /**
   * How far back the detectors look for evidence. A burst, a loop, or a run
   * of failures inside this span stays flagged until it is this old, so one
   * that happened overnight is still there in the morning.
   */
  lookbackMs: DAY_MS,
  spendSpike: {
    /** The windows compared, each ending now. */
    windowsMs: { hour: HOUR_MS, day: DAY_MS },
    /** Hours before the window whose median hourly spend is the baseline. */
    baselineHours: 7 * 24,
    /** With less history than this before the window there is no baseline. */
    minBaselineHours: 24,
    /** USD per hour the baseline never drops below. */
    baselineFloor: 0.25,
    /**
     * `hourMinCost` is the USD the last hour has to reach whatever the
     * multiple, so a busy hour over a quiet baseline does not flag. The
     * 24-hour window needs none: the floor alone puts its multiples at $24
     * and $60.
     */
    warning: { multiple: 4, hourMinCost: 3 },
    critical: { multiple: 10, hourMinCost: 10 },
    /** USD per hour of the window, used while there is no baseline. */
    noBaseline: { warning: 5, critical: 15 },
  },
  threadBurst: { windowMs: HOUR_MS, warning: 40, critical: 100 },
  repeatedPrompt: { windowMs: 10 * MINUTE_MS, warning: 6, critical: 15 },
  costUnreported: { warning: 3 },
  unmeteredCalls: {
    warning: { minCalls: 25, minShare: 0.4 },
    critical: { minCalls: 100, minShare: 0.7 },
  },
  oversizeInput: {
    /** The span whose rows give a source's median input size. */
    medianMs: 7 * DAY_MS,
    /** A source with fewer rows than this has no median to compare against. */
    minRows: 10,
    multiple: 4,
    warning: 50_000,
    critical: 150_000,
  },
  failureRun: {
    windowMs: 30 * MINUTE_MS,
    /** The share of the source's attempts in the window that went wrong. */
    minShare: 0.8,
    warning: 8,
    critical: 25,
  },
} as const;

/**
 * Flags for `entries` (rows from at least the last 8 days, oldest first) at
 * `now`. Newest evidence first within a severity, critical before warning.
 *
 * A replay is spending the user chose, so replays count toward `spend-spike`
 * and no other detector.
 */
export function detectUsageFlags(
  entries: readonly UsageEntry[],
  now: number,
): UsageFlag[] {
  const rows = entries
    .filter((entry) => entry.at <= now)
    .sort((a, b) => a.at - b.at);
  const own = rows.filter((entry) => !entry.replay);
  const recent = own.filter(
    (entry) => entry.at >= now - USAGE_FLAG_THRESHOLDS.lookbackMs,
  );
  const flags = [
    ...spendSpikes(rows, now),
    ...threadBursts(recent, now),
    ...repeatedPrompts(recent, now),
    ...costUnreported(recent, now),
    ...unmeteredCalls(recent, now),
    ...oversizeInputs(own, now),
    ...failureRuns(recent, now),
  ];
  return flags.sort(
    (a, b) =>
      Number(b.severity === "critical") - Number(a.severity === "critical") ||
      b.at - a.at ||
      a.id.localeCompare(b.id),
  );
}

type Severity = UsageFlag["severity"];

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

function spendSpikes(rows: readonly UsageEntry[], now: number): UsageFlag[] {
  const t = USAGE_FLAG_THRESHOLDS.spendSpike;
  const oldest = rows[0]?.at;
  if (oldest === undefined) return [];
  const flags: UsageFlag[] = [];
  for (const window of ["hour", "day"] as const) {
    const spanMs = t.windowsMs[window];
    const hours = spanMs / HOUR_MS;
    const start = now - spanMs;
    const spent = rows.filter(
      (entry) => entry.at >= start && entry.cost !== null,
    );
    const cost = reportedCost(spent);
    if (cost === null) continue;
    const span = window === "hour" ? "the last hour" : "the last 24 hours";
    const amount = `${money(cost)} reported in ${span} across ${requests(totalCalls(spent))}`;

    const baselineHours = Math.min(
      t.baselineHours,
      Math.floor((start - oldest) / HOUR_MS),
    );
    let severity: Severity | null;
    let title: string;
    let detail: string;
    if (baselineHours < t.minBaselineHours) {
      severity =
        cost >= t.noBaseline.critical * hours
          ? "critical"
          : cost >= t.noBaseline.warning * hours
            ? "warning"
            : null;
      title = `Spend in ${span} reached ${money(cost)}`;
      detail = `${amount}. There is under a day of earlier usage to compare with, so this is flagged from ${money(t.noBaseline.warning)} an hour.`;
    } else {
      const hourly = new Array<number>(baselineHours).fill(0);
      for (const entry of rows) {
        if (entry.at >= start) break;
        const index = Math.floor((start - 1 - entry.at) / HOUR_MS);
        if (index < baselineHours && entry.cost !== null)
          hourly[index] = hourly[index]! + entry.cost;
      }
      const usual = round(median(hourly));
      const baseline = round(Math.max(usual, t.baselineFloor) * hours);
      const reaches = (level: { multiple: number; hourMinCost: number }) =>
        cost >= level.multiple * baseline &&
        (window !== "hour" || cost >= level.hourMinCost);
      severity = reaches(t.critical)
        ? "critical"
        : reaches(t.warning)
          ? "warning"
          : null;
      const history = duration(baselineHours * HOUR_MS);
      if (usual >= t.baselineFloor) {
        title = `Spend in ${span} is ${Math.round((cost / baseline) * 10) / 10}× the usual`;
        detail = `${amount}, against a usual ${money(usual)} an hour over the ${history} before.`;
      } else {
        title = `Spend in ${span} reached ${money(cost)}`;
        detail = `${amount}. The median hour over the ${history} before spent ${money(usual)}; a spike is measured against at least ${money(t.baselineFloor)} an hour.`;
      }
    }
    if (!severity) continue;
    flags.push({
      id: `spend-spike:${window}`,
      kind: "spend-spike",
      severity,
      title,
      detail,
      ...evidence(spent),
      threadId: null,
      source: null,
    });
  }
  return flags;
}

function threadBursts(recent: readonly UsageEntry[], now: number): UsageFlag[] {
  const t = USAGE_FLAG_THRESHOLDS.threadBurst;
  const flags: UsageFlag[] = [];
  for (const [threadId, rows] of groupBy(recent, (entry) => entry.threadId)) {
    const run = busiestRun(rows, t.windowMs, (entry) => entry.calls);
    const severity = severityAt(run?.weight ?? 0, t);
    if (!run || !severity) continue;
    const seen = evidence(run.rows);
    flags.push({
      id: `thread-burst:${threadId}`,
      kind: "thread-burst",
      severity,
      title: `One thread made ${requests(run.weight)} in an hour`,
      detail: `Thread ${threadId}, ${requests(run.weight)} ${between(run.rows, now)}, ${reportedText(seen.cost)}.`,
      ...seen,
    });
  }
  return flags;
}

function repeatedPrompts(
  recent: readonly UsageEntry[],
  now: number,
): UsageFlag[] {
  const t = USAGE_FLAG_THRESHOLDS.repeatedPrompt;
  const flags: UsageFlag[] = [];
  for (const [hash, rows] of groupBy(recent, (entry) => entry.promptHash)) {
    const run = busiestRun(rows, t.windowMs, () => 1);
    const severity = severityAt(run?.weight ?? 0, t);
    if (!run || !severity) continue;
    const seen = evidence(run.rows);
    const what = seen.source ? `${sourceName(seen.source)} calls` : "Calls";
    const where = seen.threadId ? ` for thread ${seen.threadId}` : "";
    flags.push({
      id: `repeated-prompt:${hash}`,
      kind: "repeated-prompt",
      severity,
      title: `The same prompt was sent ${count(run.weight)} times in 10 minutes`,
      detail: `${what}${where} sent an identical prompt ${count(run.weight)} times ${between(run.rows, now)}, ${reportedText(seen.cost)}.`,
      ...seen,
    });
  }
  return flags;
}

function costUnreported(
  recent: readonly UsageEntry[],
  now: number,
): UsageFlag[] {
  const rows = recent.filter(
    (entry) =>
      entry.path === "gateway" &&
      (entry.status === "ok" || entry.status === "invalid") &&
      entry.cost === null &&
      tokens(entry) > 0,
  );
  if (rows.length < USAGE_FLAG_THRESHOLDS.costUnreported.warning) return [];
  const models = [...new Set(rows.map((entry) => entry.model))];
  return [
    {
      id: "cost-unreported",
      kind: "cost-unreported",
      severity: "warning",
      title: `${count(rows.length)} gateway calls used tokens but reported no cost`,
      detail: `${count(rows.length)} answered calls ${between(rows, now)} used ${count(sum(rows, tokens))} tokens on ${models.slice(0, 3).join(", ")}${models.length > 3 ? ` and ${count(models.length - 3)} more` : ""} and came back with no cost, so every total is low.`,
      ...evidence(rows),
    },
  ];
}

function unmeteredCalls(
  recent: readonly UsageEntry[],
  now: number,
): UsageFlag[] {
  const t = USAGE_FLAG_THRESHOLDS.unmeteredCalls;
  const total = totalCalls(recent);
  const rows = recent.filter((entry) => entry.cost === null);
  const unmetered = totalCalls(rows);
  if (total === 0) return [];
  const share = unmetered / total;
  const reaches = (level: { minCalls: number; minShare: number }) =>
    total >= level.minCalls && share >= level.minShare;
  const severity: Severity | null = reaches(t.critical)
    ? "critical"
    : reaches(t.warning)
      ? "warning"
      : null;
  if (!severity) return [];
  // Each request is counted under the first reason that applies to its row.
  const reasonOf = (entry: UsageEntry) =>
    entry.path === "worker"
      ? "ran in worker threads"
      : entry.path === "thread"
        ? "ran as agent threads"
        : entry.status === "failed" || entry.status === "aborted"
          ? "failed or were aborted"
          : "came back with no cost";
  const reasons = [...groupBy(rows, reasonOf)].map(
    ([reason, group]) => `${count(totalCalls(group))} ${reason}`,
  );
  return [
    {
      id: "unmetered-calls",
      kind: "unmetered-calls",
      severity,
      title: `${Math.round(share * 100)}% of requests in the last 24 hours reported no cost`,
      detail: `${count(unmetered)} of ${requests(total)} have no known cost: ${reasons.join(", ")}. Totals leave these out; the requests-per-hour limit covers them.`,
      ...evidence(rows),
    },
  ];
}

function oversizeInputs(own: readonly UsageEntry[], now: number): UsageFlag[] {
  const t = USAGE_FLAG_THRESHOLDS.oversizeInput;
  const sized = own.filter(
    (entry) => entry.at >= now - t.medianMs && entry.inputTokens !== null,
  );
  const flags: UsageFlag[] = [];
  for (const [source, rows] of groupBy(sized, (entry) => entry.source)) {
    if (rows.length < t.minRows) continue;
    const usual = median(rows.map((entry) => entry.inputTokens!));
    const oversize = rows.filter(
      (entry) =>
        entry.at >= now - USAGE_FLAG_THRESHOLDS.lookbackMs &&
        entry.inputTokens! >= t.warning &&
        entry.inputTokens! > t.multiple * usual,
    );
    // The newest of the largest rows, so the flag points at one call.
    const largest = oversize.reduce<UsageEntry | null>(
      (best, entry) =>
        !best || entry.inputTokens! >= best.inputTokens! ? entry : best,
      null,
    );
    if (!largest) continue;
    const size = largest.inputTokens!;
    const others = oversize.length - 1;
    flags.push({
      id: `oversize-input:${source}`,
      kind: "oversize-input",
      severity: size >= t.critical ? "critical" : "warning",
      title: `One ${sourceName(source)} call sent ${count(size)} input tokens`,
      detail: `${count(size)} input tokens at ${clock(largest.at, now)} on ${largest.model}${largest.threadId ? ` for thread ${largest.threadId}` : ""}, against a median of ${count(Math.round(usual))} for ${sourceName(source)} calls over the last 7 days${others > 0 ? `. ${count(others)} more ${others === 1 ? "call was" : "calls were"} oversize in the last 24 hours` : ""}.`,
      ...evidence(oversize),
      threadId: largest.threadId,
    });
  }
  return flags;
}

function failureRuns(recent: readonly UsageEntry[], now: number): UsageFlag[] {
  const t = USAGE_FLAG_THRESHOLDS.failureRun;
  const flags: UsageFlag[] = [];
  // An aborted row is neither a failure nor an attempt that worked: the
  // caller stopped waiting (the server aborts a composer preview whenever
  // the draft changes), which says nothing about the provider.
  const counted = recent.filter((entry) => entry.status !== "aborted");
  for (const [source, rows] of groupBy(counted, (entry) => entry.source)) {
    const attempts = worstRun(rows, t.windowMs, t.minShare);
    const bad = attempts.filter(wentWrong);
    const severity = severityAt(bad.length, t);
    if (!severity) continue;
    const kinds = (
      [
        ["failed", "failed"],
        ["invalid", "unusable"],
      ] as const
    )
      .map(([status, word]) => {
        const n = bad.filter((entry) => entry.status === status).length;
        return n ? `${count(n)} ${word}` : null;
      })
      .filter((part) => part !== null);
    const seen = evidence(bad);
    flags.push({
      id: `failure-run:${source}`,
      kind: "failure-run",
      severity,
      title: `${sourceName(source)} calls failed ${count(bad.length)} times in 30 minutes`,
      detail: `${count(bad.length)} of ${count(attempts.length)} attempts ${between(bad, now)} did not succeed (${kinds.join(", ")}), ${reportedText(seen.cost)}. A failed request can still be billed.`,
      ...seen,
    });
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const wentWrong = (entry: UsageEntry) => entry.status !== "ok";

const tokens = (entry: UsageEntry) =>
  (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);

const sum = <T>(rows: readonly T[], of: (row: T) => number) =>
  rows.reduce((total, row) => total + of(row), 0);

const totalCalls = (rows: readonly UsageEntry[]) =>
  sum(rows, (entry) => entry.calls);

/** Sums in whole millionths of a dollar, so a threshold compares exactly. */
const round = (usd: number) => Math.round(usd * 1e6) / 1e6;

/** The reported cost of `rows`, or null when none of them reported one. */
function reportedCost(rows: readonly UsageEntry[]): number | null {
  const reported = rows.filter((entry) => entry.cost !== null);
  return reported.length ? round(sum(reported, (entry) => entry.cost!)) : null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Rows by a key, each group oldest first; rows with a null key are left out. */
function groupBy<K extends string>(
  rows: readonly UsageEntry[],
  key: (entry: UsageEntry) => K | null,
): Map<K, UsageEntry[]> {
  const groups = new Map<K, UsageEntry[]>();
  for (const entry of rows) {
    const k = key(entry);
    if (k === null) continue;
    const group = groups.get(k);
    if (group) group.push(entry);
    else groups.set(k, [entry]);
  }
  return groups;
}

/**
 * The stretch of `rows` (one source, oldest first), no longer than `spanMs`,
 * that holds the most rows that went wrong while they are at least `minShare`
 * of it; the latest one on a tie, and empty when no row went wrong. It starts
 * and ends on a row that went wrong, so attempts that worked before or after
 * it are outside it and do not lower its share.
 */
function worstRun(
  rows: readonly UsageEntry[],
  spanMs: number,
  minShare: number,
): UsageEntry[] {
  // A bad row scores what a good row costs, in whole percent so sums are
  // exact: a stretch keeps the share exactly when the score before its first
  // row is no higher than the score after its last.
  const percent = Math.round(minShare * 100);
  const score = [0];
  const badBefore = [0];
  for (const [i, row] of rows.entries()) {
    const bad = wentWrong(row);
    score.push(score[i]! + (bad ? 100 - percent : -percent));
    badBefore.push(badBefore[i]! + (bad ? 1 : 0));
  }
  const nextBad = new Array<number>(rows.length + 1).fill(rows.length);
  for (let i = rows.length - 1; i >= 0; i--)
    nextBad[i] = wentWrong(rows[i]!) ? i : nextBad[i + 1]!;
  const firstAtMost = firstIndexAtMost(score);

  let best: { from: number; to: number; bad: number } | null = null;
  let earliest = 0;
  for (let to = 0; to < rows.length; to++) {
    if (!wentWrong(rows[to]!)) continue;
    while (rows[to]!.at - rows[earliest]!.at > spanMs) earliest += 1;
    // The earliest start that keeps the share holds the most bad rows, and
    // `to` alone always keeps it.
    const from = nextBad[firstAtMost(earliest, to, score[to + 1]!)]!;
    const bad = badBefore[to + 1]! - badBefore[from]!;
    if (!best || bad >= best.bad) best = { from, to, bad };
  }
  return best ? rows.slice(best.from, best.to + 1) : [];
}

/**
 * A lookup over `values`: the first index from `from` to `to` whose value is
 * at most `limit`, or -1. A tree of range minimums answers in logarithmic
 * time, which keeps `worstRun` near linear when a storm fills the ledger.
 */
function firstIndexAtMost(
  values: readonly number[],
): (from: number, to: number, limit: number) => number {
  const last = values.length - 1;
  const mins = new Array<number>(4 * values.length).fill(Infinity);
  const build = (node: number, lo: number, hi: number): number => {
    if (lo === hi) return (mins[node] = values[lo]!);
    const mid = (lo + hi) >> 1;
    return (mins[node] = Math.min(
      build(2 * node, lo, mid),
      build(2 * node + 1, mid + 1, hi),
    ));
  };
  build(1, 0, last);
  const find = (
    node: number,
    lo: number,
    hi: number,
    from: number,
    to: number,
    limit: number,
  ): number => {
    if (hi < from || lo > to || mins[node]! > limit) return -1;
    if (lo === hi) return lo;
    const mid = (lo + hi) >> 1;
    const left = find(2 * node, lo, mid, from, to, limit);
    return left !== -1
      ? left
      : find(2 * node + 1, mid + 1, hi, from, to, limit);
  };
  return (from, to, limit) => find(1, 0, last, from, to, limit);
}

/**
 * The heaviest stretch of `rows` (oldest first) no longer than `spanMs` from
 * its first row to its last; the latest one on a tie.
 */
function busiestRun(
  rows: readonly UsageEntry[],
  spanMs: number,
  weight: (entry: UsageEntry) => number,
): { rows: UsageEntry[]; weight: number } | null {
  let best: { from: number; to: number; weight: number } | null = null;
  let from = 0;
  let running = 0;
  for (let to = 0; to < rows.length; to++) {
    running += weight(rows[to]!);
    while (rows[to]!.at - rows[from]!.at > spanMs) {
      running -= weight(rows[from]!);
      from += 1;
    }
    if (!best || running >= best.weight) best = { from, to, weight: running };
  }
  return best
    ? { rows: rows.slice(best.from, best.to + 1), weight: best.weight }
    : null;
}

function severityAt(
  value: number,
  levels: { warning: number; critical: number },
): Severity | null {
  return value >= levels.critical
    ? "critical"
    : value >= levels.warning
      ? "warning"
      : null;
}

/** The flag fields that come straight from the rows behind it, oldest first. */
function evidence(
  rows: readonly UsageEntry[],
): Pick<UsageFlag, "at" | "since" | "threadId" | "source" | "calls" | "cost"> {
  const shared = <T>(of: (entry: UsageEntry) => T | null): T | null => {
    const first = rows[0] ? of(rows[0]) : null;
    return rows.every((entry) => of(entry) === first) ? first : null;
  };
  return {
    at: rows.at(-1)!.at,
    since: rows[0]!.at,
    threadId: shared((entry) => entry.threadId),
    source: shared((entry) => entry.source),
    calls: totalCalls(rows),
    cost: reportedCost(rows),
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const sourceName = (source: UsageSource) => USAGE_SOURCE_TITLE[source];

const COUNT = new Intl.NumberFormat("en-US");
const count = (n: number) => COUNT.format(n);
const requests = (n: number) =>
  `${count(n)} ${n === 1 ? "request" : "requests"}`;

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** `$12.34`; under a cent keeps four decimals so it doesn't read as zero. */
const money = (usd: number) =>
  usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : USD.format(usd);

const reportedText = (cost: number | null) =>
  cost === null ? "no cost reported" : `${money(cost)} reported`;

const duration = (ms: number) =>
  ms >= 2 * DAY_MS
    ? `${Math.floor(ms / DAY_MS)} days`
    : `${Math.floor(ms / HOUR_MS)} hours`;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `10:14` in local time, with the date (`May 3 10:14`) on another day than `now`. */
function clock(at: number, now: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date(now).toDateString()
    ? time
    : `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`;
}

/** `between 10:14 and 11:09`, or `at 10:14` for rows in one minute. */
function between(rows: readonly UsageEntry[], now: number): string {
  const [first, last] = [clock(rows[0]!.at, now), clock(rows.at(-1)!.at, now)];
  return first === last ? `at ${first}` : `between ${first} and ${last}`;
}
