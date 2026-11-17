import { expect, it } from "vitest";
import {
  CHOREOGRAPHED,
  CURVES,
  RACK,
  choreograph,
  choreographyOf,
  crossfade,
  handoffFor,
  reserveGap,
  featherCover,
  isChoreographed,
  runway,
  shadowPaint,
  shadowStrength,
  shadowTuning,
  type Choreographed,
  type HeadingLayout,
} from "../../src/app/headingChoreography.ts";

/** A desktop heading at the 14px body size: a workstream, a one-line title, a three-line summary. */
const layout: HeadingLayout = {
  base: 14,
  rest: { eyebrow: 11.9, title: 29.4, goal: 57.4 },
  bar: { eyebrow: -38, title: -22 },
  slot: { titleX: 200, eyebrowX: 200, titleWidth: 300 },
  heights: { eyebrow: 16, title: 28, goal: 54 },
  paneWidth: 600,
  exit: 57.4,
  wrapped: false,
  hasEyebrow: true,
  hasGoal: true,
  eyebrowScale: 0.82,
  letters: 20,
};

it("knows the six choreographed transitions and none of the others", () => {
  expect(CHOREOGRAPHED).toEqual([
    "current",
    "morph",
    "stagger",
    "flip",
    "rack",
    "cascade",
  ]);
  expect(isChoreographed("rack")).toBe(true);
  expect(isChoreographed("fade")).toBe(false);
  // The Scroll setting draws the current transition; Fade has no choreography.
  expect(choreographyOf("scroll")).toBe("current");
  expect(choreographyOf("morph")).toBe("morph");
  expect(choreographyOf("fade")).toBeNull();
});

it.each(CHOREOGRAPHED)(
  "%s starts on the expanded heading and ends in the bar",
  (kind) => {
    const start = choreograph(kind, 0, layout);
    expect(start.expanded.title.y).toBe(layout.rest.title);
    expect(start.expanded.goal?.opacity).toBe(1);
    const end = choreograph(kind, 1, layout);
    expect(end.expanded.goal?.opacity).toBe(0);
    if (kind === "morph") {
      // One title travels: it ends in the bar slot, at the bar title's size.
      expect(end.expanded.title.x).toBeCloseTo(layout.slot.titleX);
      expect(end.expanded.title.y).toBeCloseTo(layout.bar.title);
      expect(end.expanded.title.scale).toBeCloseTo(0.95 / 1.5);
    } else if (kind === "current") {
      expect(end.expanded.title.y).toBeCloseTo(layout.rest.title - layout.exit);
      expect(end.compact.title.y).toBeCloseTo(layout.bar.title);
      expect(end.expanded.title.opacity).toBe(0);
      expect(end.compact.title.opacity).toBe(1);
      expect(start.compact.title.y).toBeCloseTo(layout.bar.title + layout.exit);
    } else if (kind === "cascade") {
      // The letters carry the opacity; their boxes stay put.
      expect(start.letters!.expanded.every((l) => l.opacity === 1)).toBe(true);
      expect(start.letters!.compact.every((l) => l.opacity === 0)).toBe(true);
      expect(end.letters!.expanded.every((l) => l.opacity === 0)).toBe(true);
    } else {
      expect(start.expanded.title.opacity).toBe(1);
      expect(start.compact.title.opacity).toBe(0);
      expect(end.expanded.title.opacity).toBe(0);
      expect(end.compact.title.opacity).toBe(1);
      expect(end.compact.title.y).toBeCloseTo(layout.bar.title);
      expect(end.compact.title.rotateX).toBe(0);
    }
  },
);

it("never leaves both titles unreadable in Rack focus at the tuned timing", () => {
  let weakest = 1;
  for (let i = 0; i <= 200; i++) {
    const pose = choreograph("rack", i / 200, layout);
    const sharp = (blur: number) => 1 / (1 + (blur / 3) ** 2);
    const leaving =
      pose.expanded.title.opacity * sharp(pose.expanded.title.blur);
    const arriving =
      pose.compact.title.opacity * sharp(pose.compact.title.blur);
    weakest = Math.min(weakest, Math.max(leaving, arriving));
  }
  // Tuned for the better of the two to stay at least a third legible.
  expect(weakest).toBeGreaterThan(0.33);
});

