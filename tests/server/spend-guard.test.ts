import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestPluginHost } from "./test-host.ts";
import { getMeta, openDatabase, setMeta } from "../../src/server/db.ts";
import { parsePrefs, type Prefs } from "../../src/domain/prefs.ts";
import type {
  SpendState,
  UsageTotalsByWindow,
} from "../../src/domain/usage.ts";
import { SpendCapError, SpendGuard } from "../../src/server/spendGuard.ts";
import { UserError } from "../../src/server/service.ts";

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
const guards: SpendGuard[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const guard of guards.splice(0)) guard.dispose();
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});

/** A Tuesday afternoon, local time, so boundaries don't depend on the zone. */
const START = new Date(2025, 5, 10, 15, 0, 0).getTime();
const MIDNIGHT = new Date(2025, 5, 11).getTime();
const NEXT_MONTH = new Date(2025, 6, 1).getTime();
const HOUR = 3_600_000;

const OFF: Prefs["usage"] = {
  hourSpendWarn: null,
  hourSpendCap: null,
  daySpendWarn: null,
  daySpendCap: null,
  monthSpendWarn: null,
  monthSpendCap: null,
  hourCallsWarn: null,
  hourCallsCap: null,
  detectors: true,
};

const empty = (): UsageTotalsByWindow => ({
  hour: { cost: 0, calls: 0, unmetered: 0 },
  day: { cost: 0, calls: 0, unmetered: 0 },
  month: { cost: 0, calls: 0, unmetered: 0 },
});

function setup(usage: Partial<Prefs["usage"]> = {}) {
  const host = createTestPluginHost({ pluginId: "spend-guard-test" });
  hosts.push(host);
  const db = openDatabase(host.bb);
  const world = {
    now: START,
    prefs: { ...OFF, ...usage },
    totals: empty(),
    /** Replaces `totals` when a test needs them to follow the clock. */
    totalsAt: null as ((now: number) => UsageTotalsByWindow) | null,
  };
  const changes: SpendState[] = [];
  const logs: string[] = [];
  const create = () => {
    const guard = new SpendGuard({
      db,
      ledger: {
        totals: (now) => world.totalsAt?.(now ?? world.now) ?? world.totals,
        recent: () => [],
      },
      prefs: () => world.prefs,
      now: () => world.now,
      onChange: (state) => changes.push(state),
      log: (message) => logs.push(message),
    });
    guards.push(guard);
    return guard;
  };
  return { db, world, changes, logs, create, guard: create() };
}

const refusal = (guard: SpendGuard): SpendCapError => {
  try {
    guard.admit("turn-end");
  } catch (error) {
    if (error instanceof SpendCapError) return error;
    throw error;
  }
  throw new Error("The call was admitted.");
};

