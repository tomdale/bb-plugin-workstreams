import {
  APPEARANCE_SCOPES,
  colorTokenCss,
  derivedText,
  THEME_COLORS,
  type Appearance,
  type ColorPrefs,
  type ThemeColor,
  type ThemePalettes,
} from "../../domain/colors.ts";
import { fromRgb, type Color, type Palette } from "../../domain/vivid.ts";

const APPEARANCES = ["light", "dark"] as const;

/** BB's theme colors as computed CSS color strings, per appearance. */
type ResolvedTheme = Record<
  Appearance,
  Partial<Record<ThemeColor, { base: string; text: string }>>
>;

/**
 * Reads BB's theme colors under each appearance through the browser.
 *
 * BB defines its theme variables in document style sheets on `:root, .light`
 * and `.dark` (see `APPEARANCE_SCOPES`), and never per element. So one probe
 * per appearance, shaped like a Workstreams root, reads exactly what every root
 * under that appearance inherits, and the result serves every root on the page
 * until a style sheet changes. The probes sit in a `display: none` subtree, so
 * reading them computes style for those few elements and lays nothing out.
 */
function readTheme(): ResolvedTheme {
  const container = document.createElement("div");
  container.dataset.wsColorReader = "";
  container.style.display = "none";
  const probes = APPEARANCES.flatMap((appearance) => {
    const scope = document.createElement("div");
    scope.className = appearance;
    const root = document.createElement("div");
    root.dataset.bbPlugin = "workstreams";
    const band = appearance === "dark" ? [0.78, 1] : [0, 0.55];
    root.style.cssText = `--ws-text-min-l:${band[0]};--ws-text-max-l:${band[1]}`;
    scope.append(root);
    container.append(scope);
    return Object.entries(THEME_COLORS).map(([key, theme]) => {
      const base = document.createElement("span");
      base.style.setProperty("color", `var(${theme.base})`, "important");
      const text = document.createElement("span");
      text.style.setProperty(
        "color",
        theme.text ? `var(${theme.text})` : derivedText(`var(${theme.base})`),
        "important",
      );
      root.append(base, text);
      return { appearance, key: key as ThemeColor, base, text };
    });
  });
  document.body.append(container);
  try {
    const theme: ResolvedTheme = { light: {}, dark: {} };
    // Every probe is styled before the first read, so the reads share one
    // style update.
    for (const { appearance, key, base, text } of probes)
      theme[appearance][key] = {
        base: getComputedStyle(base).color,
        text: getComputedStyle(text).color,
      };
    return theme;
  } finally {
    container.remove();
  }
}

/** Converts computed colors to OKLCH by painting each one into a pixel. */
function palettesFor(theme: ResolvedTheme): ThemePalettes {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const toColor = (css: string): Color | null => {
    if (!context || !css || !CSS.supports("color", css)) return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(
      0,
      0,
      1,
      1,
    ).data;
    return fromRgb([r / 255, g / 255, b / 255], a / 255);
  };
  const palettes: ThemePalettes = {};
  for (const appearance of APPEARANCES) {
    const resolved: Partial<Record<ThemeColor, Palette>> = {};
    for (const [key, colors] of Object.entries(theme[appearance])) {
      const base = toColor(colors.base);
      const text = toColor(colors.text);
      if (base && text)
        resolved[key as ThemeColor] = {
          text,
          border: { ...base, alpha: base.alpha * 0.75 },
          surface: { ...base, alpha: base.alpha * 0.06 },
        };
    }
    palettes[appearance] = resolved;
  }
  return palettes;
}

/**
 * The last theme resolved in this window, keyed by its computed colors. A style
 * sheet that arrives without changing them, and a reinstall for new
 * preferences, reuse the palettes instead of converting them again.
 */
let lastTheme: { key: string; palettes: ThemePalettes } | null = null;

function themePalettes(): ThemePalettes {
  const theme = readTheme();
  const key = JSON.stringify(theme);
  if (lastTheme?.key !== key) lastTheme = { key, palettes: palettesFor(theme) };
  return lastTheme.palettes;
}

/**
 * Installs the window's token sheet: static rules that every Workstreams root
 * matches by selector, as a theme's own variables are. Roots mounting,
 * unmounting, or restyling never touch the sheet or read the page.
 *
 * Vivid paints are computed from BB's resolved theme colors, so with vivid on
 * the sheet is recomputed when the document's style sheets change: BB swaps
 * themes by rewriting a `<style>` in the head, and loads style sheets as
 * `<link>`s there. Switching between light and dark only moves the `.dark`
 * class, which the sheet's appearance scopes already cover.
 */
export function installColorTokens(colors: ColorPrefs): () => void {
  const style = document.createElement("style");
  style.dataset.wsColorTokens = "";
  document.head.append(style);
  let frame = 0;
  const write = () => {
    frame = 0;
    const css = colorTokenCss(
      colors,
      colors.vivid ? themePalettes() : undefined,
    );
    // Rewriting the sheet restyles the whole document, so it happens only when
    // the rules change.
    if (style.textContent !== css) style.textContent = css;
  };
  write();
  if (!colors.vivid) return () => style.remove();

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(write);
  };
  // BB also adds `<link rel="modulepreload">`s as threads lazy-load code, and
  // retitles the page; neither can change a theme.
  const isStyleSheet = (node: Node | null): node is Element =>
    node !== style &&
    node instanceof Element &&
    node.matches('style, link[rel~="stylesheet" i]');
  /** Whether a head mutation can change the theme: any style sheet but ours. */
  const changesStyles = (record: MutationRecord) => {
    const target =
      record.target instanceof Element
        ? record.target
        : record.target.parentElement;
    if (record.type === "childList" && target === document.head)
      return [...record.addedNodes, ...record.removedNodes].some(isStyleSheet);
    // A `<link>` whose `rel` changes may be leaving the style sheets.
    if (record.type === "attributes")
      return target !== style && !!target?.matches("style, link");
    // Text rewritten inside a `<style>`.
    return isStyleSheet(target?.closest("style") ?? null);
  };
  const observer = new MutationObserver((records) => {
    if (records.some(changesStyles)) schedule();
  });
  observer.observe(document.head, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["href", "media", "disabled", "rel"],
  });
  // A linked style sheet applies when it loads, after the mutation that added
  // it. A `<style>` applies its text at once, so its load event adds nothing.
  const onLoad = (event: Event) => {
    const target = event.target as Node | null;
    if (target instanceof HTMLLinkElement && isStyleSheet(target)) schedule();
  };
  document.addEventListener("load", onLoad, true);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    document.removeEventListener("load", onLoad, true);
    style.remove();
  };
}
