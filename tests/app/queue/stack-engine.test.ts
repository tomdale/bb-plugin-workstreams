import { describe, expect, it } from "vitest";
import {
  LEAD,
  StackEngine,
  STACK_WINDOW,
  type CardView,
  type Direction,
  type StackFrame,
} from "../../../src/app/page/queue/stackEngine.ts";

/** Six card heights, from a tall recap to a single line. */
const HEIGHTS: Record<string, number> = {
  a: 262,
  b: 92,
  c: 170,
  d: 330,
  e: 118,
  f: 150,
};
/** A long queue that cycles through those heights: a0 (tall), b1, c2, ... */
const KEYS = Array.from(
  { length: 60 },
  (_, i) => `${Object.keys(HEIGHTS)[i % 6]}${i}`,
);
const heightOf = (key: string) => HEIGHTS[key[0]!]!;
const DT = 1 / 60;

/** A card's top edge on the stage, px. */
const topOf = (c: CardView) => LEAD + c.scale * c.y;

/** A queue of `KEYS` shown through the engine, as the page drives it. */
function queue(start = 0) {
  const released: string[] = [];
  const engine = new StackEngine((key) => released.push(key));
  engine.setHeights(new Map(KEYS.map((k) => [k, heightOf(k)])));
  let at = start;
  const window = () => KEYS.slice(at, at + STACK_WINDOW);
  engine.sync(window(), undefined, false, at > 0);
  const frames: StackFrame[] = [engine.frame()];
  /** Steps the clock `ms`, calling `each` with the elapsed time before every frame. */
  const run = (ms: number, each?: (t: number) => void) => {
    for (let t = 0; t < ms; t += DT * 1000) {
      each?.(t);
      engine.step(DT);
      frames.push(engine.frame());
    }
  };
  const press = (direction: Direction) => {
    const next = at + (direction === "forward" ? 1 : -1);
    if (next < 0 || next >= KEYS.length || !engine.accept(direction))
      return false;
    at += direction === "forward" ? 1 : -1;
    engine.sync(window(), direction, false, at > 0);
    frames.push(engine.frame());
    return true;
  };
  /** The key held down for `ms` with the OS's repeat, then let go. */
  const hold = (direction: Direction, ms: number) => {
    engine.hold(direction);
    press(direction);
    let next = 250;
    run(ms, (t) => {
      if (t >= next) {
        press(direction);
        next += 33;
      }
    });
    engine.release();
  };
  const front = (frame = frames.at(-1)!) =>
    frame.cards.find((c) => c.interactive)?.key;
  return { engine, frames, run, press, hold, front, released, at: () => at };
}

const painted = (frame: StackFrame) =>
  frame.cards.filter((c) => c.painted).map((c) => c.key);