describe("limits", () => {
  it("uses the preference defaults: warns at $3 and pauses at $10 in an hour", () => {
    const { guard, world } = setup(parsePrefs({}).usage);
    world.totals.hour.cost = 2.99;
    expect(guard.status().level).toBe("ok");
    world.totals.hour.cost = 3;
    expect(guard.status().level).toBe("warning");
    expect(() => guard.admit("turn-end")).not.toThrow();
    world.totals.hour.cost = 9.99;
    expect(guard.status().level).toBe("warning");
    expect(() => guard.admit("turn-end")).not.toThrow();
    world.totals.hour.cost = 10;
    expect(guard.status().level).toBe("capped");
    expect(() => guard.admit("turn-end")).toThrow(SpendCapError);
  });

  it("refuses with a user error that carries the state", () => {
    const { guard, world } = setup({ daySpendCap: 30 });
    world.totals.day.cost = 31;
    const error = refusal(guard);
    expect(error).toBeInstanceOf(UserError);
    expect(error.name).toBe("SpendCapError");
    expect(error.state.level).toBe("capped");
    expect(error.state.limits.map((limit) => limit.key)).toEqual(["daySpend"]);
  });

  it("admits everything while no threshold is set", () => {
    const { guard, world } = setup();
    world.totals.hour = { cost: 9_999, calls: 99_999, unmetered: 99_999 };
    world.totals.day = { cost: 9_999, calls: 99_999, unmetered: 99_999 };
    world.totals.month = { cost: 9_999, calls: 99_999, unmetered: 99_999 };
    expect(guard.status()).toEqual({ level: "ok", limits: [] });
    expect(() => guard.admit("categories")).not.toThrow();
  });

  it("counts requests that reported no cost toward the requests cap", () => {
    const { guard, world } = setup({ hourSpendCap: 1, hourCallsCap: 500 });
    world.totals.hour = { cost: 0, calls: 499, unmetered: 499 };
    expect(() => guard.admit("turn-end")).not.toThrow();
    world.totals.hour = { cost: 0, calls: 500, unmetered: 500 };
    expect(refusal(guard).state.limits.map((l) => [l.key, l.level])).toEqual([
      ["hourSpend", "ok"],
      ["hourCalls", "capped"],
    ]);
  });

  it.each([
    [
      "hourSpend",
      { hourSpendCap: 10 },
      { hour: { cost: 10, calls: 1, unmetered: 0 } },
      "Workstreams is paused: the last hour's spend reached the $10.00 limit. Resume it from the Usage page, or raise Pause at in Settings → Workstreams → Usage.",
    ],
    [
      "daySpend",
      { daySpendCap: 30 },
      { day: { cost: 30.004, calls: 1, unmetered: 0 } },
      "Workstreams is paused: today's spend reached the $30.00 limit. Resume it from the Usage page, or raise Pause at in Settings → Workstreams → Usage.",
    ],
    [
      "monthSpend",
      { monthSpendCap: 250.5 },
      { month: { cost: 300, calls: 1, unmetered: 0 } },
      "Workstreams is paused: this month's spend reached the $250.50 limit. Resume it from the Usage page, or raise Pause at in Settings → Workstreams → Usage.",
    ],
    [
      "hourCalls",
      { hourCallsCap: 1500 },
      { hour: { cost: 0, calls: 1500, unmetered: 1500 } },
      "Workstreams is paused: requests in the last hour reached the limit of 1,500. Resume it from the Usage page, or raise Pause at in Settings → Workstreams → Usage.",
    ],
  ] as const)("pauses on %s and says so", (key, usage, totals, message) => {
    const { guard, world } = setup(usage);
    expect(() => guard.admit("turn-end")).not.toThrow();
    world.totals = { ...empty(), ...totals };
    const error = refusal(guard);
    expect(error.message).toBe(message);
    expect(
      error.state.limits.filter((l) => l.level === "capped").map((l) => l.key),
    ).toEqual([key]);
  });

  it("names the first reached cap and counts the others", () => {
    const { guard, world } = setup({
      hourSpendCap: 10,
      daySpendCap: 30,
      hourCallsCap: 500,
    });
    world.totals.hour = { cost: 12, calls: 20, unmetered: 0 };
    world.totals.day = { cost: 40, calls: 90, unmetered: 0 };
    expect(refusal(guard).message).toBe(
      "Workstreams is paused: the last hour's spend reached the $10.00 limit, and 1 other limit is reached. Resume it from the Usage page, or raise Pause at in Settings → Workstreams → Usage.",
    );
    world.totals.hour.calls = 500;
    expect(refusal(guard).message).toContain(
      "reached the $10.00 limit, and 2 other limits are reached.",
    );
  });
});

