import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/**
 * A ref to the value of the latest committed render. Callbacks whose identity
 * must not change, because memoized rows compare them, read through it.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** A function with one identity for the component's life that calls the latest `fn`. */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useLatest(fn);
  return useCallback((...args) => latest.current(...args), [latest]);
}
