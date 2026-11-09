// @vitest-environment jsdom
import {
  renderSlot,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
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
  extraThreads: ReturnType<typeof sidebarThread>[] = [],
  rpc: Record<string, (input: unknown) => unknown> = {},
  sdk: RenderSlotOptions["sdk"] = {},
) {
  const now = Date.now();
  return renderSlot(
    { component: WorkstreamsPage },
    { subPath: "" },
    {
      context: { projectId: null, threadId: null },
      sdk,
      sidebarThreads: {
        status: "ready",
        threads: [
          sidebarThread("a1", {
            sectionId: "sec_a",
            title: "Alpha work",
            isUnread: true,
            latestAttentionAt: now - 3_600_000,
          }),
          sidebarThread("a2", { parentThreadId: "a1", title: "Alpha child" }),
          sidebarThread("b1", {
            sectionId: "sec_b",
            title: "Beta question",
            hasPendingInteraction: true,
            isUnread: true,
            latestAttentionAt: now,
          }),
          sidebarThread("run", {
            sectionId: "sec_b",
            title: "Beta running",
            status: "active",
            indicator: "runtime",
          }),
          ...extraThreads,
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
        ...rpc,
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

it("repeats a held skip after 250 ms and every 25 ms, independent of native repeats", async () => {
  const slot = await mount(
    undefined,
    Array.from({ length: 6 }, (_, i) =>
      sidebarThread(`extra${i}`, {
        title: `Extra ${i}`,
        isUnread: true,
        latestAttentionAt: Date.now() - (i + 1) * 1000,
      }),
    ),
  );
  await waitFor(() =>
    expect(
      slot.getByRole("navigation", { name: "Queue" }).textContent,
    ).toContain("1 of 8"),
  );
  vi.useFakeTimers();
  const position = () =>
    slot.getByRole("navigation", { name: "Queue" }).textContent;
  act(() => {
    fireEvent.keyDown(window, { key: "ArrowDown" });
  });
  expect(position()).toContain("2 of 8");
  act(() => {
    fireEvent.keyDown(window, { key: "ArrowDown", repeat: true });
    vi.advanceTimersByTime(249);
  });
  expect(position()).toContain("2 of 8");
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(position()).toContain("3 of 8");
  act(() => {
    vi.advanceTimersByTime(24);
  });
  expect(position()).toContain("3 of 8");
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(position()).toContain("4 of 8");
  act(() => {
    fireEvent.keyUp(window, { key: "ArrowDown" });
    vi.advanceTimersByTime(100);
  });
  expect(position()).toContain("4 of 8");
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
  // The previous card stays hidden on the ring for a return trip.
  expect(cards().find((el) => el.dataset.queueCard === "b1")).toBe(beta);
  expect(beta?.style.visibility).toBe("hidden");
  expect(front().map((el) => el.dataset.queueCard)).toEqual(["a1"]);
  press("ArrowLeft");
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  expect(front().map((el) => el.dataset.queueCard)).toEqual(["b1"]);
  slot.lifecycle.unmount();
});

it("moves the card to the back and keeps it hidden for a return", async () => {
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
    await waitFor(() => expect(card("b1")?.style.visibility).toBe("hidden"), {
      timeout: 4000,
    });
    slot.lifecycle.unmount();
  } finally {
    delete (Element.prototype as { animate?: unknown }).animate;
  }
});

it("keeps reduced-motion skips still and does not repeat a held key", async () => {
  const animate = vi.fn(() => ({
    cancel() {},
    finished: new Promise<void>(() => {}),
  }));
  Object.defineProperty(Element.prototype, "animate", {
    value: animate,
    configurable: true,
  });
  Object.defineProperty(window, "matchMedia", {
    value: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
    configurable: true,
  });
  try {
    const slot = await mount(undefined, [
      sidebarThread("extra", {
        title: "Extra",
        isUnread: true,
        latestAttentionAt: Date.now(),
      }),
    ]);
    await waitFor(() =>
      expect(
        slot.getByRole("navigation", { name: "Queue" }).textContent,
      ).toContain("1 of 3"),
    );
    vi.useFakeTimers();
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowDown" });
      vi.advanceTimersByTime(500);
    });
    expect(
      slot.getByRole("navigation", { name: "Queue" }).textContent,
    ).toContain("2 of 3");
    const animations = animate.mock.calls as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ][];
    expect(
      animations.every(([frames]) =>
        frames.every((frame) => frame.transform === undefined),
      ),
    ).toBe(true);
    slot.lifecycle.unmount();
  } finally {
    delete (window as { matchMedia?: unknown }).matchMedia;
    delete (Element.prototype as { animate?: unknown }).animate;
  }
});

it("keeps the heading on the drum's front while a skip waits", async () => {
  const animate = vi.fn(() => ({
    cancel() {},
    finished: new Promise<void>(() => {}),
  }));
  Object.defineProperty(Element.prototype, "animate", {
    value: animate,
    configurable: true,
  });
  try {
    const slot = await mount(undefined, [
      sidebarThread("extra", {
        title: "Extra",
        isUnread: true,
        latestAttentionAt: Date.now(),
      }),
    ]);
    await waitFor(() =>
      expect(
        slot.getByRole("navigation", { name: "Queue" }).textContent,
      ).toContain("1 of 3"),
    );
    press("ArrowDown");
    await waitFor(() =>
      expect(
        slot.getByRole("navigation", { name: "Queue" }).textContent,
      ).toContain("2 of 3"),
    );
    press("ArrowDown");
    expect(
      slot.getByRole("navigation", { name: "Queue" }).textContent,
    ).toContain("2 of 3");
    await waitFor(
      () =>
        expect(
          slot.getByRole("navigation", { name: "Queue" }).textContent,
        ).toContain("3 of 3"),
      { timeout: 4000 },
    );
    slot.lifecycle.unmount();
  } finally {
    delete (Element.prototype as { animate?: unknown }).animate;
  }
});

it("fades each new heading in place over 200 ms in either direction", async () => {
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
    for (const [key, title] of [
      ["ArrowRight", "Alpha work"],
      ["ArrowLeft", "Beta question"],
    ] as const) {
      animate.mockClear();
      press(key);
      await waitFor(() => expect(heading(slot)).toBe(title));
      expect(animate.mock.calls).toContainEqual([
        [{ opacity: 0.2 }, { opacity: 1 }],
        { duration: 200, easing: "ease-out" },
      ]);
      expect(
        slot.container.querySelector('[data-queue-ghost="heading"]'),
      ).toBeNull();
    }
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
  expect(row.children.length).toBe(5);
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

it.each([false, true])(
  "answers a question in the stack (recoverable: %s)",
  async (recoverable) => {
    sessionStorage.clear();
    const { payload } = await import("./question/submission-fixture.ts");
    const answer = vi.fn(async () => ({ ok: true }));
    const slot = await mount(undefined, [], {
      question_pending: () => ({ id: "stack-question", recoverable, payload }),
      question_answer: answer,
    });
    const form = await slot.findByRole("region", {
      name: "Question needs your answer",
    });
    expect(slot.queryByText("Needs your decision")).toBeNull();
    expect(slot.queryByRole("button", { name: /^Reply/ })).toBeNull();
    expect(form.closest("[data-card-content]")).toBeTruthy();
    fireEvent.click(slot.getByText("Cards"));
    expect(slot.getByText("[ card ] [ card ]")).toBeTruthy();
    fireEvent.change(slot.getByRole("textbox", { name: "Layout notes" }), {
      target: { value: "Keep details" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Next" }));
    fireEvent.click(slot.getByText("Types, build"));
    fireEvent.click(slot.getByText("Tests"));
    fireEvent.click(within(form).getByRole("button", { name: "Next" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Notes answer" }), {
      target: { value: "Ship tomorrow" },
    });
    expect(
      slot
        .getByRole("button", { name: "Attach files or images" })
        .hasAttribute("disabled"),
    ).toBe(false);
    fireEvent.click(slot.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(answer).toHaveBeenCalledOnce());
    expect(answer.mock.calls[0]).toEqual([
      {
        threadId: "b1",
        id: "stack-question",
        dismiss: false,
        value: {
          answers: {
            q0: { selected: ["q0o1"], freeText: "Keep details" },
            q1: { selected: ["q1o0", "q1o1"] },
            q2: { selected: [], freeText: "Ship tomorrow" },
          },
        },
      },
    ]);
    slot.lifecycle.unmount();
    sessionStorage.clear();
  },
);

it("keeps a failed answer editable and retries dismissal", async () => {
  sessionStorage.clear();
  const { payload } = await import("./question/submission-fixture.ts");
  const answer = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ok: true });
  const slot = await mount(undefined, [], {
    question_pending: () => ({
      id: "stack-retry",
      recoverable: false,
      payload,
    }),
    question_answer: answer,
  });
  await slot.findByRole("region", { name: "Question needs your answer" });
  fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
  expect(await slot.findByRole("alert")).toHaveProperty(
    "textContent",
    "Could not dismiss the question. Please try again.",
  );
  expect(heading(slot)).toBe("Beta question");
  fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
  expect(answer.mock.calls[1]?.[0]).toMatchObject({
    threadId: "b1",
    id: "stack-retry",
    dismiss: true,
    value: null,
  });
  slot.lifecycle.unmount();
  sessionStorage.clear();
});

it("dismisses and restores a recap from the stack", async () => {
  const dismiss = vi.fn(async () => ({ ok: true }));
  const restore = vi.fn(async () => ({ ok: true }));
  const slot = await mount(undefined, [], {
    recap_dismiss: dismiss,
    recap_restore: restore,
  });
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  fireEvent.click(slot.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(slot.getByText("Built the feed")).toBeTruthy());
  fireEvent.click(slot.getByRole("button", { name: /Dismiss recap/ }));
  await waitFor(() =>
    expect(dismiss).toHaveBeenCalledWith({ threadId: "a1", recapId: "r1" }),
  );
  expect(await slot.findByText(/Dismissed recap for/)).toBeTruthy();
  fireEvent.click(slot.getByRole("button", { name: /Undo/ }));
  await waitFor(() =>
    expect(restore).toHaveBeenCalledWith({ threadId: "a1", recapId: "r1" }),
  );
  slot.lifecycle.unmount();
});

it("uploads stack answers to the card's project without a selected thread", async () => {
  sessionStorage.clear();
  const { payload } = await import("./question/submission-fixture.ts");
  const upload = vi.fn(
    async ({ clientFile }: { projectId: string; clientFile: File }) => ({
      type: "localFile" as const,
      path: "uploaded/notes.txt",
      name: clientFile.name,
      mimeType: clientFile.type,
      sizeBytes: clientFile.size,
    }),
  );
  const answer = vi.fn(async (_input: unknown) => ({ ok: true }));
  const slot = await mount(
    undefined,
    [],
    {
      question_pending: () => ({
        id: "stack-upload",
        recoverable: false,
        payload: { questions: [payload.questions[2]] },
      }),
      question_answer: answer,
    },
    { projects: { attachments: { upload } } },
  );
  const form = await slot.findByRole("region", {
    name: "Question needs your answer",
  });
  const file = new File(["notes"], "notes.txt", { type: "text/plain" });
  fireEvent.change(form.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(upload).toHaveBeenCalledWith({
      projectId: "proj_1",
      clientFile: file,
    }),
  );
  await slot.findByRole("button", { name: "Remove notes.txt" });
  fireEvent.click(slot.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(answer).toHaveBeenCalledOnce());
  expect(answer.mock.calls[0]?.[0]).toMatchObject({
    value: {
      answers: {
        q2: {
          attachments: [{ projectId: "proj_1", path: "uploaded/notes.txt" }],
        },
      },
    },
  });
  slot.lifecycle.unmount();
  sessionStorage.clear();
});

it("keeps question keyboard choices and drafts separate from queue navigation", async () => {
  sessionStorage.clear();
  const { payload } = await import("./question/submission-fixture.ts");
  const slot = await mount(undefined, [], {
    question_pending: (input) =>
      (input as { threadId: string }).threadId === "b1"
        ? { id: "stack-draft", recoverable: false, payload }
        : null,
  });
  const form = await slot.findByRole("region", {
    name: "Question needs your answer",
  });
  const choice = within(form).getByRole("radio", { name: /Rows/ });
  fireEvent.keyDown(choice, { key: "2", code: "Digit2" });
  expect(
    within(form)
      .getByRole("radio", { name: /Cards/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.keyDown(choice, { key: "j" });
  expect(heading(slot)).toBe("Beta question");
  fireEvent.click(
    within(slot.getByRole("navigation", { name: "Queue" })).getByRole(
      "button",
      { name: "Next" },
    ),
  );
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  fireEvent.click(
    within(slot.getByRole("navigation", { name: "Queue" })).getByRole(
      "button",
      { name: "Previous" },
    ),
  );
  const restored = await slot.findByRole("region", {
    name: "Question needs your answer",
  });
  expect(
    within(restored)
      .getByRole("radio", { name: /Cards/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  slot.lifecycle.unmount();
  sessionStorage.clear();
});

it("shows the waiting recap countdown and retains cancellation after restore", async () => {
  const recap = {
    id: "waiting",
    turnId: "turn",
    at: Date.now(),
    state: "waiting",
    goal: "Waiting for the build",
    latest: [],
    review: [],
    links: [],
    next: [],
    waitingAgents: [],
    timeout: 120,
  };
  const get = vi.fn(async () => ({
    recap,
    files: null,
    waitingCancelled: false,
  }));
  const slot = await mount(undefined, [], {
    state: () => ({ ...emptyState(), recaps: { a1: recap } }),
    recap_get: get,
  });
  await waitFor(() => expect(heading(slot)).toBe("Beta question"));
  fireEvent.click(slot.getByRole("button", { name: "Next" }));
  expect(await slot.findByLabelText("Status check countdown")).toBeTruthy();
  get.mockResolvedValue({ recap, files: null, waitingCancelled: true });
  await act(async () => {
    slot.behavior.emitRealtime("changed", {});
  });
  expect(await slot.findByText("Check cancelled")).toBeTruthy();
  slot.lifecycle.unmount();
});

it.each(["accept", "decline"] as const)(
  "keeps suggestion %s and undo available",
  async (decision) => {
    const suggestion = {
      id: "suggestion",
      kind: "edit",
      summary: "Group card work",
      reason: "These threads update the card stack",
      status: "pending",
      at: Date.now(),
      decidedAt: null,
      problem: null,
      headline: "Group the card work",
      arrivals: [],
      change: {
        op: "refile",
        moves: [
          {
            from: null,
            to: [{ name: "Cards", created: true }],
            threads: [{ id: "a1", title: "Alpha work" }],
            carried: 0,
          },
        ],
      },
    };
    const state = {
      suggestions: [suggestion],
      running: false,
      lastRunAt: null,
      error: null,
    };
    const decide = vi.fn(async (_input: unknown) => ({
      state: { ...state, suggestions: [] },
      failed: [],
      entries: { suggestion: "entry" },
    }));
    const reopen = vi.fn(async () => ({ state }));
    const slot = await mount(undefined, [], {
      suggestions: () => ({ state }),
      suggestionsDecide: decide,
      suggestionsReopen: reopen,
    });
    await waitFor(() => expect(heading(slot)).toBe("Beta question"));
    fireEvent.click(slot.getByRole("button", { name: /Archive/ }));
    await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
    fireEvent.click(slot.getByRole("button", { name: /Archive/ }));
    await waitFor(() => expect(heading(slot)).toBe("Group the card work"));
    expect(slot.getByText("These threads update the card stack")).toBeTruthy();
    expect(slot.queryByRole("button", { name: /Reply/ })).toBeNull();
    fireEvent.click(
      slot.getByRole("button", {
        name: decision === "accept" ? /Accept and move/ : /Decline/,
      }),
    );
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({ ids: ["suggestion"], decision }),
    );
    fireEvent.click(await slot.findByRole("button", { name: /Undo/ }));
    await waitFor(() =>
      expect(reopen).toHaveBeenCalledWith({
        id: "suggestion",
        entryId: "entry",
      }),
    );
    slot.lifecycle.unmount();
  },
);

it("does not change the selected item when an earlier question finishes sending", async () => {
  sessionStorage.clear();
  const { payload } = await import("./question/submission-fixture.ts");
  let resolveAnswer!: (value: unknown) => void;
  const sending = new Promise((resolve) => {
    resolveAnswer = resolve;
  });
  const slot = await mount(undefined, [], {
    question_pending: (input) =>
      (input as { threadId: string }).threadId === "b1"
        ? {
            id: "stack-sending",
            recoverable: false,
            payload: { questions: [payload.questions[2]] },
          }
        : null,
    question_answer: () => sending,
  });
  await slot.findByRole("textbox", { name: "Notes answer" });
  fireEvent.change(slot.getByRole("textbox", { name: "Notes answer" }), {
    target: { value: "Ship it" },
  });
  fireEvent.click(slot.getByRole("button", { name: "Submit" }));
  fireEvent.click(
    within(slot.getByRole("navigation", { name: "Queue" })).getByRole(
      "button",
      { name: "Next" },
    ),
  );
  await waitFor(() => expect(heading(slot)).toBe("Alpha work"));
  await act(async () => {
    resolveAnswer({ ok: true });
  });
  expect(heading(slot)).toBe("Alpha work");
  expect((await slot.findByRole("status")).textContent).toBe(
    "Answered Beta question",
  );
  expect(slot.queryByRole("button", { name: /Undo/ })).toBeNull();
  slot.lifecycle.unmount();
  sessionStorage.clear();
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
