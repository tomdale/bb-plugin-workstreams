import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PAGE = "file://" + path.join(root, "dist/queue-motion.html");
export const OUT = path.join(root, "out");
export const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** "product", "drum", or "drum:<preset>" → { mode, preset, name } (name is safe in a file name). */
export function parseSpec(spec) {
  const [mode, preset] = spec.split(":");
  return { mode, preset, name: spec.replace(/[^\w.-]+/g, "-") };
}
export const hashFor = ({ mode, preset }) =>
  `#v=${mode}${preset ? "&preset=" + encodeURIComponent(preset) : ""}`;

export async function open(opts = {}) {
  if (!fs.existsSync(PAGE.replace("file://", "")))
    throw new Error(
      "dist/queue-motion.html is missing; run `npm run build` first",
    );
  const browser = await chromium.launch({ executablePath: CHROME });
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
