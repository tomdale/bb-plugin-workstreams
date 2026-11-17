import { expect, it } from "vitest";
import {
  HYBRID_FRACTION,
  Handoff,
  LATCH_GAP,
  type HandoffConfig,
} from "../../src/app/headingHandoff.ts";

const config = (over: Partial<HandoffConfig> = {}): HandoffConfig => ({
  drive: "hybrid",
  follow: "direct",
  runway: 360,
  latchAt: 48,
  settle: 700,
  ...over,
});

/** Run the springs for `ms` in 16 ms frames. */
function run(handoff: Handoff, ms: number) {
  for (let left = ms; left > 0; left -= 16) handoff.tick(Math.min(16, left));
}

it("follows the scroll over its runway when driven directly", () => {
  const handoff = new Handoff(config({ drive: "scroll" }));
  handoff.reset(0);
  expect(handoff.progress).toBe(0);
  handoff.scroll(90);
  expect(handoff.progress).toBeCloseTo(0.25);
  handoff.scroll(1000);
  expect(handoff.progress).toBe(1);
  expect(handoff.moving).toBe(false);
});

it("chases the scroll through a spring when eased", () => {
  const handoff = new Handoff(config({ drive: "scroll", follow: "eased" }));
  handoff.reset(0);
  handoff.scroll(180);
  expect(handoff.progress).toBe(0);
  expect(handoff.moving).toBe(true);
  run(handoff, 100);
  expect(handoff.progress).toBeGreaterThan(0);
  expect(handoff.progress).toBeLessThan(0.5);
  run(handoff, 3000);
  expect(handoff.progress).toBeCloseTo(0.5);
  expect(handoff.moving).toBe(false);
});

it("tracks the scroll to the latch point, drawn the moment it moves", () => {
  const handoff = new Handoff(config());
  handoff.reset(0);
  handoff.scroll(24);
  expect(handoff.progress).toBeCloseTo(HYBRID_FRACTION / 2);
  handoff.scroll(47);
  expect(handoff.progress).toBeCloseTo((HYBRID_FRACTION * 47) / 48);
});

it("springs to 1 from the latch point without overshooting", () => {
  const handoff = new Handoff(config());
  handoff.reset(0);
  handoff.scroll(47);
  handoff.scroll(48);
  expect(handoff.moving).toBe(true);
  let previous = handoff.progress;
  for (let frame = 0; frame < 120; frame++) {
    run(handoff, 16);
    expect(handoff.progress).toBeGreaterThanOrEqual(previous - 1e-9);
    expect(handoff.progress).toBeLessThanOrEqual(1 + 1e-6);
    previous = handoff.progress;
  }
  expect(handoff.progress).toBe(1);
  expect(handoff.moving).toBe(false);
});

it("settles in about the configured time", () => {
  for (const settle of [400, 700, 1200]) {
    const handoff = new Handoff(config({ settle }));
    handoff.reset(0);
    handoff.scroll(48);
    let elapsed = 0;
    while (handoff.progress < 0.98 && elapsed < 5000) {
      run(handoff, 4);
      elapsed += 4;
    }
    // Progress starts partway from the push the latch gives it, so it reaches
    // 98% no later than the spring's own settle time.
    expect(elapsed).toBeLessThanOrEqual(settle + 8);
    expect(elapsed).toBeGreaterThan(settle * 0.5);
  }
});

it("carries the speed the reader scrolled at into the spring", () => {
  const slow = new Handoff(config());
  const fast = new Handoff(config());
  for (const handoff of [slow, fast]) handoff.reset(0);
  // Scroll 47 px in 160 ms against 16 ms, one frame each.
  for (let frame = 1; frame <= 10; frame++) {
    slow.scroll((47 * frame) / 10);
    slow.tick(16);
  }
  for (let frame = 1; frame <= 2; frame++) {
    fast.scroll((47 * frame) / 2);
    fast.tick(16);
  }
  slow.scroll(48);
  fast.scroll(48);
  run(slow, 100);
  run(fast, 100);
  expect(fast.progress).toBeGreaterThan(slow.progress);
});

it("reverses at the release point, a few pixels below the latch", () => {
  const handoff = new Handoff(config());
  handoff.reset(0);
  handoff.scroll(48);
  run(handoff, 2000);
  expect(handoff.progress).toBe(1);
  // Within the dead band the handoff stays committed.
  handoff.scroll(48 - LATCH_GAP + 1);
  run(handoff, 200);
  expect(handoff.progress).toBe(1);
  handoff.scroll(48 - LATCH_GAP);
  expect(handoff.moving).toBe(true);
  run(handoff, 4000);
  expect(handoff.progress).toBeCloseTo(
    HYBRID_FRACTION * ((48 - LATCH_GAP) / 48),
  );
  handoff.scroll(0);
  run(handoff, 4000);
  expect(handoff.progress).toBe(0);
});

it("starts latched when it begins past the latch point", () => {
  const handoff = new Handoff(config());
  handoff.reset(500);
  expect(handoff.progress).toBe(1);
  expect(handoff.moving).toBe(false);
});

it("latches to 1 and back with the latch drive", () => {
  const handoff = new Handoff(config({ drive: "latch" }));
  handoff.reset(0);
  handoff.scroll(30);
  run(handoff, 1000);
  expect(handoff.progress).toBe(0);
  handoff.scroll(48);
  run(handoff, 2000);
  expect(handoff.progress).toBe(1);
  handoff.scroll(48 - LATCH_GAP);
  run(handoff, 2000);
  expect(handoff.progress).toBe(0);
});
