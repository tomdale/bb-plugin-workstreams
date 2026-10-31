import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";

const executablePath = [
  process.env.CHROME_PATH,
  chromium.executablePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((path): path is string => !!path && existsSync(path));
const styles = readFileSync(
  new URL("../../src/app/styles.css", import.meta.url),
  "utf8",
);

it.skipIf(!executablePath)(
  "keeps the plate and fade at the viewport top when a tall footer pushes the column away",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" });
      await page.setContent(`
      <style>${styles}
        :root { --background: black; }
        body { margin: 0; }
        .surface { position: relative; }
        .scroller { height: 300px; overflow: auto; }
        .column { height: 700px; display: flex; flex-direction: column; }
        .footer { height: 280px; }
      </style>
      <div class="surface">
        <div class="scroller"><div class="column"><div class="ws-sticky-goal-root" style="margin-bottom: 100px"></div><p>Message</p></div><div class="footer"></div></div>
        <div class="ws-goal-overlay" style="pointer-events:auto">
          <div class="ws-goal-background" style="width:400px; --ws-plate-height:100px; --ws-fade-below-plate:1">
            <div class="ws-sticky-goal" style="height:100px"><div class="ws-sticky-goal__plate"></div></div>
          </div>
        </div>
      </div>`);
      const result = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>(".scroller")!;
        scroller.scrollTop = scroller.scrollHeight;
        const root = document.querySelector<HTMLElement>(
          ".ws-sticky-goal-root",
        )!;
        const plate = document.querySelector<HTMLElement>(
          ".ws-sticky-goal__plate",
        )!;
        const background = document.querySelector<HTMLElement>(
          ".ws-goal-background",
        )!;
        return {
          rootTop: root.getBoundingClientRect().top,
          scrollerTop: scroller.getBoundingClientRect().top,
          plateTop: plate.getBoundingClientRect().top,
          plateBottom: plate.getBoundingClientRect().bottom,
          onTop: document.elementFromPoint(20, 50)?.className,
          fade: getComputedStyle(background, "::after").backgroundImage,
          fadeOpacity: getComputedStyle(background, "::after").opacity,
        };
      });
      expect(result.rootTop).toBeLessThan(result.scrollerTop);
      expect(result.plateTop).toBe(result.scrollerTop);
      expect(result.plateBottom).toBe(result.scrollerTop + 100);
      expect(result.onTop).toBe("ws-sticky-goal__plate");
      expect(result.fade).toContain("linear-gradient");
      expect(result.fadeOpacity).toBe("1");
    } finally {
      await browser.close();
    }
  },
);
