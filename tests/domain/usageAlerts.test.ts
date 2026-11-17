import { describe, expect, it } from "vitest";
import type { UsageEntry, UsageFlag } from "../../src/domain/usage.ts";
import {
  detectUsageFlags,
  USAGE_FLAG_THRESHOLDS,
} from "../../src/domain/usageAlerts.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Local noon, so a test's rows stay clear of midnight. */
const NOW = new Date(2025, 4, 10, 12, 0, 0).getTime();
const T = USAGE_FLAG_THRESHOLDS;

let nextId = 0;
function row(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    id: `u${nextId++}`,
    at: NOW - MINUTE,
    source: "turn-end",
    path: "gateway",
    model: "test-model",
    threadId: null,
    traceId: null,
    status: "ok",
    calls: 1,
    inputTokens: 1_000,
    outputTokens: 100,
    cost: 0,
    promptHash: null,
    promptChars: null,
    durationMs: 1_000,
    replay: false,
    ...overrides,
  };
}

/** `count` rows, spread evenly from `from` to `to` ms before `NOW`. */
function rows(
  count: number,
  overrides: Partial<UsageEntry> = {},
  { from = 10 * MINUTE, to = MINUTE } = {},
): UsageEntry[] {
  return Array.from({ length: count }, (_, i) =>
    row({
      at: NOW - from + (count > 1 ? ((from - to) * i) / (count - 1) : 0),
      ...overrides,
    }),
  );
}

const byAt = (entries: UsageEntry[]) =>
  [...entries].sort((a, b) => a.at - b.at);

function flagsOf(
  entries: UsageEntry[],
  kind: UsageFlag["kind"],
  now = NOW,
): UsageFlag[] {
  return detectUsageFlags(byAt(entries), now).filter((f) => f.kind === kind);
}

/** One reported row an hour for the eight days before the last hour. */
const history = (cost: number) =>
  Array.from({ length: 191 }, (_, i) =>
    row({ at: NOW - (i + 1) * HOUR - 30 * MINUTE, cost }),
  );

