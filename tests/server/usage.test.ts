import { afterEach, describe, expect, it } from "vitest";
import {
  USAGE_MAX_ROWS,
  USAGE_RETAIN_MS,
  bucketStart,
  rangeBounds,
  windowStart,
  type NewUsageEntry,
} from "../../src/domain/usage.ts";
import type { NewTrace } from "../../src/domain/trace.ts";
import { openDatabase, type Database } from "../../src/server/db.ts";
import { TraceStore } from "../../src/server/trace.ts";
import { UsageLedger } from "../../src/server/usage.ts";
import { createInitializedTestPluginHost } from "./test-host.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Mid-month and mid-day, local time, so no window edge is near by accident. */
const NOW = new Date(2025, 5, 18, 14, 30).getTime();

const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
});

async function ledgerAt(now: () => number = () => NOW) {
  const host = await createInitializedTestPluginHost({ pluginId: "usage" });
  disposals.push(() => host.harness.lifecycle.dispose());
  const db = openDatabase(host.bb);
  return { db, ledger: new UsageLedger(db, now) };
}

const entry = (fields: Partial<NewUsageEntry> = {}): NewUsageEntry => ({
  at: NOW - MINUTE,
  source: "turn-end",
  path: "gateway",
  model: "google/gemini-3.1-flash-lite",
  threadId: "t1",
  traceId: null,
  status: "ok",
  calls: 1,
  inputTokens: 100,
  outputTokens: 20,
  cost: 0.01,
  promptHash: "0123456789abcdef",
  promptChars: 400,
  durationMs: 1200,
  replay: false,
  ...fields,
});

