import { describe, expect, it } from "vitest";
import { Drum, QUEUE_CFG } from "../../../src/app/page/queue/drum.ts";
import { StackEngine } from "../../../src/app/page/queue/stackEngine.ts";
import { ringSway } from "../../../src/app/page/queue/ring.ts";

describe("selected queue motion", () => {
  it("uses the complete selected lab drum configuration", () => {
    expect(Drum.config(QUEUE_CFG)).toEqual({
      ...Drum.config(),
      ramp: true,
      loose: true,
      vcap: 44 * 60,
      coverFade: 0.25,
      tempo: { ...Drum.config().tempo, kind: "constant", ms: 120 },
    });
  });

  it("keeps preceding cards on the ring for repeated returns", () => {
    const keys = Array.from({ length: 24 }, (_, i) => String(i));
    const heights = keys.map((_, i) => (i % 2 ? 73 : 284));
    const drum = new Drum(heights, QUEUE_CFG);
    const engine = new StackEngine();
    engine.setHeights(new Map(keys.map((key, i) => [key, heights[i]!])));
    let at = 11;
    const sync = (instant = false) =>
      engine.sync(
        keys.slice(at, at + 4),
        "back",
        instant,
        at > 0,
        keys.slice(Math.max(0, at - 2), at),
      );
    sync(true);
    drum.jump(at);
    drum.keyDown(-1);
    engine.hold("back");
    at--;
    sync();
    let next = 250;
    for (let n = 0; n < 100; n++) {
      const t = (n * 1000) / 60;
      while (next <= t + 1e-6 && at > 0) {
        drum.press(-1);
        if (engine.accept("back")) {
          at--;
          sync();
        }
        next += 25;
      }
      drum.step(1000 / 60);
      engine.step(1 / 60);
      const frame = engine.frame();
      expect(frame.front).toBe(String(drum.front));
      for (const card of frame.cards.filter((c) => c.painted)) {
        const ref = drum.views()[Number(card.key)]!;
        // The reference is driven on the repeat grid, a hair off the engine's
        // steps, so a card still arriving at the stack's parked coordinate may
        // count as painted in one and not the other.
        if (Math.abs(ref.c + 2) > 0.02) expect(ref.painted).toBe(true);
        expect(Math.abs(34 + card.scale * card.y - ref.top)).toBeLessThan(1);
      }
    }
  });

  it("draws a moving card on the selected path and banks about its top", () => {
    const engine = new StackEngine();
    engine.setHeights(
      new Map([
        ["a", 180],
        ["b", 90],
        ["c", 300],
      ]),
    );
    engine.sync(["a", "b", "c"], undefined, true);
    engine.sync(["b", "c"], "forward");
    engine.step(0.1);
    const card = engine.frame().cards.find((c) => c.key === "a")!;
    const drum = engine as unknown as { drum: Drum };
    const u = -drum.drum.c[0]!;
    const x = ringSway(
      {
        kind: "drum",
        front: 0,
        turn: 0,
        tuck: 0,
        sway: {
          front: 24,
          behind: -11,
          peak: 0.45,
          peakBehind: 0.4,
          cross: -0.05,
        },
      },
      u,
    );
    expect(card.x).toBeCloseTo(x, 8);
    expect(Math.abs(card.x)).toBeGreaterThan(0);
    expect(card.bank).toBeCloseTo(-x / 24, 8);
  });
});