it("recedes the leaving title and grows the arriving one in Rack focus", () => {
  const mid = choreograph("rack", 0.55, layout);
  expect(mid.expanded.title.scale).toBeLessThan(1);
  expect(mid.expanded.title.scale).toBeGreaterThan(RACK.leaveScale);
  expect(mid.expanded.title.blur).toBeGreaterThan(0);
  const early = choreograph("rack", 0.2, layout);
  expect(early.compact.title.scale).toBeGreaterThanOrEqual(RACK.arriveScale);
  expect(early.compact.title.scale).toBeLessThan(1);
  expect(early.compact.title.blur).toBeGreaterThan(0);
  expect(choreograph("rack", 1, layout).compact.title.scale).toBe(1);
});

it("settles Rack focus's workstream line where every other transition does", () => {
  // Rack focus scales about each line's middle; the line rests at a reduced
  // scale, so its box is lifted for its top edge to land where a top-left pivot
  // leaves it.
  const rack = choreograph("rack", 1, layout).compact.eyebrow!;
  const stagger = choreograph("stagger", 1, layout).compact.eyebrow!;
  const heightGiven = layout.heights.eyebrow * (1 - layout.eyebrowScale);
  const rackTop = rack.y + heightGiven / 2; // the middle pivot puts the top this far lower
  expect(rackTop).toBeCloseTo(stagger.y);
  expect(rack.scale).toBeCloseTo(stagger.scale);
});

it("moves a wrapped Morph title at its own width and hands off near the end", () => {
  const wrapped = { ...layout, wrapped: true };
  const mid = choreograph("morph", 0.5, wrapped);
  expect(mid.expanded.title.width).toBeNull();
  expect(mid.compact.title.opacity).toBe(0);
  const late = choreograph("morph", 0.95, wrapped);
  expect(late.compact.title.opacity).toBeGreaterThan(0);
  expect(late.expanded.title.opacity).toBeLessThan(1);
  const single = choreograph("morph", 0.5, layout);
  expect(single.expanded.title.width).not.toBeNull();
});

it("rises Cascade's letters in turn and brings the new ones up behind", () => {
  const pose = choreograph("cascade", 0.3, layout);
  const leaving = pose.letters!.expanded;
  expect(leaving).toHaveLength(layout.letters);
  expect(leaving[0]!.opacity).toBeLessThan(leaving.at(-1)!.opacity);
  expect(leaving[0]!.y).toBeLessThan(0);
  const arriving = pose.letters!.compact;
  expect(arriving[0]!.opacity).toBeGreaterThan(arriving.at(-1)!.opacity);
  expect(
    choreograph("cascade", 1, layout).letters!.compact.every(
      (l) => l.opacity === 1 && l.y === 0,
    ),
  ).toBe(true);
});

it("turns Flip's lines edge-on, summary first, and hides them past 90 degrees", () => {
  const early = choreograph("flip", 0.2, layout);
  expect(early.expanded.goal!.rotateX).toBeLessThan(
    early.expanded.title.rotateX,
  );
  const done = choreograph("flip", 1, layout);
  expect(done.expanded.title.opacity).toBe(0);
  expect(done.expanded.title.rotateX).toBe(-90);
});

it("scrolls over a runway that scales with the body size", () => {
  expect(runway(14)).toBe(360);
  expect(runway(16)).toBeCloseTo(411.43, 1);
});

it("fades the shadows on each transition's own tuning", () => {
  const rack = shadowTuning("rack");
  const shared = shadowTuning("morph");
  expect(rack.fadeOut).toEqual({ from: 0.4, to: 0.77, curve: "slow" });
  expect(shared.fadeOut.to).toBe(0.89);
  for (const kind of CHOREOGRAPHED as readonly Choreographed[]) {
    expect(shadowStrength(shadowTuning(kind), 0)).toBe(1);
    expect(shadowStrength(shadowTuning(kind), 1)).toBe(0);
  }
  expect(shadowStrength(rack, 0.4)).toBe(1);
  expect(shadowStrength(rack, 0.77)).toBe(0);
  expect(shadowStrength(rack, 0.6)).toBeCloseTo(1 - (0.2 / 0.37) ** 2);
});

