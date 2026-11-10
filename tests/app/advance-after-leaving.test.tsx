// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  experimental_useSidebarThreads,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { ServerStateRealtime } from "../../src/app/serverState.ts";
import { AdvanceAfterLeaving } from "../../src/app/upNext/AdvanceAfterLeaving.tsx";
import { parsePrefs } from "../../src/domain/prefs.ts";
import type { ThreadSnooze } from "../../src/domain/snooze.ts";
import { emptyState, section, sidebarThread } from "./fixtures.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const blocked = (latestAttentionAt: number) => ({
  sectionId: "sec_a",
  hasPendingInteraction: true,
  indicator: "waiting-for-input" as const,
  latestAttentionAt,
});

/** Three threads blocked on the user, so Up Next ranks ask, beta, other. */
const threading = () => [
  sidebarThread("ask", blocked(300)),
  sidebarThread("beta", blocked(200)),
  sidebarThread("other", blocked(100)),
];

type Listing = {
  status: "ready";
  threads: PluginSidebarThread[];
  sections: ReturnType<typeof section>[];
  projects: never[];
  experimental_archived: null;
};

const listing = (threads: PluginSidebarThread[]): Listing => ({
  status: "ready",
  threads,
  sections: [section("sec_a", "Alpha")],
  projects: [],
  experimental_archived: null,
});

type Snoozes = Record<string, ThreadSnooze>;

/** What the sidebar lists, replaceable the way archiving replaces it. */
type Sidebar = { threads: PluginSidebarThread[] };

/**
 * The bridge with the state feed it reads, as BB mounts them. BB hands the
 * sidebar a new list; the harness's snapshot is mutated the same way, which is
 * how `sidebar-fixture.tsx` publishes thread changes too.
 */
function App({ sidebar }: { sidebar: Sidebar }) {
  experimental_useSidebarThreads().threads = sidebar.threads;
  return (
    <>
      <ServerStateRealtime />
      <AdvanceAfterLeaving />
    </>
  );
}

function mount(viewed: string, sidebarThreads: Listing, snoozes: Snoozes) {
  const sidebar: Sidebar = { threads: sidebarThreads.threads };
  const slot = renderSlot({ component: App }, { sidebar }, {
    context: { threadId: viewed, projectId: null },
    sidebarThreads,
    settings: {},
    rpc: {
      prefs: () => ({ prefs: parsePrefs({}) }),
      state: () => ({
        ...emptyState(),
        analysis: {},
        recaps: {},
        order: { workstreams: [], threads: {}, prioritized: [] },
        snoozes,
        snoozePrefs: {},
      }),
    },
  } as never);
  return { ...slot, sidebar };
}

/**
 * Mounts with the plugin's state already read, as the app has it by the time a
 * thread is snoozed.
 */
async function mountLoaded(
  viewed: string,
  sidebarThreads: Listing,
  snoozes: Snoozes,
) {
  const slot = await mount(viewed, sidebarThreads, snoozes);
  await act(async () => {
    await slot.emitRealtime("changed", {});
  });
  return slot;
}

/** Snoozes land through the plugin's state, as they do in the app. */
async function snooze(
  slot: Awaited<ReturnType<typeof mount>>,
  snoozes: Snoozes,
  threadId: string,
) {
  await act(async () => {
    snoozes[threadId] = {
      until: Date.now() + 3_600_000,
      events: false,
      attentionAt: 0,
      at: 0,
    } as ThreadSnooze;
    await slot.emitRealtime("changed", {});
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}

/** Takes threads out of the sidebar, as archiving them does. */
async function archive(
  slot: Awaited<ReturnType<typeof mount>>,
  ...ids: string[]
) {
  await act(async () => {
    slot.sidebar.threads = slot.sidebar.threads.filter(
      (thread) => !ids.includes(thread.id),
    );
    slot.rerender(<App sidebar={slot.sidebar} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}

it("opens the next Up Next thread once the thread in view is snoozed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const snoozes: Snoozes = {};
  const slot = await mountLoaded("beta", listing(threading()), snoozes);
  await snooze(slot, snoozes, "beta");
  expect(slot.inspection.sidebarActionCalls).toEqual([
    { method: "open", threadId: "other" },
  ]);
});

it("leaves the user where they are when another thread is snoozed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const snoozes: Snoozes = {};
  const slot = await mountLoaded("beta", listing(threading()), snoozes);
  await snooze(slot, snoozes, "ask");
  expect(slot.inspection.sidebarActionCalls).toEqual([]);
});

it("opens the next Up Next thread when the thread in view is archived", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const slot = await mountLoaded("beta", listing(threading()), {});
  await archive(slot, "beta");
  expect(slot.inspection.sidebarActionCalls).toEqual([
    { method: "open", threadId: "other" },
  ]);
});

it("skips the threads an archive took with it", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const slot = await mountLoaded("beta", listing(threading()), {});
  await archive(slot, "beta", "other");
  expect(slot.inspection.sidebarActionCalls).toEqual([
    { method: "open", threadId: "ask" },
  ]);
});

it("stays where it is when Up Next has nowhere else to go", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const snoozes: Snoozes = {};
  const slot = await mountLoaded("ask", listing([threading()[0]!]), snoozes);
  await snooze(slot, snoozes, "ask");
  expect(slot.inspection.sidebarActionCalls).toEqual([]);
});