describe("the stack engine", () => {
  it("starts settled with the shown item in front and the next ones behind", () => {
    const q = queue();
    const frame = q.frames[0]!;
    expect(q.front()).toBe("a0");
    expect(frame.busy).toBe(false);
    expect(frame.replies).toEqual({ old: 0, now: 1 });
    expect(frame.height).toBe(LEAD + heightOf("a0"));
    // The front card and two peeking out; the fourth waits hidden.
    expect(painted(frame).sort()).toEqual(["a0", "b1", "c2"]);
    expect(frame.cards.map((c) => c.key).sort()).toEqual([
      "a0",
      "b1",
      "c2",
      "d3",
    ]);
  });

  it("moves on one card, lands it in front, and lets the old one go", () => {
    const q = queue();
    expect(q.press("forward")).toBe(true);
    q.run(2000);
    expect(q.front()).toBe("b1");
    expect(q.frames.at(-1)!.busy).toBe(false);
    expect(q.released).toEqual(["a0"]);
    expect(q.engine.keys().sort()).toEqual(["b1", "c2", "d3", "e4"]);
  });

  it("moves a card away through the frames and lands each at rest", () => {
    const q = queue();
    q.press("forward");
    q.run(1000);
    const keys = (f: StackFrame) => f.cards.map((c) => c.key);
    // The leaving card is on screen while it moves, and gone from the frame once released.
    expect(q.frames.some((f) => keys(f).includes("a0") && f.busy)).toBe(true);
    expect(keys(q.frames.at(-1)!)).not.toContain("a0");
  });

  it("takes a press one card at a time and drops a repeat while one waits", () => {
    const q = queue();
    expect(q.press("forward")).toBe(true);
    // The first card has not left yet, so a second press waits for it …
    q.run(DT * 1000 * 3);
    expect(q.press("forward")).toBe(true);
    // … and a third, with one already waiting, is refused.
    expect(q.press("forward")).toBe(false);
    expect(q.at()).toBe(2);
    q.run(2000);
    expect(q.front()).toBe("c2");
  });

  it("always takes a press the other way, and lands back where it began", () => {
    const q = queue(5);
    expect(q.press("forward")).toBe(true);
    expect(q.press("back")).toBe(true);
    q.run(2000);
    expect(q.front()).toBe("f5");
    expect(q.engine.keys().sort()).toEqual(["f5", "a6", "b7", "c8"].sort());
  });

  it("brings back a card it already let go, running it from behind the pile", () => {
    const q = queue(1);
    q.press("back");
    const first = q.frames.at(-1)!;
    expect(first.cards.map((c) => c.key)).toContain("a0");
    q.run(2000);
    expect(q.front()).toBe("a0");
    expect(q.released).toContain("e4");
    // It came up from below the pile: at some frame it was lower than its resting top.
    const rest = topOf(q.frames.at(-1)!.cards.find((c) => c.key === "a0")!);
    expect(
      q.frames.some((f) => {
        const card = f.cards.find((c) => c.key === "a0");
        return card && card.painted && topOf(card) > rest + 20;
      }),
    ).toBe(true);
  });

  it("goes back past a card that is still on the drum without losing it", () => {
    const q = queue(2);
    q.press("forward");
    q.run(60);
    q.press("back");
    q.run(2000);
    expect(q.front()).toBe("c2");
    expect(new Set(q.engine.keys()).size).toBe(q.engine.keys().length);
  });

  it("lets an item that left the queue go, and shows the next", () => {
    const q = queue();
    // The front item is acted on and leaves the queue: the pile is the rest.
    q.engine.sync(KEYS.slice(1, 1 + STACK_WINDOW), "forward");
    q.run(2000);
    expect(q.front()).toBe("b1");
    expect(q.released).toEqual(["a0"]);
    expect(q.frames.at(-1)!.busy).toBe(false);
  });

  it("brings an item back that had left, with an undo", () => {
    const q = queue();
    q.engine.sync(KEYS.slice(1, 1 + STACK_WINDOW), "forward");
    q.run(2000);
    q.engine.sync(KEYS.slice(0, STACK_WINDOW), "back");
    q.run(2000);
    expect(q.front()).toBe("a0");
  });

  it("puts in a card that arrives ahead and drops one that leaves ahead", () => {
    const q = queue();
    const window = ["a0", "x", "b1", "c2"];
    q.engine.setHeights(new Map([["x", 100]]));
    q.engine.sync(window);
    q.run(1000);
    expect(q.engine.keys().sort()).toEqual([...window].sort());
    q.engine.sync(["a0", "b1", "c2", "d3"]);
    q.run(1000);
    expect(q.front()).toBe("a0");
    expect(q.engine.keys().sort()).toEqual(["a0", "b1", "c2", "d3"]);
  });

  it("applies a change at once when asked, or when it cannot move there", () => {
    const q = queue();
    q.engine.sync(KEYS.slice(10, 10 + STACK_WINDOW), "forward", true);
    expect(q.front(q.engine.frame())).toBe("c10".replace("c10", KEYS[10]!));
    expect(q.engine.frame().busy).toBe(false);
    // No direction, and not a card it holds: the feed changed under it.
    q.engine.sync(KEYS.slice(30, 30 + STACK_WINDOW));
    expect(q.front(q.engine.frame())).toBe(KEYS[30]);
    expect(q.engine.frame().busy).toBe(false);
  });

  it("clears the last item", () => {
    const q = queue();
    q.engine.sync([]);
    const frame = q.engine.frame();
    expect(frame.cards).toEqual([]);
    expect(frame.height).toBe(0);
    expect(q.released.sort()).toEqual(["a0", "b1", "c2", "d3"]);
  });

  it("fades the replies out at once and in again once nothing passes over", () => {
    const q = queue();
    q.press("forward");
    expect(q.frames.at(-1)!.replies.now).toBe(0);
    q.run(2000);
    const replies = q.frames.slice(1).map((f) => f.replies);
    const last = replies.at(-1)!;
    expect(last).toEqual({ old: 0, now: 1 });
    // The old ones fade out before the new come in.
    const firstIn = replies.findIndex((r) => r.now > 0);
    expect(replies.slice(0, firstIn).some((r) => r.old > 0)).toBe(true);
    expect(
      replies.slice(0, firstIn).every((r) => r.old === 0 || r.now === 0),
    ).toBe(true);
    // A waiting press taken back before it is taken leaves the card where it is.
    const p = queue();
    p.press("forward");
    p.run(50);
    p.press("forward");
    p.press("back");
    p.run(2000);
    expect(p.front()).toBe("b1");
    expect(p.frames.at(-1)!.replies).toEqual({ old: 0, now: 1 });
  });

  it("follows the front card's height in the layout", () => {
    const q = queue();
    q.press("forward");
    q.run(3000);
    expect(q.frames.at(-1)!.height).toBe(LEAD + heightOf("b1"));
    const mid = q.frames.map((f) => f.height);
    expect(Math.min(...mid)).toBeLessThanOrEqual(LEAD + heightOf("b1") + 0.01);
    expect(Math.max(...mid)).toBeLessThanOrEqual(LEAD + heightOf("a0") + 0.01);
  });

  it("stays idle once at rest: nothing moves, no hold left", () => {
    const q = queue();
    q.hold("forward", 600);
    q.run(3000);
    const frame = q.frames.at(-1)!;
    expect(frame.busy).toBe(false);
    const again = q.engine.frame();
    expect(again.cards.map((c) => [c.key, c.y])).toEqual(
      frame.cards.map((c) => [c.key, c.y]),
    );
  });

  it("does not hold against the end of the queue", () => {
    const q = queue(KEYS.length - STACK_WINDOW);
    // The pile is the last four items: from the last, nothing lies ahead.
    q.engine.sync(KEYS.slice(-1), undefined, true, true);
    q.engine.hold("forward");
    q.run(600);
    expect(q.engine.frame().busy).toBe(false);
  });
});

