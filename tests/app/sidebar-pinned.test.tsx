// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { section, sidebarThread } from "./fixtures.ts";
import { groupRows, mountWithBands } from "./sidebar-fixture.tsx";
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const sections = [section("sec_a", "Alpha"), section("sec_b", "Beta")];

it("lists pinned roots in BB's pin order under Up Next", async () => {
  const slot = await mountWithBands(
    [
      sidebarThread("keyed", {
        sectionId: "sec_a",
        title: "Keyed pin",
        isPinned: true,
        pinnedAt: 100,
        pinSortKey: "0A",
      }),
      sidebarThread("newer", {
        sectionId: "sec_b",
        title: "Newer pin",
        isPinned: true,
        pinnedAt: 300,
      }),
      sidebarThread("older", {
        sectionId: "sec_b",
        title: "Older pin",
        isPinned: true,
        pinnedAt: 200,
      }),
      sidebarThread("plain", { sectionId: "sec_a", title: "Plain task" }),
    ],
    { sections },
  );
  const pinned = await slot.findByRole("region", { name: "Pinned" });
  // A reordered pin leads; the pins never reordered follow, newest first.
  expect(groupRows(slot, "Pinned")).toEqual([
    "Keyed pin",
    "Newer pin",
    "Older pin",
  ]);
  expect(within(pinned).getByRole("heading", { name: "Pinned" })).toBeTruthy();
  slot.lifecycle.unmount();
});

it("keeps the pinned band in Up Next's floating plate and leaves pinned rows in their workstreams", async () => {
  const at = Date.now();
  const slot = await mountWithBands(
    [
      sidebarThread("alpha", { sectionId: "sec_a", title: "Alpha task" }),
      sidebarThread("pinned", {
        sectionId: "sec_b",
        title: "Pinned task",
        isPinned: true,
        pinnedAt: 100,
      }),
    ],
    {
      sections,
      // A question puts the pinned thread in Up Next too, so both bands show.
      analysis: {
        pinned: {
          recap: "Asked.",
          state: "needs_decision",
          needsYou: "Decide?",
          subject: null,
          drift: null,
          driftSectionId: null,
          revision: at,
          at,
          model: "m",
        },
      },
    },
  );
  const upNext = await slot.findByRole("region", { name: "Up Next" });
  const pinned = await slot.findByRole("region", { name: "Pinned" });
  // One sticky plate holds both bands, Pinned after Up Next.
  const plate = pinned.closest(".ws-up-next-sticky");
  expect(plate).not.toBeNull();
  expect(upNext.closest(".ws-up-next-sticky")).toBe(plate);
  expect(
    plate!.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  // The pinned thread keeps its place in its group as well.
  expect(groupRows(slot, "Beta")).toEqual(["Pinned task, Needs you"]);
  slot.lifecycle.unmount();
});

it("shows no pinned band when nothing is pinned", async () => {
  const slot = await mountWithBands(
    [sidebarThread("alpha", { sectionId: "sec_a", title: "Alpha task" })],
    { sections },
  );
  await slot.findByRole("region", { name: "Alpha" });
  expect(slot.queryByRole("region", { name: "Pinned" })).toBeNull();
  slot.lifecycle.unmount();
});