const count = (db: Database, table = "ws_usage") =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("recording", () => {
  it("stores a row and returns it as stored", async () => {
    const { ledger } = await ledgerAt();
    const stored = ledger.record(
      entry({
        model: "m".repeat(500),
        durationMs: 1234.6,
        traceId: "trace-1",
        replay: true,
      }),
    );
    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.durationMs).toBe(1235);
    expect(stored.model).toHaveLength(200);
    expect(ledger.recent(0)).toEqual([stored]);
    expect(stored).toMatchObject({
      traceId: "trace-1",
      replay: true,
      cost: 0.01,
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  it("keeps an unreported cost null, and never stores a cost that is not a number", async () => {
    const { db, ledger } = await ledgerAt();
    ledger.record(entry({ cost: null, inputTokens: null, outputTokens: null }));
    ledger.record(entry({ cost: Number.NaN }));
    ledger.record(entry({ cost: 0 }));
    expect(
      db
        .prepare("SELECT cost, input_tokens FROM ws_usage ORDER BY rowid")
        .all(),
    ).toEqual([
      { cost: null, input_tokens: null },
      { cost: null, input_tokens: 100 },
      { cost: 0, input_tokens: 100 },
    ]);
    expect(ledger.recent(0).map((row) => row.cost)).toEqual([null, null, 0]);
  });

  it("gives each row its own id", async () => {
    const { ledger } = await ledgerAt();
    const ids = new Set(
      Array.from({ length: 20 }, () => ledger.record(entry()).id),
    );
    expect(ids.size).toBe(20);
  });
});

describe("window totals", () => {
  it("includes a window's first instant and nothing before it", async () => {
    const { ledger } = await ledgerAt();
    const hour = windowStart("hour", NOW);
    const day = windowStart("day", NOW);
    const month = windowStart("month", NOW);
    expect(hour).toBe(NOW - HOUR);
    for (const at of [hour, hour - 1, day, day - 1, month, month - 1])
      ledger.record(entry({ at, cost: 1 }));
    expect(ledger.totals(NOW)).toEqual({
      hour: { cost: 1, calls: 1, unmetered: 0 },
      day: { cost: 3, calls: 3, unmetered: 0 },
      month: { cost: 5, calls: 5, unmetered: 0 },
    });
  });

  it("leaves out rows that started after the moment asked about", async () => {
    const { ledger } = await ledgerAt();
    ledger.record(entry({ at: NOW, cost: 2 }));
    ledger.record(entry({ at: NOW + 1, cost: 5 }));
    expect(ledger.totals(NOW).hour).toEqual({
      cost: 2,
      calls: 1,
      unmetered: 0,
    });
  });

  it("reads the injected clock when no moment is given", async () => {
    let now = NOW;
    const { ledger } = await ledgerAt(() => now);
    ledger.record(entry({ at: NOW - MINUTE, cost: 4 }));
    expect(ledger.totals().hour.cost).toBe(4);
    now = NOW + HOUR;
    expect(ledger.totals().hour.cost).toBe(0);
    expect(ledger.totals().day.cost).toBe(4);
  });

  it("adds only reported costs and counts the other requests as unmetered", async () => {
    const { ledger } = await ledgerAt();
    ledger.record(entry({ cost: 0.25 }));
    ledger.record(entry({ cost: 0 }));
    ledger.record(entry({ cost: null, path: "worker" }));
    ledger.record(entry({ cost: null, calls: 4, path: "presentation" }));
    ledger.record(entry({ cost: 0.5, calls: 3, path: "presentation" }));
    expect(ledger.totals(NOW).hour).toEqual({
      cost: 0.75,
      calls: 10,
      unmetered: 5,
    });
  });

  it("is all zeros while the ledger is empty", async () => {
    const { ledger } = await ledgerAt();
    const empty = { cost: 0, calls: 0, unmetered: 0 };
    expect(ledger.totals(NOW)).toEqual({
      hour: empty,
      day: empty,
      month: empty,
    });
  });
});

describe("recent rows", () => {
  it("returns rows at or after the start, oldest first", async () => {
    const { ledger } = await ledgerAt();
    for (const at of [NOW - 5, NOW - 30, NOW - 10, NOW - 31])
      ledger.record(entry({ at }));
    expect(ledger.recent(NOW - 30).map((row) => row.at)).toEqual([
      NOW - 30,
      NOW - 10,
      NOW - 5,
    ]);
  });

  it("keeps the newest rows when more qualify than the limit", async () => {
    const { ledger } = await ledgerAt();
    for (let i = 0; i < 6; i++) ledger.record(entry({ at: NOW - i }));
    expect(ledger.recent(0, 3).map((row) => row.at)).toEqual([
      NOW - 2,
      NOW - 1,
      NOW,
    ]);
  });
});

describe("summary", () => {
  it("zero-fills every bucket in the range, aligned and oldest first", async () => {
    const { ledger } = await ledgerAt();
    const { from, bucketMs } = rangeBounds("24h", NOW);
    ledger.record(entry({ at: NOW - 3 * HOUR, cost: 0.5 }));
    ledger.record(entry({ at: NOW - 3 * HOUR + MINUTE, cost: null }));
    ledger.record(entry({ at: from - 1, cost: 9 }));
    const summary = ledger.summary("24h", { now: NOW });

    expect(summary).toMatchObject({ range: "24h", from, to: NOW, bucketMs });
    const starts = summary.buckets.map((bucket) => bucket.start);
    expect(starts[0]).toBe(from);
    expect(starts.at(-1)).toBe(bucketStart(NOW, bucketMs));
    expect(starts).toEqual(
      Array.from({ length: starts.length }, (_, i) => from + i * bucketMs),
    );
    for (const start of starts)
      expect(bucketStart(start, bucketMs)).toBe(start);

    const filled = summary.buckets.filter((bucket) => bucket.calls > 0);
    expect(filled).toEqual([
      {
        start: bucketStart(NOW - 3 * HOUR, bucketMs),
        cost: 0.5,
        calls: 2,
        unmetered: 1,
        inputTokens: 200,
        outputTokens: 40,
        failed: 0,
      },
    ]);
    // The row before the range is in no bucket and in no total.
    expect(summary.totals).toMatchObject({ cost: 0.5, calls: 2, unmetered: 1 });
  });

  it("counts a row at the range's last instant, in the bucket still filling", async () => {
    const { ledger } = await ledgerAt();
    ledger.record(entry({ at: NOW, cost: 1 }));
    ledger.record(entry({ at: NOW + 1, cost: 5 }));
    const summary = ledger.summary("1h", { now: NOW });
    expect(summary.totals.cost).toBe(1);
    expect(summary.buckets.at(-1)).toMatchObject({ cost: 1, calls: 1 });
    expect(summary.buckets.reduce((sum, bucket) => sum + bucket.calls, 0)).toBe(
      summary.totals.calls,
    );
  });

  it("starts every day bucket at local midnight, across a clock change", async () => {
    // Where clocks change in March, this range has a 23-hour day in it.
    const now = new Date(2025, 3, 15, 9, 0).getTime();
    const { ledger } = await ledgerAt(() => now);
    const lateOnShortDay = new Date(2025, 2, 9, 23, 30).getTime();
    ledger.record(entry({ at: lateOnShortDay }));
    expect(bucketStart(lateOnShortDay, DAY)).toBe(
      new Date(2025, 2, 9).getTime(),
    );
    const { buckets, from } = ledger.summary("90d", { now });

    expect(buckets[0]!.start).toBe(from);
    for (const { start } of buckets) {
      const local = new Date(start);
      expect([local.getHours(), local.getMinutes()]).toEqual([0, 0]);
    }
    expect(buckets).toHaveLength(91);
    const held = buckets.filter((bucket) => bucket.calls > 0);
    expect(held.map((bucket) => bucket.start)).toEqual([
      new Date(2025, 2, 9).getTime(),
    ]);
  });

  it("groups by source, model, and path with their labels, largest cost first", async () => {
    const { ledger } = await ledgerAt();
    ledger.record(entry({ source: "turn-end", cost: 0.1 }));
    ledger.record(entry({ source: "turn-end", cost: 0.1, status: "invalid" }));
    ledger.record(
      entry({ source: "presentation", path: "presentation", cost: 0.9 }),
    );
    ledger.record(
      entry({
        source: "start",
        path: "worker",
        model: "codex/gpt-5",
        cost: null,
        inputTokens: null,
        outputTokens: null,
      }),
    );
    ledger.record(
      entry({
        source: "debug-thread",
        path: "thread",
        model: "BB thread",
        cost: null,
        status: "failed",
      }),
    );
    ledger.record(
      entry({
        source: "recap-reminder",
        path: "thread",
        model: "BB thread",
        cost: null,
        status: "aborted",
      }),
    );
    const summary = ledger.summary("24h", { now: NOW });

    expect(summary.bySource.map(({ key, label }) => [key, label])).toEqual([
      ["presentation", "Enhanced response"],
      ["turn-end", "Turn end"],
      ["debug-thread", "Debug thread"],
      ["recap-reminder", "Recap reminder"],
      ["start", "New thread"],
    ]);
    expect(summary.byPath.map(({ key, label }) => [key, label])).toEqual([
      ["presentation", "Enhanced response"],
      ["gateway", "AI Gateway"],
      ["thread", "Agent thread"],
      ["worker", "Worker thread"],
    ]);
    expect(summary.byModel.map(({ key, label }) => [key, label])).toEqual([
      ["google/gemini-3.1-flash-lite", "google/gemini-3.1-flash-lite"],
      ["BB thread", "BB thread"],
      ["codex/gpt-5", "codex/gpt-5"],
    ]);
    expect(summary.byPath.find((group) => group.key === "thread")).toEqual({
      key: "thread",
      label: "Agent thread",
      cost: 0,
      calls: 2,
      unmetered: 2,
      inputTokens: 200,
      outputTokens: 40,
      failed: 2,
    });
    expect(summary.totals).toEqual({
      cost: 1.1,
      calls: 6,
      unmetered: 3,
      inputTokens: 500,
      outputTokens: 100,
      failed: 3,
    });
  });

  it("breaks a tie in cost by requests", async () => {
    const { ledger } = await ledgerAt();
    ledger.record(entry({ model: "a", cost: null }));
    ledger.record(entry({ model: "b", cost: null, calls: 3 }));
    ledger.record(entry({ model: "c", cost: null, calls: 2 }));
    expect(
      ledger.summary("1h", { now: NOW }).byModel.map((group) => group.key),
    ).toEqual(["b", "c", "a"]);
  });

  it("lists the 25 threads that spent most, leaving out rows with no thread", async () => {
    const { ledger } = await ledgerAt();
    for (let i = 1; i <= 30; i++)
      ledger.record(entry({ threadId: `t${i}`, cost: i }));
    ledger.record(entry({ threadId: null, cost: 1000 }));
    const { byThread } = ledger.summary("1h", { now: NOW });
    expect(byThread).toHaveLength(25);
    expect(byThread[0]).toMatchObject({ key: "t30", label: "t30", cost: 30 });
    expect(byThread.at(-1)).toMatchObject({ key: "t6", cost: 6 });
  });

  it("places each thread under the workstream it belongs to now", async () => {
    const { ledger } = await ledgerAt();
    ledger.record(entry({ threadId: "t1", cost: 0.2 }));
    ledger.record(entry({ threadId: "t1", cost: 0.3, status: "failed" }));
    ledger.record(entry({ threadId: "t2", cost: null, calls: 2 }));
    ledger.record(entry({ threadId: "t3", cost: 2 }));
    ledger.record(entry({ threadId: null, cost: 1 }));
    const asked: string[] = [];
    const { byWorkstream } = ledger.summary("1h", {
      now: NOW,
      groupOfThread: (threadId) => {
        asked.push(threadId);
        return threadId === "t3"
          ? null
          : { key: "ws_a", label: "Alpha / Parser" };
      },
    });
    expect(asked.sort()).toEqual(["t1", "t2", "t3"]);
    expect(byWorkstream).toEqual([
      {
        key: "none",
        label: "No workstream",
        cost: 3,
        calls: 2,
        unmetered: 0,
        inputTokens: 200,
        outputTokens: 40,
        failed: 0,
      },
      {
        key: "ws_a",
        label: "Alpha / Parser",
        cost: 0.5,
        calls: 4,
        unmetered: 2,
        inputTokens: 300,
        outputTokens: 60,
        failed: 1,
      },
    ]);
  });

  it("puts every thread under No workstream when nothing names workstreams", async () => {
    const { ledger } = await ledgerAt();
    ledger.record(entry({ threadId: "t1" }));
    ledger.record(entry({ threadId: "t2" }));
    expect(ledger.summary("1h", { now: NOW }).byWorkstream).toMatchObject([
      { key: "none", label: "No workstream", calls: 2 },
    ]);
  });

  it("reports the oldest row it holds, whatever the range", async () => {
    const { ledger } = await ledgerAt();
    expect(ledger.summary("1h", { now: NOW })).toMatchObject({
      retainedSince: null,
      totals: { cost: 0, calls: 0, unmetered: 0, failed: 0 },
      bySource: [],
      byWorkstream: [],
    });
    ledger.record(entry({ at: NOW - 40 * DAY }));
    ledger.record(entry({ at: NOW - MINUTE }));
    const summary = ledger.summary("1h", { now: NOW });
    expect(summary.retainedSince).toBe(NOW - 40 * DAY);
    expect(summary.totals.calls).toBe(1);
  });
});

describe("retention", () => {
  it("drops rows older than 90 days, at most once a minute unless forced", async () => {
    let now = NOW;
    const { db, ledger } = await ledgerAt(() => now);
    ledger.record(entry({ at: NOW - USAGE_RETAIN_MS - 1 }));
    ledger.record(entry({ at: NOW - USAGE_RETAIN_MS }));
    ledger.prune();
    expect(ledger.recent(0).map((row) => row.at)).toEqual([
      NOW - USAGE_RETAIN_MS,
    ]);

    // Within the minute an unforced prune does nothing.
    now = NOW + 30_000;
    ledger.record(entry({ at: NOW - USAGE_RETAIN_MS - DAY }));
    ledger.prune();
    expect(count(db)).toBe(2);
    ledger.prune({ force: true });
    expect(count(db)).toBe(0);

    ledger.record(entry({ at: NOW - USAGE_RETAIN_MS - DAY }));
    now += 60_000;
    ledger.prune();
    expect(count(db)).toBe(0);
  });

  it("keeps the newest rows when there are more than the row limit", async () => {
    const { db, ledger } = await ledgerAt();
    const extra = 7;
    db.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
       INSERT INTO ws_usage (id, at, source, path, model, status)
       SELECT 'row-' || i, ? + i, 'turn-end', 'gateway', 'm', 'ok' FROM n`,
    ).run(USAGE_MAX_ROWS + extra, NOW - DAY);
    ledger.prune({ force: true });
    expect(count(db)).toBe(USAGE_MAX_ROWS);
    expect(db.prepare("SELECT MIN(at) AS oldest FROM ws_usage").get()).toEqual({
      oldest: NOW - DAY + extra + 1,
    });
  });

  it("is untouched by clearing or pruning traces, and leaves traces alone", async () => {
    const { db, ledger } = await ledgerAt();
    const traces = new TraceStore(db, () => NOW);
    const trace: NewTrace = {
      at: NOW - MINUTE,
      kind: "turn-end",
      status: "ok",
      label: "Turn end",
      model: "m",
      durationMs: 1,
      replayOf: null,
      provider: "test",
      thinking: "off",
      system: "",
      prompt: "prompt",
      input: {},
      response: "{}",
      reasoning: null,
      stopReason: null,
      parsed: {},
      outcome: null,
      usage: { input: 1, output: 1, cost: null },
      error: null,
      summary: null,
    };
    const traceId = traces.add(trace);
    const row = ledger.record(entry({ traceId }));

    ledger.prune({ force: true });
    expect(traces.get(traceId)?.usage).toEqual({
      input: 1,
      output: 1,
      cost: null,
    });

    traces.prune({ force: true });
    expect(traces.clear()).toBe(1);
    expect(count(db, "ws_trace")).toBe(0);
    expect(ledger.recent(0)).toEqual([row]);
    expect(ledger.totals(NOW).hour).toEqual({
      cost: 0.01,
      calls: 1,
      unmetered: 0,
    });
  });
});
