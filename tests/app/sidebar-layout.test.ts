import { readFileSync } from "node:fs";
import { describe, expect } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";

const styles = readFileSync(
  new URL("../../src/app/styles.css", import.meta.url),
  "utf8",
);

const longText = "A long sidebar label that should truncate ".repeat(8);

/** True for a color carrying no hue of its own, in either serialization. */
function isNeutral(color: string): boolean {
  const oklab = /^oklab\(\S+ (\S+) (\S+)/.exec(color);
  if (oklab) return Math.hypot(Number(oklab[1]), Number(oklab[2])) < 0.001;
  const rgb = /^rgba?\((\d+), (\d+), (\d+)/.exec(color);
  return rgb !== null && rgb[1] === rgb[2] && rgb[2] === rgb[3];
}

describe.skipIf(browserUnavailable)(
  "sidebar browser layout",
  { timeout: 30_000 },
  () => {
    browserTest(
      "colors workstream names and subdued category labels while leaving status and thread titles neutral",
      async ({ page }) => {
        await page.setContent(`<style>${styles}</style>
          <div style="--ws-hue: 47; --ws-color-light: oklch(42% .1 47); --ws-color-dark: oklch(75% .1 47); --muted-foreground: rgb(130, 130, 130); color: rgb(130, 130, 130)">
            <span class="ws-mark ws-mark-unread"></span>
            <span class="ws-mark ws-spin ws-spin-dots"></span>
            <span class="ws-text-prefix">Prefix</span>
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
            prefix: getComputedStyle(document.querySelector(".ws-text-prefix")!)
              .color,
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
          expect(colors.prefix).not.toBe(colors.name);
          // The parent in an "Owner: Area" name wears the theme's muted ink,
          // one color under every area, never a tint of the area's hue.
          expect(isNeutral(colors.prefix), colors.prefix).toBe(true);
          expect(colors.title).toBe("rgb(130, 130, 130)");
          expect(colors.name).toBe(
            dark ? "oklch(0.75 0.1 47)" : "oklch(0.42 0.1 47)",
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
      "extends hover and selected fills by 3px vertically without changing row layout",
      async ({ page }) => {
        await page.setContent(`<style>${styles}</style>
          <style>
            .ws-row { position: relative; display: flex; height: 21px; }
          </style>
          <div class="ws-row" style="--sidebar-accent: rgb(100, 100, 100)">First</div>
          <div class="ws-row selected ws-row-active" style="--sidebar-accent: rgb(100, 100, 100)">Selected</div>
          <div class="ws-row neighbor">Neighbor</div>`);
        const first = page.locator(".ws-row").first();
        const selected = page.locator(".selected");
        const neighbor = page.locator(".neighbor");
        const geometry = async () => ({
          first: await first.boundingBox(),
          selected: await selected.boundingBox(),
          neighbor: await neighbor.boundingBox(),
        });
        const fill = async (row: typeof first) =>
          row.evaluate((el) => {
            const style = getComputedStyle(el, "::before");
            return {
              position: style.position,
              top: style.top,
              bottom: style.bottom,
              height: style.height,
              pointerEvents: style.pointerEvents,
              backgroundColor: style.backgroundColor,
            };
          });
        const before = await geometry();
        const selectedFill = await fill(selected);

        await first.hover();
        const after = await geometry();
        expect(after).toEqual(before);

        const hoverFill = await fill(first);
        for (const current of [hoverFill, selectedFill]) {
          expect(current).toMatchObject({
            position: "absolute",
            top: "-3px",
            bottom: "-3px",
            height: "27px",
            pointerEvents: "none",
          });
        }
        expect(hoverFill.backgroundColor).toContain("0.6");
        expect(selectedFill.backgroundColor).toBe("rgb(100, 100, 100)");
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
