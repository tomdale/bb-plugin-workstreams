import { afterAll, beforeAll, describe, expect } from "vitest";
import { THEME_COLORS } from "../../src/domain/colors.ts";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";
import { startGalleryServer, type GalleryServer } from "./gallery-server.ts";

let server: GalleryServer | undefined;
let url: string;
describe.skipIf(browserUnavailable)("vivid settings in a browser", () => {
  beforeAll(async () => {
    server = await startGalleryServer({ serveRepoRoot: true });
    url = server.url + "tests/app/vivid.html";
  }, 60_000);
  afterAll(async () => {
    await server?.stop();
  });

  browserTest(
    "persists the switch, exact overrides, and live theme changes without restyling BB",
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      const toggle = page.getByRole("switch", { name: "Use vivid colors" });
      await toggle.waitFor();
      expect(await toggle.getAttribute("aria-checked")).toBe("true");
      await toggle.focus();
      await page.keyboard.press("Space");
      await expect
        .poll(() => toggle.getAttribute("aria-checked"))
        .toBe("false");
      await page.keyboard.press("Space");
      await expect.poll(() => toggle.getAttribute("aria-checked")).toBe("true");
      // BB themes arrive as one head style sheet over `:root, .light` and
      // `.dark`; the appearance is a class on the document element.
      const setTheme = (css: string) =>
        page.evaluate((css) => {
          let theme = document.getElementById("bb-app-theme");
          if (!theme) {
            theme = document.createElement("style");
            theme.id = "bb-app-theme";
            document.head.append(theme);
          }
          theme.textContent = css;
          // The token sheet follows on the next frame.
          return new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        }, css);
      const setAppearance = (dark: boolean) =>
        page.evaluate((dark) => {
          document.documentElement.className = dark ? "dark" : "light";
        }, dark);
      const blue =
        ":root, .light { --timeline-accent: oklch(.55 .1 250); } .dark { --timeline-accent: oklch(.72 .09 250); }";
      await setTheme(blue);
      const text = () =>
        page
          .locator('[data-ws-color-preview="review"]')
          .evaluate((el) => getComputedStyle(el).color);
      for (const dark of [false, true]) {
        await setAppearance(dark);
        await expect
          .poll(text)
          .toBe(
            dark ? "oklch(0.828 0.111 230.318)" : "oklch(0.5 0.134 242.749)",
          );
        const pixels = await page
          .locator('[data-ws-color-preview="review"]')
          .evaluate((el, dark) => {
            const style = getComputedStyle(el),
              canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d")!;
            const rgba = (css: string) => {
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = css;
              ctx.fillRect(0, 0, 1, 1);
              return [...ctx.getImageData(0, 0, 1, 1).data];
            };
            const actual = [
              style.color,
              style.borderColor,
              style.backgroundColor,
            ].map(rgba);
            const expected = (
              dark
                ? [
                    "oklch(.828 .111 230.318)",
                    "oklch(.685 .169 237.323 / .8)",
                    "oklch(.293 .066 243.157 / .15)",
                  ]
                : [
                    "oklch(.5 .134 242.749)",
                    "oklch(.746 .16 232.661)",
                    "oklch(.977 .013 236.62 / .4)",
                  ]
            ).map(rgba);
            return { actual, expected };
          }, dark);
        expect(pixels.actual).toEqual(pixels.expected);
        for (const width of [390, 1000]) {
          await page.setViewportSize({ width, height: 760 });
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            );
          });
          if (process.env.WS_VIVID_ARTIFACT_DIR)
            await page.screenshot({
              animations: "disabled",
              path: `${process.env.WS_VIVID_ARTIFACT_DIR}/settings-${dark ? "dark" : "light"}-${width}.png`,
            });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
        }
      }
      await toggle.click();
      await expect.poll(text).toBe("oklch(0.72 0.09 250)");
      await page.reload();
      await setTheme(blue);
      await expect
        .poll(() => toggle.getAttribute("aria-checked"))
        .toBe("false");
      await setAppearance(false);
      await expect.poll(text).toBe("oklch(0.55 0.1 250)");
      await toggle.click();
      await expect.poll(text).toBe("oklch(0.5 0.134 242.749)");

      await page.getByRole("button", { name: "Review color" }).click();
      await page
        .getByRole("radio", { name: "Custom color", exact: true })
        .locator("..")
        .click();
      const hex = page.getByRole("textbox", { name: "Review hex color" });
      await hex.fill("#123456");
      await hex.press("Enter");
      await page.keyboard.press("Escape");
      const custom = await text();
      await toggle.click();
      await expect.poll(text).toBe(custom);
      await setAppearance(true);
      await toggle.click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("colors")!).colors.review.color,
          ),
        )
        .toBe("#123456");
      await page.reload();
      await setTheme(blue);
      await toggle.waitFor();
      await page.getByRole("button", { name: "Review color" }).click();
      await expect.poll(() => hex.inputValue()).toBe("#123456");
      await page
        .getByRole("radio", { name: "Default (Timeline blue)", exact: true })
        .locator("..")
        .click();
      await page.keyboard.press("Escape");

      await page.evaluate(() => {
        document.documentElement.className = "light";
        // A root that is its own theme scope draws that appearance.
        const other = document.createElement("section");
        other.id = "other-theme";
        other.dataset.bbPlugin = "workstreams";
        other.className = "dark";
        const child = document.createElement("span");
        child.style.color = "var(--ws-review-text)";
        other.append(child);
        document.body.append(other);
        const host = document.createElement("aside");
        host.id = "host";
        host.style.color = "var(--timeline-accent)";
        document.body.append(host);
      });
      await expect.poll(text).toBe("oklch(0.5 0.134 242.749)");
      await expect
        .poll(() =>
          page
            .locator("#other-theme span")
            .evaluate((el) => getComputedStyle(el).color),
        )
        .toBe("oklch(0.828 0.111 230.318)");
      // BB's own elements never receive the tokens.
      expect(
        await page
          .locator("#host")
          .evaluate((el) =>
            getComputedStyle(el).getPropertyValue("--ws-review-text"),
          ),
      ).toBe("");
      for (const dark of [false, true]) {
        await setAppearance(dark);
        const snapshot = () =>
          page
            .locator("[data-ws-color-preview]")
            .evaluateAll((elements) =>
              Object.fromEntries(
                elements.map((el) => [
                  el.getAttribute("data-ws-color-preview"),
                  [
                    getComputedStyle(el).color,
                    getComputedStyle(el).borderColor,
                    getComputedStyle(el).backgroundColor,
                  ],
                ]),
              ),
            );
        const pair = (accent: string, success: string) =>
          `:root, .light, .dark { --timeline-accent: ${accent}; --success: ${success}; --success-foreground: ${success}; }`;
        await setTheme(pair("rgb(64 117 170)", "rgb(121 169 219)"));
        await expect
          .poll(async () => {
            const current = await snapshot();
            return (
              JSON.stringify(current.review) !==
              JSON.stringify(current.complete)
            );
          })
          .toBe(true);
        const before = await snapshot();
        await setTheme(pair("rgb(121 169 219)", "rgb(64 117 170)"));
        await expect
          .poll(async () => (await snapshot()).review)
          .toEqual(before.complete);
        await expect
          .poll(async () => (await snapshot()).complete)
          .toEqual(before.review);
      }
      expect(errors).toEqual([]);
    },
    60_000,
  );

  browserTest(
    "resolves theme colors on a theme change, not on content churn",
    async ({ page }) => {
      await page.goto(url);
      await page.getByRole("switch", { name: "Use vivid colors" }).waitFor();
      // A new theme converts one base and one text color per theme color, under
      // each appearance, however many roots the page holds.
      const readsPerSweep = Object.keys(THEME_COLORS).length * 2 * 2;
      const reads = () =>
        page.evaluate(
          () => (window as Window & { wsReads?: number }).wsReads ?? 0,
        );
      await page.evaluate(() => {
        const instrumented = window as Window & { wsReads?: number };
        instrumented.wsReads = 0;
        const read = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function (
          this: CanvasRenderingContext2D,
          ...args: Parameters<CanvasRenderingContext2D["getImageData"]>
        ) {
          instrumented.wsReads = (instrumented.wsReads ?? 0) + 1;
          return read.apply(this, args);
        };
      });

      const churn = async () =>
        page.evaluate(async () => {
          const root = document.querySelector<HTMLElement>(
            '[data-bb-plugin="workstreams"]',
          )!;
          const content = root.querySelector<HTMLElement>("h1")!;
          // App chrome outside every plugin root, like a scrollbar or fade.
          const chrome = document.createElement("div");
          document.body.append(chrome);
          for (let step = 0; step < 8; step++) {
            // Rows, hover fills, and streamed messages restyle inside a root.
            content.className = `churn-${step}`;
            content.style.color = `rgb(${step} 0 0)`;
            const row = document.createElement("span");
            row.className = `row-${step}`;
            row.style.transform = `translateY(${step}px)`;
            root.append(row);
            chrome.className = `chrome-${step}`;
            chrome.style.opacity = String(step / 8);
            // Message blocks mount roots, and the scroller around them takes
            // style writes, custom properties included, as the heading moves.
            const mounted = document.createElement("div");
            mounted.dataset.bbPlugin = "workstreams";
            document.body.append(mounted);
            document.body.style.setProperty("--ws-plate-draw", `${step}px`);
            document.body.style.scrollPaddingTop = `${step}px`;
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          chrome.remove();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        });

      await churn();
      expect(await reads()).toBe(0);

      const text = () =>
        page
          .locator('[data-ws-color-preview="review"]')
          .evaluate((el) => getComputedStyle(el).color);
      const nextFrames = () =>
        page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );

      // Switching appearance is a class change the sheet already covers.
      await page.evaluate(() => (document.documentElement.className = "dark"));
      await nextFrames();
      expect(await reads()).toBe(0);
      const darkText = await text();
      await page.evaluate(() => (document.documentElement.className = ""));
      await expect.poll(text).not.toBe(darkText);

      // A new theme style sheet resolves the theme once for the page.
      await page.evaluate(() => {
        const theme = document.createElement("style");
        theme.id = "bb-app-theme";
        theme.textContent =
          ":root, .light, .dark { --timeline-accent: rgb(64 117 170); }";
        document.head.append(theme);
      });
      await nextFrames();
      expect(await reads()).toBe(readsPerSweep);
      await page.evaluate(() => (document.documentElement.className = "dark"));
      await expect.poll(text).not.toBe(darkText);

      // Content churn after the theme settles costs no reads either.
      await churn();
      expect(await reads()).toBe(readsPerSweep);
    },
    60_000,
  );
});
