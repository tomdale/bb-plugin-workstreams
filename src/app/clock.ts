import { createContext, useContext, useSyncExternalStore } from "react";

/** How often every clock reader re-checks what it shows. */
const TICK_MS = 60_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    for (const notify of [...listeners]) notify();
  }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const noSubscription = () => () => {};

/**
 * Stops the clock at `now` for everything below it, so a specimen or a test
 * shows the same ages every time.
 */
export const FixedClock = createContext<number | undefined>(undefined);

/**
 * Something derived from the current time, such as a thread's age. Each
 * minute every reader re-derives its value, and only a reader whose value
 * changed renders, so a list of rows pays for the rows whose label moved
 * rather than for the whole list. `read` must return a primitive, which is
 * how a reader's value is compared.
 */
export function useClock<
  T extends string | number | boolean | null | undefined,
>(read: (now: number) => T): T {
  const fixed = useContext(FixedClock);
  const snapshot = () => read(fixed ?? Date.now());
  return useSyncExternalStore(
    fixed === undefined ? subscribe : noSubscription,
    snapshot,
    snapshot,
  );
}
