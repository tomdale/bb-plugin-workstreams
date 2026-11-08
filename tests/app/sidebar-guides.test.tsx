// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DEFAULT_LINE } from "../../src/domain/lines.ts";
import { section, sidebarThread } from "./fixtures.ts";
import { mount } from "./sidebar-fixture.tsx";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

it("draws independent guides for workstreams, categories and visible descendants", async () => {
  const line = {
    ...DEFAULT_LINE,
    show: true,
    color: "#123456",
    width: 2,
    indent: 4,
    spacing: 9,
  };
  const threads = Array.from({ length: 6 }, (_, i) =>
    sidebarThread(`t${i}`, { title: `Task ${i}`, sectionId: "sec_a" }),
  );
  threads.push(
    sidebarThread("child", {
      title: "Child",
      parentThreadId: "t0",
      sectionId: "sec_a",
    }),
  );
  threads.push(
    sidebarThread("grandchild", {
      title: "Grandchild",
      parentThreadId: "child",
      sectionId: "sec_a",
    }),
  );
  const slot = await mount(threads, {
    lines: { workstreams: line, categories: line, children: line },
    sections: [section("sec_a", "Alpha")],
    catalog: {
      entities: [
        {
          id: "alpha",
          name: "Alpha",
          description: "",
          parentId: null,
          aliases: [],
        },
      ],
      groups: { sec_a: "alpha" },
      categories: {
        alpha: {
          id: "generation",
          categories: [
            {
              id: "category",
              name: "Category",
              threadIds: ["t0", "t1", "t2", "t3", "t4", "t5"],
            },
          ],
        },
      },
    },
  });
  const group = await slot.findByRole("region", { name: "Alpha" });
  await waitFor(() =>
    expect(
      within(group).getByRole("heading", { name: "Category" }),
    ).toBeTruthy(),
  );
  expect(group.querySelector('[data-ws-guide="workstreams"]')).toBeTruthy();
  expect(group.querySelector('[data-ws-guide="categories"]')).toBeTruthy();
  const child = within(group)
    .getByRole("link", { name: "Child" })
    .closest("li")!;
  const grandchild = within(group)
    .getByRole("link", { name: "Grandchild" })
    .closest("li")!;
  expect(child.querySelectorAll('[data-ws-guide="children"]')).toHaveLength(1);
  expect(
    grandchild.querySelectorAll('[data-ws-guide="children"]'),
  ).toHaveLength(2);
  const childLine = child.querySelector<HTMLElement>(
    '[data-ws-guide="children"]',
  )!;
  expect(childLine.style.width).toBe("2px");
  expect(childLine.style.backgroundColor).toBe("rgb(18, 52, 86)");
  expect(
    parseFloat(
      (grandchild.querySelector(".ws-row") as HTMLElement).style.paddingLeft,
    ) -
      parseFloat(
        (child.querySelector(".ws-row") as HTMLElement).style.paddingLeft,
      ),
  ).toBe(15);
  const root = within(group)
    .getByRole("link", { name: "Task 0" })
    .closest("li")!;
  fireEvent.click(
    within(root).getByRole("button", { name: "Hide child threads" }),
  );
  expect(within(group).queryByRole("link", { name: "Child" })).toBeNull();
  slot.lifecycle.unmount();
});

it("draws section-group guides only when the group is expanded", async () => {
  const slot = await mount(
    [
      sidebarThread("archived", {
        title: "Done",
        sectionId: "sec_a",
        isArchived: true,
        archivedAt: 100,
      }),
    ],
    {
      lines: { sections: { ...DEFAULT_LINE, show: true } },
      archived: {
        status: "ready",
        hasNextPage: false,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
        fetchNextPage: async () => {},
      },
    },
  );
  await waitFor(() =>
    expect(slot.getByRole("button", { name: /^Archived\d*$/ })).toBeTruthy(),
  );
  fireEvent.click(slot.getByRole("button", { name: /^Archived\d*$/ }));
  const group = slot.getByRole("region", { name: "Archived Alpha" });
  expect(group.querySelector('[data-ws-guide="sections"]')).toBeNull();
  fireEvent.click(within(group).getByRole("button", { name: /Alpha/ }));
  expect(group.querySelector('[data-ws-guide="sections"]')).toBeTruthy();
  fireEvent.click(within(group).getByRole("button", { name: /Alpha/ }));
  expect(group.querySelector('[data-ws-guide="sections"]')).toBeNull();
  slot.lifecycle.unmount();
});
