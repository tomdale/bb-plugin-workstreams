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

it("keeps one card per item in the stack, and only the front one live", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  const cards = () => [
    ...slot.container.querySelectorAll<HTMLElement>("[data-queue-card]"),
  ];
  const front = () => cards().filter((el) => !el.hasAttribute("inert"));
  // Every item in the window has its card; the shown one is the only live one.
  expect(cards().length).toBe(2);
  expect(front().map((el) => el.textContent)).toEqual([
    expect.stringContaining("Asked which API"),
  ]);
  expect(
    cards()
      .filter((el) => el.hasAttribute("inert"))
      .every((el) => el.getAttribute("aria-hidden") === "true"),
  ).toBe(true);
  const beta = cards().find((el) => el.dataset.queueCard === "b1");
  press("ArrowRight");
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  // Without animation the change applies at once: the same card moved on.
  expect(cards().find((el) => el.dataset.queueCard === "b1")).toBeUndefined();
  expect(beta?.isConnected).toBe(false);
  expect(front().map((el) => el.dataset.queueCard)).toEqual(["a1"]);
  press("ArrowLeft");
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  expect(front().map((el) => el.dataset.queueCard)).toEqual(["b1"]);
  slot.lifecycle.unmount();
});

it("moves the card to the back and releases it once it is out of sight", async () => {
  const animate = vi.fn(() => ({ cancel() {}, onfinish: null }));
  Object.defineProperty(Element.prototype, "animate", {
    value: animate,
    configurable: true,
  });
  try {
    const slot = await mount();
    await waitFor(() => expect(heading(slot)).toBe("Beta question"));
    const card = (id: string) =>
      slot.container.querySelector<HTMLElement>(`[data-queue-card="${id}"]`);
    press("ArrowRight");
    await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
    // The old front card is still in the page, inert, while it moves behind.
    expect(card("b1")?.hasAttribute("inert")).toBe(true);
    expect(card("a1")?.hasAttribute("inert")).toBe(false);
    // The new heading waits for the old one to fade, so it isn't shown yet.
    const live = slot.container.querySelector<HTMLElement>(
      '[data-queue-part="heading"]',
    );
    expect(live?.style.opacity).toBe("0");
    await waitFor(() => expect(card("b1")).toBeNull(), { timeout: 4000 });
    await waitFor(() => expect(live?.style.opacity).toBe(""), {
      timeout: 4000,
    });
    slot.lifecycle.unmount();
  } finally {
    delete (Element.prototype as { animate?: unknown }).animate;
  }
});

it("ignores item shortcuts while the replies fade in, and focuses a composer once they are live", async () => {
  const animate = vi.fn(() => ({ cancel() {}, onfinish: null }));
  Object.defineProperty(Element.prototype, "animate", {
    value: animate,
    configurable: true,
  });
  try {
    const slot = await mount();
    await waitFor(() => expect(heading(slot)).toBe("Beta question"));
    const actions = () =>
      slot.container.querySelector<HTMLElement>('[data-queue-part="actions"]')!;
    press("ArrowRight");
    await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
    expect(actions().hasAttribute("inert")).toBe(true);
    for (const key of ["r", "s", "e", "o", "1"]) press(key);
    press("2", { shiftKey: true });
    expect(slot.queryByRole("textbox")).toBeNull();
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    expect(
      slot.inspection.rpcCalls.some((c) => c.method === "threadArchive"),
    ).toBe(false);
    expect(slot.queryByRole("status")).toBeNull();
    // A composer opened by pointer meanwhile takes focus once the replies are live.
    fireEvent.click(slot.getByRole("button", { name: /^Reply/ }));
    const field = slot.getByRole("textbox", { name: "Reply to Alpha work" });
    (document.activeElement as HTMLElement | null)?.blur();
    await waitFor(() => expect(actions().hasAttribute("inert")).toBe(false), {
      timeout: 4000,
    });
    expect(document.activeElement).toBe(field);
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
