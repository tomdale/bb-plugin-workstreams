// @vitest-environment jsdom
// Up Next's slot motion (`useSlotList`). jsdom has no layout or Web
// Animations, so these tests lend it `Element.prototype.animate`, which turns
// motion on, give every slot a fixed contents height, and step fake timers,
// frames, and `performance.now` together.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clipPathShowing,
  presenceProps,
  stepSpring,
  UP_NEXT_MOTION,
  useSlotList,
  type Spring,
} from "../../src/app/sidebar/motion.ts";

type Item = { id: string; label: string };
const ROW = 21;

function List({
  items,
  trimmed = new Set(),
  immediate,
}: {
  items: Item[];
  trimmed?: ReadonlySet<string>;
  immediate?: string;
}) {
  const slots = useSlotList(
    [...items.map((item) => ({ kind: "row" as const, item })), MORE],
    (entry) => (entry.kind === "row" ? entry.item.id : ":more"),
    {
      trimmed,
      edge: ":more",
      immediate,
      arranged: (entry) => entry.kind === "more",
    },
  );
  return (
    <ul>
      {slots.map((slot) => (
        <li
          key={slot.key}
          ref={slot.ref}
          data-key={slot.key}
          {...presenceProps(slot.leaving ? "leave" : "idle")}
        >
          <span>
            {slot.item.kind === "row" ? slot.item.item.label : "Show more"}
          </span>
        </li>
      ))}
    </ul>
  );
}
const MORE = { kind: "more" as const };

const rows = (...ids: string[]) => ids.map((id) => ({ id, label: id }));
const slot = (key: string) =>
  document.querySelector<HTMLElement>(`[data-key="${key}"]`);
const order = () =>
  [...document.querySelectorAll<HTMLElement>("[data-key]")].map(
    (element) => element.dataset.key,
  );
/**
 * Advances fake time. A render a timer asks for commits when `act` ends, so
 * a step that ends a wait should end where the wait does.
 */
