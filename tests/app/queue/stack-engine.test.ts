import { describe, expect, it } from "vitest";
import {
  StackEngine,
  type CardEdges,
  type CardView,
  type Direction,
  type StackFrame,
} from "../../../src/app/page/queue/stackEngine.ts";

/** A card as drawn, with where its edges fall. */
type View = CardView & CardEdges;
type Frame = Omit<StackFrame, "cards"> & { cards: View[] };

/** The engine's frame with every card's edges joined to it. */
function snap(engine: StackEngine): Frame {
  const frame = engine.frame();
  const edges = engine.edges();
  return {
    ...frame,
    cards: frame.cards.map((c) => ({ ...c, ...edges.get(c.key)! })),
  };
}

/** The mockup's six cards, from a tall recap to a single line. */
const HEIGHTS: Record<string, number> = {
  a: 262, // tall, Ready for Review
  b: 92, // one line, Waiting
  c: 170,
  d: 330, // very tall
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

/** A queue of `KEYS` shown through the engine, as the page drives it. */
function queue(start = 0) {
  const released: string[] = [];
  const engine = new StackEngine((key) => released.push(key));
  engine.setHeights(new Map(KEYS.map((k) => [k, heightOf(k)])));
  let at = start;
  const window = () => KEYS.slice(at, at + 4);
  engine.sync(window());
  const frames: Frame[] = [snap(engine)];
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += DT * 1000) {
      engine.step(DT);
      frames.push(snap(engine));
    }
  };
  const press = (direction: Direction) => {
    if (!engine.accept(direction)) return false;
    at += direction === "forward" ? 1 : -1;
    engine.sync(window(), direction);
    frames.push(snap(engine));
    return true;
  };
  return { engine, frames, run, press, released, at: () => at, window };
}

const byKey = (frame: Frame) =>
  new Map(frame.cards.map((c) => [c.key, c] as const));

/** What the mockup's frame checker looked for between consecutive frames. */
function problems(frames: Frame[], jump = 40): string[] {
  const out: string[] = [];
  for (let n = 1; n < frames.length; n++) {
    const a = byKey(frames[n - 1]!);
    const b = byKey(frames[n]!);
    const both = [...b.values()].filter(
      (c) => c.painted && a.get(c.key)?.painted,
    );
    for (const c of both) {
      const p = a.get(c.key)!;
      if (Math.abs(c.top - p.top) > jump)
        out.push(`${n}: ${c.key} top jumped ${c.top - p.top}`);
      if (Math.abs(c.natBottom - p.natBottom) > jump)
        out.push(`${n}: ${c.key} moved ${c.natBottom - p.natBottom}`);
      // Where the drawn bottom changes beyond the card's own motion (it
      // follows the edge of the card in front), the band that appears or
      // disappears must be hidden behind a card in front.
      const clip = c.bottom - p.bottom - (c.natBottom - p.natBottom);
      if (Math.abs(clip) > 16) {
        const expected = p.bottom + (c.natBottom - p.natBottom);
        const lo = Math.min(expected, c.bottom);
        const hi = Math.max(expected, c.bottom);
        const hidden = [...b.values()].some(
          (o) =>
            o !== c &&
            o.painted &&
            o.layer > c.layer &&
            o.top <= lo + 0.5 &&
            o.bottom >= hi - 0.5 &&
            o.scale >= c.scale - 0.002,
        );
        if (!hidden) out.push(`${n}: ${c.key} bottom changed ${clip} in view`);
      }
      if (Math.abs(c.shade - p.shade) > 0.2)
        out.push(`${n}: ${c.key} shade ${p.shade} to ${c.shade}`);
    }
    for (const x of both)
      for (const y of both) {
        if (x.key >= y.key) continue;
        const before = Math.sign(a.get(x.key)!.layer - a.get(y.key)!.layer);
        const after = Math.sign(x.layer - y.layer);
        if (before === after) continue;
        if (overlap(x, y) > 1 && !covered(x, y, [...b.values()]))
          out.push(`${n}: ${x.key}/${y.key} swapped draw order`);
      }
  }
  return out;
}

