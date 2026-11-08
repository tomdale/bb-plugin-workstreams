// @vitest-environment jsdom
// Renders the real sidebar and Home markup in jsdom, then measures computed
// typography in Chrome with the plugin's stylesheets, so the cascade between
// the semantic `ws-text-*` roles, caller classes, and Tailwind utilities is
// checked the way BB applies it.
import { readFileSync } from "node:fs";
import {
  ReadableStream,
  TransformStream,
  WritableStream,
} from "node:stream/web";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { Row } from "../../src/app/sidebar/Row.tsx";
import { afterEach, beforeEach, describe, expect } from "vitest";
import { SIDEBAR_GEOMETRY } from "../../src/app/sidebar/tokens.ts";
import { section, sidebarThread } from "./fixtures.ts";
import { decisionFor, mountHome } from "./home-mount.tsx";
import { mountWithBands } from "./sidebar-fixture.tsx";

// jsdom's environment leaves out Node's web streams, which Playwright needs
// when it loads, so the fixture is imported after they are restored.
Object.assign(globalThis, { TransformStream, ReadableStream, WritableStream });
const { browserTest, browserUnavailable } =
  await import("./browser-fixture.ts");

const css = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const pluginStyles =
  css("../../src/app/home/home.css") + css("../../src/app/styles.css");

/**
 * `bb plugin build` compiles Tailwind, which is not installed for tests.
 * These are the utilities the measured elements use, as Tailwind v4 emits
 * them: inside the `utilities` cascade layer, which the plugin's unlayered
 * stylesheets outrank whatever their specificity.
 */
const utilities = `@layer utilities {
  .relative { position: relative; }
  .absolute { position: absolute; }
  .inset-0 { inset: 0; }
  .flex { display: flex; }
  .flex-col { flex-direction: column; }
  .flex-1 { flex: 1; }
  .shrink-0 { flex-shrink: 0; }
  .gap-1\\.5 { gap: 0.375rem; }
  .items-center { align-items: center; }
  .items-start { align-items: flex-start; }
  .items-baseline { align-items: baseline; }
  .min-w-0 { min-width: 0; }
  .h-7 { height: 1.75rem; }
  .h-\\[21px\\] { height: 21px; }
  .py-1\\.5 { padding-block: 0.375rem; }
  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .text-\\[11px\\] { font-size: 11px; }
  .text-\\[12px\\] { font-size: 12px; }
  .text-\\[13px\\] { font-size: 13px; }
  .font-normal { font-weight: 400; }
  .font-\\[450\\] { font-weight: 450; }
  .font-medium { font-weight: 500; }
  .font-semibold { font-weight: 600; }
  .leading-4 { line-height: 1rem; }
  .leading-5 { line-height: 1.25rem; }
  .leading-\\[1\\.2\\] { line-height: 1.2; }
  .uppercase { text-transform: uppercase; }
}`;

/** BB's theme values for the Home group name's text-sm size. */
const theme = `:root { --text-sm: 14px; --text-sm--line-height: 20px; font-size: 16px; font-family: sans-serif; }`;

type Type = { size: string; weight: string; line: string; height: number };

/**
 * Tags each named element with `data-probe` in jsdom, then loads the whole
 * document into Chrome and reads each probe's computed type.
 */
async function measure(
  page: import("playwright-core").Page,
  probes: Record<string, Element>,
): Promise<Record<string, Type>> {
  for (const [name, el] of Object.entries(probes))
    el.setAttribute("data-probe", name);
  await page.setContent(
    `<style>${theme}${utilities}${pluginStyles}</style>${document.body.innerHTML}`,
  );
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-probe]")].map((el) => {
        const style = getComputedStyle(el);
        return [
          el.dataset.probe!,
          {
            size: style.fontSize,
            weight: style.fontWeight,
            line: style.lineHeight,
            height: el.getBoundingClientRect().height,
          },
        ];
      }),
    ),
  );
}

const sections = [
  section("sec_split", "Studio: App"),
  section("sec_plain", "Prompting"),
];