const step = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  Element.prototype.animate ??= () => ({}) as Animation;
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
  // Every slot's contents are one row tall; an inline height clips them.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const height = this.style.height
        ? Number.parseFloat(this.style.height)
        : ROW;
      return { top: 0, height, bottom: height } as DOMRect;
    },
  );
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn(() => ({ marginTop: "0px" })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("stepSpring", () => {
  it("settles critically damped, with no overshoot, in the same time for any distance", () => {
    const settle = (distance: number) => {
      const spring: Spring = { value: distance, velocity: 0, target: 0 };
      let ms = 0;
      let lowest = distance;
      while (stepSpring(spring, 1, 0.02)) {
        ms++;
        lowest = Math.min(lowest, spring.value);
      }
      return { ms, lowest };
    };
    const short = settle(21);
    const long = settle(84);
    expect(short.lowest).toBeGreaterThanOrEqual(0);
    expect(long.lowest).toBeGreaterThanOrEqual(0);
    // 95% of the way in about 256ms, whatever the distance.
    const at = (distance: number) => {
      const spring: Spring = { value: distance, velocity: 0, target: 0 };
      stepSpring(spring, 256, 0.02);
      return spring.value / distance;
    };
    expect(at(21)).toBeCloseTo(at(84), 3);
    expect(at(84)).toBeLessThan(0.06);
  });

  it("keeps its velocity when the target changes mid-flight", () => {
    const spring: Spring = { value: 0, velocity: 0, target: 100 };
    stepSpring(spring, 60, 0.02);
    const velocity = spring.velocity;
    spring.target = 50;
    expect(spring.velocity).toBe(velocity);
    stepSpring(spring, 1, 0.02);
    expect(spring.velocity).toBeGreaterThan(velocity * 0.9);
  });
});

describe("clipPathShowing", () => {
  it("shows the bands no covered band touches, top to bottom", () => {
    expect(clipPathShowing(42, [[10, 20]])).toBe(
      "polygon(0 0px, 100% 0px, 100% 10px, 0 10px, 0 20px, 100% 20px, 100% 42px, 0 42px)",
    );
    expect(clipPathShowing(42, [[0, 12]])).toBe(
      "polygon(0 12px, 100% 12px, 100% 42px, 0 42px)",
    );
    expect(clipPathShowing(42, [[30, 42]])).toBe(
      "polygon(0 0px, 100% 0px, 100% 30px, 0 30px)",
    );
  });

  it("merges covered bands that overlap, in any order", () => {
    expect(
      clipPathShowing(42, [
        [20, 30],
        [5, 22],
      ]),
    ).toBe(
      "polygon(0 0px, 100% 0px, 100% 5px, 0 5px, 0 30px, 100% 30px, 100% 42px, 0 42px)",
    );
  });

  it("hides a slot that is covered end to end", () => {
    expect(clipPathShowing(21, [[0, 21]])).toBe("inset(100%)");
  });
});

describe("useSlotList", () => {
  it("waits out a burst of changes, then animates once to the newest", () => {
    const view = render(<List items={rows("a", "b")} />);
    view.rerender(<List items={rows("n1", "a", "b")} />);
    step(100);
    // A second change inside the burst restarts the wait.
    view.rerender(<List items={rows("n1", "n2", "a", "b")} />);
    step(100);
    expect(order()).toEqual(["a", "b", ":more"]);
    step(20);
    expect(order()).toEqual(["n1", "n2", "a", "b", ":more"]);
    expect(slot("n1")!.style.height).toBe("0px");
    expect(slot("n2")!.style.height).toBe("0px");
  });

  it("shows each row's newest contents while its arrangement waits", () => {
    const view = render(<List items={rows("a", "b")} />);
    view.rerender(
      <List
        items={[
          { id: "b", label: "b, read" },
          { id: "a", label: "a" },
        ]}
      />,
    );
    expect(order()).toEqual(["a", "b", ":more"]);
    expect(slot("b")!.textContent).toBe("b, read");
  });

  it("applies a change in `immediate` without waiting", () => {
    const view = render(<List items={rows("a")} immediate="false" />);
    view.rerender(<List items={rows("a", "b")} immediate="true" />);
    expect(order()).toEqual(["a", "b", ":more"]);
  });

  it("opens an entering slot from nothing and fades its contents in after a delay", () => {
    const view = render(<List items={rows("a", "b")} />);
    view.rerender(<List items={rows("a", "n", "b")} />);
    step(UP_NEXT_MOTION.burstMs);
    const entering = slot("n")!;
    expect(entering.style.height).toBe("0px");
    expect(entering.style.overflow).toBe("hidden");
    expect(entering.style.opacity).toBe("0");
    step(64);
    expect(Number.parseFloat(entering.style.height)).toBeGreaterThan(0);
    expect(entering.style.opacity).toBe("0");
    step(64);
    expect(Number(entering.style.opacity)).toBeGreaterThan(0);
    step(1000);
    expect(entering.style.height).toBe("");
    expect(entering.style.opacity).toBe("");
  });

  it("opens the gap above a row that stops being first with the row that enters before it", () => {
    // The CSS gap sits between neighbors (`li + li`).
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn((element: HTMLElement) => ({
        marginTop: element.previousElementSibling ? "3px" : "0px",
      })),
    );
    const view = render(<List items={rows("a", "b")} />);
    view.rerender(<List items={rows("n", "a", "b")} />);
    step(UP_NEXT_MOTION.burstMs);
    expect(slot("a")!.style.marginTop).toBe("0px");
    expect(slot("b")!.style.marginTop).toBe("3px");
    step(100);
    const gap = Number.parseFloat(slot("a")!.style.marginTop);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(3);
    step(1000);
    expect(slot("a")!.style.marginTop).toBe("");
  });

  it("closes and fades a leaving slot, inert, then unmounts it", () => {
    const view = render(<List items={rows("a", "b", "c")} />);
    view.rerender(<List items={rows("a", "c")} />);
    step(UP_NEXT_MOTION.burstMs);
    const leaving = slot("b")!;
    expect(leaving.getAttribute("aria-hidden")).toBe("true");
    expect(leaving.hasAttribute("inert")).toBe(true);
    step(UP_NEXT_MOTION.leaveMs + 16);
    expect(leaving.style.opacity).toBe("0");
    expect(Number.parseFloat(leaving.style.height)).toBeGreaterThan(0);
    step(1000);
    expect(order()).toEqual(["a", "c", ":more"]);
  });

  it("sinks a row the limit pushes out under Show more without fading it", () => {
    const view = render(<List items={rows("a", "b")} />);
    view.rerender(<List items={rows("n", "a")} trimmed={new Set(["b"])} />);
    step(UP_NEXT_MOTION.burstMs);
    step(80);
    const sinking = slot("b")!;
    expect(Number.parseFloat(sinking.style.height)).toBeLessThan(ROW);
    expect(sinking.style.opacity).toBe("");
    expect(slot("n")!.style.opacity).not.toBe("");
  });

  it("raises a row that was behind Show more into the last slot without fading it", () => {
    const view = render(
      <List items={rows("a", "b")} trimmed={new Set(["c"])} />,
    );
    view.rerender(<List items={rows("a", "c")} />);
    step(UP_NEXT_MOTION.burstMs);
    const rising = slot("c")!;
    expect(rising.style.height).toBe("0px");
    expect(rising.style.opacity).toBe("");
    // The row that left fades as it closes.
    step(32);
    expect(Number(slot("b")!.style.opacity)).toBeLessThan(1);
  });

  it("starts a re-ranked row where it was drawn, above the rows it passes", () => {
    const view = render(<List items={rows("a", "b", "c")} />);
    view.rerender(<List items={rows("c", "a", "b")} />);
    step(UP_NEXT_MOTION.burstMs);
    const mover = slot("c")!;
    expect(mover.style.transform).toBe(`translateY(${2 * ROW}px)`);
    expect(mover.style.zIndex).toBe("3");
    expect(slot("a")!.style.transform).toBe(`translateY(${-ROW}px)`);
    expect(slot("a")!.style.zIndex).toBe("2");
    // Drawn where they were, no row covers another.
    for (const key of ["a", "b", "c"])
      expect(slot(key)!.style.clipPath).toBe("");
  });

  it("hides what a row passes over by clipping it, never by drawing a surface", () => {
    const view = render(<List items={rows("a", "b")} />);
    view.rerender(<List items={rows("b", "a")} />);
    step(UP_NEXT_MOTION.burstMs);
    // The rows swap places: `b` rises into slot 0 as `a` sinks into slot 1.
    // Where they overlap, `b` is above, so `a` shows only the rest of itself.
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      step(8);
      const rise = Number.parseFloat(
        slot("b")!.style.transform.slice("translateY(".length),
      );
      const sink = Number.parseFloat(
        slot("a")!.style.transform.slice("translateY(".length),
      );
      const bTop = Number.isNaN(rise) ? 0 : rise;
      const aTop = ROW + (Number.isNaN(sink) ? 0 : sink);
      const covered = Math.min(aTop + ROW, bTop + ROW) - Math.max(aTop, bTop);
      const clip = slot("a")!.style.clipPath;
      if (covered > 0.05) {
        // The covered band is the part of `a` that `b` overlaps.
        const from = Math.max(aTop, bTop) - aTop;
        const to = Math.min(aTop + ROW, bTop + ROW) - aTop;
        expect(clip).toBe(clipPathShowing(ROW, [[from, to]]));
        seen.add(clip);
      } else expect(clip).toBe("");
      expect(slot("b")!.style.clipPath).toBe("");
      for (const key of ["a", "b"])
        expect(slot(key)!.style.backgroundColor).toBe("");
    }
    expect(seen.size).toBeGreaterThan(3);
    step(1000);
    expect(slot("a")!.style.clipPath).toBe("");
    expect(slot("b")!.style.transform).toBe("");
  });

  it("retargets from where a row is drawn when a change lands mid-flight", () => {
    const view = render(<List items={rows("a", "b", "c")} />);
    view.rerender(<List items={rows("c", "a", "b")} />);
    step(UP_NEXT_MOTION.burstMs);
    step(100);
    const travel = Number.parseFloat(
      slot("c")!.style.transform.slice("translateY(".length),
    );
    view.rerender(<List items={rows("a", "c", "b")} />);
    step(UP_NEXT_MOTION.burstMs);
    // Drawn at `travel` above its old slot 0, now laid out at slot 1.
    const now = Number.parseFloat(
      slot("c")!.style.transform.slice("translateY(".length),
    );
    expect(now).toBeLessThan(travel - ROW + 1);
    expect(now).toBeGreaterThan(travel - ROW - 30);
  });

  it("holds Show more's count with the arrangement it counts", () => {
    function Counted({ count, ids }: { count: number; ids: string[] }) {
      const slots = useSlotList(
        [...ids.map((id) => ({ id, count: 0 })), { id: ":more", count }],
        (item) => item.id,
        { trimmed: new Set(), arranged: (item) => item.id === ":more" },
      );
      return (
        <ul>
          {slots.map((s) => (
            <li key={s.key} ref={s.ref} data-key={s.key}>
              {s.key === ":more" ? `Show ${s.item.count} more` : s.key}
            </li>
          ))}
        </ul>
      );
    }
    const view = render(<Counted ids={["a", "b"]} count={1} />);
    view.rerender(<Counted ids={["n", "a"]} count={2} />);
    expect(slot(":more")!.textContent).toBe("Show 1 more");
    step(UP_NEXT_MOTION.burstMs);
    expect(slot(":more")!.textContent).toBe("Show 2 more");
  });

  it("under reduced motion applies a change at once, with nothing fading, moving, or waiting", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
    }));
    const view = render(<List items={rows("a", "b", "c")} />);
    // `n` joins, `b` leaves, and `c` and `a` change places.
    view.rerender(<List items={rows("n", "c", "a")} />);
    expect(order()).toEqual(["n", "c", "a", ":more"]);
    expect(document.querySelectorAll("[data-key][style]")).toHaveLength(0);
    step(1000);
    expect(order()).toEqual(["n", "c", "a", ":more"]);
    expect(document.querySelectorAll("[data-key][style]")).toHaveLength(0);
  });

  it("applies every change at once without Web Animations", () => {
    delete (Element.prototype as { animate?: unknown }).animate;
    const view = render(<List items={rows("a", "b")} />);
    view.rerender(<List items={rows("n", "a")} />);
    expect(order()).toEqual(["n", "a", ":more"]);
    expect(slot("n")!.getAttribute("style")).toBeNull();
  });
});

