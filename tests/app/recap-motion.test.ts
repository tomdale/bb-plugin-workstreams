// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  animateCardIn,
  followResizes,
  growSlot,
  holdSpace,
} from "../../src/app/composer/recapMotion.ts";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * BB's bottom-anchored thread scroller with a fake geometry: the timeline,
 * then the sticky footer whose grid stack holds the recap slot and one
 * sibling banner. The scroll range follows from the timeline and slot sizes.
 */
function scroller(options: {
  timeline: number;
  slot: number;
  viewport: number;
  /** Defaults to pinned at the bottom. */
  scrollTop?: number;
}) {
  const geometry = { ...options, gap: 8, rest: 100 };
  document.body.innerHTML = `
    <div id="scroller">
      <div id="content">
        <div id="timeline"></div>
        <div id="sentinel" class="scroll-bottom-anchor"></div>
        <div data-scroll-footer="">
          <div id="grid" style="display: grid; row-gap: 8px">
            <div style="display: contents"><div id="slot"></div></div>
            <div id="sibling"></div>
          </div>
        </div>
      </div>
    </div>`;
  const byId = (id: string) => document.getElementById(id)!;
  const slot = byId("slot");
  const scrollerEl = byId("scroller");
  const slotHeight = () =>
    slot.style.display === "none"
      ? null
      : slot.style.height
        ? Number.parseFloat(slot.style.height)
        : geometry.slot;
  const scrollHeight = () => {
    const held = slotHeight();
    return (
      geometry.timeline +
      geometry.rest +
      (held === null ? 0 : held + geometry.gap)
    );
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const height =
        this.id === "timeline"
          ? geometry.timeline
          : this.id === "slot"
            ? (slotHeight() ?? 0)
            : 0;
      return { height } as DOMRect;
    },
  );
  Object.defineProperty(scrollerEl, "scrollHeight", { get: scrollHeight });
  Object.defineProperty(scrollerEl, "clientHeight", {
    get: () => geometry.viewport,
  });
  let top = options.scrollTop ?? scrollHeight() - geometry.viewport;
  Object.defineProperty(scrollerEl, "scrollTop", {
    get: () => top,
    set: (value: number) => (top = value),
  });
  return {
    slot,
    slotHeight,
    grow(by: number) {
      geometry.timeline += by;
    },
    scrollTo(value: number) {
      top = value;
      scrollerEl.dispatchEvent(new Event("scroll"));
    },
  };
}

function animationHarness(element: HTMLElement) {
  const animations: {
    finished: Promise<void>;
    cancel: ReturnType<typeof vi.fn>;
    onfinish: (() => void) | null;
    finish(): void;
  }[] = [];
  const animate = vi.fn(
    (_keyframes: Keyframe[], _options?: KeyframeAnimationOptions) => {
      let resolve!: () => void;
      let reject!: () => void;
      const finished = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = () => no(new Error("cancelled"));
      });
      const animation = {
        finished,
        cancel: vi.fn(reject),
        onfinish: null as (() => void) | null,
        finish() {
          resolve();
          animation.onfinish?.();
        },
      };
      // followResizes consumes onfinish, while run consumes finished.
      void finished.catch(() => {});
      animations.push(animation);
      return animation as unknown as Animation;
    },
  );
  Object.defineProperty(element, "animate", {
    configurable: true,
    value: animate,
  });
  return { animations, animate };
}

it.each([false, true])(
  "settles slot/card entrance after cancellation=%s",
  async (cancel) => {
    const slot = document.createElement("div");
    const card = document.createElement("div");
    vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({
      height: 180,
    } as DOMRect);
    const growAnimations = animationHarness(slot);
    const cardAnimations = animationHarness(card);
    const grow = growSlot(slot, 75);
    const enter = animateCardIn(card);
    expect(growAnimations.animate.mock.calls[0]![0]).toEqual([
      { height: "75px", overflow: "hidden" },
      { height: "180px", overflow: "hidden" },
    ]);
    if (cancel) {
      grow.cancel();
      enter.cancel();
    } else {
      growAnimations.animations[0]!.finish();
      cardAnimations.animations[0]!.finish();
    }
    await Promise.all([grow.finished, enter.finished]);
    expect(growAnimations.animations[0]!.cancel).toHaveBeenCalledTimes(
      cancel ? 1 : 0,
    );
  },
);

