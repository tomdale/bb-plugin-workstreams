// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useNow } from "../../src/app/useWorkstreams.ts";

afterEach(() => vi.useRealTimers());

it("refreshes at a deadline without a thread event", () => {
  vi.useFakeTimers();
  const at = 1_000_000;
  vi.setSystemTime(at);
  const { result, unmount } = renderHook(() => useNow(60_000, at + 1234));
  act(() => vi.advanceTimersByTime(1233));
  expect(result.current).toBe(at);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe(at + 1234);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("reschedules a nearer deadline and cancels the previous timer", () => {
  vi.useFakeTimers();
  const at = 1_000_000;
  vi.setSystemTime(at);
  const { result, rerender, unmount } = renderHook(
    ({ deadline }) => useNow(60_000, deadline),
    { initialProps: { deadline: at + 50_000 } },
  );
  rerender({ deadline: at + 25 });
  act(() => vi.advanceTimersByTime(25));
  expect(result.current).toBe(at + 25);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
