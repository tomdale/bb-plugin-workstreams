import {
  colorTokenCss,
  derivedText,
  THEME_COLORS,
  TOKEN_ROOTS,
  type ColorPrefs,
  type ThemeColor,
} from "../../domain/colors.ts";
import { fromRgb, type Color, type Palette } from "../../domain/vivid.ts";

/** A root whose theme colors this sweep resolves, inside that root's scope. */
type PaletteRequest = { root: HTMLElement; dark: boolean };

type Probe = { key: ThemeColor; part: "base" | "text"; element: HTMLElement };

/**
 * Resolves each root's theme colors through the browser, in the root's own
 * inheritance.
 *
 * Every probe is styled before the sweep reads a computed style, so the page
 * recalculates style once. Styling and reading one color at a time instead
 * forces that recalculation for every color, and each recalculation matches the
 * whole document against the token style sheet.
 */
function readPalettes(
  requests: readonly PaletteRequest[],
): Array<Partial<Record<ThemeColor, Palette>>> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const toColor = (css: string): Color | null => {
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
    return fromRgb([r / 255, g / 255, b / 255], a / 255);
  };

  const scopes = requests.map(({ root, dark }) => {
    const reader = document.createElement("span");
    reader.dataset.wsColorReader = "";
    reader.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;--ws-text-min-l:${dark ? 0.78 : 0};--ws-text-max-l:${dark ? 1 : 0.55}`;
    root.append(reader);
    const probes = Object.entries(THEME_COLORS).flatMap(([key, theme]) => {
      const base = document.createElement("span");
      base.style.setProperty("color", `var(${theme.base})`, "important");
      const text = document.createElement("span");
      text.style.setProperty(
        "color",
        theme.text ? `var(${theme.text})` : derivedText(`var(${theme.base})`),
        "important",
      );
      reader.append(base, text);
      return [
        { key: key as ThemeColor, part: "base" as const, element: base },
        { key: key as ThemeColor, part: "text" as const, element: text },
      ];
    });
    return { reader, probes };
  });

  try {
    // All probes are styled, so these reads share one style recalculation.
    return scopes.map(({ probes }) => {
      const byKey = new Map<ThemeColor, { base?: Color; text?: Color }>();
      for (const { key, part, element } of probes) {
        const color = toColor(getComputedStyle(element).color);
        if (!color) continue;
        const entry = byKey.get(key) ?? {};
        entry[part] = color;
        byKey.set(key, entry);
      }
      const palettes: Partial<Record<ThemeColor, Palette>> = {};
      for (const [key, entry] of byKey)
        if (entry.base && entry.text)
          palettes[key] = {
            text: entry.text,
            border: { ...entry.base, alpha: entry.base.alpha * 0.75 },
            surface: { ...entry.base, alpha: entry.base.alpha * 0.06 },
          };
      return palettes;
    });
  } finally {
    for (const { reader } of scopes) reader.remove();
  }
}

/** Where a root's vivid paints live, and the theme they were resolved for. */
type RootPaint = { epoch: number; dark: boolean; rules: string };

/** Installs window-local paints; every root resolves its own inherited BB theme. */
export function installColorTokens(colors: ColorPrefs): () => void {
  const style = document.createElement("style");
  style.dataset.wsColorTokens = "";
  document.head.append(style);
  const ids = new Map<HTMLElement, string>();
  const paints = new Map<string, string>();
  const painted = new Map<HTMLElement, RootPaint>();
  let sequence = 0;
  let frame = 0;
  let roots = new Set<HTMLElement>();
  // Bumped when the theme may have changed. Resolving theme colors costs a
  // document-wide style recalculation, so it follows theme changes rather than
  // every mutation the page makes.
  let epoch = 0;
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const darkFor = (root: HTMLElement) => {
    const appearance = root.closest(".dark, .light");
    return appearance
      ? appearance.classList.contains("dark")
      : (media?.matches ?? false);
  };
  const update = () => {
    frame = 0;
    const theme = epoch;
    roots = new Set(document.querySelectorAll<HTMLElement>(TOKEN_ROOTS));
    for (const [root] of ids)
      if (!roots.has(root)) {
        root.removeAttribute("data-ws-palette");
        ids.delete(root);
      }
    for (const root of painted.keys())
      if (!roots.has(root)) painted.delete(root);

    const requests: PaletteRequest[] = [];
    if (colors.vivid)
      for (const root of roots) {
        const dark = darkFor(root);
        const current = painted.get(root);
        if (current && current.epoch === theme && current.dark === dark)
          continue;
        requests.push({ root, dark });
      }
    const palettes = requests.length ? readPalettes(requests) : [];
    requests.forEach(({ root, dark }, index) => {
      const key = JSON.stringify([palettes[index], dark]);
      let rules = paints.get(key);
      if (!rules) {
        rules = colorTokenCss(
          colors,
          palettes[index],
          dark,
          '[data-ws-palette="PALETTE"]',
        );
        if (paints.size >= 64) paints.clear();
        paints.set(key, rules);
      }
      painted.set(root, { epoch: theme, dark, rules });
    });

    let css = colorTokenCss(colors);
    for (const root of roots) {
      let id = ids.get(root);
      if (!id) {
        id = String(++sequence);
        ids.set(root, id);
        root.dataset.wsPalette = id;
      }
      const paint = painted.get(root);
      const dark = paint?.dark ?? darkFor(root);
      css += `[data-ws-palette="${id}"] { --ws-text-min-l: ${dark ? 0.78 : 0}; --ws-text-max-l: ${dark ? 1 : 0.55}; }\n`;
      if (paint) css += paint.rules.replaceAll('"PALETTE"', `"${id}"`);
    }
    if (style.textContent !== css) style.textContent = css;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const reschedule = () => {
    epoch++;
    schedule();
  };
  /**
   * Whether a mutation can change a root's resolved theme. Content churn — rows,
   * messages, hover fills, scroll fades — cannot: a root's colors come from its
   * theme scope and from variables it inherits from its ancestors.
   */
  const changesTheme = (record: MutationRecord): boolean => {
    const target =
      record.target instanceof Element
        ? record.target
        : record.target.parentElement;
    if (!target || target === style || target.closest("[data-ws-color-reader]"))
      return false;
    if (record.type === "attributes") {
      const name = record.attributeName;
      if (name === "href" || name === "media" || name === "disabled")
        return target.matches("link, style");
      if (target === document.documentElement || target === document.body)
        return true;
      // A theme scope sets the appearance band and can carry its own variables.
      if (
        target.classList.contains("dark") ||
        target.classList.contains("light")
      )
        return true;
      // A root's own class and style set its scope; everything inside it only
      // inherits.
      const scope = target.closest(TOKEN_ROOTS);
      if (scope) return scope === target;
      // The rest is inherited, so only a root's ancestors can restyle it.
      for (const root of roots) if (target.contains(root)) return true;
      return false;
    }
    if (target.closest("style")) return true;
    return [...record.addedNodes, ...record.removedNodes].some(
      (node) =>
        node instanceof Element &&
        !node.matches("[data-ws-color-reader]") &&
        (node.matches(`${TOKEN_ROOTS}, style, link`) ||
          node.querySelector(`${TOKEN_ROOTS}, style, link`)),
    );
  };
  const observer = new MutationObserver((records) => {
    if (records.some(changesTheme)) reschedule();
  });
  update();
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "href", "media", "disabled"],
  });
  media?.addEventListener("change", reschedule);
  // A theme arrives with the document's own style sheets, and only those can
  // change what a root inherits. This style element announces its own writes as
  // loads, which must not count as a theme change.
  const onLoad = (event: Event) => {
    const target = event.target;
    if (target === style) return;
    if (
      target === document ||
      (target instanceof Element && target.matches("link, style"))
    )
      reschedule();
  };
  document.addEventListener("load", onLoad, true);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    media?.removeEventListener("change", reschedule);
    document.removeEventListener("load", onLoad, true);
    style.remove();
    for (const root of ids.keys()) root.removeAttribute("data-ws-palette");
  };
}