const overlap = (x: View, y: View) =>
  Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);

/** Whether a third painted card in front of both hides where they overlap. */
function covered(x: View, y: View, all: View[]) {
  const top = Math.max(x.top, y.top);
  const bottom = Math.min(x.bottom, y.bottom);
  return all.some(
    (c) =>
      c !== x &&
      c !== y &&
      c.painted &&
      c.layer > x.layer &&
      c.layer > y.layer &&
      c.top <= top + 0.5 &&
      c.bottom >= bottom - 0.5 &&
      c.scale >= Math.min(x.scale, y.scale) - 0.002,
  );
}

/** Every card the engine holds is in its slot: the pile as wanted, settled. */
function expectSettled(q: ReturnType<typeof queue>) {
  const last = q.frames.at(-1)!;
  expect(last.busy).toBe(false);
  expect(q.engine.keys().sort()).toEqual([...q.window()].sort());
  const cards = byKey(last);
  q.window().forEach((key, slot) => {
    const c = cards.get(key)!;
    expect(c.interactive).toBe(slot === 0);
    expect(c.painted).toBe(slot < 3);
    expect(c.shade).toBeCloseTo(slot < 3 ? 0.24 * slot : 0.48, 2);
  });
  expect(last.height).toBeCloseTo(34 + heightOf(q.window()[0]!), 1);
}

