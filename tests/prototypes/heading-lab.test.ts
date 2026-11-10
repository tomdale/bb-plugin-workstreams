import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * The heading lab copies the shipped rules rather than importing them, so this
 * keeps the copy honest: every rule the page draws has to stay the rule
 * styles.css ships, selector for selector and declaration for declaration.
 */
const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const styles = read("src/app/styles.css");
const page = read("prototypes/heading-lab/index.html");

const pageStyles = () => {
  const opened = page.indexOf("<style>") + "<style>".length;
  return page.slice(opened, page.indexOf("</style>"));
};

/** Drop at-rule blocks, whose nested braces are not rules of their own here. */
function withoutAtRules(css: string): string {
  let out = "";
  let index = 0;
  while (index < css.length) {
    const at = css.indexOf("@media", index);
    if (at === -1) {
      out += css.slice(index);
      break;
    }
    out += css.slice(index, at);
    let depth = 0;
    let cursor = css.indexOf("{", at);
    for (; cursor < css.length; cursor++) {
      if (css[cursor] === "{") depth++;
      else if (css[cursor] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    index = cursor + 1;
  }
  return out;
}

/**
 * Declarations from a stylesheet's text, keyed by each single selector. A
 * selector can appear in more than one rule (the pinned transitions join the
 * feather's), so its declarations accumulate.
 */
function declarations(css: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!selectors || selectors.startsWith("@")) continue;
    const body = match[2]!
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(";")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .sort();
    for (const selector of selectors.split(",")) {
      const key = selector.replace(/\s+/g, " ").trim();
      found.set(key, [...(found.get(key) ?? []), ...body].sort());
    }
  }
  return found;
}

const shipped = declarations(withoutAtRules(styles));
const drawn = declarations(withoutAtRules(pageStyles()));

/** The rules the page has to draw exactly as shipped. */
const DRAWN = [
  ".ws-sticky-goal-root",
  ".ws-goal-background",
  ".ws-goal-background::before",
  ".ws-goal-background::after",
  "[data-ws-edge]",
  "[data-ws-pinned].ws-goal-background::after",
  "[data-ws-pinned] .ws-sticky-goal__plate",
  "[data-ws-pinned] .ws-sticky-goal__workstream",
  "[data-ws-pinned] .ws-sticky-goal__title",
  "[data-ws-pinned] .ws-sticky-goal__subtitle",
  ".ws-sticky-goal",
  ".ws-sticky-goal__plate",
  ".ws-goal-overlay",
  ".ws-goal-overlay__clip",
  ".ws-goal-overlay__group",
  "[data-ws-hide-title] .bb-thread-title",
  ".ws-sticky-goal__workstream",
  ".ws-sticky-goal__workstream > span",
  ".ws-sticky-goal__title",
  ".ws-sticky-goal__subtitle",
  ".ws-sticky-goal__probe",
];

it("draws the heading rules styles.css ships", () => {
  for (const selector of DRAWN) {
    const shippedBody = shipped.get(selector);
    expect(shippedBody, `${selector} is missing from styles.css`).toBeDefined();
    const drawnBody = drawn.get(selector);
    expect(
      drawnBody,
      `${selector} is missing from the heading lab`,
    ).toBeDefined();
    expect(drawnBody, `${selector} has drifted from styles.css`).toEqual(
      shippedBody,
    );
  }
});

it("keeps the reduced-motion override the stylesheet ships", () => {
  for (const css of [styles, pageStyles()]) {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-ws-pinned\] \.ws-sticky-goal__title[\s\S]*?transition:\s*none/,
    );
  }
});

it("steps the pinned heading rather than tracking the scroll", () => {
  // The page's port of pinnedStep is what the controls rely on; if the product
  // ever moves the threshold, the lab has to move with it.
  const product = read("src/app/goalHeading.ts");
  const threshold = product.match(
    /export function pinnedStep\([^)]*\)[^{]*\{([^}]*)\}/,
  )![1]!;
  expect(page).toContain("const pinnedStep = (fromBottom, exitDistance) =>");
  expect(threshold).toContain("fromBottom >= exitDistance");
});

/**
 * The band has to start exactly where the scroller does. Measuring from the
 * pane's own rect instead puts the plate one border width low, which shows a
 * sliver of timeline above it; the page measures from the overlay, the way the
 * plugin measures from BB's inset surface.
 */
it("starts the band where the timeline does", () => {
  expect(page).toContain("const originRect = overlay.getBoundingClientRect();");
  expect(page).toContain("y: scrollerRect.top - originRect.top,");
  expect(page).toContain("x: scrollerRect.left - originRect.left,");
});
