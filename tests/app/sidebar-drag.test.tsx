// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sidebarThread } from "./fixtures.ts";
import { dragGuardRemoved, groupRows, mount } from "./sidebar-fixture.tsx";
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("reorders roots by dragging a row", async () => {
  const restore = layoutByRows();
  try {
    const slot = await mount(
      [
        sidebarThread("l1", { title: "Loose one", latestAttentionAt: 3 }),
        sidebarThread("l2", { title: "Loose two", latestAttentionAt: 2 }),
        sidebarThread("l3", { title: "Loose three", latestAttentionAt: 1 }),
      ],
      { settings: { showRecent: false, showForYou: false } },
    );
    expect(groupRows(slot, "Unfiled")).toEqual([
      "Loose one",
      "Loose two",
      "Loose three",
    ]);
    await waitFor(() =>
      expect(slot.queryByRole("region", { name: "Recent" })).toBeNull(),
    );
    let navigated = 0;
    const link = slot.container.querySelector<HTMLAnchorElement>(
      '[data-sidebar-thread-id="l3"]',
    )!;
    link.addEventListener("click", (event) => {
      if (!event.defaultPrevented) navigated++;
    });
    const row = link.closest("li")!;
    fireEvent.mouseDown(row, {
      button: 0,
      clientX: 10,
      clientY: 2 * 28 + 14,
    });
    fireEvent.mouseMove(document, { clientX: 10, clientY: 2 * 28 + 4 });
    fireEvent.mouseMove(document, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(document, { clientX: 10, clientY: 10 });
    fireEvent.click(link);
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.find((c) => c.method === "reorder")?.input,
      ).toEqual({
        kind: "threads",
        groupId: "unsorted",
        ids: ["l3", "l1", "l2"],
      }),
    );
    expect(groupRows(slot, "Unfiled")).toEqual([
      "Loose three",
      "Loose one",
      "Loose two",
    ]);
    expect(navigated).toBe(0);
    expect(
      slot.inspection.sidebarActionCalls.some((c) => c.method === "open"),
    ).toBe(false);
    await dragGuardRemoved();
    slot.lifecycle.unmount();
  } finally {
    restore();
  }
});

it("does not highlight another workstream until its topic binding is known", async () => {
  const restore = layoutByRows();
  try {
    const slot = await mount(
      [
        sidebarThread("alpha", {
          sectionId: "sec_a",
          title: "Alpha task",
          latestAttentionAt: 2,
        }),
        sidebarThread("beta", {
          sectionId: "sec_b",
          title: "Beta task",
          latestAttentionAt: 1,
        }),
      ],
      { settings: { showRecent: false } },
    );
    const link = slot.container.querySelector<HTMLAnchorElement>(
      '[data-sidebar-thread-id="alpha"]',
    )!;
    const row = link.closest("li")!;
    fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 14 });
    fireEvent.mouseMove(document, { clientX: 10, clientY: 42 });
    expect(slot.container.querySelector("[data-drop-target]")).toBeNull();
    fireEvent.mouseUp(document, { clientX: 10, clientY: 42 });
    expect(
      slot.inspection.rpcCalls.find((c) => c.method === "reorder"),
    ).toBeUndefined();
    await dragGuardRemoved();
    slot.lifecycle.unmount();
  } finally {
    restore();
  }
});

it.each(["collapsed", "empty"])(
  "moves a root onto a %s workstream header",
  async (target) => {
    const restore = layoutByRows();
    const rowBounds = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (
        this.tagName === "SECTION" &&
        this.getAttribute("aria-label") === "Beta"
      )
        return new DOMRect(0, 28, 200, 28);
      return rowBounds.call(this);
    };
    try {
      const threads = [
        sidebarThread("alpha", { sectionId: "sec_a", title: "Alpha task" }),
      ];
      if (target === "collapsed")
        threads.push(
          sidebarThread("beta", { sectionId: "sec_b", title: "Beta task" }),
        );
      const slot = await mount(threads, {
        settings: { showRecent: false, showForYou: false },
        catalog: {
          entities: [
            {
              id: "a",
              name: "Alpha",
              description: "",
              parentId: null,
              aliases: [],
            },
            {
              id: "b",
              name: "Beta",
              description: "",
              parentId: null,
              aliases: [],
            },
          ],
          groups: { sec_a: "a", sec_b: "b" },
        },
      });
      await waitFor(() =>
        expect(groupRows(slot, "Alpha")).toEqual(["Alpha task"]),
      );
      if (target === "collapsed")
        fireEvent.click(
          within(slot.getByRole("region", { name: "Beta" })).getByRole(
            "button",
            { name: "Beta" },
          ),
        );
      const row = slot.container
        .querySelector('[data-sidebar-thread-id="alpha"]')!
        .closest("li")!;
      fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 14 });
      fireEvent.mouseMove(document, { clientX: 10, clientY: 24 });
      fireEvent.mouseMove(document, { clientX: 10, clientY: 42 });
      expect(
        slot
          .getByRole("region", { name: "Beta" })
          .hasAttribute("data-drop-target"),
      ).toBe(true);
      fireEvent.mouseUp(document, { clientX: 10, clientY: 42 });
      await waitFor(() =>
        expect(
          slot.inspection.rpcCalls.find((c) => c.method === "reorder")?.input,
        ).toEqual({
          kind: "threads",
          groupId: "sec_b",
          ids: target === "collapsed" ? ["alpha", "beta"] : ["alpha"],
        }),
      );
      slot.selectThread("alpha");
      const header = within(
        slot.getByRole("region", { name: "Beta" }),
      ).getByRole("button", { name: "Beta" });
      if (header.getAttribute("aria-expanded") === "false")
        fireEvent.click(header);
      await waitFor(() =>
        expect(groupRows(slot, "Beta")).toEqual(
          target === "collapsed" ? ["Alpha task", "Beta task"] : ["Alpha task"],
        ),
      );
      await dragGuardRemoved();
      slot.lifecycle.unmount();
    } finally {
      restore();
    }
  },
);

