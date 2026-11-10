import { expect, it } from "vitest";
import {
  PHONE_QUERY,
  SUBTITLE_LINE,
  SUBTITLE_SIZE,
  compactBlock,
  COMPACT_GAP,
  eyebrowMetrics,
  headingBackdropOpacity,
  headingFade,
  headingHeight,
  headingOpacity,
  headingScroll,
  headingScrollLimit,
  MIN_TITLE_BAR_WIDTH,
  pinnedHeight,
  pinnedStep,
  pinnedTitleScale,
  titleBarSlot,
  titleExitDistance,
} from "../../src/app/goalHeading.ts";

const BASE = 16;

it("keeps the workstream line one size and one height on a phone", () => {
  const phone = eyebrowMetrics(BASE, true);
  expect(phone.compactScale).toBe(1);
  // One line box at one reading size, with only the gap under it added: the
  // line never moves or changes size between states.
  expect(phone.compactBlock).toBeCloseTo(phone.size * 1.2 + BASE * COMPACT_GAP);
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

it("gives the compact line the room its own box needs", () => {
  const phone = eyebrowMetrics(BASE, true);
  const desktop = eyebrowMetrics(BASE, false);
  // The taller phone line leaves more room for the title under it.
  expect(phone.compactBlock).toBeGreaterThan(desktop.compactBlock);
  // Away from a phone the 16px wave icon is taller than the text beside it,
  // so it, scaled with the line, sets that block.
  expect(desktop.compactBlock).toBeCloseTo(
    16 * desktop.compactScale + BASE * COMPACT_GAP,
  );
});

it("keeps every wrapped title line in the pinned plate", () => {
  const one = pinnedHeight(BASE, null, 1);
  expect(
    Math.abs(pinnedHeight(BASE, null, 2) - one - BASE * 0.95 * (4 / 3)),
  ).toBeLessThan(1);
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

it("gives the fade a longer scroll handoff than the slide", () => {
  const distance = titleExitDistance(BASE, eyebrowMetrics(BASE, false), 1);
  const halfway = headingScrollLimit(distance, "fade") / 2;
  expect(headingScrollLimit(distance, "fade")).toBeCloseTo(distance * 3.5);
  expect(headingScroll(halfway, distance, "fade").progress).toBeCloseTo(
    headingScroll(headingScrollLimit(distance) / 2, distance).progress,
  );
  expect(headingScroll(halfway, distance, "fade").progress).toBeLessThan(1);
  expect(headingScroll(100, distance, "fade", 100).progress).toBe(1);
  expect(headingScroll(0, distance, "fade", 0).progress).toBe(1);
});

it("eases a small retreat and rise through the fade", () => {
  expect(headingFade(0)).toEqual({
    expanded: { opacity: 1, y: 0, scale: 1 },
    compact: { opacity: 0, y: 4, scale: 0.99 },
  });
  expect(headingFade(0.5)).toEqual({
    expanded: { opacity: 0.5, y: -1.5, scale: 0.995 },
    compact: { opacity: 0.5, y: 2, scale: 0.995 },
  });
  expect(headingFade(1)).toEqual({
    expanded: { opacity: 0, y: -3, scale: 0.99 },
    compact: { opacity: 1, y: 0, scale: 1 },
  });
  expect(headingFade(0.25).compact.opacity).toBeLessThan(0.25);
  expect(headingFade(0.75).compact.opacity).toBeGreaterThan(0.75);
});

it("scales one pinned title directly to its compact size", () => {
  expect(pinnedTitleScale(0)).toBe(1);
  expect(pinnedTitleScale(1)).toBeCloseTo(0.95 / 1.5);
  expect(pinnedTitleScale(0.5)).toBeCloseTo((1 + 0.95 / 1.5) / 2);
});

it("keeps the eased fade but removes spatial motion when asked", () => {
  expect(headingFade(0.5, false)).toEqual({
    expanded: { opacity: 0.5, y: 0, scale: 1 },
    compact: { opacity: 0.5, y: 0, scale: 1 },
  });
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

it("holds a pinned heading whole until the title has scrolled out, then steps", () => {
  const distance = titleExitDistance(BASE, eyebrowMetrics(BASE, false), 1);
  expect(pinnedStep(0, distance)).toBe(0);
  expect(pinnedStep(distance - 1, distance)).toBe(0);
  // One state either side of the threshold: the scroll position picks the
  // state rather than driving the scale with it.
  expect(pinnedStep(distance, distance)).toBe(1);
  expect(pinnedStep(distance * 4, distance)).toBe(1);
  // A wrapped title moves the threshold with the space it takes.
  const wrapped = titleExitDistance(BASE, eyebrowMetrics(BASE, false), 2);
  expect(pinnedStep(distance, wrapped)).toBe(0);
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
