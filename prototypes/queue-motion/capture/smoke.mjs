/**
 * Loads the built page in Chrome and checks what the sims cannot: that cards are drawn when the page loads, also
 * when it loads hidden and is shown later (a background tab, a closed pane), that only the pile is visible, and
 * that the controls drive the page.
 *
 *   npm run build && npm run smoke
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { CHROME, PAGE } from "./lib.mjs";

const failures = [];
const expect = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const errors = [];
const watch = (page, label) => {
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on(
    "console",
    (m) => m.type() === "error" && errors.push(`${label}: ${m.text()}`),
  );
};
/** The cards the page shows: not hidden, and how many of them the engine says are painted. */
const shown = (frame) =>
  frame.evaluate(() => ({
    visible: [...document.querySelectorAll(".card")].filter(
      (c) => getComputedStyle(c).visibility !== "hidden",
    ).length,
    painted: window.__sim.views().filter((v) => v.painted).length,
    tall: window.__sim.heights().filter((h) => h > 0).length,
  }));

const browser = await chromium.launch({ executablePath: CHROME });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "queue-motion-"));

for (const mode of ["drum", "product"]) {
  // Loaded visible.
  let page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  watch(page, `${mode} visible`);
  await page.goto(`${PAGE}#v=${mode}`);
  await page.waitForTimeout(400);
  let s = await shown(page);
  expect(
    s.painted === 3 && s.visible === 3,
    `${mode}: three cards drawn when the page loads (${JSON.stringify(s)})`,
  );
  await page.close();

  // Loaded hidden, then shown.
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  watch(page, `${mode} hidden`);
  const wrapper = `${scratch}/hidden-${mode}.html`;
  fs.writeFileSync(
    wrapper,
    `<body style="margin:0"><iframe id=f src="${PAGE}#v=${mode}" style="display:none;width:1100px;height:900px;border:0"></iframe>`,
  );
  await page.goto("file://" + wrapper);
  await page.waitForTimeout(500);
  await page.evaluate(
    () => (document.getElementById("f").style.display = "block"),
  );
  await page.waitForTimeout(600);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  s = await shown(frame);
  expect(
    s.painted === 3 && s.visible === 3,
    `${mode}: three cards drawn after a hidden page is shown (${JSON.stringify(s)})`,
  );
  await page.close();
}

// Controls: a preset, a held key, a slider, a select, and the model switch.
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
watch(page, "controls");
await page.goto(`${PAGE}#v=drum`);
await page.waitForTimeout(400);
await page.click('button[data-act="p:fold"]');
expect(
  await page.$eval('input[data-k="fold"]', (e) => e.checked),
  "the fold preset turns the fold toggle on",
);
await page.keyboard.down("ArrowDown");
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(33);
  await page.keyboard.down("ArrowDown");
}
await page.keyboard.up("ArrowDown");
await page.waitForTimeout(1000);
const front = await page.evaluate(() => window.__sim.cur());
expect(front >= 5, `a held ↓ advances the front (front ${front})`);
await page.$eval('input[data-k="cap"]', (e) => {
  e.value = "20";
  e.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.selectOption('select[data-k="tk"]', "constant");
const hash = await page.evaluate(() => location.hash);
expect(
  hash.includes("cap=20") && hash.includes("tk=constant"),
  `settings land in the URL hash (${hash})`,
);
await page.click('button[data-act="v:product"]');
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(800);
const back = await page.evaluate(() => window.__sim.cur());
expect(back === front - 1, `product mode answers ↑ (front ${back})`);
await page.close();
await browser.close();

expect(
  errors.length === 0,
  `no page errors${errors.length ? ": " + errors.join("; ") : ""}`,
);
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
