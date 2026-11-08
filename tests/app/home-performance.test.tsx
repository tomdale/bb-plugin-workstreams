// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as presentation from "../../src/app/sidebar/presentation.ts";
import * as model from "../../src/app/home/model.ts";
import * as domainPresentation from "../../src/domain/presentation.ts";
import { mountHome, section, sidebarThread } from "./home-mount.tsx";

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

it("profiles Home parent updates and preserves group folding", async () => {
  const rowRenders = vi.spyOn(presentation, "shownWorkState");
  const descendantPlans = vi.spyOn(model, "descendantCounts");
  const durations: number[] = [];
  const threads = Array.from({ length: 120 }, (_, index) =>
    sidebarThread(`thread-${index}`, {
      sectionId: "sec_a",
      title: `Thread ${index}`,
      latestAttentionAt: Date.now() - index * 1_000,
      isUnread: index === 0,
    }),
  );
  const slot = await mountHome({
    threads,
    sections: [section("sec_a", "Alpha")],
    prefs: { showForYou: false, showSnoozed: false },
    onRender: (_id, phase, actualDuration) => {
      if (phase === "update") durations.push(actualDuration);
    },
  });
  await waitFor(() => expect(slot.getAllByRole("link")).toHaveLength(120));
  await waitFor(() =>
    expect(slot.container.querySelectorAll(".ws-home-age")).toHaveLength(120),
  );

  const measurements: Record<
    string,
    {
      rows: number;
      duration: number;
      reactDuration: number;
      commits: number;
      descendantPlans: number;
    }
  > = {};
  const measure = (name: string, update: () => void) => {
    vi.setSystemTime(Date.now() + 10);
    rowRenders.mockClear();
    descendantPlans.mockClear();
    durations.length = 0;
    const started = performance.now();
    update();
    measurements[name] = {
      rows: rowRenders.mock.calls.length,
      duration: performance.now() - started,
      reactDuration: durations.reduce((total, duration) => total + duration, 0),
      commits: durations.length,
      descendantPlans: descendantPlans.mock.calls.length,
    };
  };

  measure("unchanged", () => slot.rerenderHome());
  expect(slot.getAllByRole("link")).toHaveLength(120);

  measure("equal-clones", () => {
    threads.splice(0, threads.length, ...JSON.parse(JSON.stringify(threads)));
    slot.rerenderHome();
  });

  measure("single-thread", () =>
    slot.replaceThread("thread-41", (thread) => ({
      ...thread,
      title: "Changed thread",
      displayTitle: "Changed thread",
    })),
  );
  expect(slot.getByRole("link", { name: /Changed thread/ })).toBeTruthy();

  const alpha = () =>
    within(slot.getByRole("region", { name: "Alpha" })).getByRole("button", {
      name: /Alpha/,
    });
  measure("collapse", () => fireEvent.click(alpha()));
  expect(slot.queryAllByRole("link")).toHaveLength(0);
  measure("expand", () => fireEvent.click(alpha()));
  expect(slot.getAllByRole("link")).toHaveLength(120);

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
    within(slot.getByRole("region", { name: "Alpha" })).getByRole("img", {
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
    collapse: 0,
    expand: 120,
    "live-status": 1,
  });
  expect(
    Object.fromEntries(
      Object.entries(measurements).map(([name, measurement]) => [
        name,
        measurement.descendantPlans,
      ]),
    ),
  ).toEqual({
    unchanged: 0,
    "equal-clones": 0,
    "single-thread": 1,
    collapse: 0,
    expand: 1,
    "live-status": 1,
  });
  console.info(
    `HOME_PROFILE ${JSON.stringify({ threadCount: 120, measurements })}`,
  );
  slot.lifecycle.unmount();
}, 30_000);

it("skips unchanged Up Next rows with generated workstream colors", async () => {
  const ages = vi.spyOn(domainPresentation, "relativeAge");
  const threads = Array.from({ length: 120 }, (_, index) =>
    sidebarThread(`thread-${index}`, {
      sectionId: ["sec_a", "sec_b", "sec_z"][Math.floor(index / 40)],
      title: `Thread ${index}`,
      latestAttentionAt: Date.now() - index * 1_000,
      hasPendingInteraction: true,
      indicator: "waiting-for-input",
      indicatorLabel: "Waiting for input",
    }),
  );
  const slot = await mountHome({
    threads,
    prefs: { showForYou: true, showSnoozed: false },
  });
  await waitFor(() => expect(slot.getAllByRole("link")).toHaveLength(10));
  fireEvent.click(slot.getByRole("button", { name: "Show 110 more" }));
  await waitFor(() => expect(slot.getAllByRole("link")).toHaveLength(120));

  ages.mockClear();
  slot.rerenderHome();
  expect(ages).not.toHaveBeenCalled();

  slot.replaceThread("thread-41", (thread) => ({
    ...thread,
    title: "Changed Up Next thread",
    displayTitle: "Changed Up Next thread",
  }));
  expect(ages).toHaveBeenCalledOnce();
  expect(
    slot.getByRole("link", { name: /Changed Up Next thread/ }),
  ).toBeTruthy();
  slot.lifecycle.unmount();
}, 30_000);
