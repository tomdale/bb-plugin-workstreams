import { useLayoutEffect, useReducer, useRef } from "react";
import { Handoff, type HandoffConfig } from "./headingHandoff.ts";

/** The longest a frame counts for, so a stalled tab does not jump the springs. */
const MAX_FRAME_MS = 50;

/**
 * The handoff's progress for scroll position `s` (px from the newest message).
 * Progress that depends only on the scroll is computed as the component renders;
 * a spring that is still moving keeps the component rendering each frame until
 * it settles. `resetKey` starts the handoff over from rest, as when the thread
 * changes. Disabled, it draws nothing and schedules nothing.
 */
export function useHandoff(
  config: HandoffConfig,
  s: number,
  resetKey: unknown,
  enabled: boolean,
): number {
  const driver = useRef<Handoff | null>(null);
  const started = useRef<{
    key: unknown;
    drive: HandoffConfig["drive"];
  } | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const handoff = (driver.current ??= new Handoff(config));
  if (enabled) {
    handoff.configure(config);
    const begun = started.current;
    if (!begun || begun.key !== resetKey || begun.drive !== config.drive) {
      started.current = { key: resetKey, drive: config.drive };
      handoff.reset(s);
    }
    handoff.scroll(s);
  } else {
    started.current = null;
  }
  const progress = handoff.progress;

  useLayoutEffect(() => {
    if (!enabled || !handoff.moving) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      handoff.tick(Math.min(now - last, MAX_FRAME_MS));
      last = now;
      redraw();
      if (handoff.moving) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  });
  return progress;
}
