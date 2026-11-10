// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { DebugThreadButton } from "../../src/app/debug/DebugThreadButton.tsx";
import type { DebugSubject } from "../../src/domain/debug-thread.ts";

beforeEach(() => {
  window.localStorage.clear();
  toast.mockClear();
  toast.error.mockClear();
});
afterEach(cleanup);

const subject = (overrides: Partial<DebugSubject> = {}): DebugSubject => ({
  surface: "Organizing suggestions in the sidebar",
  headline: "Merge Payments into Billing",
  facts: [{ label: "Suggestion", value: "Merge Payments into Billing" }],
  calls: { traceIds: ["tr_1"] },
  ...overrides,
});

const trace = (id: string) => ({
  id,
  at: 1,
  kind: "tidy",
  status: "ok",
  label: `${id} label`,
  model: "test/model",
  durationMs: 1,
  replayOf: null,
  usage: null,
  error: null,
  summary: null,
  threads: [],
  provider: "test",
  thinking: "off",
  system: "",
  prompt: `prompt for ${id}`,
  input: null,
  response: "{}",
  reasoning: null,
  stopReason: "stop",
  parsed: {},
  outcome: null,
  links: [],
  replays: [],
});

const prefs = (advanced: Record<string, unknown>) => ({
  prefs: {
    sidebar: { showForYou: true, showRecent: true, recentLimit: 5 },
    threads: { autoTitle: true },
    newWork: { homeProjectId: "", suggestions: true },
    advanced: { hostId: "", ...advanced },
  },
});

function mount(
  advanced: Record<string, unknown>,
  target: DebugSubject = subject(),
  handlers: Record<string, unknown> = {},
) {
  return renderSlot(
    { component: DebugThreadButton },
    { subject: target },
    {
      settings: {},
      rpc: {
        prefs: () => prefs(advanced),
        traces: () => ({ traces: [] }),
        trace: ({ id }: { id: string }) => ({ trace: trace(id) }),
        debugThread: () => ({ threadId: "th_debug" }),
        ...handlers,
      } as never,
    },
  );
}

it("stays out of the UI unless the debug UI shows it", async () => {
  const off = mount({ debugUi: false, debugDiscuss: true });
  // Preferences load asynchronously; give the store its answer first.
  await waitFor(() =>
    expect(off.inspection.rpcCalls.some((c) => c.method === "prefs")).toBe(
      true,
    ),
  );
  expect(screen.queryByRole("button", { name: /new thread/ })).toBeNull();
  off.unmount();
  const narrowed = mount({ debugUi: true, debugDiscuss: false });
  await waitFor(() =>
    expect(narrowed.inspection.rpcCalls.some((c) => c.method === "prefs")).toBe(
      true,
    ),
  );
  expect(screen.queryByRole("button", { name: /new thread/ })).toBeNull();
  narrowed.unmount();
  const on = mount({ debugUi: true, debugDiscuss: true });
  expect(
    await screen.findByRole("button", { name: "Debug this in a new thread" }),
  ).toBeTruthy();
});

it("starts a thread carrying the suggestion and its model call", async () => {
  const slot = mount({ debugUi: true, debugDiscuss: true });
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Debug this in a new thread",
    }),
  );
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "debugThread"),
    ).toBe(true),
  );
  const sent = slot.inspection.rpcCalls.find(
    (call) => call.method === "debugThread",
  )!.input as { title: string; message: string };
  expect(sent.title).toBe("Debug: Merge Payments into Billing");
  expect(sent.message).toContain("Organizing suggestions in the sidebar");
  expect(sent.message).toContain("prompt for tr_1");
  // The thread opens once it exists, so the click lands where the work is.
  await waitFor(() =>
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "th_debug",
    }),
  );
});

it("reads the calls linked to an entry rather than a named id", async () => {
  const slot = mount(
    { debugUi: true, debugDiscuss: true },
    subject({ calls: { link: { kind: "entry", ref: "e1" } } }),
    { traces: () => ({ traces: [trace("tr_2")] }) },
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Debug this in a new thread",
    }),
  );
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "debugThread"),
    ).toBe(true),
  );
  expect(
    slot.inspection.rpcCalls.find((call) => call.method === "traces")?.input,
  ).toEqual({ link: { kind: "entry", ref: "e1" }, limit: 6 });
  const sent = slot.inspection.rpcCalls.find(
    (call) => call.method === "debugThread",
  )!.input as { message: string };
  expect(sent.message).toContain("prompt for tr_2");
});

it("says so when the thread cannot start, and opens nothing", async () => {
  const slot = mount({ debugUi: true, debugDiscuss: true }, subject(), {
    debugThread: () => {
      throw new Error("Choose a debug threads project");
    },
  });
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Debug this in a new thread",
    }),
  );
  await vi.waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't start a debug thread: Choose a debug threads project",
    ),
  );
  expect(slot.inspection.navigateCalls).toEqual([]);
});

it("stops the click before the row around it hears it", async () => {
  const slot = mount({ debugUi: true, debugDiscuss: true });
  const button = await screen.findByRole("button", {
    name: "Debug this in a new thread",
  });
  // Rows navigate or start a drag on the events a click is made of.
  const heard = vi.fn();
  document.body.addEventListener("click", heard);
  document.body.addEventListener("pointerdown", heard);
  try {
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(heard).not.toHaveBeenCalled();
    // The button's own work still happened.
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.some((call) => call.method === "debugThread"),
      ).toBe(true),
    );
  } finally {
    document.body.removeEventListener("click", heard);
    document.body.removeEventListener("pointerdown", heard);
  }
});
