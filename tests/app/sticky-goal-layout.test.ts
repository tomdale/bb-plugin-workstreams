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
        const barFadeHeight = Number.parseFloat(
          getComputedStyle(background, "::before").height,
        );
        const plateFadeHeight = Number.parseFloat(
          getComputedStyle(background, "::after").height,
        );
        background.style.setProperty("--ws-plate-fade-height", "8rem");
        const hybridFadeHeight = Number.parseFloat(
          getComputedStyle(background, "::after").height,
        );
        return {
          rootTop: root.getBoundingClientRect().top,
          scrollerTop: scroller.getBoundingClientRect().top,
          plateTop: plate.getBoundingClientRect().top,
          plateBottom: plate.getBoundingClientRect().bottom,
          onTop: document.elementFromPoint(20, 50)?.className,
          fade: getComputedStyle(background, "::after").backgroundImage,
          fadeOpacity: getComputedStyle(background, "::after").opacity,
          plateFadeHeight,
          hybridFadeHeight,
          barFadeHeight,
        };
      });
      expect(result.rootTop).toBeLessThan(result.scrollerTop);
      expect(result.plateTop).toBe(result.scrollerTop);
      expect(result.plateBottom).toBe(result.scrollerTop + 100);
      expect(result.onTop).toBe("ws-sticky-goal__plate");
      expect(result.fade).toContain("linear-gradient");
      expect(result.fadeOpacity).toBe("1");
      expect(result.plateFadeHeight * (1.5 / 4)).toBe(result.barFadeHeight);
      expect(result.hybridFadeHeight).toBe(result.plateFadeHeight * 2);
      expect(result.hybridFadeHeight * (1.5 / 8)).toBe(result.barFadeHeight);
    } finally {
      await browser.close();
    }
  },
);

it.skipIf(!executablePath)(
  "feathers the heading background gradually in light and dark themes",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 400, height: 260 },
      });
      await page.setContent(`
        <style>${styles}
          body { margin: 0; }
          .surface { position: relative; height: 260px; }
        </style>
        <div class="surface">
          <div class="ws-goal-overlay">
            <div class="ws-goal-background" style="width:400px; --ws-plate-height:100px; --ws-fade-below-plate:1">
              <div class="ws-sticky-goal" style="height:100px"><div class="ws-sticky-goal__plate"></div></div>
            </div>
          </div>
        </div>`);
      for (const theme of ["dark", "light"] as const) {
        for (const fadeSize of [4, 8]) {
          await page.evaluate(
            ({ theme, fadeSize }) => {
              document.documentElement.style.setProperty(
                "--background",
                theme === "dark" ? "black" : "white",
              );
              document.querySelector<HTMLElement>(
                ".surface",
              )!.style.background = theme === "dark" ? "white" : "black";
              document
                .querySelector<HTMLElement>(".ws-goal-background")!
                .style.setProperty("--ws-plate-fade-height", `${fadeSize}rem`);
            },
            { theme, fadeSize },
          );
          const image = await page.screenshot();
          const samples = await page.evaluate(
            async ({ source, fadeSize }) => {
              const image = new Image();
              image.src = source;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext("2d")!;
              context.drawImage(image, 0, 0);
              return [
                1,
                0.25 * fadeSize * 16,
                0.5 * fadeSize * 16,
                0.75 * fadeSize * 16,
                fadeSize * 16,
              ].map(
                (offset) =>
                  context.getImageData(20, 100 + offset, 1, 1).data[0]!,
              );
            },
            {
              source: `data:image/png;base64,${image.toString("base64")}`,
              fadeSize,
            },
          );
          const contrast = samples.map((value) =>
            theme === "dark" ? value : 255 - value,
          );
          expect(contrast[0]).toBeLessThan(16);
          expect(contrast[4]).toBeGreaterThan(245);
          for (let i = 1; i < contrast.length; i++) {
            expect(contrast[i]! - contrast[i - 1]!).toBeGreaterThan(15);
          }
        }
      }
    } finally {
      await browser.close();
    }
  },
);
