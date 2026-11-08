/**
 * What the capture scripts share: where the built page is, how to launch Chrome, and the helpers `smoke.mjs`
 * uses to load the page and read its tooltip.
 *
 * Environment:
 *   CHROME_PATH        The Chrome binary (default: the macOS application path).
 *   QUEUE_MOTION_PAGE  The page to load instead of dist/queue-motion.html. Point a script at a copy of the build
 *                      so a rebuild cannot change the page under it:
 *                        cp dist/queue-motion.html /tmp/qm.html
 *                        QUEUE_MOTION_PAGE=/tmp/qm.html npm run smoke
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const BUILT = process.env.QUEUE_MOTION_PAGE
  ? path.resolve(process.env.QUEUE_MOTION_PAGE)
  : path.join(ROOT, "dist/queue-motion.html");
export const PAGE = "file://" + BUILT;
export const OUT = path.join(ROOT, "out");
export const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** "product", "drum", "cascade", or "drum:<preset>" or "cascade:<preset>" → { mode, preset, name } (name is safe in a file name). */
export function parseSpec(spec) {
  const [mode, preset] = spec.split(":");
  return { mode, preset, name: spec.replace(/[^\w.-]+/g, "-") };
}
export const hashFor = ({ mode, preset }) =>
  `#v=${mode}${preset ? "&preset=" + encodeURIComponent(preset) : ""}`;

/** Launches Chrome, after checking that there is a built page to load. */
export async function launch() {
  if (!fs.existsSync(BUILT))
    throw new Error(
      `${BUILT} is missing; run \`npm run build\` first (or set QUEUE_MOTION_PAGE)`,
    );
  return chromium.launch({ executablePath: CHROME });
}

export async function open(opts = {}) {
  const browser = await launch();
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 900 },
    ...opts,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await page.goto(PAGE + "#v=drum");
  await page.waitForTimeout(200);
  return { browser, ctx, page };
}

// ---- the page's help hooks ------------------------------------------------------------------------------

/** The viewport's left margin, which no control covers: the pointer rests there between hovers. */
export const park = (page) =>
  page.mouse.move(3, Math.round(page.viewportSize().height / 2));

/**
 * Loads the page as a new document, so the state is the hash's alone: a hash change on the open page keeps the
 * settings it already holds. The pointer is parked first, or Chrome would hover whatever sits under it once the
 * page lays out.
 */
/**
 * Opens the page at `hash`, then opens the modules that start folded (Finish, Page, Overlay) and every `more`
 * line, so every control the state shows can be reached. The page remembers folds, so they stay open on the next
 * load; the About panel is left as the page has it.
 */
export async function load(page, hash = "") {
  await park(page);
  await page.goto("about:blank");
  await page.goto(PAGE + hash);
  await page.waitForFunction(() => window.__help && window.__sim);
  await page.evaluate(() => {
    for (const d of document.querySelectorAll(
      'details.mod[data-module="finish"], details.mod[data-module="page"], details.mod[data-module="overlay"], details.more',
    ))
      d.open = true;
  });
  await page.waitForTimeout(250);
}

/**
 * The controls on screen: `[data-help]` elements with no hidden ancestor, not inside a folded inspector module,
 * and with a box, in page order. `i` is the
 * element's index among all `[data-help]` elements (see `control`); `name` is its id, numbered when several
 * elements share it (the three speed buttons).
 */
export const visibleControls = (page) =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll("[data-help]")];
    const on = all.flatMap((el, i) =>
      !el.closest("[hidden]") &&
      !el.closest("details:not([open]) > :not(summary)") &&
      el.getClientRects().length > 0
        ? [{ i, id: el.dataset.help }]
        : [],
    );
    const seen = {};
    return on.map((c) => {
      const copies = on.filter((o) => o.id === c.id).length;
      seen[c.id] = (seen[c.id] ?? 0) + 1;
      return { ...c, name: copies > 1 ? `${c.id}[${seen[c.id]}]` : c.id };
    });
  });
export const control = (page, i) => page.locator("[data-help]").nth(i);

/** An element's box as { left, top, right, bottom } in viewport pixels. */
export async function rectOf(locator) {
  const b = await locator.boundingBox();
  return (
    b && { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }
  );
}

/**
 * The tooltip as the page shows it, or null while it is closed: its text parts, its box, and whether it scrolls.
 * `view` is the viewport it was placed in.
 */
export const readTip = (page) =>
  page.evaluate(() => {
    const tip = document.getElementById("tip");
    if (!tip || tip.hidden) return null;
    const b = tip.getBoundingClientRect();
    const css = getComputedStyle(tip);
    return {
      label: tip.querySelector(".tip-head b")?.textContent ?? null,
      what: Boolean(tip.querySelector(".tip-what")),
      rows: [...tip.querySelectorAll(".tip-steps dt")].map(
        (d) => d.textContent,
      ),
      text: tip.textContent,
      box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
      scrollHeight: tip.scrollHeight,
      clientHeight: tip.clientHeight,
      overflowY: css.overflowY,
      pointerEvents: css.pointerEvents,
      view: { width: innerWidth, height: innerHeight },
    };
  });

/** Waits up to `ms` for the tooltip to close; true when it did. */
export const tipCloses = (page, ms = 1000) =>
  page
    .waitForFunction(() => document.getElementById("tip").hidden, null, {
      timeout: ms,
    })
    .then(
      () => true,
      () => false,
    );

/**
 * Moves the pointer onto a control and waits up to `wait` ms for its tooltip; null when none opens. Throws when
 * the control cannot be hovered within `reach` ms, which is when something else covers it.
 */
export async function hoverTip(
  page,
  locator,
  { wait = 1500, reach = 3000 } = {},
) {
  await locator.hover({ timeout: reach });
  await page
    .waitForFunction(() => !document.getElementById("tip").hidden, null, {
      timeout: wait,
    })
    .catch(() => {});
  return readTip(page);
}

/** The `aria-describedby` on a control's button or input (the element the page points at the tooltip). */
export const describedBy = (locator) =>
  locator.evaluate(
    (el) =>
      // A setting's own control is its `data-k` element, as tooltip.ts picks it.
      (el.matches("button, input, select, summary, [tabindex]")
        ? el
        : (el.querySelector("[data-k]") ??
          el.querySelector("button, input, select"))
      )?.getAttribute("aria-describedby") ?? null,
  );

/** How far a tooltip keeps from the viewport's edges, in px; the page asks for 8. */
export const TIP_MARGIN = 8;
/** A box's distance to each edge of the viewport; negative when it lies outside. */
export const edgeGaps = (box, view) => ({
  left: box.left,
  top: box.top,
  right: view.width - box.right,
  bottom: view.height - box.bottom,
});
export const overlaps = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
