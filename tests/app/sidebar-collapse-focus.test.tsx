// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sidebarThread } from "./fixtures.ts";
import { mount } from "./sidebar-fixture.tsx";

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** One thread in each of two workstreams, so both keep their headers. */
const threads = () => [
  sidebarThread("a1", { sectionId: "sec_a", title: "Alpha task" }),
  sidebarThread("b1", { sectionId: "sec_b", title: "Beta task" }),
];

describe("collapsing a workstream", () => {
  it("does not move focus when a saved-collapsed group mounts", async () => {
    window.localStorage.setItem(
      "workstreams:v2:collapsed",
      JSON.stringify({ sec_a: true }),
    );
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
    });
    const alpha = within(await slot.findByRole("region", { name: "Alpha" }));
    expect(alpha.getByRole("button", { name: "Expand Alpha" })).toBeTruthy();
    // Mounting a group that was already collapsed leaves focus alone.
    expect(document.activeElement).toBe(document.body);
    slot.lifecycle.unmount();
  });

  it("recovers focus to the header when a group closes with focus inside", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
    });
    const alpha = within(await slot.findByRole("region", { name: "Alpha" }));
    const row = alpha.getByRole("link", { name: "Alpha task" });
    row.focus();
    expect(document.activeElement).toBe(row);
    fireEvent.click(alpha.getByRole("button", { name: "Collapse Alpha" }));
    await within(await slot.findByRole("region", { name: "Alpha" })).findByRole(
      "button",
      { name: "Expand Alpha" },
    );
    expect(document.activeElement).toBe(
      within(slot.getByRole("region", { name: "Alpha" })).getByRole("button", {
        name: "Expand Alpha",
      }),
    );
    slot.lifecycle.unmount();
  });
});
