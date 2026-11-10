// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePrefs } from "../../src/app/prefs.ts";
import { Row } from "../../src/app/sidebar/Row.tsx";
import { sidebarThread } from "./fixtures.ts";

afterEach(cleanup);

function LiveRow(props: Parameters<typeof Row>[0]) {
  usePrefs();
  return <Row {...props} />;
}

async function mount(indicator: "none" | "runtime" = "none") {
  return mountThread({ indicator });
}

async function mountThread(overrides: Parameters<typeof sidebarThread>[1]) {
  const thread = sidebarThread("root", {
    title: "Root task",
    isPinned: true,
    isUnread: true,
    ...overrides,
  });
  const props = {
    thread,
    active: false,
    depth: 0,
    context: "Alpha",
    onNavigate: vi.fn(),
    disclosure: { expanded: true, toggle: vi.fn() },
  };
  const slot = renderSlot({ component: LiveRow }, props, {
    sidebarThreads: {
      status: "ready",
      threads: [thread],
      sections: [],
      projects: [],
    },
    rpc: {
      prefs: () => ({
        prefs: {
          sidebar: { timestamps: "hover" },
          threads: {},
          newWork: {},
          organize: {},
          advanced: {},
        },
      }),
      spinner: () => ({
        spinner: { shape: "spokes", primary: "subtle", secondary: "auto" },
      }),
    },
  });
  await waitFor(() =>
    expect(
      slot.container
        .querySelector("[data-timestamp]")
        ?.getAttribute("data-timestamp"),
    ).toBe("hover"),
  );
  return { slot, props };
}

it("wires the presented row to native shortcuts, split navigation, disclosure, and Archive", async () => {
  const { slot, props } = await mount();
  const link = slot.getByRole("link", { name: "Root task" });
  expect(link.getAttribute("href")).toBe("/projects/proj_1/threads/root");
  expect(link.getAttribute("data-sidebar-thread-id")).toBe("root");
  expect(link.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
  expect(slot.getByRole("img", { name: "Pinned" })).toBeTruthy();
  // Unread alone draws no slot mark and no inline dot.
  expect(slot.container.querySelector(".ws-status-slot .ws-mark")).toBeNull();
  expect(slot.container.querySelector(".ws-unread-inline")).toBeNull();
  fireEvent.click(link, { metaKey: true });
  expect(slot.inspection.sidebarActionCalls.at(-1)).toMatchObject({
    method: "open",
    threadId: "root",
    options: { split: true },
  });
  expect(props.onNavigate).toHaveBeenCalledOnce();
  fireEvent.click(slot.getByRole("button", { name: "Hide child threads" }));
  expect(props.disclosure.toggle).toHaveBeenCalledOnce();
  fireEvent.click(slot.getByRole("button", { name: "Archive" }));
  expect(slot.inspection.sidebarActionCalls.at(-1)).toMatchObject({
    method: "archive",
    threadId: "root",
  });
  expect(props.onNavigate).toHaveBeenCalledOnce();
  await slot.behavior.emitRealtime("prefs", {
    prefs: { sidebar: { timestamps: "hide" } },
  });
  expect(slot.container.querySelector("[data-timestamp]")).toBeNull();
  expect(slot.getByText("Alpha")).toBeTruthy();
  slot.rerender(<LiveRow {...props} placement="recent" />);
  expect(slot.queryByRole("img", { name: "Pinned" })).toBeNull();
  expect(slot.container.querySelector(".ws-status-slot .ws-mark")).toBeNull();
});

it("keeps the failure mark on a read thread whose last turn failed", async () => {
  // BB reports the error as a row indicator only while unread; the thread's
  // own status carries it afterwards.
  const { slot } = await mountThread({ isUnread: false, status: "error" });
  const link = slot.getByRole("link", { name: "Root task, Failed" });
  expect(link).toBeTruthy();
  const mark = slot.getByRole("img", { name: "Failed" });
  expect(mark.className).toContain("ws-failed");
  expect(slot.container.querySelector(".ws-unread-inline")).toBeNull();
});

it("uses the default working indicator and follows live spinner preferences", async () => {
  const { slot } = await mount("runtime");
  const mark = () => slot.getByRole("img", { name: "Working" });
  await waitFor(() => expect(mark().className).toContain("ws-spin-spokes"));
  await slot.behavior.emitRealtime("spinner", {
    spinner: { shape: "orbit", primary: "green", secondary: "none" },
  });
  expect(mark().className).toContain("ws-spin-orbit");
  expect(mark().style.getPropertyValue("--ws-spin-track")).toBe("transparent");
  await slot.behavior.emitRealtime("spinner", {
    spinner: { shape: "dots", primary: "#ff0000", secondary: "auto" },
  });
  expect(mark().className).toContain("ws-spin-dots");
  expect(mark().style.getPropertyValue("--ws-spin-primary")).toBe("#ff0000");
});