describe("resume", () => {
  it("lets calls through until the next local midnight for the day", () => {
    const { guard, world } = setup({ daySpendCap: 30 });
    world.totals.day.cost = 30;
    expect(() => guard.admit("turn-end")).toThrow(SpendCapError);
    const state = guard.resume();
    expect(state.level).toBe("warning");
    expect(state.limits[0]).toMatchObject({
      key: "daySpend",
      level: "warning",
      resumedUntil: MIDNIGHT,
    });
    world.totals.day.cost = 75;
    world.now = MIDNIGHT - 1;
    expect(() => guard.admit("turn-end")).not.toThrow();
    // The fake ledger keeps reporting the old day; only the resume ended.
    world.now = MIDNIGHT;
    expect(() => guard.admit("turn-end")).toThrow(SpendCapError);
  });

  it("lasts until the next month starts for the month", () => {
    const { guard, world } = setup({ monthSpendCap: 100 });
    world.totals.month.cost = 100;
    expect(guard.resume().limits[0]?.resumedUntil).toBe(NEXT_MONTH);
    world.now = NEXT_MONTH - 1;
    expect(() => guard.admit("turn-end")).not.toThrow();
    world.now = NEXT_MONTH;
    expect(() => guard.admit("turn-end")).toThrow(SpendCapError);
  });

  it("lasts an hour for the rolling hour and the requests limit", () => {
    const { guard, world } = setup({ hourSpendCap: 10, hourCallsCap: 500 });
    world.totals.hour = { cost: 10, calls: 500, unmetered: 0 };
    const state = guard.resume();
    expect(state.limits.map((l) => [l.key, l.resumedUntil])).toEqual([
      ["hourSpend", START + HOUR],
      ["hourCalls", START + HOUR],
    ]);
    world.totals.hour = { cost: 11, calls: 600, unmetered: 0 };
    world.now = START + HOUR - 1;
    expect(() => guard.admit("turn-end")).not.toThrow();
    world.now = START + HOUR;
    expect(() => guard.admit("turn-end")).toThrow(SpendCapError);
  });

  it("resumes only the limits whose cap is reached", () => {
    const { guard, world } = setup({ hourSpendCap: 10, daySpendCap: 30 });
    world.totals.day.cost = 30;
    expect(guard.resume().level).toBe("warning");
    world.totals.hour.cost = 10;
    expect(refusal(guard).message).toContain("the last hour's spend");
  });

  it("leaves the other limit of the same window to pause when reached", () => {
    const { guard, world, db } = setup({ hourSpendCap: 10, hourCallsCap: 500 });
    world.totals.hour = { cost: 10, calls: 40, unmetered: 0 };
    const state = guard.resume();
    expect(state.limits.map((l) => [l.key, l.resumedUntil])).toEqual([
      ["hourSpend", START + HOUR],
      ["hourCalls", null],
    ]);
    expect(JSON.parse(getMeta(db, "usage-resumes")!)).toEqual({
      hourSpend: START + HOUR,
    });
    expect(() => guard.admit("turn-end")).not.toThrow();
    // The requests limit was not reached at the resume, so it still pauses.
    world.totals.hour.calls = 500;
    expect(refusal(guard).message).toContain(
      "requests in the last hour reached the limit of 500",
    );
    // A second resume covers every cap reached by then, each for an hour.
    world.now = START + 10 * 60_000;
    expect(guard.resume().limits.map((l) => [l.key, l.resumedUntil])).toEqual([
      ["hourSpend", START + 10 * 60_000 + HOUR],
      ["hourCalls", START + 10 * 60_000 + HOUR],
    ]);
    expect(() => guard.admit("turn-end")).not.toThrow();
  });

  it("changes nothing when no cap is reached", () => {
    const { guard, world, db } = setup({ daySpendWarn: 10, daySpendCap: 30 });
    world.totals.day.cost = 12;
    expect(guard.resume().limits[0]?.resumedUntil).toBeNull();
    expect(JSON.parse(getMeta(db, "usage-resumes") ?? "{}")).toEqual({});
  });

  it("survives a restart", () => {
    const { guard, world, db, create } = setup({ daySpendCap: 30 });
    world.totals.day.cost = 30;
    guard.resume();
    expect(JSON.parse(getMeta(db, "usage-resumes")!)).toEqual({
      daySpend: MIDNIGHT,
    });
    guard.dispose();
    const restarted = create();
    expect(() => restarted.admit("turn-end")).not.toThrow();
    expect(restarted.status().limits[0]?.resumedUntil).toBe(MIDNIGHT);
  });

  it("ignores a stored resume that ended and drops it", () => {
    const { world, db, create } = setup({ daySpendCap: 30, hourSpendCap: 10 });
    setMeta(
      db,
      "usage-resumes",
      JSON.stringify({ daySpend: START - 1, hourSpend: START + 5 }),
    );
    world.totals.day.cost = 30;
    const guard = create();
    expect(() => guard.admit("turn-end")).toThrow(SpendCapError);
    expect(JSON.parse(getMeta(db, "usage-resumes")!)).toEqual({
      hourSpend: START + 5,
    });
  });

  it("drops keys that name no limit when it reads the record", () => {
    const { world, db, create } = setup({
      daySpendCap: 30,
      hourCallsCap: 500,
    });
    setMeta(
      db,
      "usage-resumes",
      JSON.stringify({ day: MIDNIGHT, hourCalls: START + HOUR }),
    );
    world.totals.day.cost = 30;
    world.totals.hour.calls = 500;
    const restarted = create();
    expect(refusal(restarted).message).toContain("today's spend");
    expect(
      restarted.status().limits.map((l) => [l.key, l.resumedUntil]),
    ).toEqual([
      ["daySpend", null],
      ["hourCalls", START + HOUR],
    ]);
    restarted.resume();
    expect(JSON.parse(getMeta(db, "usage-resumes")!)).toEqual({
      daySpend: MIDNIGHT,
      hourCalls: START + HOUR,
    });
  });

  it.each(["not json", "[1]", '{"daySpend":"tomorrow"}', "null"])(
    "treats a damaged record (%s) as no resume",
    (raw) => {
      const { world, db, create } = setup({ daySpendCap: 30 });
      setMeta(db, "usage-resumes", raw);
      world.totals.day.cost = 30;
      expect(() => create().admit("turn-end")).toThrow(SpendCapError);
    },
  );
});

