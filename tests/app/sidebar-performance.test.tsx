// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as presentation from "../../src/app/sidebar/presentation.ts";
import * as groups from "../../src/domain/groups.ts";
import * as categories from "../../src/domain/categoryRows.ts";
import * as sidebarRows from "../../src/app/sidebar/rows.ts";
import * as rowMenus from "../../src/app/sidebar/RowMenu.tsx";
import { sidebarThread } from "./fixtures.ts";
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
    for (const spy of Object.values(derived)) spy.mockClear();
    durations.length = 0;
    const started = performance.now();
    update();
    measurements[name] = {
      rows: rowRenders.mock.calls.length,
      menus: menuRenders.mock.calls.length,
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
  fireEvent.click(slot.getByRole("link", { name: "Thread 1" }));
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(slot.inspection.sidebarActionCalls.at(-1)).toMatchObject({
    method: "open",
    threadId: "thread-1",
  });

  measure("collapse", () => {
    fireEvent.click(
      within(slot.getByRole("region", { name: "Alpha" })).getByRole("button", {
        name: "Alpha",
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
      name: "Waiting for input",
    }),
  ).toBeTruthy();

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
  expect(measurements.unchanged!.derived).toMatchObject({
    arrangeGroups: 0,
    descendantsOf: 0,
    treesOf: 3,
  });
  expect(measurements["single-thread"]!.derived).toMatchObject({
    arrangeGroups: 1,
    descendantsOf: 1,
    treesOf: 3,
  });
  console.info(
    `SIDEBAR_PROFILE ${JSON.stringify({ threadCount: THREAD_COUNT, measurements })}`,
  );
  slot.lifecycle.unmount();
}, 30_000);
