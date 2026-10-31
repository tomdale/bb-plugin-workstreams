// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { emptyState, section, sidebarThread } from "./fixtures.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const entry = {
  id: "e1",
  at: Date.now(),
  action: "move",
  source: "user",
  status: "applied",
  rationale: "Moved from Unfiled to Beta",
  threads: [{ id: "loose", name: "Loose task" }],
  workstreams: [{ id: "sec_b", name: "Beta" }],
  undo: {
    kind: "move",
    moves: [{ threadId: "loose", from: null, to: "sec_b" }],
  },
  undoes: null,
  undoneBy: null,
  detail: null,
};

const analysis = (recap: string, state = "done") => ({
  recap,
  state,
  needsYou: null,
  subject: "Alpha",
  drift: null,
  driftSectionId: null,
  revision: Date.now(),
  at: Date.now(),
  model: "m",
});

async function mount() {
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  const now = Date.now();
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      sidebarThreads: {
        status: "ready",
        threads: [
          sidebarThread("a1", {
            sectionId: "sec_a",
            title: "Alpha work",
            isUnread: true,
            latestAttentionAt: now,
          }),
          sidebarThread("a2", { parentThreadId: "a1", title: "Alpha child" }),
          sidebarThread("b1", {
            sectionId: "sec_b",
            title: "Beta question",
            hasPendingInteraction: true,
            latestAttentionAt: now - 3_600_000,
          }),
          sidebarThread("run", {
            sectionId: "sec_b",
            title: "Beta running",
            status: "active",
            indicator: "runtime",
          }),
        ],
        sections: [section("sec_a", "Alpha"), section("sec_b", "Beta")],
        projects: [],
      },
      rpc: {
        state: () => ({
          ...emptyState(),
          analysis: { b1: analysis("Asked which API to use") },
          recaps: {
            a1: {
              id: "r1",
              turnId: "t1",
              at: now,
              state: "review",
              goal: "Built the feed",
              latest: ["Tests pass"],
              review: ["Open the page"],
              links: [],
              next: [
                { title: "Ship it", message: "Ship the feed to main" },
                { title: "Tweak copy", message: "Tighten the card copy" },
              ],
            },
          },
        }),
        recapFiles: () => ({ files: {} }),
        recapPrefs: () => ({ prefs: {} }),
        recap_send: () => ({ ok: true }),
        threadSend: () => ({ ok: true }),
        threadArchive: () => ({ ok: true }),
        threadUnarchive: () => ({ ok: true }),
        journal: () => ({ entries: [entry] }),
        undo: () => ({ entry: { ...entry, id: "e2", action: "undo" } }),
      },
    },
  );
}

type Slot = Awaited<ReturnType<typeof mount>>;
const heading = (slot: Slot) =>
  slot.queryByRole("heading", { level: 1 })?.textContent ?? null;
const press = (key: string, options: { shiftKey?: boolean } = {}) =>
  fireEvent.keyDown(window, {
    key,
    code: /^[0-9]$/.test(key) ? `Digit${key}` : undefined,
    ...options,
  });

it("shows one item at a time, Up Next first, with how many are left", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  expect(slot.getByText("Needs your decision")).toBeTruthy();
  expect(slot.getByText("Asked which API to use")).toBeTruthy();
  expect(slot.getByRole("navigation", { name: "Queue" }).textContent).toBe(
    "1 of 2",
  );
  // The running thread waits for its turn to end; it isn't in the queue.
  expect(slot.queryByText("Beta running")).toBeNull();
  slot.lifecycle.unmount();
});

it("archives the item at once, leaves a receipt with Undo, and moves on", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  press("e");
  expect(slot.getByRole("status").textContent).toContain(
    "Archived Beta question",
  );
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  expect(slot.getByText("Built the feed")).toBeTruthy();
  expect(slot.getByText("Ship the feed to main")).toBeTruthy();
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.find((c) => c.method === "threadArchive")?.input,
    ).toEqual({ threadId: "b1" }),
  );
  fireEvent.click(slot.getByRole("button", { name: /^Undo/ }));
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.find((c) => c.method === "threadUnarchive")
        ?.input,
    ).toEqual({ threadId: "b1" }),
  );
  slot.lifecycle.unmount();
});

