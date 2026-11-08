import { fileURLToPath } from "node:url";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect } from "vitest";
import { browserTest, browserUnavailable } from "./browser-fixture";
import { SIDEBAR_GEOMETRY } from "../../src/app/sidebar/tokens.ts";
import { workstreamGap } from "../../src/app/sidebar/workstreamGap.ts";
import { parsePrefs } from "../../src/domain/prefs.ts";
import { DEFAULT_SPINNER } from "../../src/domain/spinner.ts";

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
    "documents each primitive with its variants side by side",
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const pages: Record<string, string[]> = {
        "status-dot": ["State tones", "Sizes", "Workstream and hollow"],
        "count-pill": ["Compact", "Roomy", "Wide count"],
        "key-chip": ["Default", "Bright", "Inline"],
        "section-heading": ["Title only", "With a count", "With an action"],
        "menu-classes": ["Resting and highlighted", "Wider surface"],
      };
      for (const [id, variants] of Object.entries(pages)) {
        await page.goto(`${url}#${id}`);
        for (const name of variants)
          await page.getByRole("group", { name, exact: true }).waitFor();
      }
      await page.goto(`${url}#status-dot`);
      const compact = page.getByRole("group", { name: "Sizes" });
      const widths = await compact
        .locator("span[aria-hidden=true]")
        .evaluateAll((dots) =>
          dots.map((dot) => Math.round(dot.getBoundingClientRect().width)),
        );
      expect(widths).toEqual([6, 7, 8]);
      await page.goto(`${url}#count-pill`);
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
      await page.goto(`${url}#menu-classes`);
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
    "forwards the sidebar playground's gallery address to its page",
    async ({ page }) => {
      await page.goto(`${url}#sidebar-playground`);
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
      await page.goto(`${url}sidebar.html`);
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
          "#after .row:has(.ws-mark-unread) .ws-row",
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
    "opens the built gallery from disk with the app defaults",
    async ({ page }) => {
      const root = fileURLToPath(new URL("../../", import.meta.url));
      const output = mkdtempSync(join(tmpdir(), "workstreams-gallery-"));
      try {
        const vite = `${root}node_modules/vite/bin/vite.js`;
        const config = `${root}gallery/vite.config.ts`;
        for (const galleryPage of ["gallery", "sidebar"]) {
          await promisify(execFile)(
            process.execPath,
            [vite, "build", "--config", config, "--outDir", output],
            {
              cwd: root,
              env: {
                ...process.env,
                NO_COLOR: "1",
                GALLERY_PAGE: galleryPage,
              },
            },
          );
        }
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`file://${output}/index.html#recap-card`);
        await page
          .getByRole("heading", { name: "Recap card", exact: true })
          .waitFor();
        await page
          .getByRole("navigation", { name: "Design system" })
          .getByRole("link", { name: /Sidebar playground/ })
          .click();
        await page.locator("#after .ws-row").first().waitFor();
        expect(await page.locator("#rowHeight").inputValue()).toBe(
          String(SIDEBAR_GEOMETRY.row.rootHeight),
        );
        expect(await page.locator("#childRowHeight").inputValue()).toBe(
          String(SIDEBAR_GEOMETRY.row.childHeight),
        );
        expect(await page.locator("#font_category_color").inputValue()).toBe(
          "default",
        );
        await page.getByRole("link", { name: "Design system" }).click();
        await page
          .getByRole("heading", { name: "Introduction", exact: true })
          .waitFor();
        expect(errors).toEqual([]);
      } finally {
        rmSync(output, { recursive: true, force: true });
      }
    },
    90_000,
  );

  browserTest.concurrent(
    "retains prior Trial settings from saved playground URLs",
    async ({ page }) => {
      await page.goto(`${url}sidebar.html#iv=8&preview=trial`);
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
      await page.goto(`${url}sidebar.html#iv=6&preview=trial`);
      await page.locator("#after .ws-spin-dots").first().waitFor();
      expect(await page.locator("#rowHeight").inputValue()).toBe("21");
      await page.goto(`${url}sidebar.html#iv=7&preview=trial`);
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
      await page.goto(`${url}sidebar.html`);
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
                expected: productionColor(firstWithPrefix, "ws-prefix-name"),
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
    "keeps a mounted answer across viewport and pointer changes",
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: 1200, height: 1000 });
      await page.goto(`${url}#question-form`);
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
        expect(await input!.evaluate((el) => el.isConnected)).toBe(true);
        expect(await answer.inputValue()).toBe("Keep payment approval visible");
        await answer.press("Shift+Enter");
        expect(await answer.inputValue()).toBe(
          "Keep payment approval visible\n",
        );
        await answer.fill("Keep payment approval visible");
        if (width <= 767 && coarse) {
          await answer.press("Enter");
          expect(await answer.inputValue()).toBe(
            "Keep payment approval visible\n",
          );
          expect(await page.getByRole("status").count()).toBe(0);
          await answer.fill("Keep payment approval visible");
        }
      }
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
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
      await page.goto(`${url}#settings`);
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

      await page.goto(`${url}#actions-overlays`);
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
      await page.goto(`${url}#colors`);
      await page
        .getByRole("radiogroup", { name: "Color choice" })
        .getByRole("radio", { name: "Custom hex" })
        .click();
      expect(
        await page.locator("style[data-gallery-color-tokens]").textContent(),
      ).toContain("--ws-needs-you");
      await page
        .getByRole("navigation", { name: "Design system" })
        .getByRole("link", { name: "Actions, hints, and overlays" })
        .click();
      await page
        .getByRole("heading", {
          name: "Actions, hints, and overlays",
          exact: true,
        })
        .waitFor();
      await page
        .locator("style[data-gallery-color-tokens]")
        .waitFor({ state: "detached" });
      expect(
        await page.locator("style[data-gallery-color-tokens]").count(),
      ).toBe(0);
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
      await page.goto(`${url}#recap-card`);
      await page
        .getByText("Added the compact release summary", { exact: true })
        .waitFor();
      await page
        .getByText("Waiting for the release checks", { exact: true })
        .first()
        .waitFor();
      await page.goto(`${url}#question-form`);
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
