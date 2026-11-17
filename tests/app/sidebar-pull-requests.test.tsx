// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setOpenPullRequest } from "../../src/app/pullRequests/route.ts";
import type { TrackedPullRequest } from "../../src/domain/pullRequests.ts";
import { section, sidebarThread } from "./fixtures.ts";
import { mount } from "./sidebar-fixture.tsx";
import {
  NOW,
  check,
  minutesAgo,
  trackedPullRequest as pr,
  workstream,
} from "./pull-request-fixtures.ts";

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  setOpenPullRequest(null);
  vi.useRealTimers();
});

const tree = {
  workstreams: [
    workstream("ws_harbor", "Harbor", null),
    workstream("ws_quay", "Quay", null),
  ],
  groups: { sec_harbor: "ws_harbor", sec_quay: "ws_quay" },
};
const sections = [section("sec_harbor", "Harbor"), section("sec_quay", "Quay")];
const threads = () => [
  sidebarThread("t1", { sectionId: "sec_harbor", title: "Harbor work" }),
  sidebarThread("t2", { sectionId: "sec_harbor", title: "More harbor work" }),
];

async function mountWith(
  items: TrackedPullRequest[],
  options: Parameters<typeof mount>[1] = {},
  rows = threads(),
) {
  const slot = await mount(rows, {
    activeThreadId: null,
    sections,
    tree,
    realtime: true,
    settings: { showRecent: false, showUpNext: false },
    ...options,
    rpc: { trackedPullRequests: () => ({ items }), ...options.rpc },
  });
  return slot;
}

const region = (slot: Awaited<ReturnType<typeof mountWith>>, name: string) =>
  slot.findByRole("region", { name });
const listOf = (el: HTMLElement) =>
  within(el).queryByRole("list", { name: "Pull requests" });
const labels = (list: HTMLElement) =>
  within(list)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));

