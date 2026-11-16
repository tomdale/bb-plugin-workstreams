import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";

const styles = readFileSync(
  new URL("../../src/app/styles.css", import.meta.url),
  "utf8",
);

browserTest.skipIf(browserUnavailable)(
  "keeps actions visible while replacing details on keyboard focus and open menus",
  async ({ page }) => {
    await page.setContent(`<style>${styles}
      :root { --spacing: .25rem; }
      .ws-row { display: flex; }
      .ws-row-hover-action { width: 24px; max-width: 0; opacity: 0; overflow: hidden; padding: 0; border: 0; }
      .ws-row-actions { display: flex; margin-left: -6px; }
      .ws-edit-hint { opacity: 0; }
    </style>
      <button>Before</button>
      <div class="ws-row group/row">
        <span class="ws-row-aside ws-row-details">Updated</span>
        <span class="ws-row-aside ws-row-actions"><button class="ws-row-hover-action">Menu</button></span>
      </div>
      <div class="group/replies"><button>Reply</button><span class="ws-edit-hint">Edit</span></div>`);
    const action = page.getByRole("button", { name: "Menu" });
    const details = page.locator(".ws-row-details");
    const snapshot = () =>
      action.evaluate((node) => ({
        opacity: getComputedStyle(node).opacity,
        width: node.getBoundingClientRect().width,
      }));
    expect(await snapshot()).toEqual({ opacity: "0", width: 0 });
    await page.getByRole("button", { name: "Before" }).focus();
    await page.keyboard.press("Tab");
    expect(await snapshot()).toEqual({ opacity: "1", width: 24 });
    expect(await details.isVisible()).toBe(false);
    expect(
      await page
        .locator(".ws-row-actions")
        .evaluate((node) => getComputedStyle(node).marginLeft),
    ).toBe("0px");
    await action.evaluate((node) => node.setAttribute("data-state", "open"));
    await page.getByRole("button", { name: "Before" }).focus();
    expect(await snapshot()).toEqual({ opacity: "1", width: 24 });
    expect(await details.isVisible()).toBe(false);
    await action.evaluate((node) => node.removeAttribute("data-state"));
    expect(await snapshot()).toEqual({ opacity: "0", width: 0 });
    expect(await details.isVisible()).toBe(true);
    await page.getByRole("button", { name: "Reply", exact: true }).focus();
    expect(
      await page
        .locator(".ws-edit-hint")
        .evaluate((node) => getComputedStyle(node).opacity),
    ).toBe("1");
  },
);
