import { expect, it } from "vitest";
import {
  PHONE_QUERY,
  SUBTITLE_LINE,
  SUBTITLE_SIZE,
  compactBlock,
  eyebrowMetrics,
  headingBackdropOpacity,
  headingHeight,
  headingOpacity,
  headingScroll,
  MIN_TITLE_BAR_WIDTH,
  pinnedHeight,
  titleBarSlot,
  titleExitDistance,
} from "../../src/app/goalHeading.ts";

const BASE = 16;

it("keeps the workstream line one size and one height on a phone", () => {
  const phone = eyebrowMetrics(BASE, true);
  expect(phone.compactScale).toBe(1);
  // The compact heading reserves the same room for it as the expanded one,
  // so the line never moves between states.
  expect(phone.compactBlock).toBe(phone.expandedBlock);
});

it("sets the phone workstream line in BB's phone secondary size", () => {
  // `--text-xs` is 14px on phones, over the 12.8px (0.8 x 16) it has elsewhere.
  expect(eyebrowMetrics(BASE, true).size).toBe(14);
  expect(eyebrowMetrics(BASE, true).size).toBeGreaterThan(
    eyebrowMetrics(BASE, false).size,
  );
});

it("still shrinks the workstream line in the title bar away from a phone", () => {
  const desktop = eyebrowMetrics(BASE, false);
  expect(desktop.size).toBeCloseTo(12.8);
  expect(desktop.compactScale).toBeLessThan(1);
  expect(desktop.compactBlock).toBeLessThan(desktop.expandedBlock);
});

it("makes the pinned plate taller by the room the larger phone line needs", () => {
  const phone = pinnedHeight(BASE, eyebrowMetrics(BASE, true));
  const desktop = pinnedHeight(BASE, eyebrowMetrics(BASE, false));
  // The line reserves 20px on a phone instead of 10px in the title bar.
  expect(phone - desktop).toBe(10);
});

it("leaves the room reserved for a heading with no workstream alone", () => {
  expect(compactBlock(BASE, null)).toBeCloseTo(BASE * 0.95 * (4 / 3));
  expect(headingHeight(BASE, false, 1, 1)).toBeLessThan(
    headingHeight(BASE, true, 1, 1),
  );
  expect(headingHeight(BASE, true, 2, 1)).toBeGreaterThan(
    headingHeight(BASE, true, 1, 1),
  );
});

it("reserves only the goal's visible lines", () => {
  for (const base of [14, 16, 20]) {
    const line = base * SUBTITLE_SIZE * SUBTITLE_LINE;
    const without = headingHeight(base, true, 1, 0);
    for (const lines of [1, 2, 3]) {
      expect(
        Math.abs(headingHeight(base, true, 1, lines) - without - line * lines),
      ).toBeLessThan(1);
    }
  }
});

it("eases both copies together over a longer scroll and reaches both boundaries", () => {
  const distance = titleExitDistance(BASE, eyebrowMetrics(BASE, false), 1);
  const travel = distance * 2.5;
  const start = headingScroll(0, distance);
  const early = headingScroll(travel * 0.25, distance);
  const halfway = headingScroll(travel * 0.5, distance);
  const late = headingScroll(travel * 0.75, distance);
  const finish = headingScroll(travel, distance);
  expect(start).toEqual({ moved: 0, remaining: distance, progress: 0 });
  expect(early.progress).toBeCloseTo(0.2265625);
  expect(late.progress).toBeCloseTo(0.8671875);
  expect(early.moved + early.remaining).toBeCloseTo(distance);
  expect(halfway.progress).toBeCloseTo(0.5625);
  expect(finish).toEqual({ moved: distance, remaining: 0, progress: 1 });
  expect(headingScroll(travel + 50, distance)).toEqual(finish);
  expect(headingScroll(-10, distance)).toEqual(start);
});

it("slows to a stop at the shared endpoint without overshooting", () => {
  const distance = titleExitDistance(BASE, eyebrowMetrics(BASE, false), 1);
  const travel = distance * 2.5;
  const before = headingScroll(travel * 0.98, distance);
  const almost = headingScroll(travel * 0.99, distance);
  const finish = headingScroll(travel, distance);
  expect(before.progress).toBeLessThan(almost.progress);
  expect(almost.progress).toBeLessThan(finish.progress);
  expect(finish.progress - almost.progress).toBeLessThan(
    (almost.progress - before.progress) * 0.4,
  );
  for (let step = 0; step <= 100; step++) {
    const state = headingScroll((travel * step) / 100, distance);
    expect(state.progress).toBeGreaterThanOrEqual(0);
    expect(state.progress).toBeLessThanOrEqual(1);
    expect(state.moved + state.remaining).toBeCloseTo(distance);
  }
});

it("eases the outgoing and incoming opacity independently", () => {
  expect(headingOpacity(0)).toEqual({ expanded: 1, compact: 0 });
  expect(headingOpacity(0.25)).toEqual({ expanded: 0.9375, compact: 0.4375 });
  expect(headingOpacity(0.75)).toEqual({ expanded: 0.4375, compact: 0.9375 });
  expect(headingOpacity(1)).toEqual({ expanded: 0, compact: 1 });
});

it("keeps the backdrop opaque through the crossfade and clears it at the end", () => {
  expect(headingBackdropOpacity(0)).toBe(1);
  expect(headingBackdropOpacity(0.5)).toBeGreaterThan(0.99);
  expect(headingBackdropOpacity(0.9)).toBeGreaterThan(
    headingOpacity(0.9).expanded,
  );
  expect(headingBackdropOpacity(1)).toBe(0);
});

it("accounts for a two-line phone title before finishing the reveal", () => {
  const eyebrow = eyebrowMetrics(BASE, true);
  expect(
    titleExitDistance(BASE, eyebrow, 2) - titleExitDistance(BASE, eyebrow, 1),
  ).toBeCloseTo((BASE * 1.5 * 4) / 3);
});

it("uses BB's own phone condition", () => {
  expect(PHONE_QUERY).toBe("(max-width: 767px) and (pointer: coarse)");
});

const BAR = { left: 0, right: 900 };

it("fills the title bar's gap when the minimized title is left aligned", () => {
  // Between the thread's own controls on the left and the actions on the right.
  expect(titleBarSlot(BAR, 80, 700, false)).toEqual({ x: 96, width: 588 });
});

it("takes an even span around the bar's middle when centered", () => {
  // The nearer control decides the span, so the title stays centered.
  expect(titleBarSlot(BAR, 80, 700, true)).toEqual({ x: 216, width: 468 });
  // A leading control that reaches further inwards shortens both sides.
  expect(titleBarSlot(BAR, 300, 700, true)).toEqual({ x: 316, width: 268 });
});

it("leaves the compact title in the timeline when the bar is too narrow", () => {
  const tight = { left: 0, right: MIN_TITLE_BAR_WIDTH + 60 };
  expect(titleBarSlot(tight, 60, tight.right, false)).toBeNull();
  expect(titleBarSlot(tight, 60, tight.right, true)).toBeNull();
  // Centering loses room to both sides, so a bar with a wide leading cluster
  // has no middle span left even though its gap fits the title.
  expect(titleBarSlot(BAR, 400, 700, false)).toEqual({ x: 416, width: 268 });
  expect(titleBarSlot(BAR, 400, 700, true)).toBeNull();
});
