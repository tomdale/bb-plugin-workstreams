import { readFileSync } from "node:fs";
import { describe, expect } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";

const styles = readFileSync(
  new URL("../../src/app/styles.css", import.meta.url),
  "utf8",
);

const longText = "A long sidebar label that should truncate ".repeat(8);

describe.skipIf(browserUnavailable)(
  "sidebar browser layout",
  { timeout: 30_000 },
  () => {
    browserTest(
      "colors workstream names and subdued category labels while leaving status and thread titles neutral",
      async ({ page }) => {
        await page.setContent(`<style>${styles}</style>
          <div style="--ws-hue: 47; --muted-foreground: rgb(130, 130, 130); color: rgb(130, 130, 130)">
            <span class="ws-mark ws-mark-unread"></span>
            <span class="ws-mark ws-spin ws-spin-dots"></span>
            <span class="ws-workstream-name">Workstream</span>
            <h4 class="ws-category-label">Category</h4>
            <span class="thread-title">Thread title</span>
          </div>`);
        for (const dark of [false, true]) {
          await page.evaluate(
            (dark) => document.documentElement.classList.toggle("dark", dark),
            dark,
          );
          const colors = await page.evaluate(() => ({
            status: [...document.querySelectorAll(".ws-mark")].map(
              (el) => getComputedStyle(el).backgroundColor,
            ),
            category: getComputedStyle(
              document.querySelector(".ws-category-label")!,
            ).color,
            name: getComputedStyle(
              document.querySelector(".ws-workstream-name")!,
            ).color,
            title: getComputedStyle(document.querySelector(".thread-title")!)
              .color,
          }));
          expect(colors.status).toEqual([
            "rgba(0, 0, 0, 0)",
            "rgba(0, 0, 0, 0)",
          ]);
          expect(colors.category).not.toBe(colors.name);
          expect(colors.category).not.toBe("rgb(130, 130, 130)");
          expect(colors.title).toBe("rgb(130, 130, 130)");
          expect(colors.name).toBe(
            dark ? "oklch(0.79 0.13 47)" : "oklch(0.46 0.16 47)",
          );
        }
      },
    );

    browserTest(
      "reveals hover timestamps on pointer hover and keyboard focus without reserving space",
      async ({ page }) => {
        await page.setContent(`<style>${styles}</style>
        <div class="ws-row"><a href="#">Task</a><span data-timestamp="hover">10m</span></div>`);
        const age = page.locator("[data-timestamp]");
        await page.mouse.move(0, 500);
        expect(await age.isVisible()).toBe(false);
        await page.locator("a").hover();
        expect(await age.isVisible()).toBe(true);
        await page.mouse.move(0, 500);
        expect(await age.isVisible()).toBe(false);
        await page.keyboard.press("Tab");
        expect(await age.isVisible()).toBe(true);
        await page.locator("a").evaluate((el) => (el as HTMLElement).blur());
        await age.evaluate((el) => el.setAttribute("data-timestamp", "show"));
        expect(await age.isVisible()).toBe(true);
      },
    );

    browserTest(
      "keeps nested animated rows within the sidebar and ellipsizes both lines",
      async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setContent(`
        <style>
          ${styles}
          * { box-sizing: border-box; }
          .sidebar { width: 260px; display: flex; flex-direction: column; }
          .ws-list { display: flex; flex-direction: column; }
          ul { margin: 0; padding: 0; list-style: none; }
          .ws-row { display: flex; gap: 6px; padding: 4px 8px; }
          .labels { display: flex; flex: 1; min-width: 0; flex-direction: column; }
          .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .age { flex-shrink: 0; }
        </style>
        <div class="sidebar"><div class="ws-list">
          <div class="ws-presence"><section class="ws-needs">
            <ul><li class="ws-presence"><div>
              <div class="ws-row">
                <span class="labels">
                  <span class="truncate">${longText}</span>
                  <span class="truncate">${longText}</span>
                </span>
                <span class="age">10m</span>
              </div>
            </div></li></ul>
          </section></div>
        </div></div>
      `);
        for (const width of [180, 260, 400]) {
          await page.locator(".sidebar").evaluate((el, width) => {
            (el as HTMLElement).style.width = `${width}px`;
          }, width);
          for (const phase of [null, "enter", "leave"]) {
            await page.locator(".ws-presence").evaluateAll((els, phase) => {
              for (const el of els) {
                if (phase) el.setAttribute("data-presence", phase);
                else el.removeAttribute("data-presence");
              }
            }, phase);
            const layout = await page.evaluate(() => {
              const sidebar = document.querySelector(".sidebar")!;
              const row = document.querySelector(".ws-row")!;
              return {
                sidebarWidth: sidebar.clientWidth,
                scrollWidth: sidebar.scrollWidth,
                rowWidth: row.getBoundingClientRect().width,
                lines: [...document.querySelectorAll(".truncate")].map(
                  (el) => ({
                    clipped: el.scrollWidth > el.clientWidth,
                    overflow: getComputedStyle(el).textOverflow,
                  }),
                ),
              };
            });
            expect(layout.scrollWidth).toBe(layout.sidebarWidth);
            expect(layout.rowWidth).toBeLessThanOrEqual(width);
            expect(layout.lines).toEqual([
              { clipped: true, overflow: "ellipsis" },
              { clipped: true, overflow: "ellipsis" },
            ]);
          }
        }
      },
    );
  },
);
