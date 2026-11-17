/**
 * The usage ledger: one `ws_usage` row for every attempt that may have spent
 * provider money (see `domain/usage.ts`). It is the one place totals, limits,
 * and flags read from, and it is separate from model traces so that trace
 * retention, **Delete model traces…**, and turning the debug record off never
 * change what Workstreams knows it spent.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  THREAD_USAGE_MODEL,
  USAGE_MAX_ROWS,
  USAGE_PATH_TITLE,
  USAGE_RETAIN_MS,
  USAGE_SOURCE_TITLE,
  USAGE_WINDOWS,
  bucketStart,
  rangeBounds,
  windowStart,
  type NewUsageEntry,
  type UsageBucket,
  type UsageEntry,
  type UsageGroup,
  type UsagePath,
  type UsageRange,
  type UsageSource,
  type UsageStatus,
  type UsageSummary,
  type UsageTotals,
  type UsageTotalsByWindow,
  type WindowTotals,
} from "../domain/usage.ts";
import type { Database } from "./db.ts";

/** What the guard and the monitor read; the ledger implements it. */
export interface UsageReader {
  /** The hour, day, and month windows' totals at `now`. */
  totals(now?: number): UsageTotalsByWindow;
  /** Rows that started at or after `since`, oldest first, at most `limit`. */
  recent(since: number, limit?: number): UsageEntry[];
}

/**
 * How everything that can spend provider money reports to the ledger and
 * asks the spend guard first. Callers hold this, never the ledger or guard.
 */
export interface UsageGate {
  /** Throws `SpendCapError` when a hard cap pauses calls. Call before spending. */
  admit(source: UsageSource): void;
  /** Records one attempt, after it ended (any status). Never throws. */
  record(entry: NewUsageEntry): void;
}

/** Hex characters kept of a prompt's SHA-256: enough to tell prompts apart. */
const PROMPT_HASH_CHARS = 16;

/** The short digest a row keeps of its prompt, so identical requests match. */
export function promptHash(prompt: string): string {
  return createHash("sha256")
    .update(prompt)
    .digest("hex")
    .slice(0, PROMPT_HASH_CHARS);
}

/**
 * The row for a message that started a turn in a BB thread. BB reports
 * neither tokens nor cost for a thread's turns, so the row counts one request
 * and no spend.
 */
export function threadTurnUsage(fields: {
  at: number;
  source: UsageSource;
  threadId: string | null;
  status: UsageStatus;
  durationMs: number;
}): NewUsageEntry {
  return {
    ...fields,
    path: "thread",
    model: THREAD_USAGE_MODEL,
    traceId: null,
    calls: 1,
    inputTokens: null,
    outputTokens: null,
    cost: null,
    promptHash: null,
    promptChars: null,
    replay: false,
  };
}

const PRUNE_EVERY_MS = 60_000;
/** Models, thread ids, trace ids, and digests are all far shorter than this. */
const TEXT_MAX = 200;
const TOP_THREADS = 25;
const NO_WORKSTREAM = { key: "none", label: "No workstream" };

const clip = (text: string) => text.slice(0, TEXT_MAX);
const clipped = (text: string | null) => (text === null ? null : clip(text));
/** A count or amount the provider reported, or null when it is unusable. */
const reported = (value: number | null) =>
  value !== null && Number.isFinite(value) ? value : null;
const whole = (value: number | null) => {
  const number = reported(value);
  return number === null ? null : Math.round(number);
};

type Row = {
  id: string;
  at: number;
  source: UsageSource;
  path: UsagePath;
  model: string;
  thread_id: string | null;
  trace_id: string | null;
  status: UsageStatus;
  calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost: number | null;
  prompt_hash: string | null;
  prompt_chars: number | null;
  duration_ms: number;
  replay: number;
};

const entryOf = (row: Row): UsageEntry => ({
  id: row.id,
  at: row.at,
  source: row.source,
  path: row.path,
  model: row.model,
  threadId: row.thread_id,
  traceId: row.trace_id,
  status: row.status,
  calls: row.calls,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  cost: row.cost,
  promptHash: row.prompt_hash,
  promptChars: row.prompt_chars,
  durationMs: row.duration_ms,
  replay: row.replay === 1,
});

