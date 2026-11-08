import { mountWithBands } from "./sidebar-fixture.tsx";
// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sidebarThread } from "./fixtures.ts";
import { groupRows, mount } from "./sidebar-fixture.tsx";
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("applies the hover timestamp preference without hiding band context", async () => {
  const timestamps = "hover";
  const slot = await mountWithBands(undefined, { settings: { timestamps } });
  const alpha = slot.getByRole("region", { name: "Alpha" });
  const upNext = slot.getByRole("region", { name: "Up Next" });
  await waitFor(() => {
    const ages = alpha.querySelectorAll("[data-timestamp]");
    expect(ages).toHaveLength(2);
    for (const age of ages)
      expect(age.getAttribute("data-timestamp")).toBe(timestamps);
    const bandAges = upNext.querySelectorAll("[data-timestamp]");
    expect(bandAges).toHaveLength(3);
    for (const age of bandAges)
      expect(age.getAttribute("data-timestamp")).toBe(timestamps);
  });
  expect(within(upNext).getByText("Alpha")).toBeTruthy();
  slot.lifecycle.unmount();
});

it("updates header counts when the group is collapsed", async () => {
  const when = "collapsed",
    expanded = false,
    collapsed = true;
  const slot = await mount(
    [
      sidebarThread("ask", {
        sectionId: "sec_a",
        title: "Asking task",
        hasPendingInteraction: true,
        indicator: "waiting-for-input",
      }),
    ],
    { settings: { threadCount: when, waitingCount: when } },
  );
  const alpha = within(slot.getByRole("region", { name: "Alpha" }));
  const counts = () => [
    alpha.queryByTitle("1 waiting on you") !== null,
    alpha.queryAllByText("1", { selector: "span" }).length,
  ];
  await waitFor(() => expect(counts()).toEqual([expanded, expanded ? 2 : 0]));
  fireEvent.click(alpha.getByRole("button", { name: "Alpha" }));
  expect(counts()).toEqual([collapsed, collapsed ? 2 : 0]);
  slot.lifecycle.unmount();
});

it("does not request or render archived threads when their fold is hidden", async () => {
  const fetchNextPage = vi.fn(async () => undefined);
  const slot = await mount(
    [
      sidebarThread("archived", {
        title: "Archived task",
        isArchived: true,
        archivedAt: 100,
      }),
      sidebarThread("active", { title: "Active task" }),
    ],
    {
      settings: { showArchived: false },
      archived: {
        status: "ready",
        hasNextPage: true,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
        fetchNextPage,
      },
    },
  );
  await waitFor(() =>
    expect(slot.queryByRole("button", { name: /^Archived\d*$/ })).toBeNull(),
  );
  expect(slot.queryByText("Archived task")).toBeNull();
  expect(fetchNextPage).not.toHaveBeenCalled();
  slot.lifecycle.unmount();
});