describe("detectUsageFlags", () => {
  it("finds nothing in an empty ledger", () => {
    expect(detectUsageFlags([], NOW)).toEqual([]);
  });

  describe("spend-spike", () => {
    const lastHour = (cost: number, overrides: Partial<UsageEntry> = {}) =>
      row({ at: NOW - 30 * MINUTE, cost, ...overrides });
    const hourFlag = (entries: UsageEntry[], now = NOW) =>
      flagsOf(entries, "spend-spike", now).find(
        (f) => f.id === "spend-spike:hour",
      );
    const dayFlag = (entries: UsageEntry[]) =>
      flagsOf(entries, "spend-spike").find((f) => f.id === "spend-spike:day");

    it("warns at 4x the median hour and is critical at 10x", () => {
      // A median hour of $2 puts the warning at $8 and critical at $20.
      const past = history(2);
      expect(hourFlag([...past, lastHour(7.99)])).toBeUndefined();
      expect(hourFlag([...past, lastHour(8)])).toMatchObject({
        severity: "warning",
        title: "Spend in the last hour is 4× the usual",
      });
      expect(hourFlag([...past, lastHour(19.99)])?.severity).toBe("warning");
      expect(hourFlag([...past, lastHour(20)])?.severity).toBe("critical");
    });

    it("leaves an ordinary busy hour over a quiet baseline unflagged", () => {
      // The $0.25 floor puts 4x at $1 and 10x at $2.50; the hour needs $3
      // for a warning and $10 to be critical.
      const past = history(0.01);
      expect(hourFlag([...past, lastHour(1.5)])).toBeUndefined();
      expect(hourFlag([...past, lastHour(2.99)])).toBeUndefined();
      const warning = hourFlag([...past, lastHour(3)]);
      expect(warning?.severity).toBe("warning");
      // 300 times the median hour, which is not what it was measured against.
      expect(warning?.title).toBe("Spend in the last hour reached $3.00");
      expect(warning?.detail).toContain("$0.25");
      expect(hourFlag([...past, lastHour(9.99)])?.severity).toBe("warning");
      expect(hourFlag([...past, lastHour(10)])?.severity).toBe("critical");
    });

    it("holds the hour to its least amounts above the floor too", () => {
      // A median hour of $0.50 puts 4x at $2 and 10x at $5.
      const past = history(0.5);
      expect(hourFlag([...past, lastHour(2.99)])).toBeUndefined();
      expect(hourFlag([...past, lastHour(3)])).toMatchObject({
        severity: "warning",
        title: "Spend in the last hour is 6× the usual",
      });
      expect(hourFlag([...past, lastHour(9.99)])?.severity).toBe("warning");
      expect(hourFlag([...past, lastHour(10)])?.severity).toBe("critical");
    });

    it("leaves a normal day unflagged, with no least amount of its own", () => {
      // The floor is $6 for 24 hours, so the day warns at $24 and is
      // critical at $60.
      const past = history(0.01).filter((entry) => entry.at < NOW - DAY);
      const earlier = (cost: number) => row({ at: NOW - 2 * HOUR, cost });
      expect(dayFlag([...past, earlier(10)])).toBeUndefined();
      expect(dayFlag([...past, earlier(23.99)])).toBeUndefined();
      expect(dayFlag([...past, earlier(24)])?.severity).toBe("warning");
      expect(dayFlag([...past, earlier(59.99)])?.severity).toBe("warning");
      expect(dayFlag([...past, earlier(60)])?.severity).toBe("critical");
    });

    it("compares the last 24 hours with 24 median hours", () => {
      // The last 24 hours already hold 23 history rows: $11.50.
      const past = history(0.5);
      const earlier = (cost: number) => row({ at: NOW - 2 * HOUR, cost });
      expect(dayFlag([...past, earlier(36.49)])).toBeUndefined();
      const warning = dayFlag([...past, earlier(36.5)]);
      expect(warning).toMatchObject({ severity: "warning", cost: 48 });
      expect(dayFlag([...past, earlier(108.49)])?.severity).toBe("warning");
      expect(dayFlag([...past, earlier(108.5)])?.severity).toBe("critical");
    });

    it("adds only reported costs", () => {
      const past = history(0.5);
      const unreported = rows(50, { cost: null });
      expect(
        hourFlag([...past, ...unreported, lastHour(2.99)]),
      ).toBeUndefined();
      const flag = hourFlag([...past, ...unreported, lastHour(3)]);
      expect(flag).toMatchObject({ cost: 3, calls: 1 });
    });

    it("counts replays", () => {
      const flag = hourFlag([...history(0.5), lastHour(3, { replay: true })]);
      expect(flag?.severity).toBe("warning");
    });

    it("uses absolute amounts with under a day of history", () => {
      const start = NOW - HOUR;
      const young = row({ at: start - 24 * HOUR + MINUTE, cost: 0.01 });
      expect(hourFlag([young, lastHour(4.99)])).toBeUndefined();
      expect(hourFlag([young, lastHour(5)])?.severity).toBe("warning");
      expect(hourFlag([young, lastHour(14.99)])?.severity).toBe("warning");
      expect(hourFlag([young, lastHour(15)])?.severity).toBe("critical");
      expect(hourFlag([lastHour(5)])?.severity).toBe("warning");

      // A full day of history is a baseline, here the floor.
      const old = row({ at: start - 24 * HOUR, cost: 0.01 });
      expect(hourFlag([old, lastHour(3)])?.severity).toBe("warning");
    });

    it("rates the 24-hour window by the hour without a baseline", () => {
      const earlier = (cost: number) => row({ at: NOW - 2 * HOUR, cost });
      expect(dayFlag([earlier(119.99)])).toBeUndefined();
      expect(dayFlag([earlier(120)])?.severity).toBe("warning");
      expect(dayFlag([earlier(360)])?.severity).toBe("critical");
    });

    it("clears when the spend leaves the window", () => {
      const entries = [...history(0.5), lastHour(5)];
      expect(hourFlag(entries, NOW + 30 * MINUTE)).toBeDefined();
      expect(hourFlag(entries, NOW + 30 * MINUTE + 1)).toBeUndefined();
    });

    it("names no thread or source", () => {
      const flag = hourFlag([
        ...history(0.5),
        lastHour(5, { threadId: "thr_a" }),
      ]);
      expect(flag).toMatchObject({
        threadId: null,
        source: null,
        at: NOW - 30 * MINUTE,
        since: NOW - 30 * MINUTE,
      });
    });
  });

  describe("thread-burst", () => {
    const burst = (
      count: number,
      overrides: Partial<UsageEntry> = {},
      span?: { from: number; to: number },
    ) => rows(count, { threadId: "thr_a", ...overrides }, span);

    it("warns at 40 requests in an hour and is critical at 100", () => {
      expect(flagsOf(burst(39), "thread-burst")).toEqual([]);
      expect(flagsOf(burst(40), "thread-burst")).toMatchObject([
        { severity: "warning", calls: 40 },
      ]);
      expect(flagsOf(burst(99), "thread-burst")[0]?.severity).toBe("warning");
      expect(flagsOf(burst(100), "thread-burst")[0]?.severity).toBe("critical");
    });

    it("counts requests, whatever their status", () => {
      const entries = [
        ...burst(1, { calls: 30, status: "failed", cost: null }),
        ...burst(9, { status: "aborted", cost: null }),
      ];
      expect(flagsOf(entries, "thread-burst")).toEqual([]);
      expect(
        flagsOf(
          [...entries, ...burst(1, { status: "invalid" })],
          "thread-burst",
        ),
      ).toMatchObject([{ calls: 40 }]);
    });

    it("needs the requests inside one rolling hour", () => {
      const at = (offset: number) =>
        rows(20, { threadId: "thr_a", at: NOW - 3 * HOUR + offset });
      expect(flagsOf([...at(0), ...at(HOUR + 1)], "thread-burst")).toEqual([]);
      expect(flagsOf([...at(0), ...at(HOUR)], "thread-burst")).toHaveLength(1);
    });

    it("reports the busiest hour with its thread, span, and cost", () => {
      const entries = [
        ...rows(
          45,
          { threadId: "thr_a", cost: 0.02 },
          { from: 5 * HOUR, to: 4.5 * HOUR },
        ),
        ...rows(10, { threadId: "thr_a", cost: 0.02 }),
      ];
      const [flag] = flagsOf(entries, "thread-burst");
      expect(flag).toMatchObject({
        id: "thread-burst:thr_a",
        threadId: "thr_a",
        source: "turn-end",
        calls: 45,
        cost: 0.9,
        since: NOW - 5 * HOUR,
        at: NOW - 4.5 * HOUR,
      });
      expect(flag?.title).toBe("One thread made 45 requests in an hour");
      expect(flag?.detail).toContain("thr_a");
      expect(flag?.detail).toContain("$0.90 reported");
    });

    it("says so when no request reported a cost", () => {
      const [flag] = flagsOf(burst(40, { cost: null }), "thread-burst");
      expect(flag?.cost).toBeNull();
      expect(flag?.detail).toContain("no cost reported");
      expect(flag?.detail).not.toContain("$");
    });

    it("keeps threads apart and ignores calls about no thread", () => {
      expect(
        flagsOf(
          [...burst(39), ...burst(39, { threadId: "thr_b" })],
          "thread-burst",
        ),
      ).toEqual([]);
      expect(flagsOf(burst(100, { threadId: null }), "thread-burst")).toEqual(
        [],
      );
    });

    it("leaves replays out", () => {
      expect(
        flagsOf([...burst(39), ...burst(20, { replay: true })], "thread-burst"),
      ).toEqual([]);
    });

    it("clears once the burst is a day old", () => {
      const entries = burst(40, {}, { from: 30 * MINUTE, to: 10 * MINUTE });
      const kept = NOW + T.lookbackMs - 30 * MINUTE;
      expect(flagsOf(entries, "thread-burst", kept)).toHaveLength(1);
      expect(flagsOf(entries, "thread-burst", kept + 1)).toEqual([]);
    });
  });

  describe("repeated-prompt", () => {
    const repeats = (count: number, overrides: Partial<UsageEntry> = {}) =>
      rows(count, { promptHash: "abc123", ...overrides }, { from: 9 * MINUTE });

    it("warns at 6 identical prompts in 10 minutes and is critical at 15", () => {
      expect(flagsOf(repeats(5), "repeated-prompt")).toEqual([]);
      expect(flagsOf(repeats(6), "repeated-prompt")).toMatchObject([
        { id: "repeated-prompt:abc123", severity: "warning", calls: 6 },
      ]);
      expect(flagsOf(repeats(14), "repeated-prompt")[0]?.severity).toBe(
        "warning",
      );
      expect(flagsOf(repeats(15), "repeated-prompt")[0]?.severity).toBe(
        "critical",
      );
    });

    it("needs them inside 10 minutes", () => {
      const spread = (span: number) =>
        rows(6, { promptHash: "abc123" }, { from: HOUR, to: HOUR - span });
      expect(flagsOf(spread(10 * MINUTE + 5), "repeated-prompt")).toEqual([]);
      expect(flagsOf(spread(10 * MINUTE), "repeated-prompt")).toHaveLength(1);
    });

    it("counts prompts, not the requests a row stands for", () => {
      expect(flagsOf(repeats(5, { calls: 4 }), "repeated-prompt")).toEqual([]);
    });

    it("keeps prompts apart and ignores rows without a hash", () => {
      expect(
        flagsOf(
          [...repeats(5), ...repeats(5, { promptHash: "def456" })],
          "repeated-prompt",
        ),
      ).toEqual([]);
      expect(
        flagsOf(repeats(20, { promptHash: null }), "repeated-prompt"),
      ).toEqual([]);
    });

    it("names the thread and source the repeats share", () => {
      const [one] = flagsOf(
        repeats(6, { threadId: "thr_a", cost: 0.01 }),
        "repeated-prompt",
      );
      expect(one).toMatchObject({
        threadId: "thr_a",
        source: "turn-end",
        cost: 0.06,
      });
      expect(one?.title).toBe("The same prompt was sent 6 times in 10 minutes");

      const [mixed] = flagsOf(
        [
          ...repeats(3, { threadId: "thr_a" }),
          ...repeats(3, { threadId: "thr_b", source: "start" }),
        ],
        "repeated-prompt",
      );
      expect(mixed).toMatchObject({ threadId: null, source: null });
    });

    it("leaves replays out", () => {
      expect(
        flagsOf(
          [...repeats(5), ...repeats(5, { replay: true })],
          "repeated-prompt",
        ),
      ).toEqual([]);
    });

    it("clears once the repeats are a day old", () => {
      const entries = repeats(6);
      const kept = NOW + T.lookbackMs - 9 * MINUTE;
      expect(flagsOf(entries, "repeated-prompt", kept)).toHaveLength(1);
      expect(flagsOf(entries, "repeated-prompt", kept + 1)).toEqual([]);
    });
  });

  describe("cost-unreported", () => {
    const unreported = (count: number, overrides: Partial<UsageEntry> = {}) =>
      rows(count, { cost: null, ...overrides });

    it("warns at 3 answered gateway calls with tokens and no cost", () => {
      expect(flagsOf(unreported(2), "cost-unreported")).toEqual([]);
      const [flag] = flagsOf(
        [...unreported(2), ...unreported(1, { status: "invalid" })],
        "cost-unreported",
      );
      expect(flag).toMatchObject({
        id: "cost-unreported",
        severity: "warning",
        calls: 3,
        cost: null,
        source: "turn-end",
      });
      expect(flag?.detail).toContain("every total is low");
    });

    it("counts only calls that should have reported a cost", () => {
      const others = [
        ...unreported(3, { path: "worker" }),
        ...unreported(3, { path: "thread" }),
        ...unreported(3, { status: "failed" }),
        ...unreported(3, { status: "aborted" }),
        ...unreported(3, { inputTokens: 0, outputTokens: 0 }),
        ...unreported(3, { inputTokens: null, outputTokens: null }),
        ...unreported(3, { replay: true }),
        // Zero is a reported cost.
        ...unreported(3, { cost: 0 }),
      ];
      expect(flagsOf([...others, ...unreported(2)], "cost-unreported")).toEqual(
        [],
      );
    });

    it("counts a call that reported only output tokens", () => {
      expect(
        flagsOf(unreported(3, { inputTokens: null }), "cost-unreported"),
      ).toHaveLength(1);
    });

    it("clears after 24 hours", () => {
      const entries = unreported(3, { at: NOW - HOUR });
      const kept = NOW + T.lookbackMs - HOUR;
      expect(flagsOf(entries, "cost-unreported", kept)).toHaveLength(1);
      expect(flagsOf(entries, "cost-unreported", kept + 1)).toEqual([]);
    });
  });

  describe("unmetered-calls", () => {
    const mix = (
      unmetered: number,
      metered: number,
      overrides: Partial<UsageEntry> = { path: "worker" },
    ) => [
      ...rows(unmetered, { cost: null, ...overrides }, { from: 5 * HOUR }),
      ...rows(metered, { cost: 0.01 }, { from: 5 * HOUR }),
    ];

    it("warns from 25 requests with 40% unmetered", () => {
      expect(flagsOf(mix(24, 0), "unmetered-calls")).toEqual([]);
      expect(flagsOf(mix(9, 16), "unmetered-calls")).toEqual([]);
      expect(flagsOf(mix(10, 15), "unmetered-calls")).toMatchObject([
        { id: "unmetered-calls", severity: "warning", calls: 10, cost: null },
      ]);
    });

    it("is critical from 100 requests with 70% unmetered", () => {
      expect(flagsOf(mix(99, 0), "unmetered-calls")[0]?.severity).toBe(
        "warning",
      );
      expect(flagsOf(mix(69, 31), "unmetered-calls")[0]?.severity).toBe(
        "warning",
      );
      expect(flagsOf(mix(70, 30), "unmetered-calls")[0]?.severity).toBe(
        "critical",
      );
    });

    it("counts the requests each row stands for", () => {
      const entries = [
        row({ cost: null, path: "presentation", status: "failed", calls: 10 }),
        ...rows(15, { cost: 0.01 }),
      ];
      expect(flagsOf(entries, "unmetered-calls")).toMatchObject([
        { calls: 10 },
      ]);
    });

    it("says what the requests were and what covers them", () => {
      const entries = [
        ...rows(12, { cost: null, path: "worker" }),
        ...rows(5, { cost: null, path: "thread", source: "debug-thread" }),
        ...rows(3, { cost: null, status: "failed" }),
        ...rows(2, { cost: null, status: "aborted" }),
        ...rows(1, { cost: null }),
        ...rows(7, { cost: 0.01 }),
      ];
      const [flag] = flagsOf(entries, "unmetered-calls");
      expect(flag?.title).toBe(
        "77% of requests in the last 24 hours reported no cost",
      );
      expect(flag?.detail).toContain("23 of 30 requests");
      expect(flag?.detail).toContain("12 ran in worker threads");
      expect(flag?.detail).toContain("5 ran as agent threads");
      expect(flag?.detail).toContain("5 failed or were aborted");
      expect(flag?.detail).toContain("1 came back with no cost");
      expect(flag?.detail).toContain(
        "Totals leave these out; the requests-per-hour limit covers them.",
      );
    });

    it("leaves replays out and clears after 24 hours", () => {
      expect(
        flagsOf(
          [...mix(9, 15), ...rows(5, { cost: null, replay: true })],
          "unmetered-calls",
        ),
      ).toEqual([]);
      const entries = mix(25, 0);
      const kept = NOW + T.lookbackMs - 5 * HOUR;
      expect(flagsOf(entries, "unmetered-calls", kept)).toHaveLength(1);
      // One row has aged out, which leaves 24 requests.
      expect(flagsOf(entries, "unmetered-calls", kept + 1)).toEqual([]);
    });
  });

  describe("oversize-input", () => {
    const usual = (count: number, inputTokens = 10_000) =>
      rows(count, { inputTokens }, { from: 3 * DAY, to: 2 * DAY });
    const big = (inputTokens: number, overrides: Partial<UsageEntry> = {}) =>
      row({ inputTokens, at: NOW - HOUR, ...overrides });

    it("warns at 50,000 input tokens and is critical at 150,000", () => {
      expect(flagsOf([...usual(9), big(49_999)], "oversize-input")).toEqual([]);
      expect(
        flagsOf([...usual(9), big(50_000)], "oversize-input"),
      ).toMatchObject([
        { id: "oversize-input:turn-end", severity: "warning", calls: 1 },
      ]);
      expect(
        flagsOf([...usual(9), big(149_999)], "oversize-input")[0]?.severity,
      ).toBe("warning");
      expect(
        flagsOf([...usual(9), big(150_000)], "oversize-input")[0]?.severity,
      ).toBe("critical");
    });

    it("needs more than 4x the source's median", () => {
      expect(
        flagsOf([...usual(9, 15_000), big(60_000)], "oversize-input"),
      ).toEqual([]);
      expect(
        flagsOf([...usual(9, 15_000), big(60_001)], "oversize-input"),
      ).toHaveLength(1);
    });

    it("needs 10 rows of the source to have a median", () => {
      expect(flagsOf([...usual(8), big(200_000)], "oversize-input")).toEqual(
        [],
      );
      // Rows without an input size and rows of another source don't count.
      expect(
        flagsOf(
          [
            ...usual(8),
            ...rows(5, { inputTokens: null }),
            ...rows(5, { source: "start" }),
            big(200_000),
          ],
          "oversize-input",
        ),
      ).toEqual([]);
    });

    it("raises one flag per source, naming the largest row", () => {
      const entries = [
        ...usual(9),
        big(60_000, { threadId: "thr_small", cost: 0.25 }),
        big(80_000, { threadId: "thr_large", cost: 0.5, at: NOW - 2 * HOUR }),
        ...rows(9, { source: "tidy", inputTokens: 20_000 }),
        big(160_000, { source: "tidy", at: NOW - 3 * HOUR }),
      ];
      const flags = flagsOf(entries, "oversize-input");
      expect(flags.map((f) => f.id)).toEqual([
        "oversize-input:tidy",
        "oversize-input:turn-end",
      ]);
      expect(flags[1]).toMatchObject({
        source: "turn-end",
        threadId: "thr_large",
        calls: 2,
        cost: 0.75,
        since: NOW - 2 * HOUR,
        at: NOW - HOUR,
      });
      expect(flags[1]?.title).toBe(
        "One Turn end call sent 80,000 input tokens",
      );
      expect(flags[1]?.detail).toContain("thr_large");
      expect(flags[1]?.detail).toContain("median of 10,000");
    });

    it("leaves replays out", () => {
      expect(
        flagsOf(
          [...usual(10), big(200_000, { replay: true })],
          "oversize-input",
        ),
      ).toEqual([]);
    });

    it("clears after 24 hours, while the row still counts toward the median", () => {
      const entries = [...usual(9), big(200_000)];
      const kept = NOW + T.lookbackMs - HOUR;
      expect(flagsOf(entries, "oversize-input", kept)).toHaveLength(1);
      expect(flagsOf(entries, "oversize-input", kept + 1)).toEqual([]);
    });
  });

  describe("failure-run", () => {
    const failed = (
      count: number,
      overrides: Partial<UsageEntry> = {},
      span?: { from: number; to: number },
    ) => rows(count, { status: "failed", cost: null, ...overrides }, span);

    it("warns at 8 failures in 30 minutes and is critical at 25", () => {
      expect(flagsOf(failed(7), "failure-run")).toEqual([]);
      expect(flagsOf(failed(8), "failure-run")).toMatchObject([
        {
          id: "failure-run:turn-end",
          severity: "warning",
          source: "turn-end",
          calls: 8,
          cost: null,
        },
      ]);
      expect(flagsOf(failed(24), "failure-run")[0]?.severity).toBe("warning");
      expect(flagsOf(failed(25), "failure-run")[0]?.severity).toBe("critical");
    });

    it("counts failed and invalid attempts alike", () => {
      const [flag] = flagsOf(
        [...failed(7), ...failed(1, { status: "invalid", cost: 0.04 })],
        "failure-run",
      );
      expect(flag?.title).toBe("Turn end calls failed 8 times in 30 minutes");
      expect(flag?.detail).toContain("7 failed, 1 unusable");
      expect(flag?.detail).toContain("$0.04 reported");
    });

    it("leaves aborted requests out, as neither failures nor attempts", () => {
      // A composer preview is aborted whenever the draft changes.
      const aborted = (count: number) => failed(count, { status: "aborted" });
      expect(flagsOf(aborted(30), "failure-run")).toEqual([]);
      expect(flagsOf([...failed(7), ...aborted(30)], "failure-run")).toEqual(
        [],
      );
      // They don't dilute a run of real failures either.
      const [flag] = flagsOf([...failed(8), ...aborted(30)], "failure-run");
      expect(flag).toMatchObject({ severity: "warning", calls: 8 });
      expect(flag?.detail).toContain("8 of 8 attempts");
      expect(flag?.detail).not.toContain("aborted");
    });

    it("needs 80% of the source's attempts in the same span", () => {
      // 8 of 10 between the first failure and the last.
      const run = failed(8, {}, { from: 20 * MINUTE, to: 10 * MINUTE });
      const inside = (count: number) =>
        rows(count, {}, { from: 19 * MINUTE, to: 11 * MINUTE });
      expect(flagsOf([...run, ...inside(2)], "failure-run")).toMatchObject([
        { calls: 8 },
      ]);
      expect(flagsOf([...run, ...inside(3)], "failure-run")).toEqual([]);
      // Attempts that worked before and after the run don't dilute it.
      expect(
        flagsOf(
          [
            ...run,
            ...rows(20, {}, { from: 29 * MINUTE, to: 21 * MINUTE }),
            ...rows(20, {}, { from: 9 * MINUTE, to: MINUTE }),
          ],
          "failure-run",
        ),
      ).toHaveLength(1);
    });

    it("needs the failures inside 30 minutes", () => {
      const spread = (span: number) =>
        failed(8, {}, { from: 2 * HOUR, to: 2 * HOUR - span });
      expect(flagsOf(spread(30 * MINUTE + 7), "failure-run")).toEqual([]);
      expect(flagsOf(spread(30 * MINUTE), "failure-run")).toHaveLength(1);
    });

    it("finds the largest run that keeps the share, wherever it lies", () => {
      // Seeded, so a failure names the same rows on every run.
      let seed = 7;
      const random = () => (seed = (seed * 48_271) % 2_147_483_647) / 2 ** 31;
      for (let round = 0; round < 150; round++) {
        const failRate = 0.5 + random() * 0.5;
        const entries = Array.from({ length: 30 + (round % 40) }, () =>
          row({
            at: NOW - HOUR - Math.floor(random() * 90) * MINUTE,
            status: random() < failRate ? "failed" : "ok",
          }),
        ).sort((a, b) => a.at - b.at);
        let most = 0;
        for (let from = 0; from < entries.length; from++)
          for (let to = from; to < entries.length; to++) {
            if (entries[to]!.at - entries[from]!.at > 30 * MINUTE) break;
            const run = entries.slice(from, to + 1);
            const bad = run.filter((entry) => entry.status !== "ok").length;
            if (bad / run.length >= 0.8) most = Math.max(most, bad);
          }
        const [flag] = flagsOf(entries, "failure-run");
        expect(flag?.calls ?? 0, `round ${round}`).toBe(most >= 8 ? most : 0);
      }
    });

    it("keeps sources apart and leaves replays out", () => {
      expect(
        flagsOf(
          [
            ...failed(7),
            ...failed(7, { source: "start" }),
            ...failed(7, { replay: true }),
          ],
          "failure-run",
        ),
      ).toEqual([]);
    });

    it("clears once the run is a day old", () => {
      const entries = failed(8);
      const kept = NOW + T.lookbackMs - 10 * MINUTE;
      expect(flagsOf(entries, "failure-run", kept)).toHaveLength(1);
      expect(flagsOf(entries, "failure-run", kept + 1)).toEqual([]);
    });
  });

  describe("order and ids", () => {
    const entries = byAt([
      // Warning, newest evidence.
      ...rows(8, { status: "failed", cost: null, source: "tidy" }),
      // Critical, older.
      ...rows(100, { threadId: "thr_old" }, { from: 5 * HOUR, to: 4.5 * HOUR }),
      // Critical, newer.
      ...rows(
        15,
        { promptHash: "abc123", source: "start" },
        { from: 2 * HOUR, to: 2 * HOUR - 5 * MINUTE },
      ),
      // Warning, oldest.
      ...rows(40, { threadId: "thr_b" }, { from: 9 * HOUR, to: 8.5 * HOUR }),
    ]);

    it("puts critical first, then the newest evidence", () => {
      expect(
        detectUsageFlags(entries, NOW).map((f) => [f.severity, f.id]),
      ).toEqual([
        ["critical", "repeated-prompt:abc123"],
        ["critical", "thread-burst:thr_old"],
        ["warning", "failure-run:tidy"],
        ["warning", "thread-burst:thr_b"],
      ]);
    });

    it("keeps a finding's id from one reading to the next", () => {
      const ids = (now: number) =>
        detectUsageFlags(entries, now)
          .map((f) => f.id)
          .sort();
      expect(ids(NOW + 5 * MINUTE)).toEqual(ids(NOW));
    });

    it("reads the same from rows in any order", () => {
      expect(detectUsageFlags([...entries].reverse(), NOW)).toEqual(
        detectUsageFlags(entries, NOW),
      );
    });
  });
});
