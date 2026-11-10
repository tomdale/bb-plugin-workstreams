// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FixedClock, useClock } from "../../src/app/clock.ts";
import { relativeAge } from "../../src/domain/presentation.ts";

const START = Date.UTC(2026, 0, 1, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Age({ at, onRender }: { at: number; onRender: () => void }) {
  const age = useClock((now) => relativeAge(at, now));
  return (
    <Profiler id={String(at)} onRender={onRender}>
      <output data-at={at}>{age}</output>
    </Profiler>
  );
}

it("re-renders a reader only when its derived value changes", () => {
  const young = vi.fn();
  const old = vi.fn();
  const view = render(
    <>
      <Age at={START - 30_000} onRender={young} />
      <Age at={START - 5 * 3_600_000} onRender={old} />
    </>,
  );
  const text = (at: number) =>
    view.container.querySelector(`[data-at="${at}"]`)?.textContent;
  expect(text(START - 30_000)).toBe("now");
  const youngRenders = young.mock.calls.length;
  const oldRenders = old.mock.calls.length;

  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(text(START - 30_000)).toBe("1m");
  expect(young.mock.calls.length).toBeGreaterThan(youngRenders);
  expect(old.mock.calls.length).toBe(oldRenders);
  expect(text(START - 5 * 3_600_000)).toBe("5h");
});

it("stops its timer with its last reader", () => {
  const view = render(<Age at={START} onRender={() => {}} />);
  expect(vi.getTimerCount()).toBe(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("holds a fixed clock still", () => {
  const view = render(
    <FixedClock.Provider value={START + 3 * 60_000}>
      <Age at={START} onRender={() => {}} />
    </FixedClock.Provider>,
  );
  expect(view.container.textContent).toBe("3m");
  expect(vi.getTimerCount()).toBe(0);
  act(() => {
    vi.advanceTimersByTime(600_000);
  });
  expect(view.container.textContent).toBe("3m");
});