describe("the stack engine", () => {
  it("starts settled with the shown item in front and two peeking out", () => {
    const q = queue();
    q.run(50);
    expectSettled(q);
    const [front, one, two] = ["a0", "b1", "c2"].map((k) =>
      byKey(q.frames[0]!).get(k)!,
    );
    expect(one!.top).toBeLessThan(front!.top);
    expect(two!.top).toBeLessThan(one!.top);
    expect(one!.bottom).toBeLessThanOrEqual(front!.bottom);
  });

  it.each([
    ["a tall card leaving for a short one", 0],
    ["a short card leaving for a tall one", 1],
    ["a card leaving for a card of its own size", 4],
  ])("moves on smoothly: %s", (_, start) => {
    const q = queue(start);
    q.run(100);
    q.frames.length = 0;
    expect(q.press("forward")).toBe(true);
    q.run(3000);
    expect(problems(q.frames)).toEqual([]);
    expectSettled(q);
    expect(q.released).toContain(KEYS[start]);
  });

  it.each([
    ["a tall card coming back", 1],
    ["a short card coming back", 2],
  ])("goes back smoothly: %s", (_, start) => {
    const q = queue(start);
    q.run(100);
    q.frames.length = 0;
    expect(q.press("back")).toBe(true);
    q.run(3000);
    expect(problems(q.frames)).toEqual([]);
    expectSettled(q);
  });

  it("goes on and straight back to the same card", () => {
    const q = queue(0);
    q.press("forward");
    q.run(1500);
    q.press("back");
    q.run(3000);
    expect(q.at()).toBe(0);
    expect(problems(q.frames)).toEqual([]);
    expectSettled(q);
  });

  it("takes a held key one card at a time, at most two waiting", () => {
    const q = queue(0);
    let taken = 0;
    for (let ms = 0; ms < 1500; ms += 33) {
      if (q.press("forward")) taken++;
      q.run(33);
    }
    q.run(4000);
    expect(taken).toBeLessThan(1500 / 33);
    expect(q.at()).toBe(taken);
    // Cards move a little faster while presses wait (1.3 times), but no edge
    // moves farther per frame than in a single move.
    expect(problems(q.frames)).toEqual([]);
    expectSettled(q);
  });

  it("drops a card no lower under a held key than a single move does", () => {
    const deepest = (q: ReturnType<typeof queue>) => {
      const low = new Map<string, number>();
      for (const frame of q.frames)
        for (const c of frame.cards)
          if (c.painted) low.set(c.key, Math.max(low.get(c.key) ?? 0, c.top));
      return low;
    };
    // The lowest a card's top gets in a single move, from each start.
    let single = 0;
    for (let start = 0; start < 6; start++) {
      const q = queue(start);
      q.press("forward");
      q.run(3000);
      single = Math.max(single, deepest(q).get(KEYS[start]!)!);
    }
    // Held, each card tucks under while earlier ones are still on their way
    // behind the pile; it clears only the pile, not them, so it lands no
    // farther down than a single move would.
    const q = queue(0);
    for (let ms = 0; ms < 1500; ms += 33) {
      q.press("forward");
      q.run(33);
    }
    q.run(4000);
    for (const [key, top] of deepest(q))
      expect(top, key).toBeLessThanOrEqual(single + 1);
  });

  it("pulls a card no lower under a held key than it goes in", () => {
    const deepest = (q: ReturnType<typeof queue>) => {
      const low = new Map<string, number>();
      for (const frame of q.frames)
        for (const c of frame.cards)
          if (c.painted) low.set(c.key, Math.max(low.get(c.key) ?? 0, c.top));
      return low;
    };
    // A held back key plays the reverse of the trip a card takes leaving, so
    // each card comes out no lower than it goes in, by a single move on or by
    // a held key.
    const goesIn = new Map<string, number>();
    for (let at = 41; at < 50; at++) {
      const q = queue(at);
      q.press("forward");
      q.run(3000);
      goesIn.set(KEYS[at]!, deepest(q).get(KEYS[at]!)!);
    }
    // Held, a card drops as low as the cards it leaves with let it, which
    // depends on where in the run it goes: take every place it can have.
    for (let from = 41; from < 50; from++) {
      const held = queue(from);
      for (let ms = 0; ms < 1500; ms += 33) {
        held.press("forward");
        held.run(33);
      }
      held.run(4000);
      for (const [key, top] of deepest(held))
        goesIn.set(key, Math.max(goesIn.get(key) ?? 0, top));
    }
    // Held, each card comes out while the last is still rising into the
    // front.
    const q = queue(50);
    for (let ms = 0; ms < 1500; ms += 33) {
      q.press("back");
      q.run(33);
    }
    q.run(4000);
    const out = deepest(q);
    for (const key of KEYS.slice(41, 50))
      expect(out.get(key)!, key).toBeLessThanOrEqual(goesIn.get(key)! + 1);
  });

  it("keeps a held back key's moves when the page re-renders between them", () => {
    // The page syncs the pile on every render, with no direction except on
    // the render a press causes; the moves a held key still owes must
    // survive those.
    const q = queue(50);
    for (let ms = 0; ms < 1500; ms += 33) {
      q.press("back");
      for (let t = 0; t < 33; t += DT * 1000) {
        q.engine.sync(q.window());
        q.run(DT * 1000);
      }
    }
    q.run(4000);
    expect(problems(q.frames)).toEqual([]);
    expectSettled(q);
  });

  it("holds back a key held in the other direction the same way", () => {
    const q = queue(50);
    for (let ms = 0; ms < 1500; ms += 33) {
      q.press("back");
      q.run(33);
    }
    q.run(4000);
    expect(problems(q.frames)).toEqual([]);
    expectSettled(q);
  });

  it.each([
    ["early", 60],
    ["while the card is clear below the pile", 300],
    ["as it rises behind", 600],
  ])("turns around when reversed mid-motion (%s)", (_, wait) => {
    for (const start of [0, 1, 3]) {
      const q = queue(start);
      q.run(100);
      q.frames.length = 0;
      q.press("forward");
      q.run(wait);
      q.press("back");
      q.run(3500);
      expect(q.at()).toBe(start);
      expect(problems(q.frames)).toEqual([]);
      expectSettled(q);
    }
  });

  it("drops waiting presses when the other direction is pressed", () => {
    const q = queue(1);
    q.press("forward");
    q.press("forward");
    q.press("back");
    q.run(3500);
    expect(q.at()).toBe(2);
    expect(problems(q.frames)).toEqual([]);
    expectSettled(q);
  });

  it("never makes a card that fits at its depth vanish", () => {
    // Short cards fit behind any front card at their depth: b1 (92) leaves
    // behind c2 (170) and comes back, fully coloured, never faded away.
    const q = queue(1);
    q.press("forward");
    q.run(2500);
    q.press("back");
    q.run(2500);
    const fades = q.frames.flatMap((f) => {
      const c = byKey(f).get("b1");
      return c?.painted ? [c.shade] : [];
    });
    expect(Math.max(...fades)).toBeLessThan(0.7);
    expect(
      q.frames.some((f) => byKey(f).get("b1") && !byKey(f).get("b1")!.painted),
    ).toBe(false);
    expect(problems(q.frames)).toEqual([]);
  });

  it("fades a card too tall to fit behind the new front card", () => {
    const q = queue(0);
    q.press("forward"); // a0 (262) leaves behind b1 (92)
    q.run(3000);
    const shades = q.frames.map((f) => byKey(f).get("a0")?.shade ?? 1);
    expect(Math.max(...shades.filter((s) => s < 1))).toBeGreaterThan(0.9);
    expect(q.engine.keys()).not.toContain("a0");
    // Going back it comes out faded and gains colour as it comes forward.
    q.frames.length = 0;
    q.press("back");
    q.run(3000);
    const back = q.frames.map((f) => byKey(f).get("a0")!.shade);
    expect(back[0]).toBeGreaterThan(0.5);
    expect(back.at(-1)).toBeCloseTo(0, 2);
    expect(problems(q.frames)).toEqual([]);
    expectSettled(q);
  });

  it("brings in a card the pile never held when going back", () => {
    const q = queue(3);
    q.run(100);
    q.frames.length = 0;
    q.press("back");
    q.run(3000);
    expect(problems(q.frames)).toEqual([]);
    expectSettled(q);
  });

  it("lets an item that left the queue go, and shows the next", () => {
    const q = queue(0);
    // Acting removes the front item from the list without a skip.
    const ids = KEYS.slice(1, 5);
    q.engine.sync(ids, "forward");
    q.run(3000);
    expect(q.engine.keys().sort()).toEqual([...ids].sort());
    expect(q.released).toContain("a0");
    expect(q.engine.frame().busy).toBe(false);
  });

  it("applies a change at once when asked, or when it cannot move there", () => {
    const q = queue(0);
    q.engine.sync(["x1", "x2", "x3"], undefined);
    const last = q.engine.frame();
    expect(last.busy).toBe(false);
    expect(last.cards.map((c) => c.key).sort()).toEqual(["x1", "x2", "x3"]);
    q.engine.sync(KEYS.slice(1, 4), "forward", true);
    expect(
      q.engine
        .frame()
        .cards.map((c) => c.key)
        .sort(),
    ).toEqual(KEYS.slice(1, 4).sort());
  });

  it("clears the last item and lets an undo bring it back", () => {
    const q = queue(5);
    q.engine.sync([], "forward");
    q.run(300);
    q.engine.sync([KEYS[5]!], "back");
    q.run(3000);
    expect(q.engine.keys()).toEqual([KEYS[5]]);
    expect(q.engine.frame().busy).toBe(false);
  });

  it("fades the replies out and in once nothing passes over", () => {
    const q = queue(0);
    q.press("forward");
    const first = q.engine.frame();
    expect(first.replies.now).toBe(0);
    let shown: Frame | null = null;
    for (let ms = 0; ms < 3000; ms += 16.7) {
      q.run(16.7);
      const f = q.frames.at(-1)!;
      if (!shown && f.replies.now > 0) shown = f;
    }
    expect(q.frames.at(-1)!.replies.now).toBe(1);
    // The replies stay hidden while the leaving card is over them.
    const front = shown!.cards.find((c) => c.interactive)!;
    for (const c of shown!.cards.filter((c) => c.painted))
      expect(c.bottom).toBeLessThanOrEqual(front.bottom + 8);
  });

  it("poses a wanted card behind the front that the pile didn't hold", () => {
    const q = queue(0);
    q.run(100);
    // An undo brings back an item between the front and the next one.
    const want = [KEYS[0]!, "x9", KEYS[1]!, KEYS[2]!];
    q.engine.sync(want, "back");
    q.run(3000);
    expect(q.engine.keys().sort()).toEqual([...want].sort());
    const frame = snap(q.engine);
    expect(frame.busy).toBe(false);
    const cards = byKey(frame);
    want.forEach((key, slot) => {
      expect(cards.get(key)!.painted).toBe(slot < 3);
      expect(cards.get(key)!.interactive).toBe(slot === 0);
    });
    const tops = want.map((key) => cards.get(key)!.top);
    expect(tops[1]!).toBeLessThan(tops[0]!);
    expect(tops[2]!).toBeLessThan(tops[1]!);
  });

  it("forgets a hint once the moves it directed are taken", () => {
    const q = queue(0);
    q.engine.sync(KEYS.slice(1, 5), "forward");
    q.run(3000);
    expect((q.engine as unknown as { hint: unknown }).hint).toBeUndefined();
  });
});