it("keeps reduced-motion entrance opacity-only and skips slot growth", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  const slot = document.createElement("div");
  const card = document.createElement("div");
  vi.spyOn(slot, "getBoundingClientRect").mockReturnValue({
    height: 180,
  } as DOMRect);
  const growAnimations = animationHarness(slot);
  const cardAnimations = animationHarness(card);
  await growSlot(slot).finished;
  expect(growAnimations.animate).not.toHaveBeenCalled();
  const enter = animateCardIn(card);
  expect(cardAnimations.animate.mock.calls[0]![0]).toEqual([
    { opacity: 0 },
    { opacity: 1 },
  ]);
  cardAnimations.animations[0]!.finish();
  await enter.finished;
});

it("follows content wrapping, snaps on width changes, and cancels on cleanup", () => {
  let callback!: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(next: ResizeObserverCallback) {
        callback = next;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const frame = document.createElement("div");
  const body = document.createElement("div");
  let height = 100;
  let width = 600;
  vi.spyOn(body, "getBoundingClientRect").mockImplementation(
    () => ({ width, height }) as DOMRect,
  );
  vi.spyOn(frame, "getBoundingClientRect").mockImplementation(
    () => ({ height: height + 20 }) as DOMRect,
  );
  const animations = animationHarness(frame);
  const dispose = followResizes(frame, body);
  const deliver = () => callback([], {} as ResizeObserver);
  deliver();
  expect(animations.animate).not.toHaveBeenCalled();
  height = 160;
  deliver();
  expect(animations.animate).toHaveBeenCalledOnce();
  width = 400;
  height = 220;
  deliver();
  expect(animations.animate).toHaveBeenCalledOnce();
  expect(animations.animations[0]!.cancel).toHaveBeenCalledOnce();
  height = 260;
  deliver();
  expect(animations.animate).toHaveBeenCalledTimes(2);
  dispose();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(animations.animations[1]!.cancel).toHaveBeenCalledOnce();
});

it("trades held space for timeline growth until it is used up", () => {
  const dom = scroller({ timeline: 1000, slot: 120, viewport: 600 });
  const onRelease = vi.fn();
  const space = holdSpace(dom.slot, onRelease)!;
  expect(space).not.toBeNull();

  dom.grow(50);
  space.settle();
  expect(dom.slotHeight()).toBe(70);

  // The last 8px are the grid gap, which only goes with the slot.
  dom.grow(70);
  space.settle();
  expect(dom.slotHeight()).toBe(0);
  expect(onRelease).not.toHaveBeenCalled();

  dom.grow(10);
  space.settle();
  expect(dom.slotHeight()).toBeNull();
  expect(onRelease).toHaveBeenCalledOnce();
});

it("releases a short thread at once, since nothing there can move", () => {
  const dom = scroller({ timeline: 100, slot: 120, viewport: 600 });
  const onRelease = vi.fn();
  holdSpace(dom.slot, onRelease)!.settle();
  expect(onRelease).toHaveBeenCalledOnce();
});

it("waits for the ghost before releasing, but not before it is used up", () => {
  const dom = scroller({ timeline: 100, slot: 120, viewport: 600 });
  const onRelease = vi.fn();
  let dissolving = true;
  const space = holdSpace(dom.slot, onRelease, () => dissolving)!;
  space.settle();
  expect(onRelease).not.toHaveBeenCalled();
  dissolving = false;
  space.settle();
  expect(onRelease).toHaveBeenCalledOnce();
});

it("releases once the reader is scrolled far enough up not to notice", () => {
  const dom = scroller({ timeline: 2000, slot: 120, viewport: 600 });
  const onRelease = vi.fn();
  holdSpace(dom.slot, onRelease);
  dom.scrollTo(1550);
  expect(onRelease).not.toHaveBeenCalled();
  dom.scrollTo(1500);
  expect(onRelease).toHaveBeenCalledOnce();
});

it("does nothing outside BB's thread scroller", () => {
  const slot = document.createElement("div");
  document.body.append(slot);
  expect(holdSpace(slot, () => {})).toBeNull();
});

it("switches off the sentinel's scroll anchoring only while holding", () => {
  const dom = scroller({ timeline: 1000, slot: 120, viewport: 600 });
  const sentinel = document.getElementById("sentinel")!;
  const space = holdSpace(dom.slot, () => {})!;
  expect(sentinel.style.overflowAnchor).toBe("none");
  space.dispose();
  expect(sentinel.style.overflowAnchor).toBe("");
});