describe("pull request rows in the sidebar", () => {
  it("lists a workstream's pull requests above its threads, in status order", async () => {
    const slot = await mountWith([
      pr({ number: 5, title: "Waiting one", status: "waiting" }),
      pr({
        number: 6,
        title: "Merged one",
        status: "merged",
        mergedAt: minutesAgo(14),
      }),
      pr({ number: 7, title: "Draft one", status: "draft" }),
      pr({
        number: 8,
        title: "Failing one",
        status: "failing",
        checks: [check("test", "failed"), check("lint", "failed")],
      }),
      pr({ number: 9, title: "Running one", status: "running" }),
      pr({ number: 10, title: "Ready one", status: "ready" }),
      pr({
        number: 11,
        title: "Closed one",
        status: "closed",
        closedAt: minutesAgo(41),
      }),
    ]);
    const harbor = await region(slot, "Harbor");
    const list = await waitFor(() => listOf(harbor)!);
    expect(labels(list)).toEqual([
      "Pull request 10, Ready one, harbor, Ready",
      "Pull request 8, Failing one, harbor, 2 failing",
      "Pull request 9, Running one, harbor, Running",
      "Pull request 5, Waiting one, harbor, Waiting",
      "Pull request 7, Draft one, harbor, Draft",
      "Pull request 6, Merged one, harbor, Merged 14m ago",
      "Pull request 11, Closed one, harbor, Closed 41m ago",
    ]);
    // Above the threads, which keep their own list.
    const html = harbor.innerHTML;
    expect(html.indexOf("Ready one")).toBeLessThan(html.indexOf("Harbor work"));
  });

  it("draws number, title, repository, and an explicit status word on each row", async () => {
    const slot = await mountWith([
      pr({ number: 46, title: "Serve the dial", status: "ready" }),
    ]);
    const list = await waitFor(async () =>
      listOf(await region(slot, "Harbor"))!,
    );
    const row = within(list).getByRole("button");
    expect(row.textContent).toBe("#46Serve the dialharborReady");
    expect(row.getAttribute("data-status")).toBe("ready");
  });

  it("marks the open pull request as the current page", async () => {
    const slot = await mountWith([
      pr({ number: 1, status: "ready" }),
      pr({ number: 2, status: "waiting" }),
    ]);
    const list = await waitFor(async () =>
      listOf(await region(slot, "Harbor"))!,
    );
    const [first, second] = within(list).getAllByRole("button");
    expect(first!.getAttribute("aria-current")).toBeNull();
    const { act } = await import("@testing-library/react");
    act(() => setOpenPullRequest("github.example/tidewater/harbor#2"));
    expect(second!.getAttribute("aria-current")).toBe("page");
    expect(first!.getAttribute("aria-current")).toBeNull();
    expect(second!.className).toContain("ws-row-active");
  });

  it("opens a pull request on the Workstreams page through BB's navigation", async () => {
    const onNavigate = vi.fn();
    const slot = await mountWith([pr({ number: 2, status: "ready" })], {
      onNavigate,
    });
    const list = await waitFor(async () =>
      listOf(await region(slot, "Harbor"))!,
    );
    fireEvent.click(within(list).getByRole("button"));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "home",
      options: {
        subPath: "pull-request/github.example%2Ftidewater%2Fharbor%232",
      },
    });
    expect(onNavigate).toHaveBeenCalled();
  });

  it("separates the list from the threads by 12px only when it has rows", async () => {
    const slot = await mountWith([pr({ number: 3, status: "ready" })], {}, [
      ...threads(),
      sidebarThread("q1", { sectionId: "sec_quay", title: "Quay work" }),
    ]);
    const harbor = await region(slot, "Harbor");
    const list = await waitFor(() => listOf(harbor)!);
    expect(list.className).toContain("mb-3");
    expect(list.className).toContain("mt-[3px]");
    const quay = await region(slot, "Quay");
    expect(listOf(quay)).toBeNull();
    // Without a list there is no element, so no gap above the threads.
    expect(within(quay).queryAllByRole("list", { name: /pull/i })).toEqual([]);
  });

  it("keeps a workstream with pull requests and no thread on the list", async () => {
    const slot = await mountWith([
      pr({
        number: 4,
        title: "Dockside fix",
        workstreamId: "ws_quay",
        status: "failing",
        checks: [check("test", "failed")],
      }),
    ]);
    const quay = await region(slot, "Quay");
    const list = await waitFor(() => listOf(quay)!);
    expect(labels(list)).toEqual([
      "Pull request 4, Dockside fix, harbor, 1 failing",
    ]);
    expect(within(quay).queryAllByRole("link")).toEqual([]);
  });

  it("draws pull requests above the threads inside a group's workstreams, and a thread-less nested workstream's under its group", async () => {
    const groupTree = {
      workstreams: [
        workstream("ws_dock", "Dock", null),
        workstream("ws_crane", "Crane", "ws_dock"),
        workstream("ws_hoist", "Hoist", "ws_dock"),
        workstream("ws_pier", "Pier", "ws_dock"),
      ],
      groups: { sec_crane: "ws_crane", sec_hoist: "ws_hoist" },
      layout: [
        {
          workstreamId: "ws_dock",
          name: "Dock",
          prefix: [],
          lists: false,
          total: 6,
          children: [
            {
              workstreamId: "ws_crane",
              name: "Crane",
              prefix: [],
              lists: true,
              total: 3,
              children: [],
            },
            {
              workstreamId: "ws_hoist",
              name: "Hoist",
              prefix: [],
              lists: true,
              total: 3,
              children: [],
            },
          ],
        },
      ],
    };
    const rows = ["a", "b", "c"].flatMap((n) => [
      sidebarThread(`crane_${n}`, {
        sectionId: "sec_crane",
        title: `Crane ${n}`,
      }),
      sidebarThread(`hoist_${n}`, {
        sectionId: "sec_hoist",
        title: `Hoist ${n}`,
      }),
    ]);
    const slot = await mountWith(
      [
        pr({ number: 20, title: "Crane PR", workstreamId: "ws_crane" }),
        pr({
          number: 21,
          title: "Pier PR",
          workstreamId: "ws_pier",
          status: "ready",
        }),
      ],
      {
        sections: [
          section("sec_crane", "Crane"),
          section("sec_hoist", "Hoist"),
        ],
        tree: groupTree,
      },
      rows,
    );
    const top = await region(slot, "Dock");
    await waitFor(() =>
      expect(
        within(top).getAllByRole("list", { name: "Pull requests" }),
      ).toHaveLength(2),
    );
    const crane = within(top).getByRole("region", { name: "Crane" });
    expect(labels(listOf(crane)!)[0]).toContain("Crane PR");
    expect(crane.innerHTML.indexOf("Crane PR")).toBeLessThan(
      crane.innerHTML.indexOf("Crane a"),
    );
    expect(
      listOf(within(top).getByRole("region", { name: "Hoist" })),
    ).toBeNull();
    // Pier has no thread, yet draws inside Dock with its pull request, and not
    // as a header of its own beside Dock.
    const pier = within(top).getByRole("region", { name: "Pier" });
    expect(labels(listOf(pier)!)[0]).toContain("Pier PR");
    expect(slot.getAllByRole("region", { name: "Pier" })).toHaveLength(1);
  });

  it("does not move a pull request when its thread moves to another workstream", async () => {
    const slot = await mountWith([
      pr({ number: 30, title: "Stays in Harbor", threadId: "t1" }),
    ]);
    const harbor = await region(slot, "Harbor");
    await waitFor(() => listOf(harbor));
    slot.replaceThread("t1", (t) => ({ ...t, sectionId: "sec_quay" }));
    await waitFor(() =>
      expect(
        within(slot.getByRole("region", { name: "Quay" })).getByText(
          "Harbor work",
        ),
      ).toBeTruthy(),
    );
    expect(listOf(slot.getByRole("region", { name: "Harbor" }))).toBeTruthy();
    expect(listOf(slot.getByRole("region", { name: "Quay" }))).toBeNull();
  });

  it("shows a pull request that can't refresh with its own words, keeping its last status in the name", async () => {
    const slot = await mountWith([
      pr({
        number: 40,
        title: "Stale one",
        status: "ready",
        error: "gh is not signed in",
      }),
    ]);
    const list = await waitFor(async () =>
      listOf(await region(slot, "Harbor"))!,
    );
    const row = within(list).getByRole("button");
    expect(row.textContent).toContain("Can’t refresh");
    expect(row.getAttribute("aria-label")).toBe(
      "Pull request 40, Stale one, harbor, Ready, can’t refresh",
    );
  });

  it("updates when the server reports a change, and leaves unchanged rows alone", async () => {
    let items = [
      pr({ number: 50, title: "First", status: "running" }),
      pr({ number: 51, title: "Second", status: "waiting" }),
    ];
    let renders = 0;
    const slot = await mountWith(items, {
      onRender: () => renders++,
      rpc: { trackedPullRequests: () => ({ items }) },
    });
    const list = await waitFor(async () =>
      listOf(await region(slot, "Harbor"))!,
    );
    const [firstRow, secondRow] = within(list)
      .getAllByRole("button")
      .map((b) => b.closest("li")!);
    expect(labels(list)[0]).toContain("Running");
    // A poll that finds nothing new changes nothing.
    const before = renders;
    await slot.emitRealtime("pull-requests-changed", {});
    expect(within(list).getAllByRole("button")[0]!.closest("li")).toBe(
      firstRow,
    );
    expect(renders).toBe(before);
    items = [{ ...items[0]!, status: "ready" }, items[1]!];
    await slot.emitRealtime("pull-requests-changed", {});
    await waitFor(() => expect(labels(list)[0]).toContain("Ready"));
    // Only the changed row's element was replaced in place; the other stays.
    const rows = within(list)
      .getAllByRole("button")
      .map((b) => b.closest("li")!);
    expect(rows.some((row) => row === secondRow)).toBe(true);
  });

  it("draws no list at all before the server answers or when it fails", async () => {
    const slot = await mountWith([], {
      rpc: {
        trackedPullRequests: () => {
          throw new Error("down");
        },
      },
    });
    const harbor = await region(slot, "Harbor");
    expect(listOf(harbor)).toBeNull();
  });
});