/**
 * Holds `direction` for `ms`, a press every 33 ms (taken if the engine
 * accepts it), the way the page drives it: with `resync`, the page also
 * syncs the pile, with no direction, on every frame in between, as each
 * re-render does. Returns the presses the page took, and the lowest a
 * card's top has been while it was not the front or behind the pile.
 */
function hold(
  direction: Direction,
  start: number,
  resync: boolean,
  ms = 3000,
  check?: (q: ReturnType<typeof queue>) => void,
) {
  const q = queue(start);
  q.run(100);
  q.frames.length = 0;
  let steps = 0;
  for (let t = 0; t < ms; t += 33) {
    if (q.press(direction)) steps++;
    for (let f = 0; f < 33; f += DT * 1000) {
      if (resync) q.engine.sync(q.window());
      q.run(DT * 1000);
      check?.(q);
    }
  }
  return { q, steps };
}

/** The engine's cards by key, for the tests that look inside it. */
const inner = (engine: StackEngine) =>
  (engine as unknown as { cards: Map<string, { top: number; phase: string }> })
    .cards;

/** Holds `direction` for `ms` from the current state of `q`, a press every
 * 33 ms, with a re-render sync every frame when `resync`. */
function holdMore(
  q: ReturnType<typeof queue>,
  direction: Direction,
  ms: number,
  resync: boolean,
) {
  for (let t = 0; t < ms; t += 33) {
    q.press(direction);
    for (let f = 0; f < 33; f += DT * 1000) {
      if (resync) q.engine.sync(q.window());
      q.run(DT * 1000);
    }
  }
}

