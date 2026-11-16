// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkstreamsPage } from "../../src/app/page/Page.tsx";
import { setOpenOverview } from "../../src/app/page/overview/route.ts";
import { emptyState, section, sidebarThread } from "./fixtures.ts";
import { mount as mountSidebar } from "./sidebar-fixture.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const analysis = (recap: string, state: string, needsYou: string | null) => ({
  recap,
  state,
  needsYou,
  revision: Date.now() + 60_000,
  at: Date.now(),
  model: "m",
});

async function mount(
  subPath = "overview/sec_a",
  rpc: Record<string, (input: unknown) => unknown> = {},
) {
  const now = Date.now();
  return renderSlot(
    { component: WorkstreamsPage },
    { subPath },
    {
      context: { projectId: null, threadId: null },
      sidebarThreads: {
        status: "ready",
        threads: [
          sidebarThread("done", {
            sectionId: "sec_a",
            title: "Finished work",
            latestAttentionAt: now - 7_200_000,
          }),
          sidebarThread("child", {
            parentThreadId: "done",
            title: "Delegate of finished work",
          }),
          sidebarThread("review", {
            sectionId: "sec_a",
            title: "Feed ready",
            isUnread: true,
            latestAttentionAt: now - 3_600_000,
          }),
          sidebarThread("asks", {
            sectionId: "sec_a",
            title: "Needs a decision",
            latestAttentionAt: now - 60_000,
          }),
          sidebarThread("run", {
            sectionId: "sec_a",
            title: "Still running",
            status: "active",
            indicator: "runtime",
          }),
          sidebarThread("other", { sectionId: "sec_b", title: "Beta work" }),
        ],
        sections: [
          section("sec_a", "Alpha"),
          section("sec_b", "Beta"),
          section("sec_c", "Gamma"),
        ],
        projects: [],
      },
      rpc: {
        state: () => ({
          ...emptyState(),
          analysis: {
            asks: {
              ...analysis("Two APIs fit", "needs_decision", "Pick an API"),
              revision: now - 60_000,
            },
          },
          recaps: {
            review: {
              id: "r1",
              turnId: "t1",
              at: now,
              state: "review",
              goal: "Built the feed",
              latest: ["Tests pass"],
              review: ["Open the page"],
              links: [],
              next: [{ title: "Ship it", message: "Ship the feed to main" }],
            },
            done: {
              id: "r2",
              turnId: "t2",
              at: now,
              state: "complete",
              goal: "Merged the fix",
              latest: [],
              review: [],
              links: [],
              next: [],
            },
          },
        }),
        recapFiles: () => ({ files: {} }),
        recapPrefs: () => ({ prefs: {} }),
        recap_send: () => ({ ok: true }),
        threadArchive: () => ({ ok: true }),
        threadUnarchive: () => ({ ok: true }),
        ...rpc,
      },
    },
  );
}

type Slot = Awaited<ReturnType<typeof mount>>;
const rows = (slot: Slot) =>
  within(slot.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell"));
const rowOf = (slot: Slot, title: string) =>
  slot
    .getByRole("button", { name: title })
    .closest('[role="row"]') as HTMLElement;

it("lists a workstream's root threads by status with summary and next steps", async () => {
  const slot = await mount();
  await slot.findByRole("table", { name: "Threads in Alpha" });
  expect(slot.getByRole("heading", { level: 1 }).textContent).toBe("Alpha");
  expect(
    slot.getByText("4 threads. 1 needs you and 1 is ready for review."),
  ).toBeTruthy();
  expect(
    rows(slot).map(([status, title]) => [
      status!.textContent,
      title!.textContent,
    ]),
  ).toEqual([
    ["Needs you", "Needs a decision"],
    ["Ready for review", "Feed ready"],
    ["Working", "Still running"],
    ["Complete", "Finished work"],
  ]);
  const asks = within(rowOf(slot, "Needs a decision"));
  expect(asks.getByText("Two APIs fit")).toBeTruthy();
  expect(asks.getByText("Pick an API")).toBeTruthy();
  const review = within(rowOf(slot, "Feed ready"));
  expect(review.getByText("Built the feed")).toBeTruthy();
  expect(review.getByText("Open the page")).toBeTruthy();
  expect(review.getByRole("button", { name: "Ship it" })).toBeTruthy();
  // A finished thread with nothing left to follow up offers Archive.
  expect(
    within(rowOf(slot, "Finished work")).getAllByRole("button", {
      name: "Archive",
    }).length,
  ).toBe(2);
  // Other workstreams' threads and delegates get no row.
  expect(slot.queryByText("Beta work")).toBeNull();
  expect(slot.queryByText("Delegate of finished work")).toBeNull();
  slot.lifecycle.unmount();
});

it("opens a thread from its title", async () => {
  const slot = await mount();
  fireEvent.click(await slot.findByRole("button", { name: "Feed ready" }));
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "toThread",
    threadId: "review",
  });
  slot.lifecycle.unmount();
});

