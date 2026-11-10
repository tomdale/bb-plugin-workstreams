import { useLayoutEffect } from "react";
import { installColorTokens } from "./colorTokens.ts";
import { usePrefs } from "../prefs.ts";

/** One overlay per window applies persisted colors to slots and portal roots. */
export function ColorTokenStyle() {
  const { prefs } = usePrefs();
  const colors = prefs?.colors;
  useLayoutEffect(() => {
    if (colors) return installColorTokens(colors);
  }, [colors]);
  return null;
}