describe("a held key", () => {
  it("moves one card about every 150 ms whatever its height, and rests on a whole card", () => {
    const q = queue();
    q.hold("forward", 1500);
    q.run(3000);
    const moved = q.at();
    // 1500 ms at 150 ms a card, within a card either way.
    expect(moved).toBeGreaterThanOrEqual(8);
    expect(moved).toBeLessThanOrEqual(11);
    expect(q.front()).toBe(KEYS[moved]);
    expect(q.frames.at(-1)!.busy).toBe(false);
  });

  it("holds back the same way", () => {
    const q = queue(30);
    q.hold("back", 1500);
    q.run(3000);
    expect(q.at()).toBeLessThanOrEqual(22);
    expect(q.at()).toBeGreaterThanOrEqual(19);
    expect(q.front()).toBe(KEYS[q.at()]);
  });

  it("stops at the first card", () => {
    const q = queue(3);
    q.hold("back", 2000);
    q.run(3000);
    expect(q.at()).toBe(0);
    expect(q.front()).toBe("a0");
  });

  it("moves no card edge faster than the tap budget before the hold takes over, nor the held budget after", () => {
    const q = queue();
    q.hold("forward", 1500);
    q.run(1000);
    const edges = (f: StackFrame) =>
      new Map(
        f.cards
          .filter((c) => c.painted)
          .map((c) => [c.key, [topOf(c), topOf(c) + c.scale * c.vis]] as const),
      );
    let worst = 0;
    for (let n = 1; n < q.frames.length; n++) {
      const a = edges(q.frames[n - 1]!);
      const b = edges(q.frames[n]!);
      for (const [key, e] of b) {
        const p = a.get(key);
        if (p) worst = Math.max(worst, Math.abs(e[0]! - p[0]!));
      }
    }
    // Over the held budget of 30 px a frame, a drawn edge would jump.
    expect(worst).toBeLessThanOrEqual(31);
  });
});
