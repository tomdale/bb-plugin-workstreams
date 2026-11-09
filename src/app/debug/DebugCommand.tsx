import { useEffect, useMemo } from "react";
import type { PrefsPatch } from "../../domain/prefs.ts";
import { usePrefs } from "../prefs.ts";

let current: {
  shown: boolean;
  save: (patch: PrefsPatch) => Promise<void>;
} | null = null;

/** The app-wide command reads and writes the live preference through the bridge. */
export function DebugCommandBridge(): null {
  const { prefs, save } = usePrefs();
  const bridge = useMemo(
    () => ({ shown: prefs?.advanced.debugUi ?? false, save }),
    [prefs, save],
  );
  current = bridge;
  useEffect(() => {
    return () => {
      if (current === bridge) current = null;
    };
  }, [bridge]);
  return null;
}

/**
 * Shows or hides the debug UI. Recording is a separate preference, so this
 * never stops traces: what was recorded while the UI was hidden is there when
 * it comes back.
 */
export function toggleDebugUi(): void {
  if (!current) return;
  void current.save({ advanced: { debugUi: !current.shown } });
}
