import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { THEME_COLORS, TOKEN_ROOTS } from "../../src/domain/colors.ts";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";

let server: ChildProcess;
let url: string;
describe.skipIf(browserUnavailable)("vivid settings in a browser", () => {
  beforeAll(async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    server = spawn(
      process.execPath,
      [
        `${root}node_modules/vite/bin/vite.js`,
        root,
        "--config",
        `${root}gallery/vite.config.ts`,
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    url = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(output)), 50_000);
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) {
          clearTimeout(timer);
          resolve(match[0] + "tests/app/vivid.html");
        }
      };
      server.stdout!.on("data", read);
      server.stderr!.on("data", read);
      server.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Vite exited ${code}: ${output}`));
      });
    });
  }, 60_000);
  afterAll(async () => {
    if (server && server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
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
      const setAppearance = async (dark: boolean) => {
        await page.evaluate((dark) => {
          document.documentElement.className = dark ? "dark" : "light";
          document
            .querySelector<HTMLElement>("main")!
            .style.setProperty(
              "--timeline-accent",
              dark ? "oklch(.72 .09 250)" : "oklch(.55 .1 250)",
            );
        }, dark);
      };
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
        const main = document.querySelector<HTMLElement>("main")!;
        main.style.setProperty("--family", "rgb(64 117 170)");
        main.style.setProperty("--timeline-accent", "var(--family)");
        const other = document.createElement("section");
        other.id = "other-theme";
        other.dataset.bbPlugin = "workstreams";
        other.className = "dark";
        other.style.setProperty("--timeline-accent", "rgb(121 169 219)");
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
      // A theme scope on the root itself must also set the text lightness band.
      await expect
        .poll(() =>
          page
            .locator("#other-theme span")
            .evaluate((el) => getComputedStyle(el).color),
        )
        .toBe("oklch(0.828 0.111 230.318)");
      const host = await page.locator("#host").evaluate((el) => ({
        color: getComputedStyle(el).color,
        token: getComputedStyle(el).getPropertyValue("--ws-review-text"),
      }));
      expect(host.token).toBe("");
      await page
        .locator("main")
        .evaluate((el) =>
          (el as HTMLElement).style.setProperty("--family", "rgb(121 169 219)"),
        );
      await expect.poll(text).not.toBe("oklch(0.5 0.134 242.749)");
      expect(
        await page
          .locator("#host")
          .evaluate((el) => getComputedStyle(el).color),
      ).toBe(host.color);
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
        await page.locator("main").evaluate((el) => {
          const root = el as HTMLElement;
          root.style.setProperty("--timeline-accent", "rgb(64 117 170)");
          root.style.setProperty("--success", "rgb(121 169 219)");
          root.style.setProperty("--success-foreground", "rgb(121 169 219)");
        });
        await expect
          .poll(async () => {
            const current = await snapshot();
            return (
              JSON.stringify(current.review) !==
              JSON.stringify(current.complete)
            );
          })
          .toBe(true);
        await page.waitForFunction(() =>
          getComputedStyle(
            document.querySelector('[data-ws-color-preview="review"]')!,
          ).color.includes("oklch"),
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        const before = await snapshot();
        await page.locator("main").evaluate((el) => {
          const root = el as HTMLElement;
          root.style.setProperty("--timeline-accent", "rgb(121 169 219)");
          root.style.setProperty("--success", "rgb(64 117 170)");
          root.style.setProperty("--success-foreground", "rgb(64 117 170)");
        });
        await expect
          .poll(async () => (await snapshot()).review)
          .toEqual(before.complete);
        await expect
          .poll(async () => (await snapshot()).complete)
          .toEqual(before.review);
      }
      await page.evaluate(() => {
        document.documentElement.className = "";
        document
          .querySelector<HTMLElement>("main")!
          .style.removeProperty("--timeline-accent");
        const theme = document.createElement("style");
        theme.id = "live-theme";
        theme.textContent = "main { --timeline-accent: rgb(121 169 219); }";
        document.head.append(theme);
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await expect.poll(text).toBe("oklch(0.828 0.111 230.318)");
      await page.emulateMedia({ colorScheme: "light" });
      await expect.poll(text).not.toBe("oklch(0.828 0.111 230.318)");
      await page.evaluate(() => {
        document.getElementById("live-theme")!.textContent =
          "main { --timeline-accent: rgb(64 117 170); }";
      });
      await expect.poll(text).toBe("oklch(0.5 0.134 242.749)");
      expect(errors).toEqual([]);
    },
    60_000,
  );

  browserTest(
    "resolves theme colors on a theme change, not on content churn",
    async ({ page }) => {
      await page.goto(url);
      await page.getByRole("switch", { name: "Use vivid colors" }).waitFor();
      const paletteRoots = await page.evaluate(
        (selector) => document.querySelectorAll(selector).length,
        TOKEN_ROOTS,
      );
      // A sweep reads one base and one text color per theme color per root.
      const readsPerSweep = paletteRoots * Object.keys(THEME_COLORS).length * 2;
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
          for (let step = 0; step < 20; step++) {
            // Rows, hover fills, and streamed messages restyle inside a root.
            content.className = `churn-${step}`;
            content.style.color = `rgb(${step} 0 0)`;
            const row = document.createElement("span");
            row.className = `row-${step}`;
            row.style.transform = `translateY(${step}px)`;
            root.append(row);
            chrome.className = `chrome-${step}`;
            chrome.style.opacity = String(step / 20);
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          chrome.remove();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        });

      await churn();
      expect(await reads()).toBe(0);

      // The theme scope moving is a theme change, and it re-resolves once.
      await page.evaluate(async () => {
        document.documentElement.className = "dark";
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      expect(await reads()).toBe(readsPerSweep);
      const text = () =>
        page
          .locator('[data-ws-color-preview="review"]')
          .evaluate((el) => getComputedStyle(el).color);
      await expect.poll(text).toBe("oklch(0.828 0.111 230.318)");

      // Content churn after the theme settles costs no reads either.
      await churn();
      expect(await reads()).toBe(readsPerSweep);
    },
    60_000,
  );
});
