import { describe, expect, it } from "vitest";
import {
  bucketStart,
  evaluateLimits,
  rangeBounds,
  windowResetsAt,
  windowStart,
  type UsageLimits,
  type UsageTotalsByWindow,
} from "../../src/domain/usage.ts";

const NOON = new Date(2026, 4, 14, 12, 30).getTime();
const HOUR = 3_600_000;

const none = { warn: null, cap: null };
const totals = (
  hour: [number, number],
  day: [number, number] = hour,
  month: [number, number] = day,
): UsageTotalsByWindow => ({
  hour: { cost: hour[0], calls: hour[1], unmetered: 0 },
  day: { cost: day[0], calls: day[1], unmetered: 0 },
  month: { cost: month[0], calls: month[1], unmetered: 0 },
});

describe("windows", () => {
  it("starts the day at local midnight and the month on the first", () => {
    expect(windowStart("day", NOON)).toBe(new Date(2026, 4, 14).getTime());
    expect(windowStart("month", NOON)).toBe(new Date(2026, 4, 1).getTime());
    expect(windowStart("hour", NOON)).toBe(NOON - HOUR);
  });

  it("resets at the next boundary, an hour out for the rolling hour", () => {
    expect(windowResetsAt("day", NOON)).toBe(new Date(2026, 4, 15).getTime());
    expect(windowResetsAt("month", NOON)).toBe(new Date(2026, 5, 1).getTime());
    expect(windowResetsAt("hour", NOON)).toBe(NOON + HOUR);
  });

  it("aligns buckets to local time and ranges to a whole first bucket", () => {
    const midnight = new Date(2026, 4, 14).getTime();
    expect(bucketStart(NOON, 24 * HOUR)).toBe(midnight);
    expect(bucketStart(NOON, HOUR)).toBe(new Date(2026, 4, 14, 12).getTime());
    const { from, bucketMs } = rangeBounds("30d", NOON);
    expect(bucketMs).toBe(24 * HOUR);
    expect(from).toBeLessThanOrEqual(NOON - 30 * 24 * HOUR);
    expect(NOON - from).toBeLessThan(31 * 24 * HOUR + HOUR);
  });
});

describe("evaluateLimits", () => {
  const limits = (patch: Partial<UsageLimits>): UsageLimits => ({
    hourSpend: none,
    daySpend: none,
    monthSpend: none,
    hourCalls: none,
    ...patch,
  });

  it("lists only the limits that have a threshold", () => {
    expect(evaluateLimits(limits({}), totals([1, 1]), NOON)).toEqual({
      level: "ok",
      limits: [],
    });
  });

  it("warns at the warn threshold and caps at the cap, inclusive", () => {
    const set = limits({ daySpend: { warn: 5, cap: 10 } });
    expect(evaluateLimits(set, totals([0, 0], [4.99, 9]), NOON).level).toBe(
      "ok",
    );
    expect(evaluateLimits(set, totals([0, 0], [5, 9]), NOON).level).toBe(
      "warning",
    );
    const capped = evaluateLimits(set, totals([0, 0], [10, 9]), NOON);
    expect(capped.level).toBe("capped");
    expect(capped.limits[0]).toMatchObject({
      key: "daySpend",
      window: "day",
      metric: "spend",
      used: 10,
      level: "capped",
      resetsAt: new Date(2026, 4, 15).getTime(),
      resumedUntil: null,
    });
  });

  it("counts calls for the calls limit, whatever their cost", () => {
    const set = limits({ hourCalls: { warn: null, cap: 500 } });
    const state = evaluateLimits(set, totals([0, 500]), NOON);
    expect(state.level).toBe("capped");
    expect(state.limits[0]).toMatchObject({ metric: "calls", used: 500 });
  });

  it("lets a resumed window's cap through but keeps the warning", () => {
    const set = limits({
      hourSpend: { warn: 2, cap: 4 },
      daySpend: { warn: null, cap: 20 },
    });
    const state = evaluateLimits(set, totals([5, 5], [25, 25]), NOON, {
      hour: NOON + HOUR,
    });
    expect(state.limits.map((s) => [s.key, s.level])).toEqual([
      ["hourSpend", "warning"],
      ["daySpend", "capped"],
    ]);
    expect(state.limits[0]?.resumedUntil).toBe(NOON + HOUR);
    expect(state.level).toBe("capped");
  });

  it("ignores a resume that has ended", () => {
    const set = limits({ hourSpend: { warn: null, cap: 4 } });
    expect(
      evaluateLimits(set, totals([5, 5]), NOON, { hour: NOON - 1 }).level,
    ).toBe("capped");
  });
});