it.each([false, true])(
  "chooses a topic inside a parent group and moves its delegates (failure: %s)",
  async (fails) => {
    let release!: () => void;
    const moveWait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restore = layoutByRows();
    try {
      const slot = await mount(
        [
          sidebarThread("alpha", {
            sectionId: "sec_a",
            title: "Alpha task",
            latestAttentionAt: Date.now(),
          }),
          sidebarThread("child", {
            parentThreadId: "alpha",
            title: "Delegate",
            latestAttentionAt: Date.now() - 1,
          }),
          sidebarThread("beta", {
            sectionId: "sec_b",
            title: "Beta task",
            latestAttentionAt: Date.now() - 2,
          }),
        ],
        {
          settings: { showRecent: false, showForYou: false },
          catalog: {
            entities: [
              {
                id: "a",
                name: "Alpha",
                description: "",
                parentId: null,
                aliases: [],
              },
              {
                id: "b",
                name: "Beta",
                description: "",
                parentId: null,
                aliases: [],
              },
              {
                id: "labels",
                name: "Labels",
                description: "",
                parentId: "b",
                aliases: [],
              },
            ],
            groups: { sec_a: "a", sec_b: "b" },
          },
          moveWait,
          assignmentError: fails ? "Topic assignment failed" : undefined,
        },
      );
      await waitFor(() =>
        expect(groupRows(slot, "Alpha")).toEqual(["Alpha task", "Delegate"]),
      );
      const row = slot.container
        .querySelector('[data-sidebar-thread-id="alpha"]')!
        .closest("li")!;
      fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 14 });
      fireEvent.mouseMove(document, { clientX: 10, clientY: 24 });
      fireEvent.mouseMove(document, { clientX: 10, clientY: 70 });
      expect(
        slot
          .getByRole("region", { name: "Beta" })
          .hasAttribute("data-drop-target"),
      ).toBe(true);
      fireEvent.mouseUp(document, { clientX: 10, clientY: 70 });
      await waitFor(() =>
        expect(
          slot.inspection.rpcCalls.find((c) => c.method === "taskMove")?.input,
        ).toEqual({ threadId: "alpha", entityId: "b" }),
      );
      expect(
        slot.getByText("Choosing a topic in the destination workstream…"),
      ).toBeTruthy();
      release();
      if (fails) {
        await slot.findByText("Topic assignment failed");
        expect(groupRows(slot, "Alpha")).toEqual(["Alpha task", "Delegate"]);
        expect(groupRows(slot, "Beta")).toEqual(["Beta task"]);
        expect(
          slot.inspection.rpcCalls.some((c) => c.method === "reorder"),
        ).toBe(false);
      } else {
        await waitFor(() =>
          expect(
            slot.inspection.rpcCalls.some((c) => c.method === "reorder"),
          ).toBe(true),
        );
        // Publish the coordinator's updated section through the SDK snapshot.
        slot.selectThread("alpha");
        await waitFor(() =>
          expect(groupRows(slot, "Beta")).toEqual([
            "Beta task",
            "Alpha task",
            "Delegate",
          ]),
        );
        expect(
          within(slot.getByRole("region", { name: "Alpha" })).queryAllByRole(
            "link",
          ),
        ).toEqual([]);
        expect(
          slot.inspection.rpcCalls.find((c) => c.method === "reorder")?.input,
        ).toEqual({
          kind: "threads",
          groupId: "sec_b",
          ids: ["beta", "alpha"],
        });
      }
      await dragGuardRemoved();
      slot.lifecycle.unmount();
    } finally {
      restore();
    }
  },
);

/**
 * jsdom has no layout. Lays rows out 28px apart in document order, 200px
 * wide, and gives every other element the union of the rows it contains.
 */
function layoutByRows(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const anchors = [...document.querySelectorAll("[data-sidebar-thread-id]")];
    const inside = anchors
      .map((a, i) => [a, i] as const)
      .filter(([a]) => this === a || this.contains(a));
    if (!inside.length) return new DOMRect(0, 0, 0, 0);
    const top = inside[0]![1] * 28;
    const bottom = (inside.at(-1)![1] + 1) * 28;
    return new DOMRect(0, top, 200, bottom - top);
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}