/** The element whose own text is exactly `text`. */
const byText = (root: HTMLElement, text: string) =>
  within(root).getByText(
    (_, el) =>
      el?.textContent === text &&
      [...el.children].every((child) => child.textContent !== text),
  );

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe.skipIf(browserUnavailable)(
  "sidebar typography in the browser",
  { timeout: 30_000 },
  () => {
    browserTest(
      "keeps row emphasis, title lines, and row heights",
      async ({ page }) => {
        const at = Date.now();
        const slot = await mountWithBands(
          [
            sidebarThread("unread", {
              sectionId: "sec_plain",
              title: "Unread root",
              isUnread: true,
            }),
            sidebarThread("read", {
              sectionId: "sec_plain",
              title: "Read root",
            }),
            sidebarThread("beta", {
              sectionId: "sec_split",
              title: "Active root",
            }),
            sidebarThread("child", {
              sectionId: "sec_split",
              parentThreadId: "beta",
              title: "Nested child",
            }),
            sidebarThread("asking", {
              sectionId: "sec_plain",
              title: "Asking root",
              latestAttentionAt: at,
            }),
          ],
          {
            sections,
            analysis: { asking: decisionFor(at, "Ship it?") },
            settings: { showRecent: false },
          },
        );
        const upNext = await slot.findByRole("region", { name: "Up Next" });
        const plain = slot.getByRole("region", { name: "Prompting" });
        const split = slot.getByRole("region", { name: "Studio: App" });
        await waitFor(() => within(split).getByText("Nested child"));
        const row = (region: HTMLElement, title: string) =>
          within(region).getByRole("link", { name: title }).closest(".ws-row")!;
        const title = (region: HTMLElement, title: string) =>
          row(region, title).querySelector(".ws-text-thread")!;

        const type = await measure(page, {
          unread: title(plain, "Unread root"),
          read: title(plain, "Read root"),
          active: title(split, "Active root"),
          child: title(split, "Nested child"),
          twoLine: title(upNext, "Asking root"),
          rootRow: row(plain, "Read root"),
          childRow: row(split, "Nested child"),
        });
        slot.lifecycle.unmount();

        for (const name of ["unread", "read", "active", "child", "twoLine"])
          expect(type[name]!.size, name).toBe("13px");
        expect(type.unread!.weight).toBe("500");
        expect(type.active!.weight).toBe("400");
        expect(type.read!.weight).toBe("400");
        expect(type.child!.weight).toBe("400");
        expect(type.read!.line).toBe("15.6px");
        expect(type.unread!.line).toBe("15.6px");
        expect(type.child!.line).toBe("20px");
        expect(type.twoLine!.line).toBe("20px");
        expect(type.rootRow!.height).toBe(SIDEBAR_GEOMETRY.row.rootHeight);
        expect(type.childRow!.height).toBe(SIDEBAR_GEOMETRY.row.childHeight);
      },
    );

    browserTest(
      "keeps read-row title and timestamp geometry when activation changes",
      async ({ page }) => {
        const fontPath =
          "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2";
        const font = readFileSync(new URL(fontPath, import.meta.url)).toString(
          "base64",
        );
        for (const title of [
          "Reading changes",
          "Reviewing a long sidebar title that must truncate at the available width",
        ]) {
          const thread = sidebarThread("stable", { title });
          const props = {
            thread,
            depth: 0,
            active: false,
            now: Date.now(),
            onNavigate: () => undefined,
          };
          const slot = renderSlot({ component: Row }, props, {
            sidebarThreads: {
              status: "ready",
              threads: [thread],
              sections: [],
              projects: [],
            },
            rpc: {
              prefs: () => ({ prefs: { sidebar: { timestamps: "show" } } }),
            },
          });
          await waitFor(() =>
            expect(
              slot.container.querySelector("[data-timestamp]"),
            ).not.toBeNull(),
          );
          const geometry = async () => {
            await page.setContent(
              `<style>${theme}${utilities}${pluginStyles}@font-face { font-family: RowTest; font-weight: 100 900; src: url(data:font/woff2;base64,${font}); } .ws-row { width: 280px; font-family: RowTest; }</style>${slot.container.innerHTML}`,
            );
            await page.evaluate(() => document.fonts.ready);
            return page.evaluate(() => {
              const row = document.querySelector(".ws-row")!;
              const title = row.querySelector(".ws-text-thread")!;
              const range = document.createRange();
              range.selectNodeContents(title);
              const rect = (el: Element | Range) => {
                const { x, y, width, height } = el.getBoundingClientRect();
                return { x, y, width, height };
              };
              return {
                weight: getComputedStyle(title).fontWeight,
                row: rect(row),
                title: rect(title),
                ink: rect(range),
                timestamp: rect(row.querySelector("[data-timestamp]")!),
                status: rect(row.querySelector(".ws-status-slot")!),
              };
            });
          };
          expect(slot.getByText(title)).toBeTruthy();
          const before = await geometry();
          expect(before.weight).toBe("400");
          slot.rerender(<Row {...props} active />);
          expect(slot.getByRole("link").getAttribute("aria-current")).toBe(
            "page",
          );
          expect(await geometry()).toEqual(before);
          slot.rerender(<Row {...props} />);
          expect(slot.getByRole("link").hasAttribute("aria-current")).toBe(
            false,
          );
          expect(await geometry()).toEqual(before);
          slot.lifecycle.unmount();
        }
      },
    );

    browserTest(
      "sets workstream names in the type of each place they appear",
      async ({ page }) => {
        const slot = await mountWithBands(
          [
            sidebarThread("live-split", {
              sectionId: "sec_split",
              title: "Live split",
            }),
            sidebarThread("live-plain", {
              sectionId: "sec_plain",
              title: "Live plain",
            }),
            sidebarThread("arch-split", {
              sectionId: "sec_split",
              title: "Archived split",
              isArchived: true,
              archivedAt: 200,
            }),
            sidebarThread("arch-plain", {
              sectionId: "sec_plain",
              title: "Archived plain",
              isArchived: true,
              archivedAt: 100,
            }),
          ],
          {
            sections,
            settings: {
              showRecent: false,
              showForYou: false,
              showArchived: true,
            },
            archived: {
              status: "ready",
              hasNextPage: false,
              isFetchingNextPage: false,
              isFetchNextPageError: false,
              fetchNextPage: async () => undefined,
            },
          },
        );
        fireEvent.click(slot.getByRole("button", { name: /^Archived\d*$/ }));
        const header = (region: string, name: string) =>
          within(slot.getByRole("region", { name: region })).getByRole(
            "button",
            { name: new RegExp(`^${name}`) },
          );
        const type = await measure(page, {
          headerPlain: byText(header("Prompting", "Prompting"), "Prompting"),
          headerOwner: byText(header("Studio: App", "Studio: App"), "Studio"),
          headerArea: byText(header("Studio: App", "Studio: App"), "App"),
          archivedPlain: byText(
            header("Archived Prompting", "Prompting"),
            "Prompting",
          ),
          archivedOwner: byText(
            header("Archived Studio: App", "Studio: App"),
            "Studio",
          ),
          archivedArea: byText(
            header("Archived Studio: App", "Studio: App"),
            "App",
          ),
        });
        slot.lifecycle.unmount();

        // Sidebar headers: a plain name in semibold, an area of a product
        // lighter, both at 13px on a 1.2 line.
        expect(type.headerPlain).toMatchObject({
          size: "13px",
          weight: "600",
          line: "15.6px",
        });
        for (const part of [type.headerOwner, type.headerArea])
          expect(part).toMatchObject({
            size: "13px",
            weight: "450",
            line: "15.6px",
          });
        // Archived groups keep their smaller 12px names.
        expect(type.archivedPlain).toMatchObject({
          size: "12px",
          weight: "600",
        });
        for (const part of [type.archivedOwner, type.archivedArea])
          expect(part).toMatchObject({ size: "12px", weight: "450" });
      },
    );

    browserTest(
      "keeps Home's own type for workstream names",
      async ({ page }) => {
        const slot = await mountHome({
          sections,
          threads: [
            sidebarThread("one", { sectionId: "sec_split", title: "One" }),
            sidebarThread("two", { sectionId: "sec_plain", title: "Two" }),
          ],
        });
        await waitFor(() =>
          expect(
            document.querySelectorAll(".ws-home-group-name").length,
          ).toBeGreaterThanOrEqual(2),
        );
        const names = [
          ...document.querySelectorAll<HTMLElement>(".ws-home-group-name"),
        ];
        const plain = names.find((el) => el.textContent === "Prompting")!;
        const split = names.find((el) => el.textContent === "Studio: App")!;
        const type = await measure(page, {
          plain,
          owner: byText(split, "Studio"),
          area: byText(split, "App"),
        });
        slot.lifecycle.unmount();

        for (const name of ["plain", "owner", "area"])
          expect(type[name], name).toMatchObject({
            size: "14px",
            weight: "600",
            line: "20px",
          });
      },
    );
  },
);
