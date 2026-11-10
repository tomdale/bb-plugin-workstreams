// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as presentation from "../../src/app/sidebar/presentation.ts";
import * as groups from "../../src/domain/groups.ts";
import * as categories from "../../src/domain/categoryRows.ts";
import * as sidebarRows from "../../src/app/sidebar/rows.ts";
import * as rowMenus from "../../src/app/sidebar/RowMenu.tsx";
import * as dnd from "../../src/app/sidebar/dnd.tsx";
import * as workstreamGroups from "../../src/app/sidebar/WorkstreamGroup.tsx";
import { emptyState, sidebarThread } from "./fixtures.ts";
import { mount } from "./sidebar-fixture.tsx";

const THREAD_COUNT = 120;

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("profiles parent updates and preserves row interactions", async () => {
  const rowRenders = vi.spyOn(presentation, "presentRow");
  const menuRenders = vi.spyOn(rowMenus, "RowMenu");
  const headerRenders = vi.spyOn(workstreamGroups, "WorkstreamGroup");
  const derived = {
    arrangeGroups: vi.spyOn(groups, "arrangeGroups"),
    categoryRows: vi.spyOn(categories, "categoryRows"),
    descendantsOf: vi.spyOn(sidebarRows, "descendantsOf"),
    treesOf: vi.spyOn(sidebarRows, "treesOf"),
  };
  const durations: number[] = [];
  const threads = Array.from({ length: THREAD_COUNT }, (_, index) =>
    sidebarThread(`thread-${index}`, {
      sectionId: ["sec_a", "sec_b", "sec_z"][Math.floor(index / 40)],
      title: `Thread ${index}`,
      latestAttentionAt: Date.now() - index * 1_000,
      isUnread: index === 0,
      // A mark from the start keeps the status column open, so a row that
      // gains one later re-renders alone.
      ...(index === 79 ? { indicator: "draft" } : {}),
    }),
  );
  const onNavigate = vi.fn();
  const slot = await mount(threads, {
    activeThreadId: "thread-0",
    onNavigate,
    settings: {
      showForYou: false,
      showRecent: false,
      showSnoozed: false,
      showArchived: false,
    },
    onRender: (_id, phase, actualDuration) => {
      if (phase === "update") durations.push(actualDuration);
    },
  });
  await waitFor(() => expect(slot.getAllByRole("link")).toHaveLength(120));
  await waitFor(() =>
    expect(slot.container.querySelectorAll("[data-timestamp]")).toHaveLength(
      120,
    ),
  );

  const measurements: Record<
    string,
    {
      rows: number;
      menus: number;
      headers: number;
      duration: number;
      reactDuration: number;
      commits: number;
      derived: Record<string, number>;
    }
  > = {};
  const measure = (name: string, update: () => void) => {
    vi.setSystemTime(Date.now() + 10);
    rowRenders.mockClear();
    menuRenders.mockClear();
    headerRenders.mockClear();
    for (const spy of Object.values(derived)) spy.mockClear();
    durations.length = 0;
    const started = performance.now();
    update();
    measurements[name] = {
      rows: rowRenders.mock.calls.length,
      menus: menuRenders.mock.calls.length,
      headers: headerRenders.mock.calls.length,
      duration: performance.now() - started,
      reactDuration: durations.reduce((total, duration) => total + duration, 0),
      commits: durations.length,
      derived: Object.fromEntries(
        Object.entries(derived).map(([name, spy]) => [
          name,
          spy.mock.calls.length,
        ]),
      ),
    };
  };

  measure("unchanged", () => slot.rerenderList());
  expect(slot.getAllByRole("link")).toHaveLength(120);

  measure("equal-clones", () => {
    threads.splice(0, threads.length, ...JSON.parse(JSON.stringify(threads)));
    slot.rerenderList();
  });

  measure("single-thread", () =>
    slot.replaceThread("thread-41", (thread) => ({
      ...thread,
      title: "Changed thread",
      displayTitle: "Changed thread",
    })),
  );
  expect(slot.getByRole("link", { name: "Changed thread" })).toBeTruthy();

  measure("active-navigation", () => slot.selectThread("thread-1"));
  expect(
    slot.getByRole("link", { name: "Thread 1" }).getAttribute("aria-current"),
  ).toBe("page");
  expect(
    slot.getByRole("link", { name: "Thread 0" }).getAttribute("aria-current"),
  ).toBeNull();
  measure("collapse", () => {
    fireEvent.click(
      within(slot.getByRole("region", { name: "Alpha" })).getByRole("button", {
        name: "Collapse Alpha",
      }),
    );
  });
  expect(slot.getAllByRole("link")).toHaveLength(80);

  measure("live-status", () =>
    slot.replaceThread("thread-41", (thread) => ({
      ...thread,
      isUnread: true,
      indicator: "waiting-for-input",
      indicatorLabel: "Waiting for input",
      hasPendingInteraction: true,
    })),
  );
  expect(
    within(slot.getByRole("region", { name: "Beta" })).getByRole("img", {
      name: "Needs you, unread",
    }),
  ).toBeTruthy();
  fireEvent.click(
    slot.getByRole("link", { name: "Changed thread, Needs you" }),
  );
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(slot.inspection.sidebarActionCalls.at(-1)).toMatchObject({
    method: "open",
    threadId: "thread-41",
  });

  expect(
    Object.fromEntries(
      Object.entries(measurements).map(([name, measurement]) => [
        name,
        measurement.rows,
      ]),
    ),
  ).toEqual({
    unchanged: 0,
    "equal-clones": 0,
    "single-thread": 1,
    "active-navigation": 2,
    collapse: 0,
    "live-status": 1,
  });
  for (const measurement of Object.values(measurements))
    expect(measurement.menus).toBe(measurement.rows);
  // A list render that leaves a workstream's own inputs alone skips its header.
  for (const name of ["unchanged", "equal-clones"])
    expect(measurements[name]!.headers, name).toBe(0);
  // A thread change renders its own workstream's header, not its neighbors'.
  expect(measurements["single-thread"]!.headers).toBe(1);
  for (const name of [
    "unchanged",
    "equal-clones",
    "active-navigation",
    "collapse",
  ])
    expect(measurements[name]!.derived, name).toMatchObject({
      categoryRows: 0,
      treesOf: 0,
    });
  expect(measurements.unchanged!.derived).toMatchObject({
    arrangeGroups: 0,
    descendantsOf: 0,
  });
  for (const name of ["single-thread", "live-status"])
    expect(measurements[name]!.derived).toMatchObject({
      arrangeGroups: 1,
      descendantsOf: 1,
      categoryRows: 1,
      treesOf: 1,
    });
  console.info(
    `SIDEBAR_PROFILE ${JSON.stringify({ threadCount: THREAD_COUNT, measurements })}`,
  );
  slot.lifecycle.unmount();
}, 30_000);

