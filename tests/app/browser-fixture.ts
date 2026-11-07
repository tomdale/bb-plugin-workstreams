import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { it } from "vitest";

const executablePath = [
  process.env.CHROME_PATH,
  chromium.executablePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((path): path is string => !!path && existsSync(path));

// A browser process is expensive; contexts isolate cookies, storage, pages,
// and emulation between tests without launching Chrome for every assertion.
export const browserTest = it.extend<{ browser: Browser; page: Page }>({
  browser: [
    async ({}, use) => {
      const browser = await chromium.launch({ executablePath, headless: true });
      try {
        await use(browser);
      } finally {
        await browser.close();
      }
    },
    { scope: "file" },
  ],
  page: async ({ browser }, use) => {
    const context = await browser.newContext();
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
});
export const browserUnavailable = !executablePath;
