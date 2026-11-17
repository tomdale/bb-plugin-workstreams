// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { UsageIndicator, UsageRange } from "../../src/domain/usage.ts";
import { WorkstreamsPage } from "../../src/app/page/Page.tsx";
import { emptyState, section, sidebarThread } from "./fixtures.ts";
import { spendState, usageReport } from "./usage-fixture.ts";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

async function mount(
  subPath: string,
  rpc: Record<string, (input: never) => unknown> = {},
) {
  return renderSlot(
    { component: WorkstreamsPage },
    { subPath },
    {
      context: { projectId: null, threadId: null },
      sidebarThreads: {
        status: "ready",
        threads: [sidebarThread("a1", { sectionId: "sec_a", title: "Alpha" })],
        sections: [section("sec_a", "Alpha")],
        projects: [],
      },
      rpc: {
        state: () => emptyState(),
        recapFiles: () => ({ files: {} }),
        recapPrefs: () => ({ prefs: {} }),
        usage: ({ range }: { range: UsageRange }) => usageReport(range),
        usageStatus: () => ({ level: "ok", flags: 0 }),
        ...rpc,
      } as never,
    },
  );
}

type Slot = Awaited<ReturnType<typeof mount>>;

async function usageItem(slot: Slot) {
  fireEvent.pointerDown(slot.getByRole("button", { name: "More" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  return slot.findByRole("menuitem", { name: /^Usage/ });
}

const statusReads = (slot: Slot) =>
  slot.inspection.rpcCalls.filter((call) => call.method === "usageStatus")
    .length;

it("opens Usage from its deep link, and Back returns to the queue", async () => {
  const slot = await mount("usage");
  expect(slot.getByRole("heading", { level: 1 }).textContent).toBe("Usage");
  await slot.findByRole("list", {
    name: "Reported cost over the last 24 hours",
  });
  fireEvent.click(slot.getByRole("button", { name: "Back" }));
  await waitFor(() =>
    expect(slot.getByRole("button", { name: "More" })).toBeTruthy(),
  );
});

it("opens Usage from the menu without the debug UI", async () => {
  const slot = await mount("");
  const item = await usageItem(slot);
  expect(item.textContent).toBe("Usage");
  expect(slot.queryByRole("menuitem", { name: "Model traces" })).toBeNull();
  fireEvent.click(item);
  expect((await slot.findByRole("heading", { level: 1 })).textContent).toBe(
    "Usage",
  );
  expect(
    slot.inspection.rpcCalls.find((call) => call.method === "usage")?.input,
  ).toEqual({ range: "24h" });
});

it.each([
  [{ level: "capped", flags: 3 }, "UsagePaused"],
  [{ level: "warning", flags: 3 }, "UsageWarning"],
  [{ level: "ok", flags: 1 }, "Usage1 flag"],
  [{ level: "ok", flags: 2 }, "Usage2 flags"],
  [{ level: "ok", flags: 0 }, "Usage"],
] as [UsageIndicator, string][])(
  "marks the menu item for %o",
  async (indicator, text) => {
    const slot = await mount("", { usageStatus: () => indicator });
    await waitFor(() => expect(statusReads(slot)).toBe(1));
    expect((await usageItem(slot)).textContent).toBe(text);
  },
);

it("re-reads the mark on the server's usage signal", async () => {
  let indicator: UsageIndicator = { level: "ok", flags: 0 };
  const slot = await mount("", { usageStatus: () => indicator });
  await waitFor(() => expect(statusReads(slot)).toBe(1));
  indicator = { level: "capped", flags: 0 };
  await slot.behavior.emitRealtime("usage", { state: spendState().state });
  await waitFor(() => expect(statusReads(slot)).toBe(2));
  expect((await usageItem(slot)).textContent).toBe("UsagePaused");
});

it("shows no mark when the status cannot be read", async () => {
  const slot = await mount("", {
    usageStatus: () => {
      throw new Error("Offline");
    },
  });
  await waitFor(() => expect(statusReads(slot)).toBe(1));
  expect((await usageItem(slot)).textContent).toBe("Usage");
});
