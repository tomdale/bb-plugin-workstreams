import {
  colorTokenCss,
  derivedText,
  THEME_COLORS,
  TOKEN_ROOTS,
  type ColorPrefs,
  type ThemeColor,
} from "../../domain/colors.ts";
import { fromRgb, type Color, type Palette } from "../../domain/vivid.ts";

/** Resolves CSS variables through the browser in the same theme scope as the plugin root. */
function readPalettes(
  root: HTMLElement,
  dark: boolean,
): Partial<Record<ThemeColor, Palette>> {
  const reader = document.createElement("span");
  reader.dataset.wsColorReader = "";
  reader.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;--ws-text-min-l:${dark ? 0.78 : 0};--ws-text-max-l:${dark ? 1 : 0.55}`;
  root.append(reader);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map<string, Color | null>();
  const read = (expression: string): Color | null => {
    if (cache.has(expression)) return cache.get(expression)!;
    reader.style.setProperty("color", expression, "important");
    const css = getComputedStyle(reader).color;
    if (!context || !CSS.supports("color", css)) return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(
      0,
      0,
      1,
      1,
    ).data;
    const color = fromRgb([r / 255, g / 255, b / 255], a / 255);
    cache.set(expression, color);
    return color;
  };
  try {
    return Object.fromEntries(
      Object.entries(THEME_COLORS).flatMap(([key, theme]) => {
        const base = read(`var(${theme.base})`);
        const text = read(
          theme.text ? `var(${theme.text})` : derivedText(`var(${theme.base})`),
        );
        return base && text
          ? [
              [
                key,
                {
                  text,
                  border: { ...base, alpha: base.alpha * 0.75 },
                  surface: { ...base, alpha: base.alpha * 0.06 },
                },
              ],
            ]
          : [];
      }),
    );
  } finally {
    reader.remove();
  }
}

/** Installs window-local paints; every root resolves its own inherited BB theme. */
export function installColorTokens(colors: ColorPrefs): () => void {
  const style = document.createElement("style");
  style.dataset.wsColorTokens = "";
  document.head.append(style);
  const ids = new Map<HTMLElement, string>();
  const paints = new Map<string, string>();
  let sequence = 0;
  let frame = 0;
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const update = () => {
    frame = 0;
    let css = colorTokenCss(colors);
    const roots = new Set(document.querySelectorAll<HTMLElement>(TOKEN_ROOTS));
    for (const [root] of ids)
      if (!roots.has(root)) {
        root.removeAttribute("data-ws-palette");
        ids.delete(root);
      }
    for (const root of roots) {
      let id = ids.get(root);
      if (!id) {
        id = String(++sequence);
        ids.set(root, id);
        root.dataset.wsPalette = id;
      }
      const appearance = root.closest(".dark, .light");
      const dark = appearance
        ? appearance.classList.contains("dark")
        : (media?.matches ?? false);
      css += `[data-ws-palette="${id}"] { --ws-text-min-l: ${dark ? 0.78 : 0}; --ws-text-max-l: ${dark ? 1 : 0.55}; }\n`;
      if (!colors.vivid) continue;
      const palettes = readPalettes(root, dark);
      const key = JSON.stringify([palettes, dark]);
      let rules = paints.get(key);
      if (!rules) {
        rules = colorTokenCss(
          colors,
          palettes,
          dark,
          '[data-ws-palette="PALETTE"]',
        );
        if (paints.size >= 64) paints.clear();
        paints.set(key, rules);
      }
      css += rules.replaceAll('"PALETTE"', `"${id}"`);
    }
    if (style.textContent !== css) style.textContent = css;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const observer = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      const target =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement;
      if (
        !target ||
        target === style ||
        target.closest("[data-ws-color-reader]")
      )
        return false;
      if (record.type === "attributes")
        return !target.closest(TOKEN_ROOTS) || target.matches(TOKEN_ROOTS);
      if (target.closest("style")) return true;
      return [...record.addedNodes, ...record.removedNodes].some(
        (node) =>
          node instanceof Element &&
          !node.matches("[data-ws-color-reader]") &&
          (node.matches(`${TOKEN_ROOTS}, style, link`) ||
            node.querySelector(`${TOKEN_ROOTS}, style, link`)),
      );
    });
    if (relevant) schedule();
  });
  update();
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "href", "media", "disabled"],
  });
  media?.addEventListener("change", schedule);
  document.addEventListener("load", schedule, true);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    media?.removeEventListener("change", schedule);
    document.removeEventListener("load", schedule, true);
    style.remove();
    for (const root of ids.keys()) root.removeAttribute("data-ws-palette");
  };
}
