import { describe, expect, it } from "vitest";
import { parsePrefs } from "../../src/domain/prefs.ts";
import type { UsageEntry } from "../../src/domain/usage.ts";
import { detectUsageFlags } from "../../src/domain/usageAlerts.ts";
import type { UsageReader } from "../../src/server/usage.ts";
import { UsageMonitor } from "../../src/server/usageMonitor.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const START = new Date(2025, 4, 10, 12, 0, 0).getTime();

/** Enough requests from one thread, a minute before `at`, for a `thread-burst`. */
const burst = (threadId: string, at: number): UsageEntry[] =>
  Array.from({ length: 40 }, (_, i) => ({
    id: `${threadId}-${i}`,
    at: at - MINUTE,
    source: "turn-end",
    path: "gateway",
    model: "test-model",
    threadId,
    traceId: null,
    status: "ok",
    calls: 1,
    inputTokens: 1_000,
    outputTokens: 100,
    cost: 0.01,
    promptHash: null,
    promptChars: null,
    durationMs: 1_000,
    replay: false,
  }));

function setup(entries: UsageEntry[] = burst("thr_a", START)) {
  const world = {
    now: START,
    detectors: true,
    entries,
    reads: [] as { since: number; limit: number | undefined }[],
  };
  const ledger: UsageReader = {
    totals: () => {
      throw new Error("The monitor reads rows, not totals.");
    },
    recent: (since, limit) => {
      world.reads.push({ since, limit });
      return world.entries.filter((entry) => entry.at >= since);
    },
  };
  const monitor = new UsageMonitor({
    ledger,
    prefs: () => ({ ...parsePrefs({}).usage, detectors: world.detectors }),
    now: () => world.now,
  });
  return { world, monitor };
}

const ids = (monitor: UsageMonitor) => monitor.flags().map((flag) => flag.id);

describe("UsageMonitor", () => {
  it("runs the detectors over the last 8 days of the ledger", () => {
    const { world, monitor } = setup();
    expect(monitor.flags()).toEqual(detectUsageFlags(world.entries, START));
    expect(ids(monitor)).toEqual(["thread-burst:thr_a"]);
    expect(world.reads).toEqual([{ since: START - 8 * DAY, limit: 60_000 }]);
  });

  it("returns nothing and reads nothing while detectors are off", () => {
    const { world, monitor } = setup();
    world.detectors = false;
    expect(monitor.flags()).toEqual([]);
    expect(world.reads).toEqual([]);
  });

  it("serves one reading for 15 seconds", () => {
    const { world, monitor } = setup();
    monitor.flags();
    world.entries = [...world.entries, ...burst("thr_b", START)];

    world.now = START + 14_999;
    expect(ids(monitor)).toEqual(["thread-burst:thr_a"]);
    expect(world.reads).toHaveLength(1);

    world.now = START + 15_000;
    expect(ids(monitor).sort()).toEqual([
      "thread-burst:thr_a",
      "thread-burst:thr_b",
    ]);
    expect(world.reads).toEqual([
      { since: START - 8 * DAY, limit: 60_000 },
      { since: START + 15_000 - 8 * DAY, limit: 60_000 },
    ]);
  });

  it("reads again when the clock moves back", () => {
    const { world, monitor } = setup();
    monitor.flags();
    world.now = START - MINUTE;
    monitor.flags();
    expect(world.reads).toHaveLength(2);
  });

  it("stops at once when detectors are turned off, and reads afresh when turned on", () => {
    const { world, monitor } = setup();
    expect(ids(monitor)).toHaveLength(1);

    world.detectors = false;
    expect(monitor.flags()).toEqual([]);

    world.detectors = true;
    world.entries = [];
    expect(monitor.flags()).toEqual([]);
    expect(world.reads).toHaveLength(2);
  });

  it("drops a flag once its rows age out", () => {
    const { world, monitor } = setup();
    expect(ids(monitor)).toHaveLength(1);
    world.now = START + DAY;
    expect(monitor.flags()).toEqual([]);
  });
});