it("does no row or tree work on a minute tick when ages are hidden", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  const rowRenders = vi.spyOn(presentation, "presentRow");
  const categoryPlan = vi.spyOn(categories, "categoryRows");
  const trees = vi.spyOn(sidebarRows, "treesOf");
  const slot = await mount(
    [
      sidebarThread("root", { sectionId: "sec_a", title: "Root task" }),
      sidebarThread("other", { sectionId: "sec_b", title: "Other task" }),
    ],
    {
      settings: {
        timestamps: "hide",
        showForYou: false,
        showRecent: false,
        showSnoozed: false,
        showArchived: false,
      },
    },
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(slot.getAllByRole("link")).toHaveLength(2);
  expect(slot.container.querySelectorAll("[data-timestamp]")).toHaveLength(0);
  rowRenders.mockClear();
  categoryPlan.mockClear();
  trees.mockClear();
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(rowRenders).not.toHaveBeenCalled();
  expect(categoryPlan).not.toHaveBeenCalled();
  expect(trees).not.toHaveBeenCalled();
  slot.lifecycle.unmount();
});

it("retains a row's previous time while its visible age is unchanged", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  const rowRenders = vi.spyOn(presentation, "presentRow");
  const categoryPlan = vi.spyOn(categories, "categoryRows");
  const trees = vi.spyOn(sidebarRows, "treesOf");
  const slot = await mount(
    [
      sidebarThread("root", {
        sectionId: "sec_a",
        title: "Root task",
        latestAttentionAt: Date.now() + 120_000,
      }),
    ],
    {
      settings: {
        showForYou: false,
        showRecent: false,
        showSnoozed: false,
        showArchived: false,
      },
    },
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(slot.getAllByRole("link")).toHaveLength(1);
  expect(slot.getByText("now", { selector: "[data-timestamp]" })).toBeTruthy();
  rowRenders.mockClear();
  categoryPlan.mockClear();
  trees.mockClear();
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(slot.getByText("now", { selector: "[data-timestamp]" })).toBeTruthy();
  expect(rowRenders).not.toHaveBeenCalled();
  expect(categoryPlan).not.toHaveBeenCalled();
  expect(trees).not.toHaveBeenCalled();
  slot.lifecycle.unmount();
});

it("renders only the changed row when one thread's analysis changes", async () => {
  const sortables = vi.spyOn(dnd, "Sortable");
  const headers = vi.spyOn(workstreamGroups, "WorkstreamGroup");
  const rowRenders = vi.spyOn(presentation, "presentRow");
  const threads = Array.from({ length: 60 }, (_, index) =>
    sidebarThread(`thread-${index}`, {
      sectionId: ["sec_a", "sec_b", "sec_z"][Math.floor(index / 20)],
      title: `Thread ${index}`,
      latestAttentionAt: Date.now() - index * 1_000,
    }),
  );
  const progress = (recap: string, revision: number) => ({
    recap,
    state: "in_progress",
    needsYou: null,
    subject: null,
    goal: null,
    drift: null,
    driftSectionId: null,
    revision,
    at: revision,
    model: "m",
  });
  const analysis: Record<string, unknown> = {
    "thread-41": progress("Reading the code.", Date.now()),
  };
  const slot = await mount(threads, {
    realtime: true,
    activeThreadId: null,
    settings: {
      showForYou: false,
      showRecent: false,
      showSnoozed: false,
      showArchived: false,
    },
    rpc: {
      state: () => ({
        ...emptyState(),
        analysis: { ...analysis },
        order: { workstreams: [], threads: {}, prioritized: [] },
      }),
    },
  });
  await waitFor(() => expect(slot.getAllByRole("link")).toHaveLength(60));
  sortables.mockClear();
  headers.mockClear();
  rowRenders.mockClear();

  analysis["thread-41"] = progress("Writing the fix.", Date.now() + 1);
  await act(async () => slot.behavior.emitRealtime("changed", {}));
  await waitFor(() => expect(rowRenders).toHaveBeenCalled());
  // The row's own selection renders it; no group header, sortable tree, or
  // other row renders.
  expect(rowRenders).toHaveBeenCalledTimes(1);
  expect(sortables).not.toHaveBeenCalled();
  expect(headers).not.toHaveBeenCalled();
  slot.lifecycle.unmount();
});
