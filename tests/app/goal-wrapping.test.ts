import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { SUBTITLE_LINE, SUBTITLE_SIZE } from "../../src/app/goalHeading.ts";

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
  "wraps goals at narrow and wide widths and clips only after three lines",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        `<style>${styles} body { font-family: sans-serif; }</style><div class="ws-sticky-goal__subtitle"></div>`,
      );
      for (const base of [14, 16, 20]) {
        for (const width of [260, 360, 720]) {
          const measure = async (text: string) =>
            page.evaluate(
              ({ text, width, size }) => {
                const goal = document.querySelector<HTMLElement>(
                  ".ws-sticky-goal__subtitle",
                )!;
                goal.style.width = `${width}px`;
                goal.style.fontSize = `${size}px`;
                goal.textContent = text;
                const style = getComputedStyle(goal);
                return {
                  height: goal.getBoundingClientRect().height,
                  line: Number.parseFloat(style.lineHeight),
                  clipped: goal.scrollHeight > goal.clientHeight + 1,
                  horizontalOverflow: goal.scrollWidth > goal.clientWidth,
                };
              },
              { text, width, size: base * SUBTITLE_SIZE },
            );
          const short = await measure("Copy the thread link.");
          expect(short.height).toBeCloseTo(short.line, 0);
          expect(short.clipped).toBe(false);
          const readable = await measure(
            "Make the review code easier to navigate without changing its behavior.",
          );
          expect(readable.height).toBeLessThanOrEqual(readable.line * 3 + 1);
          expect(readable.clipped).toBe(false);
          if (width === 260)
            expect(readable.height).toBeGreaterThan(readable.line * 1.5);
          for (const long of [
            "A deliberately long goal with too many details. ".repeat(30),
            "x".repeat(600),
          ]) {
            const result = await measure(long);
            expect(
              Math.abs(
                result.height - base * SUBTITLE_SIZE * SUBTITLE_LINE * 3,
              ),
            ).toBeLessThan(1);
            expect(result.clipped).toBe(true);
            expect(result.horizontalOverflow).toBe(false);
          }
        }
      }
    } finally {
      await browser.close();
    }
  },
);
