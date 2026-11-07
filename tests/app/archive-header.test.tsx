// @vitest-environment jsdom
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ArchiveHeaderAction } from "../../src/app/header/ArchiveHeaderAction.tsx";
import { sidebarThread } from "./fixtures.ts";

afterEach(cleanup);

async function mount({
  showArchiveButton,
  compact = false,
  threads = [sidebarThread("t1", { title: "Task" })],
}: {
  /** Omitted leaves the stored preferences without the field. */
  showArchiveButton?: boolean;
  compact?: boolean;
  threads?: PluginSidebarThread[];
} = {}) {
  return renderSlot(
    { component: ArchiveHeaderAction },
    { threadId: "t1", projectId: "proj_1", isCompactViewport: compact },
    {
      rpc: {
        prefs: () => ({
          prefs: {
            threads:
              showArchiveButton === undefined ? {} : { showArchiveButton },
          },
        }),
      },
      sidebarThreads: { threads },
    },
  );
}

// Preferences arrive after the first render, so a test that expects no button
// waits for them to load first; checking sooner would pass vacuously.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

it("shows an icon-only Archive button by default", async () => {
  const slot = await mount();
  const button = await slot.findByRole("button", { name: "Archive" });
  expect(button.textContent).toBe("");
  expect(button.querySelector('[data-icon="Archive"]')).not.toBeNull();
  slot.lifecycle.unmount();
});

it("archives through BB's own flow, not Workstreams' recap archive", async () => {
  const slot = await mount({ showArchiveButton: true });
  fireEvent.click(await slot.findByRole("button", { name: "Archive" }));
  expect(slot.inspection.sidebarActionCalls).toEqual([
    { method: "archive", threadId: "t1" },
  ]);
  expect(slot.inspection.rpcCalls.map((call) => call.method)).not.toContain(
    "archive",
  );
  slot.lifecycle.unmount();
});

it("stays hidden when the setting is off", async () => {
  const slot = await mount({ showArchiveButton: false });
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "prefs"),
    ).toBe(true),
  );
  await settle();
  expect(slot.queryByRole("button")).toBeNull();
  slot.lifecycle.unmount();
});

it("hides for a thread outside the active sidebar list", async () => {
  // Archived and unknown threads aren't in the active list, and BB drops a
  // thread from it as soon as it is archived.
  const slot = await mount({ threads: [sidebarThread("other")] });
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "prefs"),
    ).toBe(true),
  );
  await settle();
  expect(slot.queryByRole("button")).toBeNull();
  slot.lifecycle.unmount();
});

it("keeps the same icon-only button on compact viewports", async () => {
  const slot = await mount({ compact: true });
  const button = await slot.findByRole("button", { name: "Archive" });
  expect(button.textContent).toBe("");
  slot.lifecycle.unmount();
});
