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
import { ActivityView } from "./activity-mount.tsx";
import { emptyState } from "./fixtures.ts";
import { chooseOption } from "./select.ts";

import * as activityLoader from "../../src/app/page/activityLoader.ts";
import { entry, trace } from "./activity-fixtures.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function page(rpc: Record<string, unknown>) {
  return renderSlot(
    { component: ActivityView },
    {},
    {
      settings: {},
      rpc: {
        prefs: () => ({
          prefs: {
            sidebar: { showForYou: true, showRecent: true, recentLimit: 5 },
            threads: {
              autoTitle: true,
              analysisModel: { kind: "gateway", model: "m" },
              showParentLink: false,
            },
            newWork: {
              homeProjectId: "",
              suggestions: true,
              suggestionsModel: { kind: "gateway", model: "m" },
            },
            organize: { model: { kind: "gateway", model: "m" } },
            advanced: { hostId: "", debug: true },
          },
        }),
        state: () => emptyState(),
        journal: () => ({ entries: [entry] }),
        ...rpc,
      } as never,
    },
  );
}

it("distinguishes an empty server-filtered trace result from an empty log", async () => {
  const slot = await page({
    journal: () => ({ entries: [] }),
    traces: () => ({ traces: [] }),
  });
  await slot.findByText("No activity yet.");
  chooseOption(
    await slot.findByRole("combobox", { name: "Filter by model call kind" }),
    "Quick analysis",
  );
  expect(await slot.findByText("No matching activity.")).toBeTruthy();
});

it("filters internal calls, exposes metadata and event internals, and opens the full inspector", async () => {
  const traces = [
    trace("ok"),
    trace("bad", {
      kind: "quick-analysis",
      status: "failed",
      error: "Offline",
    }),
    trace("replay", { replayOf: "ok" }),
  ];
  const slot = await page({
    traces: ({ ids, kind }: { ids?: string[]; kind?: string }) => ({
      traces: traces.filter(
        (t) => (!ids || ids.includes(t.id)) && (!kind || t.kind === kind),
      ),
    }),
    trace: ({ id }: { id: string }) => ({
      trace: {
        ...traces.find((t) => t.id === id),
        id,
        provider: "test",
        thinking: "off",
        system: "Classify",
        prompt: "Exact prompt",
        input: {},
        response: "{}",
        reasoning: null,
        stopReason: "stop",
        parsed: {},
        outcome: {},
        links: [],
        replays: [],
      },
    }),
  });
  expect(await slot.findByText("3 model calls shown · $0.0300")).toBeTruthy();
  expect(
    slot.getByRole("link", { name: "Parser thread" }).getAttribute("href"),
  ).toBe("/threads/missing-thread");
  expect(slot.queryByText(/Internal ·/)).toBeNull();
  expect(slot.getByText("Replay")).toBeTruthy();
  expect(
    slot
      .getAllByText("Technical details")
      .every((node) => !node.closest("details")!.open),
  ).toBe(true);
  const entryRow = slot.getByText("Moved a thread").closest("li")!;
  fireEvent.click(within(entryRow).getByText("Technical details"));
  expect(within(entryRow).getByText("Event ID")).toBeTruthy();
  expect(within(entryRow).getByText("e1")).toBeTruthy();
  const callRow = slot.getByText("ok").closest("li")!;
  fireEvent.click(within(callRow).getByText("Technical details"));
  expect(within(callRow).getByText("Model", { selector: "dt" })).toBeTruthy();
  expect(within(callRow).getByText("Duration")).toBeTruthy();
  expect(within(callRow).getByText("Input tokens")).toBeTruthy();
  expect(within(callRow).getByText("Output tokens")).toBeTruthy();
  fireEvent.click(
    // Debug mode arrives with the asynchronously loaded preferences.
    await within(callRow).findByRole("button", {
      name: "Inspect this model call",
    }),
  );
  const pane = await within(document.body).findByRole("dialog");
  expect(await within(pane).findByLabelText("Prompt")).toHaveProperty(
    "textContent",
    "Exact prompt",
  );
  fireEvent.click(within(pane).getByRole("button", { name: "Close" }));
  fireEvent.click(slot.getByRole("checkbox", { name: "Failures only" }));
  expect(slot.queryByText("Moved a thread")).toBeNull();
  expect(slot.queryByText("ok")).toBeNull();
  expect(slot.getByText("bad")).toBeTruthy();
  expect(slot.getByText("1 model calls shown · $0.0100")).toBeTruthy();
  chooseOption(
    slot.getByRole("combobox", { name: "Filter by model call kind" }),
    "Quick analysis",
  );
  expect(await slot.findByText("bad")).toBeTruthy();
  chooseOption(
    slot.getByRole("combobox", { name: "Filter by action" }),
    "Move",
  );
  expect(await slot.findByText("Moved a thread")).toBeTruthy();
  expect(slot.queryByText("bad")).toBeNull();
  chooseOption(
    slot.getByRole("combobox", { name: "Filter by action" }),
    "Model calls",
  );
  expect(slot.getByText("bad")).toBeTruthy();
});

