import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { CHROME } from "./lib.mjs";
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage();
try {
  await p.goto(process.env.QM_URL + "#v=drum&preset=natural&cap=1800&sway=40");
  await p.locator("[data-act=save]").click();
  await p.locator("#preset-name").fill("isolated test");
  await p.locator("[data-act=save]").click();
  if (
    (await p.locator("#save-note").textContent()) !== "Saved “isolated test”."
  )
    throw Error("save not confirmed");
  execFileSync("bb", ["plugin", "reload", "workstreams"], { stdio: "pipe" });
  await p.reload();
  await p.locator('[data-act="p:fold"]').click();
  await p.locator('#saved-chips [data-act="u:0"]').click();
  if ((await p.locator("input[data-k=cap]").inputValue()) !== "1800")
    throw Error("restore failed");
  await p.locator("input[data-k=cap]").evaluate((e) => {
    e.value = "2100";
    e.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await p.locator("[data-act=save]").click();
  await p.locator("#preset-name").fill("isolated test");
  await p.locator("[data-act=save]").click();
  if (
    (await p.locator("#save-note").textContent()) !==
    "Replaced “isolated test”."
  )
    throw Error("replace failed");
  await p.reload();
  await p.locator('#saved-chips [data-act="u:0"]').click();
  if ((await p.locator("input[data-k=cap]").inputValue()) !== "2100")
    throw Error("replacement restore failed");
  await p.evaluate(() => {
    window.oldSet = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await p.locator("[data-act=save]").click();
  await p.locator("#preset-name").fill("denied");
  await p.locator("[data-act=save]").click();
  if (
    (await p.locator("#save-note").textContent()) !==
    "This browser would not store the preset."
  )
    throw Error("failed save not reported");
  await p.locator('#saved-chips [data-act="ud:0"]').click();
  if (
    (await p.locator("#save-note").textContent()) !==
    "This browser would not delete the preset."
  )
    throw Error("failed deletion not reported");
  await p.evaluate(() => (Storage.prototype.setItem = window.oldSet));
  await p.locator('#saved-chips [data-act="ud:0"]').click();
  await p.reload();
  if (await p.locator('#saved-chips [data-act^="u:"]').count())
    throw Error("delete failed");
  console.log(
    "actual BB environment route -> isolated origin: save, restore, replace, denied writes and deletion verified",
    new URL(p.url()).origin,
  );
} finally {
  await b.close();
}
