// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sidebarThread } from "./fixtures.ts";
import { dragGuardRemoved, mount } from "./sidebar-fixture.tsx";

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** One thread in Alpha and one in Beta, so both keep their headers. */
const threads = () => [
  sidebarThread("a1", {
    sectionId: "sec_a",
    title: "Alpha task",
    latestAttentionAt: Date.now(),
  }),
  sidebarThread("b1", {
    sectionId: "sec_b",
    title: "Beta task",
    latestAttentionAt: Date.now() - 1_000,
  }),
];

/**
 * Drags a workstream's header from one row's center to another's, laid out
 * as `layoutGroups` does (row 0 centers at 14px, row 1 at 42px).
 */
const dragHeader = (
  slot: Awaited<ReturnType<typeof mount>>,
  name: string,
  fromY: number,
  toY: number,
) => {
  const header = slot
    .getByRole("region", { name })
    .querySelector(".group\\/row")!;
  fireEvent.mouseDown(header, { button: 0, clientX: 10, clientY: fromY });
  fireEvent.mouseMove(document, { clientX: 10, clientY: fromY + 10 });
  fireEvent.mouseMove(document, { clientX: 10, clientY: toY });
  fireEvent.mouseUp(document, { clientX: 10, clientY: toY });
};

/**
 * jsdom has no layout. Lays the workstream groups out 28px apart in document
 * order, 200px wide, and gives every element containing them their union.
 */
function layoutGroups(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const groups = [
      ...document.querySelectorAll('section[data-flip-key^="group:"]'),
    ];
    const inside = groups.filter(
      (group) => this === group || this.contains(group),
    );
    if (!inside.length) return new DOMRect(0, 0, 0, 0);
    const first = groups.indexOf(inside[0]!);
    const last = groups.indexOf(inside.at(-1)!);
    return new DOMRect(0, first * 28, 200, (last - first + 1) * 28);
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

describe("workstream headers", () => {
  it("reorders workstreams by dragging a header in manual order", async () => {
    const restore = layoutGroups();
    try {
      const slot = await mount(threads(), {
        settings: {
          showRecent: false,
          showForYou: false,
          groupSort: "manual",
        },
      });
      await slot.findByRole("region", { name: "Alpha" });
      dragHeader(slot, "Alpha", 14, 42);
      await waitFor(() =>
        expect(
          slot.inspection.rpcCalls.find((c) => c.method === "reorder")?.input,
        ).toEqual({
          kind: "workstreams",
          ids: ["sec_b", "sec_a", "sec_z"],
        }),
      );
      await dragGuardRemoved();
      slot.lifecycle.unmount();
    } finally {
      restore();
    }
  });

  it("does not store a dragged order the name sort would hide", async () => {
    const restore = layoutGroups();
    try {
      const slot = await mount(threads(), {
        settings: { showRecent: false, showForYou: false },
      });
      await slot.findByRole("region", { name: "Alpha" });
      dragHeader(slot, "Alpha", 14, 42);
      expect(slot.inspection.rpcCalls.some((c) => c.method === "reorder")).toBe(
        false,
      );
      expect(
        slot.getAllByRole("region").map((r) => r.getAttribute("aria-label")),
      ).toEqual(["Alpha", "Beta", "Zeta"]);
      await dragGuardRemoved();
      slot.lifecycle.unmount();
    } finally {
      restore();
    }
  });

  it("draws an empty workstream's header without a fold chevron", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
    });
    const empty = within(await slot.findByRole("region", { name: "Zeta" }));
    expect(
      empty.queryByRole("button", { name: /^(Expand|Collapse) Zeta$/ }),
    ).toBeNull();
    expect(empty.getByText("Zeta")).toBeTruthy();
    // A workstream with threads keeps the control that folds it.
    const toggle = within(
      slot.getByRole("region", { name: "Alpha" }),
    ).getByRole("button", { name: "Collapse Alpha" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    slot.lifecycle.unmount();
  });

  it("folds a workstream only from the chevron beside its name", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
    });
    const alpha = within(await slot.findByRole("region", { name: "Alpha" }));
    // The row is the workstream's drag handle, so a press on the name is
    // not a fold.
    fireEvent.click(alpha.getByText("Alpha"));
    expect(alpha.getByRole("link", { name: "Alpha task" })).toBeTruthy();
    fireEvent.click(alpha.getByRole("button", { name: "Collapse Alpha" }));
    expect(alpha.queryAllByRole("link")).toHaveLength(0);
    expect(
      alpha
        .getByRole("button", { name: "Expand Alpha" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    slot.lifecycle.unmount();
  });
});
