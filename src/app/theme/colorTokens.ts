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

/**
 * Where a root's vivid paints live, and the theme they were resolved for. Roots
 * whose paints are identical share a `key`, and so a style rule.
 */
type RootPaint = {
  epoch: number;
  dark: boolean;
  rules: string;
  key: string;
};

/** Installs window-local paints; every root resolves its own inherited BB theme. */
export function installColorTokens(colors: ColorPrefs): () => void {
  const style = document.createElement("style");
  style.dataset.wsColorTokens = "";
  document.head.append(style);
  // Roots with the same paints share one `data-ws-palette` value and one rule,
  // so a root joining the page names an existing rule and leaves the style
  // sheet alone. Rewriting the sheet restyles the whole document, which costs
  // over a hundred milliseconds on a long thread.
  const tagged = new Set<HTMLElement>();
  const paletteIds = new Map<string, string>();
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
  /**
   * What a style attribute hands down to the colors resolved beneath it: custom
   * properties, which carry the theme, and the color properties themselves.
   * Everything else (scroll padding, transforms, sizes) cannot change a palette.
   */
  const inheritedStyle = (style: CSSStyleDeclaration): string => {
    const declared: string[] = [];
    for (let index = 0; index < style.length; index++) {
      const name = style.item(index);
      if (name.startsWith("--") || name === "color" || name === "color-scheme")
        declared.push(`${name}:${style.getPropertyValue(name)}`);
    }
    return declared.sort().join(";");
  };
  const setsOwnTheme = (root: HTMLElement) => inheritedStyle(root.style) !== "";
  const update = () => {
    frame = 0;
    const theme = epoch;
    roots = new Set(document.querySelectorAll<HTMLElement>(TOKEN_ROOTS));
    for (const root of tagged)
      if (!roots.has(root)) {
        root.removeAttribute("data-ws-palette");
        tagged.delete(root);
      }
    for (const root of painted.keys())
      if (!roots.has(root)) painted.delete(root);

    // Roots inherit their theme from the scope that holds them, so one read
    // serves every root in a scope. Reading a root costs a restyle of the page
    // under it, and a long thread keeps many roots mounting as it scrolls. A
    // root that sets its own variables is read on its own.
    const fresh = (paint: RootPaint | undefined, dark: boolean) =>
      paint && paint.epoch === theme && paint.dark === dark ? paint : null;
    const scopeOf = (root: HTMLElement) => root.closest(".dark, .light");
    const donors = new Map<Element | null, RootPaint>();
    const stale: Array<{ root: HTMLElement; dark: boolean }> = [];
    if (colors.vivid)
      for (const root of roots) {
        const dark = darkFor(root);
        const paint = fresh(painted.get(root), dark);
        if (!paint) stale.push({ root, dark });
        else if (!setsOwnTheme(root)) donors.set(scopeOf(root), paint);
      }
    const requests: PaletteRequest[] = [];
    const followers: Array<{ root: HTMLElement; scope: Element | null }> = [];
    const readers = new Map<Element | null, HTMLElement>();
    for (const { root, dark } of stale) {
      if (setsOwnTheme(root)) {
        requests.push({ root, dark });
        continue;
      }
      const scope = scopeOf(root);
      const donor = donors.get(scope);
      if (donor && donor.dark === dark) painted.set(root, donor);
      else if (readers.has(scope)) followers.push({ root, scope });
      else {
        readers.set(scope, root);
        requests.push({ root, dark });
      }
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
      painted.set(root, { epoch: theme, dark, rules, key });
    });
    for (const { root, scope } of followers) {
      const paint = painted.get(readers.get(scope)!);
      if (paint) painted.set(root, paint);
    }

    const groups = new Map<
      string,
      { id: string; dark: boolean; paint?: RootPaint }
    >();
    for (const root of roots) {
      const paint = painted.get(root);
      const dark = paint?.dark ?? darkFor(root);
      const key = paint?.key ?? `plain:${dark}`;
      let group = groups.get(key);
      if (!group) {
        let id = paletteIds.get(key);
        if (!id) {
          id = String(++sequence);
          paletteIds.set(key, id);
        }
        group = { id, dark, paint };
        groups.set(key, group);
      }
      if (root.dataset.wsPalette !== group.id)
        root.dataset.wsPalette = group.id;
      tagged.add(root);
    }
    for (const key of paletteIds.keys())
      if (!groups.has(key)) paletteIds.delete(key);
    let css = colorTokenCss(colors);
    // In a fixed order, so the sheet's text changes only when its rules do.
    const ordered = [...groups.values()].sort((a, b) => +a.id - +b.id);
    for (const { id, dark, paint } of ordered) {
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
  const scratch = document.createElement("div");
  /**
   * Whether a style attribute write changed what the element hands down. The
   * thread's scroller is an ancestor of every message's roots and takes style
   * writes while the sticky heading moves, so counting each one as a theme
   * change would resolve every root's palette on each of those frames.
   */
  const handsDownNewStyle = (record: MutationRecord, target: Element) => {
    if (!(target instanceof HTMLElement)) return true;
    // A null old value is an attribute that was absent, which is no style.
    scratch.style.cssText = record.oldValue ?? "";
    return inheritedStyle(scratch.style) !== inheritedStyle(target.style);
  };
  /**
   * How a mutation bears on the paints. A `theme` change can alter any root's
   * resolved colors. A `roots` change only brings new roots that need their own
   * paint; painted roots keep theirs. Content churn — rows, messages, hover
   * fills, scroll fades — changes neither: a root's colors come from its theme
   * scope and from variables it inherits from its ancestors.
   */
  const changeOf = (record: MutationRecord): "theme" | "roots" | null => {
    const target =
      record.target instanceof Element
        ? record.target
        : record.target.parentElement;
    if (!target || target === style || target.closest("[data-ws-color-reader]"))
      return null;
    if (record.type === "attributes") {
      const name = record.attributeName;
      if (name === "href" || name === "media" || name === "disabled")
        return target.matches("link, style") ? "theme" : null;
      if (name === "style" && !handsDownNewStyle(record, target)) return null;
      if (target === document.documentElement || target === document.body)
        return "theme";
      // A theme scope sets the appearance band and can carry its own variables.
      if (
        target.classList.contains("dark") ||
        target.classList.contains("light")
      )
        return "theme";
      // A root's own class and style set its scope; everything inside it only
      // inherits.
      const scope = target.closest(TOKEN_ROOTS);
      if (scope) return scope === target ? "theme" : null;
      // The rest is inherited, so only a root's ancestors can restyle it.
      for (const root of roots) if (target.contains(root)) return "theme";
      return null;
    }
    if (target.closest("style")) return "theme";
    const touchesStyles = (node: Node) =>
      node instanceof Element &&
      !node.matches("[data-ws-color-reader]") &&
      (node.matches("style, link") || node.querySelector("style, link"));
    const touchesRoots = (node: Node) =>
      node instanceof Element &&
      !node.matches("[data-ws-color-reader]") &&
      (node.matches(TOKEN_ROOTS) || node.querySelector(TOKEN_ROOTS));
    const changed = [...record.addedNodes, ...record.removedNodes];
    if (changed.some(touchesStyles)) return "theme";
    return changed.some(touchesRoots) ? "roots" : null;
  };
  const observer = new MutationObserver((records) => {
    let change: "theme" | "roots" | null = null;
    for (const record of records) {
      const next = changeOf(record);
      if (next === "theme") {
        change = next;
        break;
      }
      change ??= next;
    }
    if (change === "theme") reschedule();
    else if (change === "roots") schedule();
  });
  update();
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
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
    for (const root of tagged) root.removeAttribute("data-ws-palette");
  };
}
