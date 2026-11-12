import { describe, expect, vi } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";
import { galleryServer } from "./gallery-fixture.ts";

vi.setConfig({ maxConcurrency: 5 });

describe.skipIf(browserUnavailable)("gallery specimens", () => {
  const server = galleryServer();
  browserTest.concurrent(
    "navigates real specimens, filters pages, and shows source",
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(server.url);
      await page
        .getByRole("heading", { name: "Introduction", exact: true })
        .waitFor();
      await page
        .getByRole("navigation", { name: "Design system" })
        .getByRole("link", { name: "Recap card", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Recap card", exact: true })
        .waitFor();
      expect(new URL(page.url()).hash).toBe("#recap-card");
      await page.getByText("View source", { exact: true }).click();
      expect(
        await page.getByLabel("Example source code").textContent(),
      ).toContain("RecapCardPreview");
      await page.getByLabel("Search pages").fill("question form");
      const navigation = page.getByRole("navigation", {
        name: "Design system",
      });
      expect(await navigation.getByRole("link").allTextContents()).toEqual([
        "Question form",
      ]);
      await navigation.getByRole("link", { name: "Question form" }).click();
      await page
        .getByRole("heading", { name: "Question form", exact: true })
        .waitFor();
      await page.goBack();
      await page
        .getByRole("heading", { name: "Recap card", exact: true })
        .waitFor();
      await page.goto(`${server.url}#not-a-page`);
      await page.getByRole("heading", { name: "Page not found" }).waitFor();
      await page.getByRole("link", { name: "Back to introduction" }).click();
      await page
        .getByRole("heading", { name: "Introduction", exact: true })
        .waitFor();
      expect(errors).toEqual([]);
    },
    60_000,
  );

  browserTest.concurrent(
    "documents each primitive with its variants side by side",
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const pages: Record<string, string[]> = {
        "status-dot": ["State tones", "Sizes", "Workstream and hollow"],
        "count-pill": ["Compact", "Roomy", "Wide count"],
        "key-chip": ["Default", "Bright", "Inline"],
        "section-heading": ["Title only", "With a count", "With an action"],
        "menu-classes": ["Items", "Wider surface"],
      };
      for (const [id, variants] of Object.entries(pages)) {
        await page.goto(`${server.url}#${id}`);
        for (const name of variants)
          await page.getByRole("group", { name, exact: true }).waitFor();
      }
      await page.goto(`${server.url}#status-dot`);
      const compact = page.getByRole("group", { name: "Sizes" });
      const widths = await compact
        .locator("span[aria-hidden=true]")
        .evaluateAll((dots) =>
          dots.map((dot) => Math.round(dot.getBoundingClientRect().width)),
        );
      expect(widths).toEqual([6, 7, 8]);
      await page.goto(`${server.url}#count-pill`);
      const roomy = await page
        .getByRole("group", { name: "Roomy" })
        .getByText("2", { exact: true })
        .evaluate((pill) => {
          const style = getComputedStyle(pill);
          return [
            style.paddingLeft,
            style.fontSize,
            style.fontWeight,
            style.lineHeight,
            style.borderRadius,
          ];
        });
      expect(roomy.slice(0, 4)).toEqual(["8px", "12px", "500", "22px"]);
      expect(parseFloat(roomy[4]!)).toBeGreaterThan(100);
      await page.goto(`${server.url}#menu-classes`);
      expect(
        await page
          .getByRole("menu", { name: "Menu, width 48" })
          .getByRole("menuitem")
          .count(),
      ).toBe(4);
      expect(errors).toEqual([]);
    },
    60_000,
  );

  browserTest.concurrent(
    "renders every specimen with real tokens and bounded controls",
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: 1440, height: 1000 });
      for (const id of [
        "colors",
        "typography",
        "work-identity",
        "settings",
        "actions-overlays",
        "recap-card",
        "question-form",
        "reply-vocabulary",
        "bb-controls",
      ]) {
        await page.goto(`${server.url}#${id}`);
        await page.locator(".gallery-specimen-content").waitFor();
        await page
          .getByRole("radiogroup", { name: "Preview width" })
          .getByRole("radio", { name: "Phone", exact: true })
          .check();
        const bounds = await page
          .locator("[data-gallery-specimen]")
          .evaluateAll((elements) =>
            elements.map((element) => ({
              width: element.clientWidth,
              scroll: element.scrollWidth,
              token: getComputedStyle(element)
                .getPropertyValue("--ws-review-border")
                .trim(),
            })),
          );
        expect(
          bounds.length,
          `${id} has labeled live examples`,
        ).toBeGreaterThan(0);
        for (const bound of bounds) {
          expect(bound.token, `${id} loads Workstreams tokens`).not.toBe("");
          expect(
            bound.width,
            `${id} applies Phone width to live examples`,
          ).toBeLessThanOrEqual(360);
          expect(
            bound.scroll,
            `${id} stays within the Phone preview`,
          ).toBeLessThanOrEqual(bound.width + 1);
        }
        expect(
          await page
            .locator(
              "[data-gallery-specimen] [data-gallery-controls], [data-gallery-specimen] [data-gallery-documentation]",
            )
            .count(),
        ).toBe(0);
        if (id === "typography") {
          expect(
            await page
              .locator(".ws-text-section")
              .evaluate((element) => getComputedStyle(element).fontSize),
          ).toBe("11px");
        }
      }
      expect(errors).toEqual([]);
    },
    60_000,
  );

  browserTest.concurrent(
    "reviews suggestions with ribbons between the two sidebars, keys, Undo, and a compact drop-down",
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${server.url}#suggestions-review`);
      const group = (name: string) =>
        page.getByRole("group", { name, exact: true });
      const wide = group("Seven suggestions");
      await wide
        .getByRole("button", {
          name: "Split Support Tools into 5 workstreams",
          exact: true,
        })
        .waitFor();
      // The split's five flows are ribbons laid out between the two sidebars.
      const ribbons = wide.getByRole("button", {
        name: /^\d+ threads? to Support Tools: /,
      });
      expect(await ribbons.count()).toBe(5);
      const box = await ribbons.first().boundingBox();
      expect(box!.width).toBeGreaterThan(100);
      expect(box!.height).toBeGreaterThan(4);
      await ribbons.first().hover();
      const card = wide.getByRole("tooltip");
      await card.waitFor();
      expect(await card.textContent()).toMatch(/\d+ threads/);
      await page.mouse.move(0, 0);
      await card.waitFor({ state: "detached" });

      // A decision keeps its row's place, with Undo, and the keys step.
      await wide
        .getByRole("button", {
          name: "Merge Release Notes into Docs",
          exact: true,
        })
        .click();
      await page.keyboard.press("a");
      await wide.getByRole("button", { name: /^Undo/ }).waitFor();
      // The decided row stays where it was in the list, the rest unmoved.
      const rows = wide.getByRole("listitem");
      const texts = await rows.allTextContents();
      expect(texts).toHaveLength(8);
      expect(texts[0]).toBe("Split Support Tools into 5 workstreams");
      expect(texts.filter((t) => t.startsWith("Accepted: Merge"))).toHaveLength(
        1,
      );
      // The keys belong to the review that holds the focus.
      expect(
        await group("One suggestion")
          .getByRole("button", { name: /^Undo/ })
          .count(),
      ).toBe(0);
      await page.keyboard.press("u");
      await wide
        .getByRole("button", { name: "Accept: Merge Release Notes into Docs" })
        .waitFor();

      const compact = group("Compact viewport");
      const trigger = compact.getByRole("button", { name: /1 of 3/ });
      await trigger.click();
      await page
        .getByRole("menuitem", { name: /Rename User Research/ })
        .click();
      await compact
        .getByRole("button", { name: /^Rename User Research/ })
        .waitFor();
      expect(errors).toEqual([]);
    },
    60_000,
  );

  browserTest.concurrent(
    "places Change labels in a gutter and distinguishes every check status",
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${server.url}#reply-vocabulary`);
      const variant = (name: string) =>
        page.getByRole("group", { name, exact: true }).first();
      const widthControl = page.getByRole("radiogroup", {
        name: "Preview width",
      });

      const change = variant("Change");
      const pair = change.locator("[data-reply-change-pair]");
      expect(await pair.textContent()).toContain("Before");
      expect(await pair.textContent()).toContain("After");
      // Labels sit in a gutter beside their values, and above them when narrow.
      const placement = () =>
        change.locator("[data-reply-change]").evaluate((change) => {
          const rows = [...change.querySelectorAll("[data-reply-change-row]")];
          return rows.map((row) => {
            const label = row.querySelector("dt")!;
            const value = row.querySelector("dd")!;
            const box = label.getBoundingClientRect();
            const beside =
              value.getBoundingClientRect().left >= box.right &&
              value.getBoundingClientRect().top < box.bottom;
            return {
              beside,
              valueLeft: Math.round(value.getBoundingClientRect().left),
              // A label is never broken across lines: the shared gutter is
              // wide enough for the longest one.
              clipped: label.scrollWidth > label.clientWidth + 1,
            };
          });
        });
      await widthControl.getByRole("radio", { name: "Wide" }).check();
      const wide = await placement();
      expect(wide.map((row) => row.beside)).toEqual([true, true, true, true]);
      // One shared gutter: every value starts at the same edge, and no label
      // wraps.
      expect(new Set(wide.map((row) => row.valueLeft)).size).toBe(1);
      expect(wide.every((row) => !row.clipped)).toBe(true);
      await widthControl.getByRole("radio", { name: "Phone" }).check();
      const phone = await placement();
      expect(phone.map((row) => row.beside)).toEqual([
        false,
        false,
        false,
        false,
      ]);

      const statuses = await variant("Checks")
        .locator("[data-reply-check-status]")
        .evaluateAll((elements) =>
          elements.map((element) =>
            element.getAttribute("data-reply-check-status"),
          ),
        );
      expect(statuses).toEqual([
        "passed",
        "passed",
        "failed",
        "skipped",
        "blocked",
        "untested",
      ]);
    },
    60_000,
  );

  browserTest.concurrent(
    "changes themes and widths without overflowing a narrow viewport",
    async ({ page }) => {
      await page.goto(`${server.url}#recap-card`);
      await page
        .getByRole("heading", { name: "Recap card", exact: true })
        .waitFor();
      await page
        .getByRole("radiogroup", { name: "Theme", exact: true })
        .getByRole("radio", { name: "Dark", exact: true })
        .check();
      expect(await page.locator("html").getAttribute("class")).toContain(
        "dark",
      );
      await page
        .getByRole("radiogroup", { name: "Preview width" })
        .getByRole("radio", { name: "Phone", exact: true })
        .check();
      expect(
        await page
          .locator(".gallery-specimen-container")
          .evaluate((element) => element.getBoundingClientRect().width),
      ).toBeLessThanOrEqual(360);
      await page
        .getByRole("radiogroup", { name: "Theme", exact: true })
        .getByRole("radio", { name: "Light", exact: true })
        .check();
      expect(await page.locator("html").getAttribute("class")).toContain(
        "light",
      );
      await page.emulateMedia({
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      await page
        .getByRole("radiogroup", { name: "Theme", exact: true })
        .getByRole("radio", { name: "System", exact: true })
        .check();
      await page.waitForFunction(() =>
        document.documentElement.classList.contains("dark"),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "Pages", exact: true }).click();
      await page
        .getByRole("navigation", { name: "Design system" })
        .getByRole("link", { name: "Question form" })
        .click();
      await page
        .getByRole("heading", { name: "Question form", exact: true })
        .waitFor();
      expect(
        await page
          .getByRole("button", { name: "Pages", exact: true })
          .getAttribute("aria-expanded"),
      ).toBe("false");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    },
    60_000,
  );

  browserTest.concurrent(
    "keeps a mounted answer across viewport and pointer changes",
    async ({ page, expect }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: 1200, height: 1000 });
      await page.goto(`${server.url}#question-form`);
      const answer = page
        .getByRole("group", { name: "Freeform only", exact: true })
        .getByRole("textbox", { name: "Context answer" });
      await answer.fill("Keep payment approval visible");
      const input = await answer.elementHandle();
      const cdp = await page.context().newCDPSession(page);
      for (const [width, coarse] of [
        [390, false],
        [390, true],
        [1200, true],
        [1200, false],
        [390, true],
      ] as const) {
        await cdp.send("Emulation.setTouchEmulationEnabled", {
          enabled: coarse,
          maxTouchPoints: 1,
        });
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForFunction(
          ({ width, coarse }) =>
            matchMedia("(max-width: 767px)").matches === width <= 767 &&
            matchMedia("(pointer: coarse)").matches === coarse,
          { width, coarse },
        );
        await page.waitForFunction(
          ({ soft }) =>
            document.body.textContent!.includes("Enter to submit") === !soft,
          { soft: width <= 767 && coarse },
        );
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        expect(await input!.evaluate((el) => el.isConnected)).toBe(true);
        expect(await answer.inputValue()).toBe("Keep payment approval visible");
        await answer.press("Shift+Enter");
        expect(await answer.inputValue()).toBe(
          "Keep payment approval visible\n",
        );
        await answer.fill("Keep payment approval visible");
        if (width <= 767 && coarse) {
          await answer.press("Enter");
          await expect
            .poll(() => answer.inputValue())
            .toBe("Keep payment approval visible\n");
          expect(await page.getByRole("status").count()).toBe(0);
          await answer.fill("Keep payment approval visible");
        }
      }
      await cdp.send("Emulation.setTouchEmulationEnabled", {
        enabled: false,
      });
      await page.setViewportSize({ width: 1200, height: 1000 });
      await page.getByText(/Enter to submit/).waitFor();
      await answer.press("Enter");
      await page
        .getByRole("status")
        .filter({ hasText: "Answer: Keep payment approval visible" })
        .waitFor();
      expect(await answer.inputValue()).toBe("Keep payment approval visible");
      expect(errors).toEqual([]);
    },
    60_000,
  );

  browserTest.concurrent(
    "shows interaction outcomes outside specimens and discloses earlier actions",
    async ({ page }) => {
      await page.goto(`${server.url}#settings`);
      const notes = page.locator("[data-gallery-documentation]");
      expect(await notes.count()).toBe(0);
      await page.getByRole("button", { name: "Set minimum to 1" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Recent: 1 threads" })
        .waitFor();
      await page.getByRole("button", { name: "Set maximum to 10" }).click();
      const history = page.getByText("Earlier actions", { exact: true });
      expect(await notes.locator("details").getAttribute("open")).toBeNull();
      await history.click();
      expect(await notes.locator("ol").innerText()).toContain(
        "Recent: 1 threads",
      );
      expect(
        await page.locator("[data-gallery-specimen] [role=status]").count(),
      ).toBe(0);

      await page.goto(`${server.url}#actions-overlays`);
      expect(await page.locator("[data-gallery-documentation]").count()).toBe(
        0,
      );
      const trigger = page
        .getByRole("group", { name: "Follow viewport", exact: true })
        .getByRole("button", { name: "Rename thread…" });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Rename thread" });
      const name = dialog.getByRole("textbox", { name: "Thread name" });
      await name.fill("");
      expect(
        await dialog
          .getByRole("button", { name: "Save", exact: true })
          .isDisabled(),
      ).toBe(true);
      await name.fill("Review checkout changes");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Name saved: Review checkout changes" })
        .waitFor();
      expect(
        await trigger.evaluate((el) => el === document.activeElement),
      ).toBe(true);
      await trigger.click();
      expect(await name.inputValue()).toBe("Review checkout changes");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      const saving = page.getByRole("group", {
        name: "Dialog, saving",
        exact: true,
      });
      await saving
        .getByRole("status")
        .filter({ hasText: "Saving thread name…" })
        .waitFor();
      expect(
        await saving
          .getByRole("button", { name: "Save", exact: true })
          .isDisabled(),
      ).toBe(true);
      await page
        .getByRole("group", { name: "Dialog, save rejected", exact: true })
        .getByRole("alert")
        .waitFor();
      await trigger.click();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Rename cancelled" })
        .waitFor();
    },
    60_000,
  );

  browserTest.concurrent(
    "removes color overrides when leaving the color example",
    async ({ page }) => {
      await page.goto(`${server.url}#colors`);
      await page
        .getByRole("radiogroup", { name: "Color choice" })
        .getByRole("radio", { name: "Custom hex" })
        .click();
      expect(
        await page.locator("style[data-ws-color-tokens]").textContent(),
      ).toContain("--ws-needs-you");
      await page
        .getByRole("navigation", { name: "Design system" })
        .getByRole("link", { name: "Overlays" })
        .click();
      await page
        .getByRole("heading", {
          name: "Overlays",
          exact: true,
        })
        .waitFor();
      await page
        .locator("style[data-ws-color-tokens]")
        .waitFor({ state: "detached" });
      expect(await page.locator("style[data-ws-color-tokens]").count()).toBe(0);
      const options = page
        .getByRole("group", { name: "Follow viewport", exact: true })
        .getByRole("button", { name: "Open options" });
      await options.click();
      const popover = page.getByRole("dialog");
      await popover
        .getByRole("button", { name: "Review release notes" })
        .waitFor();
      expect(
        await popover.evaluate(
          (el) => el.closest('[data-bb-plugin="workstreams"]') !== null,
        ),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await options.waitFor();
    },
    60_000,
  );

  browserTest.concurrent(
    "runs recap and question controls locally without BB requests",
    async ({ page }) => {
      const requests: string[] = [];
      page.on("request", (request) => {
        if (
          request.url().includes("/api/") ||
          ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
        )
          requests.push(request.url());
      });
      await page.goto(`${server.url}#recap-card`);
      await page
        .getByText("Added the compact release summary", { exact: true })
        .waitFor();
      await page
        .getByText("Waiting for the release checks", { exact: true })
        .first()
        .waitFor();
      await page.goto(`${server.url}#question-form`);
      const single = page.getByRole("group", {
        name: "Single choice",
        exact: true,
      });
      await single.getByRole("radio", { name: /Compact summary/ }).click();
      await single.getByRole("button", { name: /Submit/ }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Answer: Compact summary" })
        .waitFor();
      await page.getByRole("button", { name: "Reset form" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Form reset" })
        .waitFor();
      expect(requests).toEqual([]);
    },
    60_000,
  );
});