describe("useSlotList measurement", () => {
  /** A ResizeObserver whose notifications the test delivers. */
  function observeResizes() {
    const observed = new Set<Element>();
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe(element: Element) {
          observed.add(element);
        }
        unobserve(element: Element) {
          observed.delete(element);
        }
        disconnect() {}
      },
    );
    return {
      observed,
      notify: () =>
        act(() => {
          for (const callback of callbacks) callback([], {} as ResizeObserver);
        }),
    };
  }
  /** Each slot's contents height, by key; a slot's inline height clips it. */
  function contentHeights(heights: Record<string, number>) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const height = this.style.height
          ? Number.parseFloat(this.style.height)
          : (heights[this.dataset.key ?? ""] ?? ROW);
        return { top: 0, height, bottom: height } as DOMRect;
      },
    );
  }

  it("measures nothing when the list renders with its arrangement unchanged", () => {
    observeResizes();
    const view = render(<List items={rows("a", "b")} />);
    const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    const styles = vi.mocked(getComputedStyle);
    reads.mockClear();
    styles.mockClear();
    for (let i = 0; i < 5; i++)
      view.rerender(
        <List
          items={[
            { id: "a", label: `a, render ${i}` },
            { id: "b", label: "b" },
          ]}
        />,
      );
    expect(reads).not.toHaveBeenCalled();
    expect(styles).not.toHaveBeenCalled();
  });

  it("reads the gap between slots once, however many arrangements follow", () => {
    observeResizes();
    const view = render(<List items={rows("a", "b")} />);
    view.rerender(<List items={rows("n", "a", "b")} />);
    step(UP_NEXT_MOTION.burstMs);
    step(1000);
    view.rerender(<List items={rows("a", "b")} />);
    step(UP_NEXT_MOTION.burstMs);
    step(1000);
    expect(getComputedStyle).toHaveBeenCalledOnce();
  });

  it("watches each slot's contents, not the slot, and grows a slot whose contents grew", () => {
    const resizes = observeResizes();
    const heights: Record<string, number> = {};
    contentHeights(heights);
    render(<List items={rows("a", "b")} />);
    expect([...resizes.observed].map((element) => element.tagName)).toEqual([
      "SPAN",
      "SPAN",
      "SPAN",
    ]);
    step(20);
    // `a` gains a second line.
    heights.a = 2 * ROW;
    resizes.notify();
    // The slot holds its height until the burst is quiet, then opens.
    expect(slot("a")!.style.height).toBe(`${ROW}px`);
    step(UP_NEXT_MOTION.burstMs);
    step(1000);
    expect(slot("a")!.style.height).toBe("");
  });

  it("measures a contents change seen mid-motion once the slots come to rest", () => {
    const resizes = observeResizes();
    const heights: Record<string, number> = {};
    contentHeights(heights);
    const view = render(<List items={rows("a", "b")} />);
    view.rerender(<List items={rows("n", "a", "b")} />);
    step(UP_NEXT_MOTION.burstMs);
    step(32);
    heights.b = 2 * ROW;
    const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    reads.mockClear();
    resizes.notify();
    // Nothing is measured while the slots move.
    expect(reads).not.toHaveBeenCalled();
    step(1000);
    // At rest the change is measured, and once its burst ends the slot opens
    // toward the new height.
    expect(reads).toHaveBeenCalled();
    expect(Number.parseFloat(slot("b")!.style.height)).toBeGreaterThan(ROW);
    step(1000);
    expect(slot("b")!.style.height).toBe("");
  });
});
