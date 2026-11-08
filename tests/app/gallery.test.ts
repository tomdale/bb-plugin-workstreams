import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture";

let server: ChildProcess | undefined;
let url: string;

describe.skipIf(browserUnavailable)("standalone design system gallery", () => {
  beforeAll(async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    server = spawn(
      process.execPath,
      [
        `${root}node_modules/vite/bin/vite.js`,
        "--config",
        `${root}gallery/vite.config.ts`,
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ],
      {
        cwd: root,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    url = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error(`Gallery did not start: ${output}`)),
        50_000,
      );
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      };
      server!.stdout!.on("data", read);
      server!.stderr!.on("data", read);
      server!.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      server!.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Gallery exited (${code}): ${output}`));
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

  browserTest.concurrent(
    "navigates real specimens, filters pages, and shows source",
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
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
      await page.getByLabel("Find a page").fill("question form");
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
      await page.goto(`${url}#not-a-page`);
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
    "offers a local sidebar playground with independent connecting lines",
    async ({ page }) => {
      const errors: string[] = [];
      const writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
          writes.push(request.url());
      });
      await page.goto(url);
      await page
        .getByRole("navigation", { name: "Design system" })
        .getByRole("link", { name: "Sidebar playground" })
        .click();
      expect(new URL(page.url()).pathname).toBe("/sidebar.html");
      await page.locator("#after .ws-row").first().waitFor();
      expect(
        await page.locator("#after .ws-text-thread").count(),
      ).toBeGreaterThan(0);
      expect(
        await page.locator("#after .ws-workstream-name").count(),
      ).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Connecting lines" }).click();
      await page
        .getByLabel("View: Parent treatment", { exact: true })
        .selectOption("family");
      for (const type of [
        "Workstreams section",
        "Shared parent",
        "Workstream",
        "Category",
        "Child threads",
      ]) {
        await page
          .getByLabel(`${type}: Show line`, { exact: true })
          .selectOption("on");
      }
      await page.getByLabel("Child threads: Width", { exact: true }).fill("3");
      await page.getByLabel("Child threads: Indent", { exact: true }).fill("4");
      await page
        .getByLabel("Child threads: Color", { exact: true })
        .fill("#336699");
      await page
        .getByLabel("Child threads: Spacing", { exact: true })
        .fill("7");
      for (const kind of [
        "section",
        "parent",
        "workstream",
        "category",
        "children",
      ]) {
        expect(
          await page.locator(`#after [data-guide="${kind}"]`).count(),
        ).toBeGreaterThan(0);
        expect(
          await page.locator(`#before [data-guide="${kind}"]`).count(),
        ).toBe(0);
      }
      expect(
        await page
          .locator('#after [data-guide="children"]')
          .first()
          .evaluate((el) => (el as HTMLElement).style.backgroundSize),
      ).toBe("3px 100%");
      expect(
        await page
          .locator('#after [data-guide="children"]')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundImage),
      ).toContain("rgb(51, 102, 153)");
      const childrenBefore = await page.locator("#after .row.child").count();
      await page
        .locator("#after .ws-disclosure")
        .first()
        .click({ force: true });
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll("#after .row.child").length < count,
        childrenBefore,
      );
      const firstParent = page.locator("#after .family.has-parent").first();
      expect(await firstParent.locator('[data-guide="parent"]').count()).toBe(
        1,
      );
      await firstParent.locator(".parent").click();
      expect(
        await page
          .locator("#after .family.has-parent")
          .first()
          .locator('[data-guide="parent"]')
          .count(),
      ).toBe(0);
      const saved = page.url();
      await page.reload();
      expect(page.url()).toBe(saved);
      await page.getByRole("button", { name: "Connecting lines" }).click();
      expect(
        await page
          .getByLabel("Child threads: Width", { exact: true })
          .inputValue(),
      ).toBe("3");
      expect(
        await page.locator('#after [data-guide="children"]').count(),
      ).toBeGreaterThan(0);
      await page.goto(`${url}sidebar.html#iv=7&rowHeight=25&grouping=family`);
      await page.locator("#after .ws-row").first().waitFor();
      expect(
        await page
          .getByLabel("View: Parent treatment", { exact: true })
          .inputValue(),
      ).toBe("family");
      expect(await page.locator("#after [data-guide]").count()).toBe(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Trial", exact: true }).click();
      expect(await page.locator("#currentPanel").isVisible()).toBe(false);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator("#after .row:not(.categorized):not(.child)")
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(25);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    },
    60_000,
  );

  browserTest.concurrent(
    "uses fixture topic colors and scoped status tokens in both sidebar previews",
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}sidebar.html`);
      await page.locator("#after .ws-workstream-name").first().waitFor();
      const colorsByTheme: Record<string, string> = {};
      for (const theme of ["Dark", "Light"] as const) {
        await page.getByRole("button", { name: theme, exact: true }).click();
        const panels = await page.evaluate(() => {
          const samples = (panel: string) => {
            const root = document.getElementById(panel)!;
            const resolvedColor = (element: Element, value: string) => {
              const probe = document.createElement("span");
              probe.style.color = value;
              probe.style.display = "none";
              element.append(probe);
              const color = getComputedStyle(probe).color;
              probe.remove();
              return color;
            };
            const units = Array.from(root.querySelectorAll(".unit"));
            const names = units.map((unit) => ({
              name: unit.querySelector(".ws-workstream-name")!.textContent,
              actual: getComputedStyle(
                unit.querySelector(".ws-workstream-name")!,
              ).color,
              expected: resolvedColor(unit, "var(--color)"),
            }));
            const firstWithPrefix = units.find((unit) =>
              unit.querySelector(".ws-text-prefix"),
            )!;
            const prefix = firstWithPrefix.querySelector(".ws-text-prefix")!;
            const firstWithCategory = units.find((unit) =>
              unit.querySelector(".cat"),
            )!;
            const category = firstWithCategory.querySelector(".cat")!;
            const marks = [
              [".ws-work-review", "--ws-review-mark"],
              [".ws-work-complete", "--ws-complete-mark"],
              [".ws-work-needs_decision", "--ws-needs-you-soft"],
              [".ws-mark-waiting", "--ws-needs-you-mark"],
              [".ws-mark-error", "--ws-failure-mark"],
            ].map(([selector, token]) => {
              const mark = root.querySelector(selector!)!;
              return {
                selector,
                token: getComputedStyle(mark).getPropertyValue(token!).trim(),
                actual: getComputedStyle(mark).color,
                expected: resolvedColor(mark, `var(${token})`),
                fixture: resolvedColor(
                  mark,
                  {
                    ".ws-work-review": "var(--status-primary)",
                    ".ws-work-complete": "#30a46c",
                    ".ws-mark-waiting": "var(--status-waiting)",
                    ".ws-mark-error": "var(--status-error)",
                  }[selector!] ?? `var(${token})`,
                ),
              };
            });
            const unread = root.querySelector(".ws-mark-unread")!;
            return {
              names,
              unread: {
                actual: getComputedStyle(unread, "::before").backgroundColor,
                expected: resolvedColor(unread, "var(--status-primary)"),
              },
              prefix: {
                actual: getComputedStyle(prefix).color,
                expected: resolvedColor(
                  firstWithPrefix,
                  "color-mix(in oklab, var(--color) 60%, black)",
                ),
              },
              category: {
                actual: getComputedStyle(category).color,
                expected: resolvedColor(
                  firstWithCategory,
                  "color-mix(in oklab, var(--color) 45%, oklch(from var(--color) l 0 h))",
                ),
              },
              marks,
            };
          };
          return { trial: samples("after"), current: samples("before") };
        });
        for (const panel of [panels.trial, panels.current]) {
          expect(
            new Set(panel.names.map((name) => name.actual)).size,
          ).toBeGreaterThan(2);
          for (const name of panel.names)
            expect(name.actual, String(name.name)).toBe(name.expected);
          expect(panel.prefix.actual).toBe(panel.prefix.expected);
          expect(panel.category.actual).toBe(panel.category.expected);
          expect(panel.unread.actual).toBe(panel.unread.expected);
          for (const mark of panel.marks) {
            expect(mark.token, mark.selector).not.toBe("");
            expect(mark.actual, mark.selector).toBe(mark.expected);
            expect(mark.actual, mark.selector).toBe(mark.fixture);
          }
        }
        expect(panels.trial.names).toEqual(panels.current.names);
        colorsByTheme[theme] = panels.trial.names[0]!.actual;
      }
      expect(colorsByTheme.Dark).not.toBe(colorsByTheme.Light);

      await page
        .getByRole("button", { name: "Workstreams", exact: true })
        .click();
      const currentName = page
        .locator("#before .unit")
        .filter({
          has: page.getByRole("button", { name: "Prompting", exact: true }),
        })
        .locator(".ws-workstream-name");
      const trialName = page
        .locator("#after .unit")
        .filter({
          has: page.getByRole("button", { name: "Prompting", exact: true }),
        })
        .locator(".ws-workstream-name");
      const currentColor = await currentName.evaluate(
        (el) => getComputedStyle(el).color,
      );
      await page
        .getByLabel("Workstream headers: Color", { exact: true })
        .selectOption("custom");
      await page.locator("#font_workstream_customColor").fill("#336699");
      expect(await trialName.evaluate((el) => getComputedStyle(el).color)).toBe(
        "rgb(51, 102, 153)",
      );
      expect(
        await currentName.evaluate((el) => getComputedStyle(el).color),
      ).toBe(currentColor);
      await page.reload();
      expect(await trialName.evaluate((el) => getComputedStyle(el).color)).toBe(
        "rgb(51, 102, 153)",
      );
      expect(
        await currentName.evaluate((el) => getComputedStyle(el).color),
      ).toBe(currentColor);
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
        await page.goto(`${url}#${id}`);
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
    "places Change labels in a gutter and distinguishes every check status",
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${url}#reply-vocabulary`);
      const selectComponent = async (name: string) => {
        await page.getByRole("combobox", { name: "Reply component" }).click();
        await page.getByRole("option", { name, exact: true }).click();
      };
      const widthControl = page.getByRole("radiogroup", {
        name: "Preview width",
      });

      await selectComponent("Change");
      const pair = page.locator("[data-reply-change-pair]");
      expect(await pair.textContent()).toContain("Before");
      expect(await pair.textContent()).toContain("After");
      // Labels sit in a gutter beside their values, and above them when narrow.
      const placement = () =>
        page.locator("[data-reply-change]").evaluate((change) => {
          const rows = [...change.querySelectorAll("[data-reply-change-row]")];
          return rows.map((row) => {
            const label = row.querySelector("dt")!.getBoundingClientRect();
            const value = row.querySelector("dd")!.getBoundingClientRect();
            return {
              beside: value.left >= label.right && value.top < label.bottom,
              valueLeft: Math.round(value.left),
              labelLines: Math.round(label.height / 16),
            };
          });
        });
      await widthControl.getByRole("radio", { name: "Wide" }).check();
      const wide = await placement();
      expect(wide.map((row) => row.beside)).toEqual([true, true, true, true]);
      // One shared gutter: every value starts at the same edge, and no label
      // wraps.
      expect(new Set(wide.map((row) => row.valueLeft)).size).toBe(1);
      expect(wide.every((row) => row.labelLines <= 1)).toBe(true);
      await widthControl.getByRole("radio", { name: "Phone" }).check();
      const phone = await placement();
      expect(phone.map((row) => row.beside)).toEqual([
        false,
        false,
        false,
        false,
      ]);

      await selectComponent("Checks");
      const statuses = await page
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
      await page.goto(`${url}#recap-card`);
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
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
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
      await page.goto(`${url}#recap-card`);
      await page.getByRole("combobox", { name: "Reported state" }).click();
      await page.getByRole("option", { name: "Complete", exact: true }).click();
      await page
        .getByText("Added the compact release summary", { exact: true })
        .waitFor();
      await page.getByRole("combobox", { name: "Reported state" }).click();
      await page.getByRole("option", { name: "Waiting", exact: true }).click();
      await page
        .getByText("Waiting for the release checks", { exact: true })
        .waitFor();
      await page.goto(`${url}#question-form`);
      await page.getByRole("radio", { name: /Compact summary/ }).click();
      await page.getByRole("button", { name: /Submit/ }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Local answer: Compact summary" })
        .waitFor();
      await page.getByRole("button", { name: "Reset local form" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Local form reset" })
        .waitFor();
      expect(requests).toEqual([]);
    },
    60_000,
  );
});
