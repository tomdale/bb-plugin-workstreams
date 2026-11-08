import { useEffect, useMemo } from "react";
import type { PrefsPatch } from "../../domain/prefs.ts";
import { usePrefs } from "../prefs.ts";

let current: {
  debug: boolean;
  save: (patch: PrefsPatch) => Promise<void>;
} | null = null;

/** The app-wide command reads and writes the live preference through the bridge. */
export function DebugCommandBridge(): null {
  const { prefs, save } = usePrefs();
  const bridge = useMemo(
    () => ({ debug: prefs?.advanced.debug ?? false, save }),
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

/** Flips the Debug mode preference; a no-op until the bridge mounts. */
export function toggleDebugMode(): void {
  if (!current) return;
  void current.save({ advanced: { debug: !current.debug } });
}