it("holds a follow-up behind its receipt so Undo can keep it from sending", async () => {
  const slot = await mount();
  const ship = await slot.findByRole("button", { name: "Ship it" });
  vi.useFakeTimers();
  fireEvent.click(ship);
  expect(slot.getByRole("status").textContent).toContain(
    "Sending to Feed ready",
  );
  // The row reads Working with the message until its turn ends.
  expect(rowOf(slot, "Feed ready").textContent).toContain(
    "You sent: Ship the feed to main",
  );
  fireEvent.click(slot.getByRole("button", { name: "Undo" }));
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(slot.inspection.rpcCalls.some((c) => c.method === "recap_send")).toBe(
    false,
  );
  fireEvent.click(slot.getByRole("button", { name: "Ship it" }));
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(
    slot.inspection.rpcCalls.find((c) => c.method === "recap_send")?.input,
  ).toEqual({
    threadId: "review",
    recapId: "r1",
    action: "Ship the feed to main",
  });
  // Once sent, the receipt gives the line back to the counts.
  expect(slot.queryByRole("status")).toBeNull();
  slot.lifecycle.unmount();
});

it("opens the thread instead of sending on a Shift-click", async () => {
  const slot = await mount();
  fireEvent.click(await slot.findByRole("button", { name: "Ship it" }), {
    shiftKey: true,
  });
  expect(slot.queryByRole("status")).toBeNull();
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "toThread",
    threadId: "review",
  });
  slot.lifecycle.unmount();
});

it("archives from Next steps, with Undo", async () => {
  const slot = await mount();
  await slot.findByRole("table");
  fireEvent.click(
    within(
      rowOf(slot, "Finished work").querySelector(".ws-overview-next")!,
    ).getByRole("button", { name: "Archive" }),
  );
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.find((c) => c.method === "threadArchive")?.input,
    ).toEqual({ threadId: "done" }),
  );
  expect(slot.getByRole("status").textContent).toContain(
    "Archived Finished work",
  );
  expect(slot.queryByRole("button", { name: "Finished work" })).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.find((c) => c.method === "threadUnarchive")
        ?.input,
    ).toEqual({ threadId: "done" }),
  );
  expect(slot.getByRole("button", { name: "Finished work" })).toBeTruthy();
  slot.lifecycle.unmount();
});

it("starts new work in the workstream", async () => {
  const slot = await mount();
  fireEvent.click(await slot.findByRole("button", { name: "New work" }));
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "toCompose",
    options: { focusPrompt: true },
  });
  slot.lifecycle.unmount();
});

it("says when a workstream has no open threads or no longer exists", async () => {
  const empty = await mount("overview/sec_c");
  expect(
    await empty.findByText("No open threads in this workstream."),
  ).toBeTruthy();
  expect(empty.queryByRole("table")).toBeNull();
  empty.lifecycle.unmount();
  cleanup();
  const gone = await mount("overview/sec_missing");
  expect(
    await gone.findByText("This workstream no longer exists."),
  ).toBeTruthy();
  gone.lifecycle.unmount();
});

it("goes back to the queue", async () => {
  const slot = await mount();
  fireEvent.click(await slot.findByRole("button", { name: "Back" }));
  await waitFor(() => expect(slot.queryByRole("table")).toBeNull());
  expect(slot.getByRole("navigation", { name: "Queue" })).toBeTruthy();
  slot.lifecycle.unmount();
});

it("opens from a workstream's name and menu in the sidebar", async () => {
  const slot = await mountSidebar(
    [sidebarThread("a1", { sectionId: "sec_a", title: "Alpha task" })],
    { settings: { showRecent: false, showForYou: false } },
  );
  const name = await slot.findByRole("button", { name: "Overview of Alpha" });
  fireEvent.click(name);
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "toPluginPanel",
    path: "home",
    options: { subPath: "overview/sec_a" },
  });
  // The header marks itself while the page shows its Overview.
  expect(name.getAttribute("aria-current")).toBeNull();
  act(() => setOpenOverview("sec_a"));
  expect(name.getAttribute("aria-current")).toBe("page");
  act(() => setOpenOverview(null));
  fireEvent.contextMenu(name);
  expect(await slot.findByRole("menuitem", { name: "Overview" })).toBeTruthy();
  slot.lifecycle.unmount();
});
