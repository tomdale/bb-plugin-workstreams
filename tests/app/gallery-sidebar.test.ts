import { describe, expect, vi } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture.ts";
import { SIDEBAR_GEOMETRY } from "../../src/app/sidebar/tokens.ts";
import { fileURLToPath } from "node:url";
import { workstreamGap } from "../../src/app/sidebar/workstreamGap.ts";
import { parsePrefs } from "../../src/domain/prefs.ts";
import { DEFAULT_SPINNER } from "../../src/domain/spinner.ts";
import { galleryServer } from "./gallery-fixture.ts";

vi.setConfig({ maxConcurrency: 5 });

describe.skipIf(browserUnavailable)("gallery sidebar", () => {
  const server = galleryServer();
  browserTest.concurrent(
    "forwards the sidebar playground's gallery address to its page",
    async ({ page }) => {
      await page.goto(`${server.url}#sidebar-playground`);
      await page.waitForURL("**/sidebar.html");
      await page.locator("#after .ws-row").first().waitFor();
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
      await page.goto(server.url);
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
      await page.goto(
        `${server.url}sidebar.html#iv=7&rowHeight=25&grouping=family`,
      );
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
    "starts and resets both sidebar previews to the app defaults",
    async ({ page }) => {
      const errors: string[] = [];
      const writes: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
          writes.push(request.url());
      });
      await page.setViewportSize({ width: 1440, height: 500 });
      await page.goto(`${server.url}sidebar.html`);
      await page
        .locator(`#after .ws-spin-${DEFAULT_SPINNER.shape}`)
        .first()
        .waitFor();
      await page
        .locator(`#before .ws-spin-${DEFAULT_SPINNER.shape}`)
        .first()
        .waitFor();
      const compare = async () => {
        const panels = await page.evaluate(() => {
          const sample = (id: string) => {
            const root = document.getElementById(id)!;
            const bounds = root.getBoundingClientRect();
            return Array.from(
              root.querySelectorAll(".heading, .cat, .row"),
            ).map((element) => {
              const box = element.getBoundingClientRect();
              const text = element.querySelector(".title, .accent") ?? element;
              const style = getComputedStyle(text);
              return {
                text: text.textContent,
                top: Math.round((box.top - bounds.top) * 10) / 10,
                left: Math.round((box.left - bounds.left) * 10) / 10,
                height: box.height,
                size: style.fontSize,
                weight: style.fontWeight,
                lineHeight: style.lineHeight,
                color: style.color,
              };
            });
          };
          return { trial: sample("after"), current: sample("before") };
        });
        expect(panels.trial).toEqual(panels.current);
      };
      await compare();
      const timestamp = parsePrefs({}).sidebar.timestamps;
      const timestamps = page.locator("#after [data-timestamp]");
      if (timestamp === "hide") expect(await timestamps.count()).toBe(0);
      else {
        expect(await timestamps.count()).toBeGreaterThan(0);
        expect(await timestamps.first().getAttribute("data-timestamp")).toBe(
          timestamp,
        );
      }
      expect(await page.locator("#after [data-guide]").count()).toBe(0);
      const firstRow = page.locator("#after .ws-row").first();
      const rowCount = await page.locator("#after .ws-row").count();
      await firstRow.hover();
      await firstRow
        .getByRole("button", { name: "Archive", exact: true })
        .click();
      expect(await page.locator("#previewAction").textContent()).toContain(
        "Preview only: archive",
      );
      expect(await page.locator("#after .ws-row").count()).toBe(rowCount);
      const snooze = firstRow.getByRole("button", { name: /^Snooze / });
      await snooze.focus();
      await page.keyboard.press("ArrowDown");
      const menu = page.getByRole("menu", { name: /^Snooze / });
      await menu.waitFor();
      expect(await menu.getByRole("menuitem").count()).toBeGreaterThan(1);
      await menu.getByRole("menuitem").first().click();
      expect(await page.locator("#previewAction").textContent()).toContain(
        "Preview only: snooze",
      );
      expect(await page.locator("#after .ws-row").count()).toBe(rowCount);
      expect(
        await page
          .locator("#after .row:not(.child)")
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(SIDEBAR_GEOMETRY.row.rootHeight);
      expect(
        await page
          .locator("#after .row.child")
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(SIDEBAR_GEOMETRY.row.childHeight);
      expect(
        await page
          .locator("#after .heading")
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(SIDEBAR_GEOMETRY.workstreamHeader.height);
      expect(
        await page
          .locator("#after .cat")
          .first()
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBe(SIDEBAR_GEOMETRY.category.height);
      const lineHeight = await page.evaluate(() => {
        const row = document.querySelector("#after .row.child .ws-row")!;
        const reference = row.cloneNode(true) as HTMLElement;
        document.getElementById("after")!.append(reference);
        const trial = parseFloat(
          getComputedStyle(row.querySelector(".ws-text-thread")!).lineHeight,
        );
        const app = parseFloat(
          getComputedStyle(reference.querySelector(".ws-text-thread")!)
            .lineHeight,
        );
        reference.remove();
        return { trial, app };
      });
      expect(Math.abs(lineHeight.trial - lineHeight.app)).toBeLessThan(0.05);
      const unreadWeight = await page.evaluate(() => {
        const row = document.querySelector(
          "#after .row:has(.font-medium) .ws-row",
        )!;
        const reference = row.cloneNode(true) as HTMLElement;
        document.getElementById("after")!.append(reference);
        const trial = getComputedStyle(
          row.querySelector(".ws-text-thread")!,
        ).fontWeight;
        const app = getComputedStyle(
          reference.querySelector(".ws-text-thread")!,
        ).fontWeight;
        reference.remove();
        return { trial, app };
      });
      expect(unreadWeight.trial).toBe(unreadWeight.app);
      const tokenUrl = `/@fs${fileURLToPath(new URL("../../src/app/sidebar/tokens.ts", import.meta.url)).replaceAll("\\", "/")}`;
      const adaptive = await page.evaluate(
        (tokenPath) =>
          new Promise((resolve, reject) => {
            const extraStyle = document.createElement("style");
            extraStyle.textContent =
              ".ws-text-workstream { font-size: 14px } .ws-text-category { font-size: 15px }";
            document.head.append(extraStyle);
            const script = document.createElement("script");
            script.type = "module";
            const timer = setTimeout(
              () => reject(new Error("Defaults probe did not run")),
              10_000,
            );
            document.addEventListener(
              "defaults-probe",
              (event) => {
                clearTimeout(timer);
                script.remove();
                extraStyle.remove();
                resolve((event as CustomEvent).detail);
              },
              { once: true },
            );
            script.textContent = `
          import { SIDEBAR_GEOMETRY as geometry } from ${JSON.stringify(tokenPath)};
          import { appSidebarDefaults } from "/sidebar-playground/appDefaults.ts";
          const oldHeight = geometry.row.rootHeight;
          try {
            geometry.row.rootHeight = 27;
            const values = appSidebarDefaults();
            document.dispatchEvent(new CustomEvent("defaults-probe", { detail: {
              height: values.rowHeight,
              workstreamSize: values.font_workstream_size,
              categorySize: values.font_category_size,
            }}));
          } finally { geometry.row.rootHeight = oldHeight; }
        `;
            document.head.append(script);
          }),
        tokenUrl,
      );
      expect(adaptive).toEqual({
        height: "27",
        workstreamSize: "14",
        categorySize: "15",
      });
      const gaps = async () =>
        page.locator("#after .tier > .family").evaluateAll((families) =>
          families.map((family) => ({
            name: family.querySelector(".heading")!.getAttribute("aria-label")!,
            collapsed:
              family
                .querySelector(".heading")!
                .getAttribute("aria-expanded") === "false",
            gap: parseFloat(getComputedStyle(family).marginTop),
          })),
        );
      const checkGaps = async () => {
        const groups = await gaps();
        for (let i = 0; i < groups.length; i++) {
          const current = groups[i]!;
          const prev = groups[i - 1];
          expect(current.gap).toBe(
            workstreamGap(
              prev ? { id: prev.name, name: prev.name } : null,
              { id: current.name, name: current.name },
              prev?.collapsed ?? false,
            ),
          );
        }
      };
      await checkGaps();
      for (const id of ["after", "before"])
        await page.locator(`#${id} .heading`).first().click();
      await compare();
      await checkGaps();

      await page.locator("#focus").selectOption("on");
      for (const panel of ["#after", "#before"])
        expect(
          await page.locator(`${panel} .focus-icon`).count(),
        ).toBeGreaterThan(0);
      await page.locator("#after .tier-toggle").click();
      expect(
        await page.locator("#after .tier-toggle").getAttribute("aria-expanded"),
      ).toBe("true");
      expect(
        await page
          .locator("#before .tier-toggle")
          .getAttribute("aria-expanded"),
      ).toBe("false");
      const trialLowerWorkstream = page.locator(
        '#after .heading[aria-label="Studio: Workstreams"]',
      );
      await trialLowerWorkstream.click();
      expect(await trialLowerWorkstream.getAttribute("aria-expanded")).toBe(
        "true",
      );
      const currentApp = page.locator(
        '#before .heading[aria-label="Studio: App"]',
      );
      const trialApp = page.locator(
        '#after .heading[aria-label="Studio: App"]',
      );
      const currentExpanded = await currentApp.getAttribute("aria-expanded");
      const trialExpanded = await trialApp.getAttribute("aria-expanded");
      await trialApp.click();
      expect(await trialApp.getAttribute("aria-expanded")).not.toBe(
        trialExpanded,
      );
      expect(await currentApp.getAttribute("aria-expanded")).toBe(
        currentExpanded,
      );
      expect(
        await page.evaluate(() =>
          document.activeElement?.getAttribute("aria-label"),
        ),
      ).toBe("Studio: App");
      expect(await trialLowerWorkstream.getAttribute("aria-expanded")).toBe(
        "true",
      );
      if ((await trialApp.getAttribute("aria-expanded")) === "false")
        await trialApp.click();
      await page.locator("#focus").selectOption("off");

      await page.getByRole("button", { name: "Threads", exact: true }).click();
      const collapsedCases = [
        {
          variant: "Uncategorized",
          textLabel: "Collapsed uncategorized thread: Size",
          size: "19",
          parentTitle: "Planning shortcuts",
          childTitle: "Reviewing shortcuts",
          rowSelector: ".row.has-disclosure:not(.categorized)",
          heightProperty: "--row-height",
        },
        {
          variant: "Categorized",
          textLabel: "Collapsed categorized thread: Size",
          size: "18",
          parentTitle: "Refining sidebar grouping",
          childTitle: "Checking layout",
          rowSelector: ".row.has-disclosure.categorized",
          heightProperty: "--cat-row-height",
        },
      ];
      for (const [index, scenario] of collapsedCases.entries()) {
        if (index > 0)
          await page
            .getByRole("button", { name: scenario.variant, exact: true })
            .click();
        await page
          .getByRole("button", {
            name: new RegExp(`Activate to override ${scenario.textLabel}`),
          })
          .click();
        await page
          .getByLabel(scenario.textLabel, { exact: true })
          .fill(scenario.size);
        const parent = page
          .locator(`#after ${scenario.rowSelector}`)
          .filter({ hasText: scenario.parentTitle })
          .first();
        expect(await parent.count(), scenario.variant).toBe(1);
        await parent.hover();
        await parent
          .getByRole("button", { name: "Hide child threads", exact: true })
          .click();
        const result = await parent.evaluate((element, heightProperty) => {
          const sidebar = element.closest(".sidebar")!;
          const title = element.querySelector(".ws-text-thread")!;
          return {
            fontSize: getComputedStyle(title).fontSize,
            height: element.getBoundingClientRect().height,
            expectedHeight: parseFloat(
              getComputedStyle(sidebar).getPropertyValue(heightProperty),
            ),
            expanded: element
              .querySelector(".thread-disclosure")
              ?.getAttribute("aria-expanded"),
          };
        }, scenario.heightProperty);
        expect(result.fontSize).toBe(`${scenario.size}px`);
        expect(result.height).toBe(result.expectedHeight);
        expect(result.expanded).toBe("false");
        expect(
          await page.locator("#after .ws-text-thread").allTextContents(),
        ).not.toContain(scenario.childTitle);
        expect(
          await page.evaluate(() => ({
            label: document.activeElement?.getAttribute("aria-label"),
            expanded: document.activeElement?.getAttribute("aria-expanded"),
          })),
        ).toEqual({ label: "Show child threads", expanded: "false" });
      }

      const currentRow = await page
        .locator("#before .ws-row")
        .first()
        .elementHandle();
      const currentGap = await page
        .locator("#before")
        .evaluate((element) =>
          (element as HTMLElement).style.getPropertyValue("--item-gap"),
        );
      const panelScroll = async (panel: string) =>
        page.locator(panel).evaluate((element) => {
          const sidebar = element as HTMLElement;
          sidebar.scrollTop = Math.min(100, sidebar.scrollHeight);
          return {
            top: sidebar.scrollTop,
            max: sidebar.scrollHeight - sidebar.clientHeight,
          };
        });
      const scrollTop = (panel: string) =>
        page
          .locator(panel)
          .evaluate((element) => (element as HTMLElement).scrollTop);
      const currentScroll = await panelScroll("#before");
      const trialScroll = await panelScroll("#after");
      for (const [panel, scroll] of [
        ["#before", currentScroll],
        ["#after", trialScroll],
      ] as const) {
        expect(
          scroll.max,
          `${panel} has independently scrollable content`,
        ).toBeGreaterThan(0);
        expect(scroll.top).toBeGreaterThan(0);
      }
      await page
        .getByRole("button", { name: "Workstreams", exact: true })
        .click();
      await page.getByText("Group spacing · shared", { exact: true }).click();
      await page.locator("#itemGap").fill("16");
      expect(await page.locator("#itemGap").inputValue()).toBe("16");
      expect(
        await page
          .locator("#before")
          .evaluate((element) =>
            (element as HTMLElement).style.getPropertyValue("--item-gap"),
          ),
      ).toBe(currentGap);
      expect(
        await page
          .locator("#after")
          .evaluate((element) =>
            (element as HTMLElement).style.getPropertyValue("--item-gap"),
          ),
      ).toBe("16px");
      expect(
        await currentRow!.evaluate(
          (original) =>
            original.isConnected &&
            document.querySelector("#before .ws-row") === original,
        ),
      ).toBe(true);
      expect(await scrollTop("#before")).toBe(currentScroll.top);
      expect(await scrollTop("#after")).toBe(trialScroll.top);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(
        "itemGap",
      );
      await page.getByRole("button", { name: "Reset all" }).click();
      expect(await page.locator("#itemGap").inputValue()).toBe(
        String(SIDEBAR_GEOMETRY.gaps.item),
      );
      await compare();
      await page
        .getByLabel("View: Example order", { exact: true })
        .selectOption("manual");
      expect(
        await page
          .locator("#after .heading")
          .first()
          .getAttribute("aria-label"),
      ).toBe("Studio: App");
      const manualOrder = [
        "Studio: App",
        "Studio: Workstreams",
        "Agent: Automations",
        "Agent: Code review",
        "Agent: Research",
        "Tools: CLI",
        "Prompting",
        "Quality",
      ];
      for (const panel of ["#before", "#after"])
        expect(
          await page
            .locator(`${panel} .unit .heading`)
            .evaluateAll((elements) =>
              elements.map((element) => element.getAttribute("aria-label")),
            ),
        ).toEqual(manualOrder);
      await compare();
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    },
    60_000,
  );

  browserTest.concurrent(
    "retains prior Trial settings from saved playground URLs",
    async ({ page }) => {
      await page.goto(`${server.url}sidebar.html#iv=8&preview=trial`);
      await page.locator("#after .ws-spin-dots").first().waitFor();
      expect(await page.locator("#rowHeight").inputValue()).toBe("25");
      expect(await page.locator("#itemGap").inputValue()).toBe("7");
      expect(await page.locator("#after [data-timestamp]").count()).toBe(0);
      expect(new URL(page.url()).hash).toContain("legacyPresentation=1");
      await page.reload();
      await page.locator("#after .ws-spin-dots").first().waitFor();
      expect(await page.locator("#rowHeight").inputValue()).toBe("25");
      await page.getByRole("button", { name: "Reset all" }).click();
      await page
        .locator(`#after .ws-spin-${DEFAULT_SPINNER.shape}`)
        .first()
        .waitFor();
      expect(await page.locator("#rowHeight").inputValue()).toBe(
        String(SIDEBAR_GEOMETRY.row.rootHeight),
      );
      const timestamp = parsePrefs({}).sidebar.timestamps;
      const timestamps = page.locator("#after [data-timestamp]");
      if (timestamp === "hide") expect(await timestamps.count()).toBe(0);
      else {
        expect(await timestamps.count()).toBeGreaterThan(0);
        expect(await timestamps.first().getAttribute("data-timestamp")).toBe(
          timestamp,
        );
      }
      expect(new URL(page.url()).hash).toBe("");
      await page.goto(`${server.url}sidebar.html#iv=6&preview=trial`);
      await page.locator("#after .ws-spin-dots").first().waitFor();
      expect(await page.locator("#rowHeight").inputValue()).toBe("21");
      await page.goto(`${server.url}sidebar.html#iv=7&preview=trial`);
      await page.locator("#after .ws-spin-dots").first().waitFor();
      expect(await page.locator("#rowHeight").inputValue()).toBe("25");
      expect(await page.locator("#grouping").inputValue()).toBe("family");
    },
    60_000,
  );

  browserTest.concurrent(
    "uses fixture topic colors and scoped status tokens in both sidebar previews",
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${server.url}sidebar.html`);
      await page.locator("#after .ws-workstream-name").first().waitFor();
      const themeRows = {
        current: await page.locator("#before .ws-row").first().elementHandle(),
        trial: await page.locator("#after .ws-row").first().elementHandle(),
      };
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
            const productionColor = (element: Element, className: string) => {
              const probe = document.createElement("span");
              probe.className = className;
              element.append(probe);
              const color = getComputedStyle(probe).color;
              probe.remove();
              return color;
            };
            const firstWithPrefix = units.find((unit) =>
              unit.querySelector(".ws-text-prefix"),
            )!;
            const prefix = firstWithPrefix.querySelector(".ws-text-prefix")!;
            const firstWithCategory = units.find((unit) =>
              unit.querySelector(".cat"),
            )!;
            const category = firstWithCategory.querySelector(".cat")!;
            const marks = (
              [
                [
                  ".ws-dot-needs-you",
                  "--ws-needs-you-mark",
                  "borderTopColor",
                  "var(--ws-needs-you-text)",
                ],
                [
                  ".ws-dot-review.ws-dot-ring",
                  "--ws-review-mark",
                  "borderTopColor",
                  "var(--ws-review-text)",
                ],
                [
                  ".ws-dot-done",
                  "--ws-complete-mark",
                  "backgroundColor",
                  "var(--ws-complete-text)",
                ],
                [
                  ".ws-failed",
                  "--ws-failure-mark",
                  "color",
                  "var(--destructive-text)",
                ],
              ] as const
            ).map(([selector, token, prop, fixture]) => {
              const mark = root.querySelector(selector)!;
              return {
                selector,
                token: getComputedStyle(mark).getPropertyValue(token).trim(),
                actual: getComputedStyle(mark)[prop],
                expected: resolvedColor(mark, `var(${token})`),
                fixture: resolvedColor(mark, fixture),
              };
            });
            return {
              names,
              prefix: {
                actual: getComputedStyle(prefix).color,
                // Probed inside the prefix, which carries the container's
                // color, or the muted fallback when the fixture names none.
                expected: productionColor(prefix, "ws-text-prefix"),
              },
              category: {
                actual: getComputedStyle(category).color,
                expected: productionColor(
                  firstWithCategory,
                  "ws-category-label",
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
      for (const [panel, row] of [
        ["#before", themeRows.current],
        ["#after", themeRows.trial],
      ] as const)
        expect(
          await row!.evaluate(
            (original, selector) =>
              original.isConnected &&
              document.querySelector(`${selector} .ws-row`) === original,
            panel,
          ),
        ).toBe(true);

      await page
        .getByRole("button", { name: "Categories", exact: true })
        .click();
      const trialCategory = page.locator("#after .cat").first();
      const currentCategory = page.locator("#before .cat").first();
      const originalCategory = await currentCategory.evaluate(
        (el) => getComputedStyle(el).color,
      );
      await page.locator("#mix").fill("60");
      expect(
        await trialCategory.evaluate((el) => getComputedStyle(el).color),
      ).not.toBe(originalCategory);
      expect(
        await currentCategory.evaluate((el) => getComputedStyle(el).color),
      ).toBe(originalCategory);
      await page.getByRole("button", { name: "Reset all" }).click();
      expect(
        await trialCategory.evaluate((el) => getComputedStyle(el).color),
      ).toBe(
        await currentCategory.evaluate((el) => getComputedStyle(el).color),
      );

      await page.getByRole("button", { name: "Sidebar", exact: true }).click();
      const widthRows = {
        current: await page.locator("#before .ws-row").first().elementHandle(),
        trial: await page.locator("#after .ws-row").first().elementHandle(),
      };
      await page.locator("#width").fill("320");
      for (const [panel, row] of [
        ["#before", widthRows.current],
        ["#after", widthRows.trial],
      ] as const) {
        expect(
          await page
            .locator(panel)
            .evaluate((element) =>
              (element as HTMLElement).style.getPropertyValue(
                "--sidebar-width",
              ),
            ),
        ).toBe("320px");
        expect(
          await row!.evaluate(
            (original, selector) =>
              original.isConnected &&
              document.querySelector(`${selector} .ws-row`) === original,
            panel,
          ),
        ).toBe(true);
      }

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
});
