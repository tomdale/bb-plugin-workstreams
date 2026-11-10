// @vitest-environment jsdom
// A list's status slot is as wide as the widest mark its rows draw. The
// markup comes from the real sidebar in jsdom and the geometry from Chrome
// with the plugin's stylesheet, as in sidebar-typography.test.tsx.
import { readFileSync } from "node:fs";
import {
  ReadableStream,
  TransformStream,
  WritableStream,
} from "node:stream/web";
import { cleanup, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rowGeometry } from "../../src/app/sidebar/rowGeometry.ts";
import {
  FULL_SLOT_PX,
  SPINNER_WIDTH_PX,
  childIndent,
  slotContentWidth,
} from "../../src/app/sidebar/statusSlot.ts";
import { SPINNER_SHAPES } from "../../src/domain/spinner.ts";
import { section, sidebarThread } from "./fixtures.ts";
import { mount } from "./sidebar-fixture.tsx";

Object.assign(globalThis, { TransformStream, ReadableStream, WritableStream });
const { browserTest, browserUnavailable } =
  await import("./browser-fixture.ts");

const css = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const pluginStyles = css("../../src/app/styles.css");

/** The Tailwind utilities the sidebar rows use, as Tailwind v4 emits them. */
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
  .items-baseline { align-items: baseline; }
  .min-w-0 { min-width: 0; }
  .h-7 { height: 1.75rem; }
  .h-\\[21px\\] { height: 21px; }
  .pr-2 { padding-right: 0.5rem; }
  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .text-\\[13px\\] { font-size: 13px; }
  .leading-\\[1\\.2\\] { line-height: 1.2; }
}`;

const sections = [section("sec_a", "Alpha")];
const asking = { hasPendingInteraction: true };
const working = { indicator: "runtime" };

/** The thread rows' geometry in Chrome, by title. */
async function geometry(
  page: import("playwright-core").Page,
  region: HTMLElement,
) {
  await page.setContent(
    `<style>:root { font-size: 16px; font-family: sans-serif; } ul { list-style: none; margin: 0; padding: 0; } .ws-row { width: 280px; }${utilities}${pluginStyles}</style>${region.outerHTML}`,
  );
  return page.evaluate(() =>
    [...document.querySelectorAll(".ws-row")].map((row) => {
      const rect = (el: Element) => el.getBoundingClientRect();
      const slot = row.querySelector(".ws-status-slot")!;
      const mark = slot.querySelector<HTMLElement>(".ws-dot, .ws-mark");
      const title = row.querySelector(".ws-text-thread")!;
      // What a mark draws: its children (by layout width, since a spinning
      // square's bounding box outgrows its round ink) and the pseudo-elements
      // that draw it.
      const ink = (el: HTMLElement) => {
        const widths = [...el.children].map(
          (child) => (child as HTMLElement).offsetWidth,
        );
        for (const part of ["::before", "::after"])
          widths.push(parseFloat(getComputedStyle(el, part).width) || 0);
        const kids = [...el.children].map(rect);
        if (kids.length > 1)
          widths.push(
            Math.max(...kids.map((k) => k.right)) -
              Math.min(...kids.map((k) => k.left)),
          );
        return Math.max(0, ...widths);
      };
      return {
        title: title.textContent!,
        slot: rect(slot).width,
        titleLeft: rect(title).left - rect(row).left,
        slotLeft: rect(slot).left - rect(row).left,
        paddingLeft: parseFloat(getComputedStyle(row).paddingLeft),
        markWidth: mark ? rect(mark).width : 0,
        markOffset: mark
          ? rect(mark).left +
            rect(mark).width / 2 -
            rect(slot).left -
            rect(slot).width / 2
          : 0,
        gap: mark ? rect(title).left - rect(mark).right : null,
        ink: mark && !mark.classList.contains("ws-dot") ? ink(mark) : 0,
      };
    }),
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("slot content widths", () => {
  it("gives each spinner shape a width and the other marks their own", () => {
    for (const shape of SPINNER_SHAPES)
      expect(slotContentWidth("working", shape)).toBe(SPINNER_WIDTH_PX[shape]);
    expect(slotContentWidth("needs-you", "spokes")).toBe(8);
    expect(slotContentWidth("review", "arc")).toBe(8);
    expect(slotContentWidth("done", "arc")).toBe(8);
    for (const kind of ["error", "draft", "disclosure"] as const)
      expect(slotContentWidth(kind, "arc")).toBe(FULL_SLOT_PX);
  });

  it("indents a child by the slot and its gap", () => {
    const at = (depth: number, slotWidth?: number) =>
      rowGeometry({ depth, slotWidth, inGroup: true }).paddingLeft;
    expect(childIndent(8)).toBe(14);
    expect(at(1) - at(0)).toBe(20);
    expect(at(1, 9) - at(0, 9)).toBe(15);
    expect(at(2, 9) - at(0, 9)).toBe(30);
  });
});

describe("a list's slot width", () => {
  it("is the widest mark the list draws, and folds away without marks", async () => {
    const widths = async (
      threads: ReturnType<typeof sidebarThread>[],
      spinner?: unknown,
    ) => {
      const slot = await mount(threads, {
        settings: { showRecent: false },
        spinner,
      });
      const alpha = await slot.findByRole("region", { name: "Alpha" });
      const slots = [...alpha.querySelectorAll<HTMLElement>(".ws-status-slot")];
      const result = slots.map((el) => [
        el.style.getPropertyValue("--ws-slot-width"),
        el.hasAttribute("data-collapsed"),
      ]);
      slot.lifecycle.unmount();
      return result;
    };
    const row = (id: string, overrides = {}) =>
      sidebarThread(id, { sectionId: "sec_a", title: id, ...overrides });
    expect(await widths([row("a"), row("b")])).toEqual([
      ["0px", true],
      ["0px", true],
    ]);
    expect(await widths([row("a", asking), row("b")])).toEqual([
      ["8px", false],
      ["8px", false],
    ]);
    const arc = { shape: "arc", primary: "subtle", secondary: "auto" };
    expect(await widths([row("a", asking), row("b", working)], arc)).toEqual([
      ["9px", false],
      ["9px", false],
    ]);
    expect(await widths([row("a", asking), row("b", working)])).toEqual([
      ["14px", false],
      ["14px", false],
    ]);
    expect(
      await widths([row("a", asking), row("b", { status: "error" })], arc),
    ).toEqual([
      ["14px", false],
      ["14px", false],
    ]);
  });
});

describe.skipIf(browserUnavailable)("slot geometry in the browser", () => {
  const rows = async (
    page: import("playwright-core").Page,
    threads: ReturnType<typeof sidebarThread>[],
    spinner?: unknown,
  ) => {
    const slot = await mount(threads, {
      settings: { showRecent: false, timestamps: "hide" },
      spinner,
    });
    const alpha = await slot.findByRole("region", { name: "Alpha" });
    await waitFor(() => within(alpha).getAllByRole("link"));
    const measured = await geometry(page, alpha);
    slot.lifecycle.unmount();
    return measured;
  };
  const row = (id: string, overrides = {}) =>
    sidebarThread(id, { sectionId: "sec_a", title: id, ...overrides });

  browserTest(
    "tightens the gap next to dots and keeps titles on one edge",
    { timeout: 30_000 },
    async ({ page }) => {
      const measured = await rows(page, [
        row("needs", asking),
        row("read"),
        row("review", { isUnread: true }),
      ]);
      expect(measured.map((r) => r.slot)).toEqual([8, 8, 8]);
      expect(new Set(measured.map((r) => r.titleLeft)).size).toBe(1);
      const dot = measured[0]!;
      expect(dot.markOffset).toBeCloseTo(0, 1);
      // A dot used to sit 9.5px from its title, centered in a 14px slot.
      expect(dot.gap).toBeLessThan(8);
    },
  );

  for (const shape of SPINNER_SHAPES)
    browserTest(
      `leaves room for the ${shape} spinner beside dots`,
      { timeout: 30_000 },
      async ({ page }) => {
        const spinner = { shape, primary: "subtle", secondary: "auto" };
        const measured = await rows(
          page,
          [row("needs", asking), row("busy", working), row("wait", asking)],
          spinner,
        );
        const busy = measured.find((r) => r.title === "busy")!;
        expect(busy.slot).toBe(SPINNER_WIDTH_PX[shape]);
        expect(busy.ink).toBeGreaterThan(0);
        expect(busy.ink).toBeLessThanOrEqual(busy.slot);
        expect(new Set(measured.map((r) => r.titleLeft)).size).toBe(1);
        expect(busy.markOffset).toBeCloseTo(0, 1);
      },
    );

  browserTest(
    "lines a child's mark up with its parent's title",
    { timeout: 30_000 },
    async ({ page }) => {
      const measured = await rows(page, [
        row("parent", asking),
        row("child", { parentThreadId: "parent", ...working }),
      ]);
      const [parent, child] = measured as [
        (typeof measured)[number],
        (typeof measured)[number],
      ];
      expect(child.slotLeft).toBe(parent.titleLeft);
    },
  );
});