it("shows archived threads grouped by workstream and loads another page", async () => {
  const fetchNextPage = vi.fn(async () => undefined);
  const slot = await mount(
    [
      sidebarThread("arch-alpha", {
        sectionId: "sec_a",
        title: "Archived Alpha task",
        isArchived: true,
        archivedAt: 300,
      }),
      sidebarThread("arch-alpha-old", {
        sectionId: "sec_a",
        title: "Older Alpha task",
        isArchived: true,
        archivedAt: 100,
      }),
      sidebarThread("arch-beta", {
        sectionId: "sec_b",
        title: "Archived task",
        isArchived: true,
        archivedAt: 200,
      }),
      sidebarThread("arch-beta-child", {
        parentThreadId: "arch-alpha",
        sectionId: "sec_b",
        title: "Archived child task",
        isArchived: true,
        archivedAt: 250,
      }),
      sidebarThread("arch-loose", {
        title: "Archived loose task",
        isArchived: true,
        archivedAt: 50,
      }),
      sidebarThread("arch-hidden", {
        sectionId: "sec_a",
        title: "Hidden archived task",
        isArchived: true,
        isHidden: true,
        archivedAt: 400,
      }),
      sidebarThread("active", { sectionId: "sec_a", title: "Active task" }),
    ],
    {
      settings: { showRecent: false, showArchived: true },
      archived: {
        status: "ready",
        hasNextPage: true,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
        fetchNextPage,
      },
    },
  );
  const archived = slot.getByRole("button", { name: /^Archived\d*$/ });
  expect(archived.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(archived);
  const alpha = within(slot.getByRole("region", { name: "Archived Alpha" }));
  fireEvent.click(alpha.getByRole("button", { name: /Alpha/ }));
  expect(
    alpha.getAllByRole("link").map((link) => link.getAttribute("aria-label")),
  ).toEqual(["Archived Alpha task", "Archived child task", "Older Alpha task"]);
  const beta = within(slot.getByRole("region", { name: "Archived Beta" }));
  fireEvent.click(beta.getByRole("button", { name: /Beta/ }));
  expect(groupRows(slot, "Archived Beta")).toEqual(["Archived task"]);
  const betaRow = within(slot.getByRole("region", { name: "Archived Beta" }))
    .getByRole("link", { name: "Archived task" })
    .closest(".ws-row")!;
  expect(betaRow.textContent).not.toContain("Beta");
  const unsorted = within(
    slot.getByRole("region", { name: "Archived Unfiled" }),
  );
  fireEvent.click(unsorted.getByRole("button", { name: /Unfiled/ }));
  expect(groupRows(slot, "Archived Unfiled")).toEqual(["Archived loose task"]);
  const archivedRegion = slot.getByRole("region", { name: "Archived" });
  expect(
    archivedRegion.querySelector('[data-sidebar-thread-id="active"]'),
  ).toBeNull();
  expect(
    archivedRegion.querySelector('[data-sidebar-thread-id="arch-hidden"]'),
  ).toBeNull();
  fireEvent.click(
    slot.getByRole("button", { name: "Load more archived threads" }),
  );
  expect(fetchNextPage).toHaveBeenCalledOnce();
  slot.lifecycle.unmount();
});

it("sorts workstreams alphabetically by default and lets the view menu change sorting", async () => {
  const slot = await mountWithBands(
    [
      sidebarThread("root", {
        sectionId: "sec_a",
        title: "Root task",
        latestAttentionAt: Date.now() - 1_000,
      }),
      sidebarThread("kid", {
        parentThreadId: "root",
        sectionId: "sec_b",
        title: "Kid task",
        latestAttentionAt: Date.now() - 1_000,
      }),
      sidebarThread("beta", {
        sectionId: "sec_b",
        title: "Beta task",
        latestAttentionAt: Date.now() - 2_000,
      }),
      sidebarThread("loose", { title: "Loose task" }),
    ],
    {
      settings: { showRecent: false, showForYou: false },
      order: { workstreams: ["sec_z", "sec_b", "sec_a"], threads: {} },
    },
  );
  await waitFor(() =>
    expect(
      slot.getAllByRole("region").map((r) => r.getAttribute("aria-label")),
    ).toEqual(["Alpha", "Beta", "Unfiled", "Zeta"]),
  );
  // The sort lives on the heading over the workstreams.
  expect(slot.getByRole("heading", { name: "Workstreams" })).toBeTruthy();
  fireEvent.pointerDown(
    slot.getByRole("button", { name: "Sort workstreams" }),
    { button: 0, ctrlKey: false },
  );
  const menu = await screen.findByRole("menu", {
    name: "Sort workstreams",
  });
  expect(within(menu).getByText("Sort workstreams")).toBeTruthy();
  fireEvent.click(
    within(menu).getByRole("menuitemradio", { name: "Recent activity" }),
  );
  await waitFor(() =>
    expect(
      slot.getAllByRole("region").map((r) => r.getAttribute("aria-label")),
    ).toEqual(["Alpha", "Beta", "Unfiled", "Zeta"]),
  );
  expect(slot.inspection.rpcCalls).toContainEqual(
    expect.objectContaining({
      method: "setPrefs",
      input: { patch: { sidebar: { groupSort: "activity" } } },
    }),
  );
  slot.lifecycle.unmount();
});

it("shows Unfiled, then recent empty workstreams; empty ones get a scoped New work action and no zero count", async () => {
  const slot = await mount(undefined, {
    settings: { showRecent: false, showForYou: false, groupSort: "manual" },
    order: { workstreams: ["sec_z", "sec_b", "sec_a"], threads: {} },
    lastPopulatedAt: { sec_z: Date.now() },
  });
  await waitFor(() =>
    expect(
      slot.getAllByRole("region").map((r) => r.getAttribute("aria-label")),
    ).toEqual(["Beta", "Alpha", "Unfiled", "Zeta"]),
  );
  expect(slot.queryByRole("button", { name: /Dormant/ })).toBeNull();
  const empty = within(slot.getByRole("region", { name: "Zeta" }));
  expect(empty.queryByText("0")).toBeNull();
  // An empty workstream has nothing to fold, so its header is not a button.
  expect(empty.queryByRole("button", { name: "Zeta" })).toBeNull();
  expect(
    slot
      .getByRole("region", { name: "Zeta" })
      .querySelector('.group\\/heading [data-icon^="Chevron"]'),
  ).toBeNull();
  expect(
    within(slot.getByRole("region", { name: "Beta" }))
      .getByRole("button", { name: "Beta" })
      .querySelector('[data-icon="ChevronDown"]'),
  ).not.toBeNull();
  expect(
    within(slot.getByRole("region", { name: "Beta" })).queryByText("1"),
  ).toBeNull();
  const newWork = empty.getByRole("button", { name: "New work in Zeta" });
  expect(newWork.classList.contains("opacity-0")).toBe(false);
  fireEvent.click(newWork);
  // New work happens in BB's own New thread view.
  expect(slot.inspection.navigateCalls).toEqual([
    { method: "toCompose", options: { focusPrompt: true } },
  ]);
  slot.lifecycle.unmount();
});

it("sorts and groups Recent from its section menu and persists the preference", async () => {
  const slot = await mountWithBands(
    [
      sidebarThread("a", {
        sectionId: "sec_a",
        title: "Zulu task",
        latestAttentionAt: 300,
      }),
      sidebarThread("b", {
        sectionId: "sec_b",
        title: "Alpha task",
        latestAttentionAt: 200,
      }),
    ],
    { settings: { showForYou: false } },
  );
  const menuButton = await slot.findByRole("button", {
    name: "Recent options",
  });
  fireEvent.pointerDown(menuButton, { button: 0, ctrlKey: false });
  const menu = await screen.findByRole("menu");
  fireEvent.click(
    within(menu).getByRole("menuitemradio", { name: "Title A–Z" }),
  );
  expect(groupRows(slot, "Recent")).toEqual(["Alpha task", "Zulu task"]);
  fireEvent.pointerDown(slot.getByRole("button", { name: "Recent options" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    within(await screen.findByRole("menu")).getByRole("menuitemcheckbox", {
      name: "Group by workstream",
    }),
  );
  expect(groupRows(slot, "Recent · Alpha")).toEqual(["Zulu task"]);
  expect(groupRows(slot, "Recent · Beta")).toEqual(["Alpha task"]);
  expect(
    JSON.parse(window.localStorage.getItem("workstreams:v1:band-options")!)
      .recent,
  ).toEqual({
    sort: "title",
    grouped: true,
  });
  slot.lifecycle.unmount();
});

it("shows Up Next and Recent as overlays without removing group rows", async () => {
  const slot = await mountWithBands([
    sidebarThread("ask", {
      sectionId: "sec_a",
      title: "Asking task",
      hasPendingInteraction: true,
      indicator: "waiting-for-input",
      isPinned: true,
      latestAttentionAt: Date.now() - 60_000,
    }),
    ...[1, 2, 3, 4, 5].map((n) =>
      sidebarThread(`other${n}`, {
        sectionId: "sec_b",
        title: `Other ${n}`,
        isPinned: n === 5,
        latestAttentionAt: Date.now() - n * 1_000,
      }),
    ),
    sidebarThread("other5-child", {
      parentThreadId: "other5",
      sectionId: "sec_b",
      title: "Other 5 child",
      latestAttentionAt: Date.now() - 500,
    }),
  ]);
  // Up Next takes the question and the four newest others; Recent carries
  // on with the next one.
  expect(groupRows(slot, "Up Next")).toEqual([
    "Asking task",
    "Other 1",
    "Other 2",
    "Other 3",
    "Other 4",
  ]);
  expect(groupRows(slot, "Recent")).toEqual(["Other 5"]);
  expect(groupRows(slot, "Recent")).not.toContain("Other 5 child");
  expect(
    within(slot.getByRole("region", { name: "Recent" })).queryByRole("img", {
      name: "Pinned",
    }),
  ).toBeNull();
  expect(
    within(slot.getByRole("region", { name: "Up Next" })).queryByRole("img", {
      name: "Pinned",
    }),
  ).toBeNull();
  expect(
    within(slot.getByRole("region", { name: "Alpha" })).getByRole("img", {
      name: "Pinned",
    }),
  ).toBeTruthy();
  expect(
    within(slot.getByRole("region", { name: "Recent" })).queryByRole("button", {
      name: /child threads/i,
    }),
  ).toBeNull();
  expect(groupRows(slot, "Beta")).toContain("Other 5 child");
  expect(groupRows(slot, "Beta")).toHaveLength(6);
  expect(groupRows(slot, "Alpha")).toEqual(["Asking task"]);
  const alpha = within(slot.getByRole("region", { name: "Alpha" }));
  expect(alpha.queryByTitle("1 waiting on you")).toBeNull();
  expect(alpha.queryByText("1", { selector: "span" })).toBeNull();
  fireEvent.click(alpha.getByRole("button", { name: "Alpha" }));
  expect(alpha.getByTitle("1 waiting on you")).toBeTruthy();
  expect(alpha.getAllByText("1", { selector: "span" })).toHaveLength(2);
  fireEvent.click(alpha.getByRole("button", { name: "Alpha" }));
  expect(alpha.queryByTitle("1 waiting on you")).toBeNull();
  slot.lifecycle.unmount();
});

it("collapses a parent's children in its group", async () => {
  const slot = await mount();
  expect(groupRows(slot, "Alpha")).toEqual(["Root task", "Kid task"]);
  const alpha = within(slot.getByRole("region", { name: "Alpha" }));
  fireEvent.click(alpha.getByRole("button", { name: "Hide child threads" }));
  expect(groupRows(slot, "Alpha")).toEqual(["Root task"]);
  fireEvent.click(alpha.getByRole("button", { name: "Show child threads" }));
  expect(groupRows(slot, "Alpha")).toEqual(["Root task", "Kid task"]);
  slot.lifecycle.unmount();
});

it("keeps child disclosures beneath the sticky Up Next card", async () => {
  const slot = await mountWithBands([
    sidebarThread("parent", {
      sectionId: "sec_a",
      title: "Waiting parent",
      hasPendingInteraction: true,
      indicator: "waiting-for-input",
      latestAttentionAt: Date.now() - 2_000,
    }),
    sidebarThread("child", {
      parentThreadId: "parent",
      sectionId: "sec_a",
      title: "Child thread",
      latestAttentionAt: Date.now() - 1_000,
    }),
    sidebarThread("other", {
      sectionId: "sec_b",
      title: "Other task",
      latestAttentionAt: Date.now() - 3_000,
    }),
  ]);
  const band = slot.getByRole("region", { name: "Up Next" });
  const disclosure = within(band).getByRole("button", {
    name: "Show child threads",
  });
  expect(disclosure.className).not.toContain("z-10");
  slot.lifecycle.unmount();
});

it("persists collapse state per group", async () => {
  const first = await mount(undefined, { settings: { showRecent: false } });
  fireEvent.click(
    within(first.getByRole("region", { name: "Alpha" })).getByRole("button", {
      name: "Alpha",
    }),
  );
  expect(
    within(first.getByRole("region", { name: "Alpha" })).queryAllByRole("link"),
  ).toHaveLength(0);
  first.lifecycle.unmount();
  const second = await mount(undefined, { settings: { showRecent: false } });
  expect(
    within(second.getByRole("region", { name: "Alpha" })).queryAllByRole(
      "link",
    ),
  ).toHaveLength(0);
  second.lifecycle.unmount();
});

it("offers a Topic submenu in the row menu", async () => {
  const slot = await mount(undefined, { settings: { showRecent: false } });
  const link = within(slot.getByRole("region", { name: "Alpha" })).getByRole(
    "link",
    {
      name: "Root task",
    },
  );
  fireEvent.contextMenu(link.closest("li")!);
  const item = await slot.findByRole("menuitem", {
    name: "Topic",
  });
  expect(item).toBeTruthy();
  slot.lifecycle.unmount();
});

it("folds the status slot away only when no row in the group has a mark", async () => {
  const slots = (slot: Awaited<ReturnType<typeof mount>>, name: string) =>
    [
      ...slot.getByRole("region", { name }).querySelectorAll(".ws-status-slot"),
    ].map((el) => el.hasAttribute("data-collapsed"));
  const quiet = await mount(
    [
      sidebarThread("a", { sectionId: "sec_a", title: "A" }),
      sidebarThread("b", { sectionId: "sec_a", title: "B" }),
    ],
    { settings: { showRecent: false } },
  );
  await quiet.findByRole("region", { name: "Alpha" });
  expect(slots(quiet, "Alpha")).toEqual([true, true]);
  quiet.lifecycle.unmount();
  const marked = await mount(
    [
      sidebarThread("a", { sectionId: "sec_a", title: "A", isUnread: true }),
      sidebarThread("b", { sectionId: "sec_a", title: "B" }),
    ],
    { settings: { showRecent: false } },
  );
  await marked.findByRole("region", { name: "Alpha" });
  expect(slots(marked, "Alpha")).toEqual([false, false]);
  marked.lifecycle.unmount();
});

it("keeps thread titles at their default color in workstreams and Up Next", async () => {
  const slot = await mountWithBands();
  for (const [region, name] of [
    ["Alpha", "Root task"],
    ["Up Next", "Root task"],
    ["Unfiled", "Loose task"],
  ]) {
    const row = within(slot.getByRole("region", { name: region })).getByRole(
      "link",
      { name },
    );
    expect(
      row?.closest(".ws-row")?.querySelector(".ws-thread-title"),
    ).toBeNull();
  }
  slot.lifecycle.unmount();
});