it("connects pagination, realtime, filter changes, and unmount to the loader", async () => {
  let publish!: Parameters<typeof activityLoader.createActivityLoader>[1];
  const load = vi.fn(async () => {});
  const refresh = vi.fn(async () => {});
  const cancel = vi.fn();
  vi.spyOn(activityLoader, "createActivityLoader").mockImplementation(
    (_source, sink) => {
      publish = sink;
      return { load, refresh, cancel };
    },
  );
  const slot = await page({});
  await waitFor(() =>
    expect(load).toHaveBeenLastCalledWith({
      external: false,
      debug: true,
      traceLimit: 100,
      callKind: "",
    }),
  );
  act(() => {
    publish.entries([entry]);
    publish.calls([trace("first")], true);
  });
  fireEvent.click(slot.getByRole("button", { name: "Load older model calls" }));
  await waitFor(() =>
    expect(load).toHaveBeenLastCalledWith(
      expect.objectContaining({ traceLimit: 200 }),
    ),
  );
  act(() => publish.calls([trace("first"), trace("older")], false));
  expect(slot.getByText("older")).toBeTruthy();
  expect(slot.getByText("2 model calls shown · $0.0200")).toBeTruthy();
  expect(
    slot.queryByRole("button", { name: "Load older model calls" }),
  ).toBeNull();
  load.mockClear();
  refresh.mockClear();
  await slot.behavior.emitRealtime("changed", {});
  expect(refresh).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ traceLimit: 200 }),
  );
  expect(load).not.toHaveBeenCalled();
  cancel.mockClear();
  chooseOption(
    slot.getByRole("combobox", { name: "Filter by model call kind" }),
    "Quick analysis",
  );
  await waitFor(() =>
    expect(load).toHaveBeenLastCalledWith(
      expect.objectContaining({ callKind: "quick-analysis", traceLimit: 100 }),
    ),
  );
  expect(cancel).toHaveBeenCalled();
  cancel.mockClear();
  slot.lifecycle.unmount();
  expect(cancel).toHaveBeenCalledExactlyOnceWith();
});

it("clears hidden debug-only filters when Debug mode turns off", async () => {
  const slot = await page({
    traces: () => ({
      traces: [trace("bad", { status: "failed", error: "Offline" })],
    }),
  });
  await slot.findByText("bad");
  fireEvent.click(slot.getByRole("checkbox", { name: "Failures only" }));
  expect(slot.queryByText("Moved a thread")).toBeNull();
  await slot.behavior.emitRealtime("prefs", {
    prefs: { advanced: { debug: false } },
  });
  await waitFor(() =>
    expect(slot.queryByRole("checkbox", { name: "Failures only" })).toBeNull(),
  );
  expect(slot.getByText("Moved a thread")).toBeTruthy();
  expect(slot.queryByText("bad")).toBeNull();
});

it("reports when filters match no activity", async () => {
  const slot = await page({ traces: () => ({ traces: [] }) });
  await slot.findByText("Moved a thread");
  chooseOption(
    slot.getByRole("combobox", { name: "Filter by action" }),
    "Removed topic",
  );
  expect(await slot.findByText("No matching activity.")).toBeTruthy();
});

it("keeps traces and reports a failed clear without losing journal entries", async () => {
  const slot = await page({
    traces: () => ({ traces: [trace("kept")] }),
    traceClear: () => {
      throw new Error("Clear failed");
    },
  });
  await slot.findByText("kept");
  fireEvent.click(slot.getByRole("button", { name: "Clear traces…" }));
  fireEvent.click(slot.getByRole("button", { name: "Delete traces" }));
  expect((await slot.findByRole("alert")).textContent).toBe("Clear failed");
  expect(slot.getByText("kept")).toBeTruthy();
  expect(slot.getByText("Moved a thread")).toBeTruthy();
  expect(slot.getByRole("button", { name: "Delete traces" })).toHaveProperty(
    "disabled",
    false,
  );
});

it("confirms clearing all traces without deleting Activity changes", async () => {
  let stored = [trace("ok")];
  const traceClear = vi.fn(() => {
    stored = [];
    return { removed: 1 };
  });
  const slot = await page({ traces: () => ({ traces: stored }), traceClear });
  await slot.findByText("ok");
  fireEvent.click(slot.getByRole("button", { name: "Clear traces…" }));
  expect(traceClear).not.toHaveBeenCalled();
  fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
  expect(slot.getByText("ok")).toBeTruthy();
  fireEvent.click(slot.getByRole("button", { name: "Clear traces…" }));
  fireEvent.click(slot.getByRole("button", { name: "Delete traces" }));
  await waitFor(() => expect(slot.queryByText("ok")).toBeNull());
  expect(traceClear).toHaveBeenCalledWith(null);
  expect(slot.getByText("Moved a thread")).toBeTruthy();
  expect(slot.getByText("0 model calls shown · $0.0000")).toBeTruthy();
});