/** Whether a frame paints `key` as the front card: nearest, within a few
 * pixels of the front's place (the next card lands on it a beat later), with
 * none of its depth shading. */
const atFront = (frame: Frame, key: string) => {
  const c = byKey(frame).get(key);
  if (!c?.painted || Math.abs(c.top - 34) > 12 || c.shade > 0.05) return false;
  return frame.cards.every((o) => !o.painted || o.layer <= c.layer);
};

describe("a held key's pace", () => {
  it.each([false, true])(
    "steps back within 1 of on (re-render syncs: %s)",
    (resync) => {
      const on = hold("forward", 0, resync).steps;
      const back = hold("back", 50, resync).steps;
      expect(on).toBeGreaterThan(10);
      expect(Math.abs(back - on)).toBeLessThanOrEqual(1);
    },
  );

  it.each([false, true])(
    "brings every card to the front, smoothly, and settles (re-render syncs: %s)",
    (resync) => {
      for (const start of [50, 30, 9]) {
        const { q } = hold("back", start, resync);
        q.run(4000);
        expect(problems(q.frames), `from ${start}`).toEqual([]);
        expectSettled(q);
        for (const key of KEYS.slice(q.at(), start))
          expect(
            q.frames.some((f) => atFront(f, key)),
            `${key} reached the front`,
          ).toBe(true);
      }
    },
  );

  it.each([false, true])(
    "keeps hidden cards from holding a draw tier (re-render syncs: %s)",
    (resync) => {
      const { q } = hold("back", 50, resync, 3000, (q) => {
        const last = q.frames.at(-1)!;
        for (const c of last.cards)
          if (!c.painted && !c.interactive)
            expect(
              inner(q.engine).get(c.key)?.top,
              `${c.key} is hidden but holds a tier`,
            ).toBe(0);
      });
      q.run(4000);
      expectSettled(q);
    },
  );

  it.each([false, true])(
    "plays a held back key as the reverse of a held on key (re-render syncs: %s)",
    (resync) => {
      // Cards that left the front 200 ms apart come back 200 ms apart, each
      // landing on the one before, and the card that left last comes back
      // first.
      const on = hold("forward", 0, resync);
      on.q.run(4000);
      const left = new Map<string, number>();
      on.q.frames.forEach((f, n) => {
        for (const c of f.cards)
          if (!left.has(c.key) && !c.interactive && c.top > 40)
            left.set(c.key, n);
      });
      const back = hold("back", 50, resync);
      back.q.run(4000);
      const came = new Map<string, number>();
      back.q.frames.forEach((f, n) => {
        for (const key of KEYS.slice(back.q.at(), 50))
          if (!came.has(key) && atFront(f, key)) came.set(key, n);
      });
      const gaps = (m: Map<string, number>) =>
        [...m.values()].slice(1).map((n, i) => n - [...m.values()][i]!);
      const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      expect(mean(gaps(came)) * DT * 1000).toBeGreaterThan(150);
      expect(mean(gaps(came)) * DT * 1000).toBeLessThan(260);
      expect(mean(gaps(left)) * DT * 1000).toBeGreaterThan(150);
      expect(mean(gaps(left)) * DT * 1000).toBeLessThan(260);
    },
  );

  it.each([false, true])(
    "turns around cleanly when held on, then back (re-render syncs: %s)",
    (resync) => {
      const found: string[] = [];
      for (const wait of [200, 450, 700, 1000, 1400]) {
        const q = queue(20);
        q.run(100);
        q.frames.length = 0;
        holdMore(q, "forward", wait, resync);
        holdMore(q, "back", 1000, resync);
        q.run(4000);
        found.push(...problems(q.frames).map((m) => `${wait} ms: ${m}`));
        expectSettled(q);
      }
      expect(found).toEqual([]);
    },
  );

  it.each([false, true])(
    "turns around cleanly when reversed mid-burst (re-render syncs: %s)",
    (resync) => {
      const found: string[] = [];
      for (const wait of [200, 450, 700, 1000, 1400]) {
        for (const then of [33, 600]) {
          const q = queue(50);
          q.run(100);
          q.frames.length = 0;
          holdMore(q, "back", wait, resync);
          holdMore(q, "forward", then, resync);
          q.run(4000);
          found.push(
            ...problems(q.frames).map((m) => `${wait}+${then} ms: ${m}`),
          );
          expectSettled(q);
        }
      }
      expect(found).toEqual([]);
    },
  );

  it.each([false, true])(
    "turns around cleanly when held back, then on, then back (re-render syncs: %s)",
    (resync) => {
      const found: string[] = [];
      for (const wait of [450, 800]) {
        const q = queue(50);
        q.run(100);
        q.frames.length = 0;
        holdMore(q, "back", wait, resync);
        holdMore(q, "forward", 400, resync);
        holdMore(q, "back", 800, resync);
        q.run(4000);
        found.push(...problems(q.frames).map((m) => `${wait} ms: ${m}`));
        expectSettled(q);
      }
      expect(found).toEqual([]);
    },
  );
});
