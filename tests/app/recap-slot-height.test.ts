// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { observeSlotHeight } from "../../src/app/composer/recapMotion.ts";

function observerHarness() {
  const observers: {
    callback: ResizeObserverCallback;
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({
          callback,
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    },
  );
  return {
    observers,
    deliver(target: Element, height: number, border = true, index = 0) {
      observers[index]!.callback(
        [
          {
            target,
            contentRect: { height },
            borderBoxSize: border ? [{ blockSize: height }] : [],
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses delivered slot sizes without geometry reads at mount or delivery", () => {
  const ro = observerHarness();
  const slot = document.createElement("div");
  const read = vi
    .spyOn(slot, "getBoundingClientRect")
    .mockImplementation(() => {
      throw Error("Unexpected layout read");
    });
  const measurement = observeSlotHeight(slot);
  expect(ro.observers[0]!.observe).toHaveBeenCalledWith(slot, {
    box: "border-box",
  });
  ro.deliver(slot, 120.5);
  expect(measurement.height()).toBe(120.5);
  ro.deliver(slot, 182.25);
  expect(measurement.height()).toBe(182.25);
  ro.deliver(slot, 0);
  expect(measurement.height()).toBe(0);
  expect(read).not.toHaveBeenCalled();
  measurement.dispose();
});

it("reads live geometry if hidden before the first observer delivery", () => {
  const ro = observerHarness();
  const slot = document.createElement("div");
  const read = vi
    .spyOn(slot, "getBoundingClientRect")
    .mockReturnValue({ height: 124 } as DOMRect);
  const measurement = observeSlotHeight(slot);
  expect(read).not.toHaveBeenCalled();
  expect(measurement.height()).toBe(124);
  ro.deliver(slot, 140);
  expect(measurement.height()).toBe(140);
  expect(read).toHaveBeenCalledOnce();
  measurement.dispose();
});

it("keeps the fallback live when ResizeObserver is absent", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const slot = document.createElement("div");
  const read = vi
    .spyOn(slot, "getBoundingClientRect")
    .mockReturnValue({ height: 120 } as DOMRect);
  const measurement = observeSlotHeight(slot);
  expect(read).not.toHaveBeenCalled();
  expect(measurement.height()).toBe(120);
  read.mockReturnValue({ height: 200 } as DOMRect);
  expect(measurement.height()).toBe(200);
  measurement.dispose();
});

it("accepts contentRect for the unpadded slot when border-box sizes are absent", () => {
  const ro = observerHarness();
  const slot = document.createElement("div");
  const measurement = observeSlotHeight(slot);
  ro.deliver(slot, 156.75, false);
  expect(measurement.height()).toBe(156.75);
  measurement.dispose();
});

it("ignores other targets and queued deliveries after cleanup", () => {
  const ro = observerHarness();
  const slot = document.createElement("div");
  const measurement = observeSlotHeight(slot);
  ro.deliver(slot, 120);
  ro.deliver(document.createElement("div"), 500);
  expect(measurement.height()).toBe(120);
  measurement.dispose();
  expect(ro.observers[0]!.disconnect).toHaveBeenCalledOnce();
  ro.deliver(slot, 999);
  const next = observeSlotHeight(slot);
  ro.deliver(slot, 180, true, 1);
  expect(next.height()).toBe(180);
  expect(measurement.height()).toBe(120);
  next.dispose();
});
