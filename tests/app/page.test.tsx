// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkstreamsPage } from "../../src/app/page/Page.tsx";
import {
  CARD_TOP_FRACTION,
  HEADING_BLOCK_MIN_HEIGHT,
  PAGE_TOP,
} from "../../src/app/page/queue/layout.ts";
import { LEAD } from "../../src/app/page/queue/stackEngine.ts";
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

async function mount(
  catalog?: import("../../src/domain/topics.ts").TopicState,
) {
  const now = Date.now();
  return renderSlot(
    { component: WorkstreamsPage },
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
          ...(catalog ? { catalog } : {}),
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

it("uses the topic color for the queue workstream path", async () => {
  const slot = await mount({
    entities: [
      {
        id: "beta",
        name: "Beta",
        description: "",
        parentId: null,
        aliases: [],
      },
    ],
    groups: { sec_b: "beta" },
    colors: { beta: { hue: 175, level: 1 } },
    assignments: {},
    revision: 1,
  });
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  const path = slot.container.querySelector(".ws-queue-path") as HTMLElement;
  expect(path.style.getPropertyValue("--ws-hue")).toBe("175");
  expect(path.style.getPropertyValue("--ws-color-light")).toContain("50.00%");
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

it("steps with ↓ and ↑ without scrolling the page, and not from a text field", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  expect(press("ArrowDown")).toBe(false);
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  expect(press("ArrowUp")).toBe(false);
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  fireEvent.click(slot.getByRole("button", { name: /^Reply/ }));
  const box = await slot.findByRole("textbox");
  fireEvent.keyDown(box, { key: "ArrowDown" });
  expect(heading(slot)).toBe("Beta question");
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
  // The footer's arrows point the way the cards move: up and down.
  const icon = (name: string) =>
    slot
      .getByRole("button", { name })
      .querySelector("[data-icon]")
      ?.getAttribute("data-icon");
  expect(icon("Previous")).toBe("ChevronUp");
  expect(icon("Next")).toBe("ChevronDown");
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
    // The old front card is still in the page, inert, while it moves behind,
    // and the new one takes clicks and focus once it has come to the front.
    expect(card("b1")?.hasAttribute("inert")).toBe(true);
    await waitFor(() => expect(card("a1")?.hasAttribute("inert")).toBe(false));
    await waitFor(() => expect(card("b1")).toBeNull(), { timeout: 4000 });
    slot.lifecycle.unmount();
  } finally {
    delete (Element.prototype as { animate?: unknown }).animate;
  }
});

it("crossfades the heading with a drift that follows the direction of travel", async () => {
  const animate = vi.fn(
    (_keyframes: Keyframe[], _options: KeyframeAnimationOptions) => ({
      cancel() {},
      finished: new Promise<void>(() => {}),
    }),
  );
  Object.defineProperty(Element.prototype, "animate", {
    value: animate,
    configurable: true,
  });
  try {
    const slot = await mount();
    await waitFor(() => expect(heading(slot)).toBe("Beta question"));
    const drifts = () =>
      animate.mock.calls.flatMap(([keyframes]) =>
        keyframes[0]?.opacity === 0 ? [String(keyframes[0].transform)] : [],
      );
    const ghosts = () =>
      slot.container.querySelectorAll('[data-queue-ghost="heading"]');
    press("ArrowRight");
    await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
    // Forward, the new heading rises from below and the old one stays drawn
    // over the same place until it has gone.
    expect(drifts()).toContain("translateY(6px)");
    expect(ghosts().length).toBe(1);
    expect(ghosts()[0]!.textContent).toContain("Beta question");
    // The new heading waits for the old one to mostly fade, the path line
    // first and the title after it.
    const delays = animate.mock.calls
      .filter(([keyframes]) => keyframes[0]?.opacity === 0)
      .map(([, options]) => options.delay);
    expect(delays).toContain(70);
    expect(delays).toContain(110);
    animate.mockClear();
    press("ArrowLeft");
    await waitFor(() => expect(heading(slot)).toBe("Beta question"));
    expect(drifts()).toContain("translateY(-6px)");
    // The old copy is dropped, not queued behind the new one.
    expect(ghosts().length).toBe(1);
    slot.lifecycle.unmount();
  } finally {
    delete (Element.prototype as { animate?: unknown }).animate;
  }
});

it("centers the thread actions in the column", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  press("ArrowRight");
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  const row = slot.getByRole("button", { name: /^Reply/ }).parentElement!;
  expect(row.className).toContain("justify-center");
  expect(row.className).not.toMatch(/\bpl-\d/);
  expect(row.children.length).toBe(4);
  slot.lifecycle.unmount();
});

it("shows the edit hint only on hover, focus, or while ⇧ is held, without moving anything", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  press("ArrowRight");
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  const hint = () => slot.getByText("hold ⇧ to edit before sending");
  const first = hint();
  const classes = () => first.className.split(/\s+/);
  // Always laid out (so its space is reserved); hidden and revealed by
  // opacity alone, on hover of the replies or keyboard focus within them.
  expect(first.closest(".group\\/replies")).toBe(
    slot.getByRole("list", { name: "Replies" }).parentElement,
  );
  expect(classes()).toContain("opacity-0");
  expect(classes()).toContain("group-hover/replies:opacity-100");
  expect(classes()).toContain("group-has-[:focus-visible]/replies:opacity-100");
  expect(classes()).not.toContain("hidden");
  expect(classes()).not.toContain("invisible");
  // ⇧ shows it, brighter, whatever the pointer does.
  fireEvent.keyDown(window, { key: "Shift" });
  expect(hint()).toBe(first);
  expect(classes()).toContain("opacity-100");
  expect(classes()).not.toContain("opacity-0");
  expect(classes()).toContain("text-foreground/70");
  fireEvent.keyUp(window, { key: "Shift" });
  expect(hint()).toBe(first);
  expect(classes()).toContain("opacity-0");
  expect(classes()).not.toContain("text-foreground/70");
  slot.lifecycle.unmount();
});

it("places the heading and the card from the page's height, not the item's", async () => {
  const slot = await mount();
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  const block = () =>
    slot.container.querySelector<HTMLElement>('[data-queue-part="heading"]')!
      .parentElement!;
  const page = slot.container.querySelector<HTMLElement>(".overflow-y-auto")!;
  const column = () => page.firstElementChild as HTMLElement;
  // The page is a size container, so `cqh` in the block's least height is
  // the page's height and a resize moves the card without a re-render.
  expect(page.className).toContain("[container-type:size]");
  expect(block().style.minHeight).toBe(HEADING_BLOCK_MIN_HEIGHT);
  // The heading's place comes from the page's height alone, too.
  expect(column().style.getPropertyValue("--ws-queue-top")).toBe(PAGE_TOP);
  expect(HEADING_BLOCK_MIN_HEIGHT).toBe(
    `max(0px, calc(${CARD_TOP_FRACTION * 100}cqh - ${LEAD}px - ${PAGE_TOP}))`,
  );
  const first = block();
  press("ArrowRight");
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  // The next item sets the same rule on the same block.
  expect(block()).toBe(first);
  expect(block().style.minHeight).toBe(HEADING_BLOCK_MIN_HEIGHT);
  expect(column().style.getPropertyValue("--ws-queue-top")).toBe(PAGE_TOP);
  slot.lifecycle.unmount();
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