describe("transitions", () => {
  it("reports each level change once and each lift once", () => {
    const { guard, world, changes, logs } = setup({
      daySpendWarn: 10,
      daySpendCap: 30,
    });
    const lifts = vi.fn();
    guard.onLift(lifts);
    guard.observe();
    guard.observe();
    expect(changes).toEqual([]);
    expect(logs).toEqual([]);

    world.totals.day.cost = 10;
    guard.observe();
    guard.observe();
    guard.status();
    expect(changes.map((state) => state.level)).toEqual(["warning"]);

    world.totals.day.cost = 30;
    guard.observe();
    expect(() => guard.admit("turn-end")).toThrow(SpendCapError);
    expect(() => guard.admit("categories")).toThrow(SpendCapError);
    guard.observe();
    expect(changes.map((state) => state.level)).toEqual(["warning", "capped"]);
    expect(lifts).not.toHaveBeenCalled();

    guard.resume();
    guard.observe();
    guard.admit("turn-end");
    expect(changes.map((state) => state.level)).toEqual([
      "warning",
      "capped",
      "warning",
    ]);
    expect(lifts).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(3);
    expect(logs[1]).toContain("today's spend reached the $30.00 limit");
  });

  it("reports a pause it finds on its first look after a restart", () => {
    const { world, changes, create } = setup({ daySpendCap: 30 });
    world.totals.day.cost = 45;
    const guard = create();
    expect(() => guard.admit("turn-end")).toThrow(SpendCapError);
    expect(changes.map((state) => state.level)).toEqual(["capped"]);
  });

  it("lifts through observe when the cap is raised or turned off", () => {
    const { guard, world, changes } = setup({ daySpendCap: 30 });
    const lifts = vi.fn();
    guard.onLift(lifts);
    world.totals.day.cost = 30;
    guard.observe();
    world.prefs = { ...world.prefs, daySpendCap: 30.01 };
    guard.observe();
    expect(lifts).toHaveBeenCalledTimes(1);
    expect(changes.at(-1)?.level).toBe("ok");
    expect(() => guard.admit("turn-end")).not.toThrow();

    world.totals.day.cost = 31;
    guard.observe();
    world.prefs = { ...world.prefs, daySpendCap: null };
    guard.observe();
    expect(lifts).toHaveBeenCalledTimes(2);
  });

  it("stops telling a listener that was removed", () => {
    const { guard, world } = setup({ daySpendCap: 30 });
    const kept = vi.fn();
    const removed = vi.fn();
    guard.onLift(kept);
    const remove = guard.onLift(removed);
    remove();
    world.totals.day.cost = 30;
    guard.observe();
    guard.resume();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it("admits the call even when a listener throws", () => {
    const { guard, world, logs } = setup({ daySpendCap: 30 });
    const later = vi.fn();
    guard.onLift(() => {
      throw new Error("listener broke");
    });
    guard.onLift(later);
    world.totals.day.cost = 30;
    guard.observe();
    world.totals.day.cost = 0;
    expect(() => guard.admit("turn-end")).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
    expect(logs.at(-1)).toContain("listener broke");
  });

  it("sees no second change when a listener asks again", () => {
    const { guard, world, changes } = setup({ daySpendCap: 30 });
    const lifts = vi.fn(() => guard.admit("turn-end"));
    guard.onLift(lifts);
    world.totals.day.cost = 30;
    guard.observe();
    world.totals.day.cost = 0;
    guard.observe();
    expect(lifts).toHaveBeenCalledTimes(1);
    expect(changes.map((state) => state.level)).toEqual(["capped", "ok"]);
  });
});

describe("lifting by time", () => {
  function timed(usage: Partial<Prefs["usage"]>) {
    vi.useFakeTimers({ now: START });
    const context = setup(usage);
    // The guard's clock is the faked one, so timers and `now` move together.
    const guard = new SpendGuard({
      db: context.db,
      ledger: {
        totals: (now) =>
          context.world.totalsAt?.(now ?? Date.now()) ?? context.world.totals,
        recent: () => [],
      },
      prefs: () => context.world.prefs,
      now: () => Date.now(),
      onChange: (state) => context.changes.push(state),
    });
    guards.push(guard);
    const lifts = vi.fn();
    guard.onLift(lifts);
    return { ...context, guard, lifts };
  }

  it("ends a day's pause at local midnight", () => {
    const { guard, world, lifts, changes } = timed({ daySpendCap: 30 });
    world.totalsAt = (now) => ({
      ...empty(),
      day: { cost: now < MIDNIGHT ? 30 : 0, calls: 0, unmetered: 0 },
    });
    expect(() => guard.admit("turn-end")).toThrow(SpendCapError);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(MIDNIGHT - START - 1);
    expect(lifts).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lifts).toHaveBeenCalledTimes(1);
    expect(changes.map((state) => state.level)).toEqual(["capped", "ok"]);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => guard.admit("turn-end")).not.toThrow();
  });

  it("looks again every minute while the rolling hour is over its cap", () => {
    const { guard, world, lifts } = timed({
      hourSpendCap: 10,
      daySpendCap: 30,
    });
    const clears = START + 150_000;
    world.totalsAt = (now) => ({
      ...empty(),
      hour: { cost: now < clears ? 10 : 9.5, calls: 0, unmetered: 0 },
    });
    guard.observe();
    vi.advanceTimersByTime(120_000);
    expect(lifts).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(lifts).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps waiting on the hour when the day clears first", () => {
    const { guard, world, lifts, changes } = timed({
      hourCallsCap: 500,
      daySpendCap: 30,
    });
    world.now = MIDNIGHT - 90_000;
    vi.setSystemTime(world.now);
    world.totalsAt = (now) => ({
      ...empty(),
      hour: { cost: 0, calls: 500, unmetered: 500 },
      day: { cost: now < MIDNIGHT ? 30 : 0, calls: 0, unmetered: 0 },
    });
    guard.observe();
    vi.advanceTimersByTime(10 * 60_000);
    expect(lifts).not.toHaveBeenCalled();
    expect(changes.map((state) => state.level)).toEqual(["capped"]);
    expect(guard.status().limits.map((l) => [l.key, l.level])).toEqual([
      ["daySpend", "ok"],
      ["hourCalls", "capped"],
    ]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("sets no timer below a cap", () => {
    const { guard, world } = timed({ daySpendWarn: 10, daySpendCap: 30 });
    world.totals.day.cost = 29.99;
    guard.observe();
    expect(guard.status().level).toBe("warning");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops watching and telling once disposed", () => {
    const { guard, world, lifts, changes } = timed({ hourSpendCap: 10 });
    world.totals.hour.cost = 10;
    guard.observe();
    expect(vi.getTimerCount()).toBe(1);
    guard.dispose();
    expect(vi.getTimerCount()).toBe(0);
    world.totals.hour.cost = 0;
    vi.advanceTimersByTime(10 * 60_000);
    expect(lifts).not.toHaveBeenCalled();
    expect(changes.map((state) => state.level)).toEqual(["capped"]);
    // A read after disposal still answers, without a new timer.
    world.totals.hour.cost = 10;
    expect(guard.status().level).toBe("capped");
    expect(vi.getTimerCount()).toBe(0);
  });
});
