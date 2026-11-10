// @vitest-environment jsdom
import { useRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRowFlip } from "../../src/app/sidebar/motion.ts";

type Call = {
  element: HTMLElement;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: Animation;
};

const calls: Call[] = [];
const visual = new Map<HTMLElement, { transform: string; opacity: number }>();
const byKey = (key: string) =>
  calls.filter((call) => call.element.dataset.flipRow === key);

function rect(top: number, height = 21): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    height,
    left: 0,
    right: 260,
    bottom: top + height,
    width: 260,
    toJSON: () => ({}),
  } as DOMRect;
}

function List({ order }: { order: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const capture = useRowFlip(ref, order.join(" "));
  return (
    <div data-flip-list ref={ref} onClickCapture={capture}>
      {order.map((key) => (
        <div data-flip-row={key} key={key}>
          {key}
        </div>
      ))}
    </div>
  );
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: function (
      this: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      const animation = {
        cancel: vi.fn(),
        onfinish: null,
      } as unknown as Animation;
      calls.push({ element: this, frames, options, animation });
      return animation;
    },
  });
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn((element: HTMLElement) => {
      const current = visual.get(element);
      return {
        transform: current?.transform ?? "none",
        opacity: String(current?.opacity ?? 1),
      } as CSSStyleDeclaration;
    }),
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-flip-list") ? 500 : 21;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(21);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("data-flip-list")) return rect(0, 500);
      const parent = this.parentElement!;
      const index = [...parent.children].indexOf(this);
      return rect(index * 21);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
  calls.length = 0;
  visual.clear();
});

describe("Up Next row FLIP", () => {
  it("slides surviving rows in the new DOM order using only transform and opacity", () => {
    const view = render(<List order={["a", "b", "c"]} />);
    view.rerender(<List order={["b", "a", "c"]} />);

    expect(
      [...view.container.querySelectorAll("[data-flip-row]")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["b", "a", "c"]);
    expect(calls.map((call) => call.element.dataset.flipRow)).toEqual([
      "b",
      "a",
    ]);
    expect(byKey("a")[0]!.frames).toEqual([
      { transform: "translateY(-21px)" },
      { transform: "translateY(0px)" },
    ]);
    expect(byKey("b")[0]!.frames[0]).toEqual({
      transform: "translateY(21px)",
    });
    for (const call of calls) {
      expect(call.options).toMatchObject({ duration: 240 });
      for (const frame of call.frames) {
        const properties = Object.keys(frame);
        expect(properties).toHaveLength(1);
        expect(["opacity", "transform"]).toContain(properties[0]);
      }
    }
    const a = view.container.querySelector<HTMLElement>('[data-flip-row="a"]')!;
    const b = view.container.querySelector<HTMLElement>('[data-flip-row="b"]')!;
    expect(a.style.zIndex).toBe("1");
    expect(b.style.zIndex).toBe("2");
    view.unmount();
    expect(a.style.zIndex).toBe("");
    expect(b.style.zIndex).toBe("");
  });

  it("fades a promoted row in at its destination while its neighbors make room", () => {
    const view = render(<List order={["a", "b"]} />);
    view.rerender(<List order={["new", "a", "b"]} />);

    expect(byKey("new")[0]!.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(byKey("new")[0]!.options).toMatchObject({ duration: 260 });
    expect(byKey("a")[0]!.frames[0]).toEqual({
      transform: "translateY(-21px)",
    });
    expect(byKey("b")[0]!.frames[0]).toEqual({
      transform: "translateY(-21px)",
    });
  });

  it("retargets from the current translation and opacity on a second input", () => {
    const view = render(<List order={["a", "b"]} />);
    view.rerender(<List order={["new", "a", "b"]} />);
    const row = view.container.querySelector<HTMLElement>(
      '[data-flip-row="new"]',
    )!;
    visual.set(row, { transform: "none", opacity: 0.5 });
    calls.length = 0;

    view.rerender(<List order={["a", "new", "b"]} />);

    const transform = byKey("new").find((call) =>
      Object.hasOwn(call.frames[0]!, "transform"),
    )!;
    const fade = byKey("new").find((call) =>
      Object.hasOwn(call.frames[0]!, "opacity"),
    )!;
    expect(transform.frames).toEqual([
      { transform: "translateY(-21px)" },
      { transform: "translateY(0px)" },
    ]);
    expect(fade.frames).toEqual([{ opacity: 0.5 }, { opacity: 1 }]);
  });

  it("preserves a subpixel position when a retarget barely moves a row", () => {
    const view = render(<List order={["a", "b", "c"]} />);
    view.rerender(<List order={["b", "a", "c"]} />);
    const row = view.container.querySelector<HTMLElement>(
      '[data-flip-row="a"]',
    )!;
    visual.set(row, {
      transform: "matrix(1, 0, 0, 1, 0, -0.25)",
      opacity: 1,
    });
    calls.length = 0;

    view.rerender(<List order={["c", "a", "b"]} />);

    expect(byKey("a")[0]!.frames[0]).toEqual({
      transform: "translateY(-0.25px)",
    });
  });

  it("fades a row entering the scrollport instead of traveling from offscreen", () => {
    const order = Array.from({ length: 31 }, (_, index) => `row-${index}`);
    const view = render(<List order={order} />);
    view.rerender(<List order={["row-30", ...order.slice(0, 30)]} />);

    expect(byKey("row-30")[0]!.frames).toEqual([
      { opacity: 0 },
      { opacity: 1 },
    ]);
  });

  it("does not measure rows again on a geometry-stable rerender", () => {
    const view = render(<List order={["a", "b", "c"]} />);
    const rectangles = HTMLElement.prototype
      .getBoundingClientRect as ReturnType<typeof vi.fn>;
    rectangles.mockClear();

    view.rerender(<List order={["a", "b", "c"]} />);

    expect(rectangles).not.toHaveBeenCalled();
  });

  it("applies reduced-motion changes without travel or a flash", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }) as MediaQueryList),
    );
    const rectangles = HTMLElement.prototype
      .getBoundingClientRect as ReturnType<typeof vi.fn>;
    rectangles.mockClear();
    const view = render(<List order={["a", "b"]} />);
    view.rerender(<List order={["new", "b", "a"]} />);

    expect(calls).toEqual([]);
    expect(rectangles).not.toHaveBeenCalled();
    expect(
      [...view.container.querySelectorAll("[data-flip-row]")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["new", "b", "a"]);
  });
});
