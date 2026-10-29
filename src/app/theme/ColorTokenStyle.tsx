import { useLayoutEffect } from "react";
import { colorTokenCss } from "../../domain/colors.ts";
import { usePrefs } from "../prefs.ts";

/**
 * Applies the color choices from Settings → Workstreams → Colors to every
 * Workstreams surface in this window. Mounted once per window as an app
 * overlay; tokens.css supplies the defaults until preferences load, and when
 * every token is at its default this adds nothing.
 */
export function ColorTokenStyle() {
  const { prefs } = usePrefs();
  const css = prefs ? colorTokenCss(prefs.colors) : "";
  useLayoutEffect(() => {
    if (!css) return;
    const style = document.createElement("style");
    style.dataset.wsColorTokens = "";
    // colorTokenCss builds this from enum values and validated #rrggbb only.
    style.textContent = css;
    document.head.append(style);
    return () => style.remove();
  }, [css]);
  return null;
}
