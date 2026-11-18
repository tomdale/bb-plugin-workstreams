// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { section, sidebarThread } from "./fixtures.ts";
import { mountWithBands } from "./sidebar-fixture.tsx";

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const sections = [section("sec_a", "Alpha")];
// Every row also carries its recap as a hidden description.
const shown = { ignore: "[hidden]" };

async function mountRows(rows: "compact" | "full") {
  const at = Date.now();
  const stored = { title: null, revision: at, at, model: "m" };
  const slot = await mountWithBands(
    [
      sidebarThread("done", {
        sectionId: "sec_a",
        title: "Done task",
        latestAttentionAt: at,
      }),
      sidebarThread("asks", {
        sectionId: "sec_a",
        title: "Asking task",
        latestAttentionAt: at,
      }),
      sidebarThread("fresh", { sectionId: "sec_a", title: "Fresh task" }),
    ],
    {
      sections,
      settings: { rows },
      analysis: {
        done: {
          ...stored,
          recap: "Shipped the checkout",
          state: "complete",
          ask: null,
        },
        asks: {
          ...stored,
          recap: "Asked.",
          state: "needs-input",
          ask: "Which region?",
        },
      },
    },
  );
  return { slot, group: await slot.findByRole("region", { name: "Alpha" }) };
}

it("adds a second line to every row with something to say when rows are Full", async () => {
  const { slot, group } = await mountRows("full");
  expect(within(group).getByText("Shipped the checkout", shown)).toBeTruthy();
  expect(within(group).getByText("Which region?", shown)).toBeTruthy();
  // Nothing is known about the third thread, so its row stays one line.
  const fresh = group.querySelector('[data-sidebar-thread-id="fresh"]');
  expect(fresh?.closest(".ws-row")?.className).toContain("items-center");
  slot.lifecycle.unmount();
});

it("keeps workstream rows to one line when rows are Compact", async () => {
  const { slot, group } = await mountRows("compact");
  expect(within(group).queryByText("Shipped the checkout", shown)).toBeNull();
  expect(within(group).queryByText("Which region?", shown)).toBeNull();
  slot.lifecycle.unmount();
});