it("holds a reply behind its receipt so Undo can keep it from sending", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  press("e");
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  vi.useFakeTimers();
  press("1");
  expect(slot.getByRole("status").textContent).toContain("Sent to Alpha work");
  press("u");
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(slot.inspection.rpcCalls.some((c) => c.method === "recap_send")).toBe(
    false,
  );
  expect(heading(slot)).toBe("Alpha work");
  press("1");
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(
    slot.inspection.rpcCalls.find((c) => c.method === "recap_send")?.input,
  ).toEqual({ threadId: "a1", recapId: "r1", action: "Ship the feed to main" });
  slot.lifecycle.unmount();
});

it("edits a reply before sending with shift and a number", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  press("e");
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  press("2", { shiftKey: true });
  const field = slot.getByRole("textbox", { name: "Reply to Alpha work" });
  expect((field as HTMLTextAreaElement).value).toBe("Tighten the card copy");
  fireEvent.keyDown(field, { key: "Escape" });
  expect(
    slot.queryByRole("textbox", { name: "Reply to Alpha work" }),
  ).toBeNull();
  slot.lifecycle.unmount();
});

it("steps through the queue without acting", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  press("ArrowRight");
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  expect(slot.getByRole("navigation", { name: "Queue" }).textContent).toBe(
    "2 of 2",
  );
  fireEvent.click(slot.getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  expect(
    slot.inspection.rpcCalls.some((c) => c.method === "threadArchive"),
  ).toBe(false);
  slot.lifecycle.unmount();
});

it("draws the leaving item until its exit ends, and none for a held key", async () => {
  type Fake = {
    onfinish: (() => void) | null;
    oncancel: (() => void) | null;
    cancel: () => void;
  };
  const started: { el: Element; animation: Fake }[] = [];
  const animate = vi.fn(function (this: Element) {
    const animation: Fake = {
      onfinish: null,
      oncancel: null,
      cancel: () => animation.oncancel?.(),
    };
    started.push({ el: this, animation });
    return animation;
  });
  Object.defineProperty(Element.prototype, "animate", {
    value: animate,
    configurable: true,
  });
  try {
    const slot = await mount();
    await waitFor(() => expect(heading(slot)).toBe("Beta question"));
    const copies = () =>
      [...slot.container.querySelectorAll("[inert]")].map(
        (el) => el.textContent,
      );
    // Past the first item's own entrance, so the change isn't a held key.
    await new Promise((resolve) => setTimeout(resolve, 250));
    press("ArrowRight");
    await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
    // The old heading, card, and actions leave as copies over the page.
    expect(copies().some((text) => text?.includes("Beta question"))).toBe(true);
    expect(copies().some((text) => text?.includes("Asked which API"))).toBe(
      true,
    );
    // Going straight back is a held key: nothing more is copied.
    const before = copies().length;
    press("ArrowLeft");
    await waitFor(() => expect(heading(slot)).toBe("Beta question"));
    expect(copies().length).toBe(before);
    // Each copy goes once its exit ends.
    for (const { el, animation } of started)
      if (el.hasAttribute("inert")) animation.onfinish?.();
    expect(copies()).toEqual([]);
    slot.lifecycle.unmount();
  } finally {
    delete (Element.prototype as { animate?: unknown }).animate;
  }
});

it("opens the item's thread", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  press("o");
  expect(slot.inspection.sidebarActionCalls).toContainEqual(
    expect.objectContaining({ method: "open", threadId: "b1" }),
  );
  slot.lifecycle.unmount();
});

it("opens the activity log from the menu, with undo", async () => {
  const slot = await mount();
  const more = slot.getByRole("button", { name: "More" });
  fireEvent.pointerDown(more, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(await slot.findByRole("menuitem", { name: "Activity" }));
  expect(await slot.findByText("Moved from Unfiled to Beta")).toBeTruthy();
  fireEvent.click(slot.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.find((c) => c.method === "undo")?.input,
    ).toEqual({
      entryId: "e1",
    }),
  );
  fireEvent.click(slot.getByRole("button", { name: "Back" }));
  await waitFor(() =>
    expect(slot.getByRole("button", { name: "More" })).toBeTruthy(),
  );
  slot.lifecycle.unmount();
});
