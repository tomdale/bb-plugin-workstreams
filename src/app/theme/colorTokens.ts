import {
  colorTokenCss,
  derivedText,
  TEXT_BAND,
  THEME_COLORS,
  type Appearance,
  type ColorPrefs,
  type ThemeColor,
  type ThemePalettes,
} from "../../domain/colors.ts";
import { fromRgb, type Color, type Palette } from "../../domain/vivid.ts";

const APPEARANCES = ["light", "dark"] as const satisfies readonly Appearance[];
const THEME_KEYS = Object.keys(THEME_COLORS) as ThemeColor[];

/**
 * The probe properties for each theme color. They are registered as typed
 * colors that do not inherit and start as `none`, so the browser computes each
 * one to an absolute color, and one that names a missing or non-color BB
 * variable computes to `none` instead of borrowing a color from its ancestors.
 */
const probe = (key: ThemeColor, part: "base" | "text") =>
  `--ws-probe-${key}-${part}`;

let registered = false;
function registerProbes() {
  if (registered) return;
  registered = true;
  for (const key of THEME_KEYS)
    for (const part of ["base", "text"] as const)
      try {
        globalThis.CSS?.registerProperty?.({
          name: probe(key, part),
          syntax: "<color> | none",
          inherits: false,
          initialValue: "none",
        });
      } catch {
        // Already registered by an earlier copy of this module in the window,
        // with the same definition.
      }
}

/** BB's theme colors as computed CSS color strings, per appearance. */
type ResolvedTheme = Record<
  Appearance,
  Partial<Record<ThemeColor, { base: string; text: string }>>
>;

/**
 * Reads BB's theme colors under both appearances at once.
 *
 * BB declares its theme variables only on `:root, .light` and on `.dark`, in
 * document style sheets, so a host shaped like a Workstreams root inside a
 * `.light` element, and another inside a `.dark` element, see what every root
 * under that appearance inherits, whichever appearance the page shows. Each
 * host carries every probe, so both cost one style update and one computed
 * style each, however many roots the page holds. They sit in a
 * `display: none` subtree, so nothing is laid out.
 */
function readTheme(): ResolvedTheme {
  registerProbes();
  const container = document.createElement("div");
  container.dataset.wsColorReader = "";
  container.style.display = "none";
  const hosts = APPEARANCES.map((appearance) => {
    const scope = document.createElement("div");
    scope.className = appearance;
    const host = document.createElement("div");
    host.dataset.bbPlugin = "workstreams";
    const band = TEXT_BAND[appearance];
    host.style.setProperty("--ws-text-min-l", String(band.min));
    host.style.setProperty("--ws-text-max-l", String(band.max));
    for (const key of THEME_KEYS) {
      const theme = THEME_COLORS[key];
      host.style.setProperty(probe(key, "base"), `var(${theme.base})`);
      host.style.setProperty(
        probe(key, "text"),
        theme.text ? `var(${theme.text})` : derivedText(`var(${theme.base})`),
      );
    }
    scope.append(host);
    container.append(scope);
    return { appearance, host };
  });
  document.body.append(container);
  try {
    const theme: ResolvedTheme = { light: {}, dark: {} };
    for (const { appearance, host } of hosts) {
      const style = getComputedStyle(host);
      for (const key of THEME_KEYS)
        theme[appearance][key] = {
          base: style.getPropertyValue(probe(key, "base")),
          text: style.getPropertyValue(probe(key, "text")),
        };
    }
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
    // `none` is a missing BB variable; `currentcolor` would paint the canvas's
    // own text color.
    if (!context || !css || css === "none" || css === "currentcolor")
      return null;
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
 * unmounting, or restyling never touch the sheet or read the page, and neither
 * does switching between light and dark, since the sheet holds both.
 *
 * Vivid paints are computed from BB's resolved theme colors, so with vivid on
 * the sheet is recomputed when the document's style sheets change: BB swaps
 * themes by rewriting a `<style>` in the head, and loads style sheets as
 * `<link>`s there.
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
  // BB also adds `<link rel="preload">` and `<link rel="modulepreload">` as it
  // loads plugins, and retitles the page; none of them can change a theme.
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
      return (
        isStyleSheet(target) ||
        (record.attributeName === "rel" &&
          /(^|\s)stylesheet(\s|$)/i.test(record.oldValue ?? ""))
      );
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
    attributeOldValue: true,
    attributeFilter: ["href", "media", "disabled", "rel"],
  });
  // A linked style sheet applies when it loads, after the mutation that added
  // it. A `<style>` applies its text at once, so its load event adds nothing.
  const onLoad = (event: Event) => {
    const target = event.target as Node | null;
    if (target instanceof HTMLLinkElement && isStyleSheet(target)) schedule();
  };
  document.addEventListener("load", onLoad, true);
  // A style sheet's `prefers-color-scheme` queries change what it declares when
  // the system appearance changes, with no mutation to observe.
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", schedule);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    document.removeEventListener("load", onLoad, true);
    media?.removeEventListener("change", schedule);
    style.remove();
  };
}