/**
 * The sums every report shares. SQL's SUM skips nulls, so `cost` adds only
 * the costs that were reported, and `unmetered` counts the requests it left
 * out. `failed` counts attempts, not requests: a composition that fails after
 * several requests failed once.
 */
const AMOUNTS = `COALESCE(SUM(cost), 0) AS cost,
  COALESCE(SUM(calls), 0) AS calls,
  COALESCE(SUM(CASE WHEN cost IS NULL THEN calls ELSE 0 END), 0) AS unmetered,
  COALESCE(SUM(input_tokens), 0) AS inputTokens,
  COALESCE(SUM(output_tokens), 0) AS outputTokens,
  COALESCE(SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END), 0) AS failed`;
/** Largest cost first; requests, then the key, settle ties. */
const LARGEST_FIRST = "cost DESC, calls DESC, key ASC";

const largestFirst = (a: UsageGroup, b: UsageGroup) =>
  b.cost - a.cost || b.calls - a.calls || a.key.localeCompare(b.key);

const EMPTY: UsageTotals = {
  cost: 0,
  calls: 0,
  unmetered: 0,
  inputTokens: 0,
  outputTokens: 0,
  failed: 0,
};

export class UsageLedger implements UsageReader {
  private prunedAt = 0;

  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  record(entry: NewUsageEntry): UsageEntry {
    const stored: UsageEntry = {
      id: randomUUID(),
      at: Math.round(entry.at),
      source: entry.source,
      path: entry.path,
      model: clip(entry.model),
      threadId: clipped(entry.threadId),
      traceId: clipped(entry.traceId),
      status: entry.status,
      calls: Math.max(1, Math.round(reported(entry.calls) ?? 1)),
      inputTokens: whole(entry.inputTokens),
      outputTokens: whole(entry.outputTokens),
      cost: reported(entry.cost),
      promptHash: clipped(entry.promptHash),
      promptChars: whole(entry.promptChars),
      durationMs: Math.max(0, Math.round(reported(entry.durationMs) ?? 0)),
      replay: entry.replay,
    };
    this.db
      .prepare(
        `INSERT INTO ws_usage (id, at, source, path, model, thread_id, trace_id, status, calls,
           input_tokens, output_tokens, cost, prompt_hash, prompt_chars, duration_ms, replay)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stored.id,
        stored.at,
        stored.source,
        stored.path,
        stored.model,
        stored.threadId,
        stored.traceId,
        stored.status,
        stored.calls,
        stored.inputTokens,
        stored.outputTokens,
        stored.cost,
        stored.promptHash,
        stored.promptChars,
        stored.durationMs,
        stored.replay ? 1 : 0,
      );
    return stored;
  }

  totals(now: number = this.now()): UsageTotalsByWindow {
    // One range scan of the `at` index per window. A row counts from the
    // moment its attempt started, so a window's first instant is included.
    const read = this.db.prepare(
      `SELECT COALESCE(SUM(cost), 0) AS cost,
         COALESCE(SUM(calls), 0) AS calls,
         COALESCE(SUM(CASE WHEN cost IS NULL THEN calls ELSE 0 END), 0) AS unmetered
       FROM ws_usage WHERE at >= ? AND at <= ?`,
    );
    const totals = {} as UsageTotalsByWindow;
    for (const window of USAGE_WINDOWS)
      totals[window] = read.get(windowStart(window, now), now) as WindowTotals;
    return totals;
  }

  /**
   * When more than `limit` rows qualify, the newest `limit` are returned: what
   * reads recent usage cares most about what just happened.
   */
  recent(since: number, limit: number = USAGE_MAX_ROWS): UsageEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM ws_usage WHERE at >= ? ORDER BY at DESC, rowid DESC LIMIT ?",
      )
      .all(since, Math.max(0, Math.floor(limit))) as Row[];
    return rows.reverse().map(entryOf);
  }

  /**
   * The Usage page's aggregates for `range`. `groupOfThread` names the
   * workstream a thread belongs to now (`null` for none), so `byWorkstream`
   * reflects current membership.
   */
  summary(
    range: UsageRange,
    options: {
      now?: number;
      groupOfThread?: (
        threadId: string,
      ) => { key: string; label: string } | null;
    } = {},
  ): UsageSummary {
    const { from, to, bucketMs } = rangeBounds(
      range,
      options.now ?? this.now(),
    );
    const within = "FROM ws_usage WHERE at >= ? AND at <= ?";
    const totals = this.db
      .prepare(`SELECT ${AMOUNTS} ${within}`)
      .get(from, to) as UsageTotals;

    // Rows are placed by the bucket boundaries rather than by `bucketStart`
    // of each row, so a day that a clock change makes 23 or 25 hours long is
    // still one bucket.
    const inBucket = this.db.prepare(
      `SELECT ${AMOUNTS} FROM ws_usage WHERE at >= ? AND at < ?`,
    );
    const buckets: UsageBucket[] = [];
    for (let start = from; start <= to;) {
      const aligned = bucketStart(start + bucketMs * 1.5, bucketMs);
      const next = aligned > start ? aligned : start + bucketMs;
      // The last bucket is still filling: it ends at `to`, inclusive.
      const end = next > to ? to + 1 : next;
      buckets.push({
        ...(totals.calls ? (inBucket.get(start, end) as UsageTotals) : EMPTY),
        start,
      });
      start = next;
    }

    const grouped = (column: string, extra = "") =>
      this.db
        .prepare(
          `SELECT ${column} AS key, ${AMOUNTS} ${within} ${extra}
           GROUP BY ${column} ORDER BY ${LARGEST_FIRST}`,
        )
        .all(from, to) as (UsageTotals & { key: string | null })[];
    const labeled = (
      column: string,
      label: (key: string) => string,
    ): UsageGroup[] =>
      grouped(column).map((group) => ({
        ...group,
        key: group.key ?? "",
        label: label(group.key ?? ""),
      }));

    // Every thread's sums, so each can be placed under its workstream; the
    // rows without a thread come back under a null key.
    const perThread = grouped("thread_id");
    const byWorkstream = new Map<string, UsageGroup>();
    for (const { key: threadId, ...amounts } of perThread) {
      const group =
        (threadId !== null && options.groupOfThread?.(threadId)) ||
        NO_WORKSTREAM;
      const sum = byWorkstream.get(group.key);
      if (!sum) {
        byWorkstream.set(group.key, { ...amounts, ...group });
        continue;
      }
      for (const field of Object.keys(EMPTY) as (keyof UsageTotals)[])
        sum[field] += amounts[field];
    }

    return {
      range,
      from,
      to,
      bucketMs,
      totals,
      buckets,
      bySource: labeled(
        "source",
        (key) => USAGE_SOURCE_TITLE[key as UsageSource] ?? key,
      ),
      byModel: labeled("model", (key) => key),
      byPath: labeled(
        "path",
        (key) => USAGE_PATH_TITLE[key as UsagePath] ?? key,
      ),
      byThread: perThread
        .flatMap(({ key, ...amounts }) =>
          key === null ? [] : [{ ...amounts, key, label: key }],
        )
        .slice(0, TOP_THREADS),
      byWorkstream: [...byWorkstream.values()].sort(largestFirst),
      retainedSince: (
        this.db.prepare("SELECT MIN(at) AS at FROM ws_usage").get() as {
          at: number | null;
        }
      ).at,
    };
  }

  /** Applies retention (90 days, 250,000 rows). Cheap to call after every record. */
  prune(options: { force?: boolean } = {}): void {
    const now = this.now();
    if (!options.force && now - this.prunedAt < PRUNE_EVERY_MS) return;
    this.prunedAt = now;
    this.db
      .prepare("DELETE FROM ws_usage WHERE at < ?")
      .run(now - USAGE_RETAIN_MS);
    const { rows } = this.db
      .prepare("SELECT COUNT(*) AS rows FROM ws_usage")
      .get() as { rows: number };
    if (rows > USAGE_MAX_ROWS)
      this.db
        .prepare(
          `DELETE FROM ws_usage WHERE rowid IN
             (SELECT rowid FROM ws_usage ORDER BY at ASC, rowid ASC LIMIT ?)`,
        )
        .run(rows - USAGE_MAX_ROWS);
  }
}