it("shortens each shadow as the handoff runs and drops it once faded", () => {
  const tuning = shadowTuning("rack");
  const shadow = { bottom: 80, visible: 1 };
  const full = shadowPaint(tuning, 0, shadow)!;
  expect(full.solid).toBeCloseTo(80 + tuning.solidEdge);
  expect(full.feather).toBe(tuning.length);
  const late = shadowPaint(tuning, 0.7, shadow)!;
  expect(late.solid).toBeLessThan(full.solid);
  expect(late.solid).toBeGreaterThan(full.solid * tuning.collapse.solidKept);
  expect(late.feather).toBeLessThan(full.feather);
  expect(shadowPaint(tuning, 0.9, shadow)).toBeNull();
});

it("holds the feather opaque before it falls away", () => {
  const tuning = shadowTuning("rack");
  expect(featherCover(tuning, 0)).toBe(1);
  expect(featherCover(tuning, tuning.hold)).toBe(1);
  expect(featherCover(tuning, 1)).toBe(0);
  expect(featherCover(tuning, 0.5)).toBeGreaterThan(0);
  expect(featherCover(tuning, 0.5)).toBeLessThan(1);
});

it("falls every curve from 1 to 0", () => {
  for (const curve of Object.values(CURVES)) {
    expect(curve(0)).toBeCloseTo(1);
    expect(curve(1)).toBeCloseTo(0);
  }
});

it("slides the current transition's copies through the exit distance together", () => {
  const mid = choreograph("current", 0.5, layout);
  expect(mid.expanded.title.y).toBeCloseTo(layout.rest.title - layout.exit / 2);
  expect(mid.compact.title.y).toBeCloseTo(layout.bar.title + layout.exit / 2);
  expect(mid.expanded.title.opacity).toBeCloseTo(0.75);
  expect(mid.compact.title.opacity).toBeCloseTo(0.75);
  // Driven straight from the scroll it eases in step with the scroll position.
  const eased = choreograph("current", 0.5, layout, RACK, true);
  expect(eased.progress).toBeCloseTo(0.5625);
});

it("crosses the lines in place for reduced motion", () => {
  expect(crossfade(0, layout).expanded.title.opacity).toBe(1);
  const mid = crossfade(0.5, layout);
  expect(mid.expanded.title.y).toBe(layout.rest.title);
  expect(mid.compact.title.y).toBe(layout.bar.title);
  expect(mid.expanded.title.opacity).toBeCloseTo(0.5);
  expect(mid.compact.title.opacity).toBeCloseTo(0.5);
  const end = crossfade(1, layout);
  expect(end.expanded.goal?.opacity).toBe(0);
  expect(end.compact.title.opacity).toBe(1);
});

it("keeps the heading's height above the first message while it shows, then a fixed gap", () => {
  const height = 104;
  expect(reserveGap(14, height, choreograph("rack", 0, layout))).toBe(height);
  const gone = reserveGap(14, height, choreograph("rack", 1, layout));
  expect(gone).toBeCloseTo(14 * 1.5);
  const between = reserveGap(14, height, choreograph("rack", 0.6, layout));
  expect(between).toBeGreaterThan(gone);
  expect(between).toBeLessThan(height);
  // The gap below the heading does not depend on how many lines the summary takes.
  const taller = { ...layout, heights: { ...layout.heights, goal: 36 } };
  expect(reserveGap(14, height, choreograph("rack", 1, taller))).toBeCloseTo(
    gone,
  );
});

it("sets each transition's runway and latch for the scroll style", () => {
  const direct = handoffFor("morph", 14, 57, "direct");
  expect(direct).toMatchObject({ drive: "direct", runway: 360 });
  expect(handoffFor("morph", 14, 57, "latch")).toMatchObject({
    drive: "latch",
    latchAt: 48,
    settle: 700,
  });
  // Rack focus latches later and settles more slowly.
  expect(handoffFor("rack", 14, 57, "latch")).toMatchObject({
    latchAt: 64,
    settle: 860,
  });
  // Scroll's direct runway is 2.5 times the title's exit distance, and the distances grow with the type.
  expect(handoffFor("current", 14, 57, "direct").runway).toBeCloseTo(142.5);
  expect(handoffFor("rack", 16, 57, "direct").runway).toBeCloseTo(
    (360 * 16) / 14,
  );
  expect(handoffFor("flip", 16, 57, "latch").latchAt).toBeCloseTo(
    (48 * 16) / 14,
  );
});
