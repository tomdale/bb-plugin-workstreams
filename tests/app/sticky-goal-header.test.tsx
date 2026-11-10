// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import {
  SUBTITLE_LINE,
  SUBTITLE_SIZE,
  BAR_FADE_RATIO,
  headingBackdropOpacity,
  headingHeight,
  headingOpacity,
  headingScroll,
  pinnedHeight,
  pinnedTitleScale,
  titleExitDistance,
} from "../../src/app/goalHeading.ts";
import {
  StickyGoalHeader,
  useMessageScroller,
} from "../../src/app/StickyGoalHeader.tsx";
import { REDUCED_MOTION_QUERY } from "@/components/ui/hooks/use-media-query";
import { parsePrefs, type Prefs } from "../../src/domain/prefs.ts";
import { emptyState, sidebarThread } from "./fixtures.ts";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function stubResizeObserver() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

/**
 * BB's thread pane reduced to what the heading attaches to: the sliding app
 * surface, the pane with its title bar, the message scroller with its column,
 * and the composer, whose recap card scrolls its own text with the same class.
 */
function paneFixture({ recap }: { recap: boolean }) {
  document.body.innerHTML = `
    <main data-sidebar="inset">
      <div data-split-pane-id="main">
        <header>
          <div class="flex-1"><span class="bb-thread-title">Thread</span></div>
          <div>actions</div>
        </header>
        <div data-thread-window>
          <div class="thread-scrollbar" data-test="messages">
            <div>
              <div data-test="sentinel" aria-hidden="true" class="invisible w-px"></div>
              <div data-test="column" data-scroll-attached></div>
            </div>
          </div>
          <div data-app-composer>
            ${
              recap
                ? '<div role="region" aria-label="Latest recap"><div class="thread-scrollbar"></div></div>'
                : ""
            }
          </div>
        </div>
      </div>
    </main>`;
}

async function mountHeading(
  headingTransition: "fade" | "scroll" = "scroll",
  goal: string | null = null,
  onRender?: ProfilerOnRenderCallback,
  threads: Partial<Prefs["threads"]> = {},
) {
  stubResizeObserver();
  const heading = {
    component: onRender
      ? () => (
          <Profiler id="heading" onRender={onRender}>
            <StickyGoalHeader />
          </Profiler>
        )
      : StickyGoalHeader,
  };
  return renderSlot(
    heading,
    {},
    {
      context: { threadId: "t1", projectId: "proj_1" },
      sidebarThreads: {
        sections: [],
        threads: [sidebarThread("t1", { title: "Ship the mobile polish" })],
      },
      rpc: {
        state: () => ({
          ...emptyState(),
          analysis: goal
            ? {
                t1: {
                  recap: "Working",
                  state: "in_progress",
                  needsYou: null,
                  goal: null,
                  threadGoal: goal,
                  revision: 1,
                  at: 1,
                  model: "test",
                },
              }
            : {},
        }),
        prefs: () => ({
          prefs: parsePrefs({ threads: { headingTransition, ...threads } }),
        }),
      },
    },
  );
}

const root = () => document.querySelector("[data-workstreams-sticky-goal]");
const overlay = () => document.querySelector("[data-workstreams-goal-overlay]");

function ScrollerProbe({ threadId }: { threadId: string | null }) {
  const mount = useMessageScroller(threadId);
  return <output data-testid="mounted-thread">{mount?.threadId ?? ""}</output>;
}

function readingScroller(scrollTop = 200) {
  const scroller = document.querySelector<HTMLElement>(
    '[data-test="messages"]',
  )!;
  const writes = vi.fn((value: number) => {
    scrollTop = value;
  });
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: writes,
    },
  });
  return { scroller, writes };
}

const nextFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

it("leaves detached-reader scroll compensation to BB on attachment", async () => {
  paneFixture({ recap: false });
  const { scroller, writes } = readingScroller();
  const slot = render(<ScrollerProbe threadId="t1" />);
  await waitFor(() => expect(root()).not.toBeNull());
  expect(scroller.scrollTop).toBe(200);
  expect(writes).not.toHaveBeenCalled();
  slot.unmount();
});

it("keeps following the newest message when attaching at the bottom", async () => {
  paneFixture({ recap: false });
  const { scroller, writes } = readingScroller(600);
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    get: () =>
      1000 +
      Number.parseFloat((root() as HTMLElement)?.style.marginBottom || "0"),
  });
  const slot = render(<ScrollerProbe threadId="t1" />);
  await waitFor(() => expect(root()).not.toBeNull());
  expect(writes).toHaveBeenCalledWith(scroller.scrollHeight);
  slot.unmount();
});

it("preserves the outgoing gap through the host snapshot and binds the new heading to the replacement column", async () => {
  paneFixture({ recap: false });
  const { scroller, writes } = readingScroller();
  const column = document.querySelector<HTMLElement>('[data-test="column"]')!;
  const slot = render(<ScrollerProbe threadId="t1" />);
  await waitFor(() => expect(root()).not.toBeNull());
  const outgoing = root() as HTMLElement;
  const outgoingOverlay = overlay()!;
  const gap = outgoing.style.marginBottom;
  slot.rerender(<ScrollerProbe threadId="t2" />);
  expect(slot.getByTestId("mounted-thread").textContent).toBe("");
  await nextFrame();
  expect(root()).toBe(outgoing);
  expect(outgoing.style.marginBottom).toBe(gap);
  expect(outgoing.parentElement).toBe(column);
  expect(writes).not.toHaveBeenCalled();

  await act(async () => {
    column.append(document.createTextNode("Finishing the outgoing render"));
  });
  await nextFrame();
  expect(root()).toBe(outgoing);
  expect(slot.getByTestId("mounted-thread").textContent).toBe("");

  const replacement = column.cloneNode(false) as HTMLElement;
  column.replaceWith(replacement);
  await waitFor(() =>
    expect(slot.getByTestId("mounted-thread").textContent).toBe("t2"),
  );
  expect(root()?.parentElement).toBe(replacement);
  expect(
    document.querySelectorAll("[data-workstreams-sticky-goal]"),
  ).toHaveLength(1);
  expect(outgoing.parentElement).toBeNull();
  expect(outgoingOverlay.isConnected).toBe(false);
  expect(scroller.scrollTop).toBe(200);
  expect(writes).not.toHaveBeenCalled();
  slot.unmount();
});

it("reuses the outgoing gap when selection reverses before the pane changes", async () => {
  paneFixture({ recap: false });
  const { writes } = readingScroller();
  const slot = render(<ScrollerProbe threadId="t1" />);
  await waitFor(() => expect(root()).not.toBeNull());
  const original = root();
  for (const threadId of ["t2", "t1", "t2", "t1"]) {
    slot.rerender(<ScrollerProbe threadId={threadId} />);
    await nextFrame();
    expect(root()).toBe(original);
    expect(slot.getByTestId("mounted-thread").textContent).toBe(
      threadId === "t1" ? "t1" : "",
    );
  }
  expect(writes).not.toHaveBeenCalled();
  slot.unmount();
});

it("keeps the outgoing gap when returning Home until the native pane is removed", async () => {
  paneFixture({ recap: false });
  readingScroller();
  const slot = render(<ScrollerProbe threadId="t1" />);
  await waitFor(() => expect(root()).not.toBeNull());
  const outgoing = root()!;
  slot.rerender(<ScrollerProbe threadId={null} />);
  await nextFrame();
  expect(root()).toBe(outgoing);
  expect(slot.getByTestId("mounted-thread").textContent).toBe("");
  document.querySelector("[data-thread-window]")!.remove();
  await waitFor(() => expect(overlay()).toBeNull());
  expect(outgoing.parentElement).toBeNull();
  slot.unmount();
});

it("restores native scroll padding and removes the gap and overlay on disposal", async () => {
  paneFixture({ recap: false });
  const { scroller } = readingScroller();
  scroller.style.setProperty("scroll-padding-top", "19px", "important");
  const slot = render(<ScrollerProbe threadId="t1" />);
  await waitFor(() => expect(root()).not.toBeNull());
  expect(scroller.style.scrollPaddingTop).not.toBe("19px");
  slot.unmount();
  expect(root()).toBeNull();
  expect(overlay()).toBeNull();
  expect(scroller.style.scrollPaddingTop).toBe("19px");
  expect(scroller.style.getPropertyPriority("scroll-padding-top")).toBe(
    "important",
  );
});

it("keeps a detached reader near the bottom detached during overlay recovery", async () => {
  paneFixture({ recap: false });
  const { scroller, writes } = readingScroller();
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    get: () =>
      1000 +
      Number.parseFloat((root() as HTMLElement)?.style.marginBottom || "0"),
  });
  const slot = render(<ScrollerProbe threadId="t1" />);
  await waitFor(() => expect(root()).not.toBeNull());
  const position = scroller.scrollHeight - scroller.clientHeight - 80;
  scroller.scrollTop = position;
  writes.mockClear();
  const original = overlay()!;
  original.remove();
  await waitFor(() => expect(overlay()).not.toBeNull());
  expect(overlay()).not.toBe(original);
  expect(scroller.scrollTop).toBe(position);
  expect(writes).not.toHaveBeenCalled();
  slot.unmount();
});

it("recovers an overlay removed while the message column remains mounted", async () => {
  paneFixture({ recap: false });
  readingScroller();
  const slot = render(<ScrollerProbe threadId="t1" />);
  await waitFor(() => expect(root()).not.toBeNull());
  const original = overlay()!;
  original.remove();
  await waitFor(() => expect(overlay()).not.toBeNull());
  expect(overlay()).not.toBe(original);
  expect(
    document.querySelectorAll("[data-workstreams-sticky-goal]"),
  ).toHaveLength(1);
  slot.unmount();
});

it.each([0, 1, 2, 3, 7])(
  "reserves space for the goal's visible lines, capped at three (%i)",
  async (lines) => {
    paneFixture({ recap: false });
    const base = 14;
    const line = base * SUBTITLE_SIZE * SUBTITLE_LINE;
    const size = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("ws-sticky-goal__subtitle")
          ? Math.round(line * lines)
          : 0;
      });
    const slot = await mountHeading(
      "fade",
      lines
        ? "Make review findings clear without losing useful context."
        : null,
    );
    try {
      const height = headingHeight(base, false, 1, Math.min(3, lines));
      await waitFor(() =>
        expect((root() as HTMLElement)?.style.marginBottom).toBe(`${height}px`),
      );
      await waitFor(() =>
        expect(
          overlay()?.querySelector<HTMLElement>('[data-ws-heading="expanded"]')
            ?.style.height,
        ).toBe(`${height}px`),
      );
      expect(
        overlay()!.querySelector<HTMLElement>(".ws-sticky-goal")!.style.height,
      ).toBe(`${height}px`);
    } finally {
      slot.lifecycle.unmount();
      size.mockRestore();
    }
  },
);

it("remeasures wrapped goals when the pane width changes", async () => {
  paneFixture({ recap: false });
  const line = 14 * SUBTITLE_SIZE * SUBTITLE_LINE;
  let lines = 3;
  let width = 600;
  const size = vi
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ws-sticky-goal__subtitle")
        ? Math.round(line * lines)
        : 0;
    });
  const column = document.querySelector<HTMLElement>('[data-test="column"]')!;
  const rect = vi
    .spyOn(column, "getBoundingClientRect")
    .mockImplementation(() => new DOMRect(0, 0, width, 1000));
  const slot = await mountHeading(
    "fade",
    "Make review findings clear without losing useful context.",
  );
  try {
    await waitFor(() =>
      expect((root() as HTMLElement)?.style.marginBottom).toBe(
        `${headingHeight(14, false, 1, 3)}px`,
      ),
    );
    lines = 1;
    width = 1000;
    window.dispatchEvent(new Event("resize"));
    await waitFor(() =>
      expect((root() as HTMLElement)?.style.marginBottom).toBe(
        `${headingHeight(14, false, 1, 1)}px`,
      ),
    );
  } finally {
    slot.lifecycle.unmount();
    size.mockRestore();
    rect.mockRestore();
  }
});

it("attaches to the message scroller although a recap card scrolls its own text", async () => {
  paneFixture({ recap: true });
  const slot = await mountHeading();
  await waitFor(() => expect(root()).not.toBeNull());
  expect(document.querySelector('[data-test="column"]')!.contains(root())).toBe(
    true,
  );
  slot.lifecycle.unmount();
});

it("ignores the scroll sentinel when BB removes the column's attachment marker", async () => {
  paneFixture({ recap: false });
  const column = document.querySelector<HTMLElement>('[data-test="column"]')!;
  column.removeAttribute("data-scroll-attached");
  const slot = await mountHeading();
  await waitFor(() => expect(root()?.parentElement).toBe(column));
  const replacement = column.cloneNode(false) as HTMLElement;
  column.replaceWith(replacement);
  await waitFor(() => expect(root()?.parentElement).toBe(replacement));
  expect(
    document.querySelector('[data-test="sentinel"]')!.contains(root()),
  ).toBe(false);
  slot.lifecycle.unmount();
});

it("falls back to the first column when BB does not mark it", async () => {
  paneFixture({ recap: false });
  document.querySelector('[data-test="sentinel"]')!.remove();
  document
    .querySelector('[data-test="column"]')!
    .removeAttribute("data-scroll-attached");
  const slot = await mountHeading();
  await waitFor(() => expect(root()).not.toBeNull());
  expect(document.querySelector('[data-test="column"]')!.contains(root())).toBe(
    true,
  );
  slot.lifecycle.unmount();
});

it("centers the minimized title in the title bar when asked to", async () => {
  paneFixture({ recap: false });
  const scroller = document.querySelector<HTMLElement>(
    '[data-test="messages"]',
  )!;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: { configurable: true, writable: true, value: 600 },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 48, 900, 672),
  );
  const header = document.querySelector("header")!;
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 900, 48),
  );
  vi.spyOn(
    header.querySelector(".bb-thread-title")!,
    "getBoundingClientRect",
  ).mockReturnValue(new DOMRect(0, 0, 80, 48));
  vi.spyOn(header.lastElementChild!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(700, 0, 100, 48),
  );
  const slot = await mountHeading("fade", null, undefined, {
    headingAlign: "center",
  });
  const groups = () => ({
    expanded: overlay()!.querySelector<HTMLElement>(
      '[data-ws-heading="expanded"] .ws-goal-overlay__group',
    ),
    compact: overlay()!.querySelector<HTMLElement>(
      '[data-ws-heading="compact"] .ws-goal-overlay__group',
    ),
  });
  await waitFor(() => expect(groups().compact).not.toBeNull());
  // The expanded heading stays with the messages; only the minimized copy
  // moves to the bar's middle.
  expect(groups().expanded!.hasAttribute("data-ws-align")).toBe(false);
  expect(groups().compact!.getAttribute("data-ws-align")).toBe("center");
  expect(groups().compact!.style.width).toBe("468px");
  expect(
    overlay()!.querySelector<HTMLElement>('[data-ws-heading="compact"]')!.style
      .transform,
  ).toContain("translate(216px");
  slot.lifecycle.unmount();
});

it("leaves the minimized title in the bar's gap by default", async () => {
  paneFixture({ recap: false });
  const scroller = document.querySelector<HTMLElement>(
    '[data-test="messages"]',
  )!;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: { configurable: true, writable: true, value: 600 },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 48, 900, 672),
  );
  const header = document.querySelector("header")!;
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 900, 48),
  );
  vi.spyOn(
    header.querySelector(".bb-thread-title")!,
    "getBoundingClientRect",
  ).mockReturnValue(new DOMRect(0, 0, 80, 48));
  vi.spyOn(header.lastElementChild!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(700, 0, 100, 48),
  );
  const slot = await mountHeading();
  const compact = () =>
    overlay()!.querySelector<HTMLElement>(
      '[data-ws-heading="compact"] .ws-goal-overlay__group',
    );
  await waitFor(() => expect(compact()).not.toBeNull());
  expect(compact()!.hasAttribute("data-ws-align")).toBe(false);
  // Between the thread's controls and the actions, as before.
  expect(compact()!.style.width).toBe("588px");
  slot.lifecycle.unmount();
});

it.each(["fade", "scroll"] as const)(
  "keeps the large heading floating over the timeline in %s mode",
  async (mode) => {
    paneFixture({ recap: false });
    const scroller = document.querySelector<HTMLElement>(
      '[data-test="messages"]',
    )!;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 600 },
    });
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 48, 900, 672),
    );
    const header = document.querySelector("header")!;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 900, 48),
    );
    vi.spyOn(
      header.querySelector(".bb-thread-title")!,
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(0, 0, 80, 48));
    vi.spyOn(header.lastElementChild!, "getBoundingClientRect").mockReturnValue(
      new DOMRect(700, 0, 100, 48),
    );
    const slot = await mountHeading(mode, null, undefined, {
      headingScroll: "float",
    });
    await waitFor(() => expect(overlay()).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 550));
    // Far from the newest message, where minimizing would have swapped in the
    // compact copy.
    scroller.scrollTop = 300;
    scroller.dispatchEvent(new Event("scroll"));
    const expanded = () =>
      overlay()!.querySelector<HTMLElement>(
        '[data-ws-heading="expanded"] .ws-goal-overlay__group',
      )!;
    const compact = () =>
      overlay()!.querySelector<HTMLElement>(
        '[data-ws-heading="compact"] .ws-goal-overlay__group',
      )!;
    await waitFor(() => expect(expanded().style.opacity).toBe("1"));
    expect(compact().style.opacity).toBe("0");
    expect(expanded().style.transform).toBe(
      mode === "fade" ? "translateY(11.9px) scale(1)" : "translateY(11.9px)",
    );
    // The timeline keeps its reserved room, and the heading still shadows it.
    expect(scroller.style.scrollPaddingTop).toBe(
      `${headingHeight(14, false, 1, 0)}px`,
    );
    const background = overlay()!.querySelector<HTMLElement>(
      ".ws-goal-background",
    )!;
    expect(background.style.getPropertyValue("--ws-fade-below-plate")).toBe(
      "1",
    );
    expect(background.style.getPropertyValue("--ws-fade-below-bar")).toBe("0");
    expect(
      background.querySelector<HTMLElement>(".ws-sticky-goal__plate")!.style
        .transform,
    ).toBe("scaleY(1)");
    slot.lifecycle.unmount();
  },
);

it("draws the heading text inside the app's sliding surface so it travels with the pane", async () => {
  paneFixture({ recap: false });
  const slot = await mountHeading();
  await waitFor(() => expect(overlay()).not.toBeNull());
  expect(
    document.querySelector('[data-sidebar="inset"]')!.contains(overlay()),
  ).toBe(true);
  await waitFor(() =>
    expect(overlay()!.textContent).toContain("Ship the mobile polish"),
  );
  const background = overlay()!.querySelector(".ws-goal-background");
  expect(background?.querySelector(".ws-sticky-goal__plate")).not.toBeNull();
  expect(root()!.contains(background)).toBe(false);
  slot.lifecycle.unmount();
});

it("moves the two fixed-size headings together as the reader scrolls", async () => {
  paneFixture({ recap: false });
  const scroller = document.querySelector<HTMLElement>(
    '[data-test="messages"]',
  )!;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: { configurable: true, writable: true, value: 600 },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 48, 900, 672),
  );
  const header = document.querySelector("header")!;
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 900, 48),
  );
  vi.spyOn(
    header.querySelector(".bb-thread-title")!,
    "getBoundingClientRect",
  ).mockReturnValue(new DOMRect(0, 0, 80, 48));
  vi.spyOn(header.lastElementChild!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(700, 0, 100, 48),
  );
  const slot = await mountHeading();
  scroller.scrollTop = 600;
  scroller.dispatchEvent(new Event("scroll"));
  const groups = () => [
    ...overlay()!.querySelectorAll<HTMLElement>(".ws-goal-overlay__group"),
  ];
  await waitFor(() => expect(groups()).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 550));
  const y = (element: HTMLElement) =>
    Number.parseFloat(
      element.style.transform.match(/translateY\(([-\d.]+)px\)/)![1]!,
    );
  const initial = groups().map(y);
  expect(groups().map((group) => Number(group.style.opacity))).toEqual([1, 0]);
  const fadeScale = () =>
    Number(
      overlay()!
        .querySelector<HTMLElement>(".ws-goal-background")!
        .style.getPropertyValue("--ws-plate-fade-scale"),
    );
  expect(fadeScale()).toBe(1);
  const motion = headingScroll(10, initial[1]!);
  scroller.scrollTop = 590;
  scroller.dispatchEvent(new Event("scroll"));
  await waitFor(() =>
    expect(y(groups()[0]!)).toBeCloseTo(initial[0]! - motion.moved),
  );
  expect(y(groups()[1]!)).toBeCloseTo(initial[1]! - motion.moved);
  const partialOpacity = groups().map((group) => Number(group.style.opacity));
  expect(partialOpacity[0]).toBeGreaterThan(0);
  expect(partialOpacity[0]).toBeLessThan(1);
  const expectedOpacity = headingOpacity(motion.progress);
  expect(partialOpacity[0]).toBeCloseTo(expectedOpacity.expanded);
  expect(partialOpacity[1]).toBeCloseTo(expectedOpacity.compact);
  expect(partialOpacity[1]).toBeGreaterThan(0);
  expect(fadeScale()).toBeLessThan(1);
  expect(fadeScale()).toBeGreaterThan(BAR_FADE_RATIO);
  expect(
    groups()[0]!.querySelector<HTMLElement>(".ws-sticky-goal__title")!.style
      .fontSize,
  ).not.toBe(
    groups()[1]!.querySelector<HTMLElement>(".ws-sticky-goal__title")!.style
      .fontSize,
  );
  scroller.scrollTop = 450;
  scroller.dispatchEvent(new Event("scroll"));
  await waitFor(() => expect(y(groups()[1]!)).toBe(0));
  expect(groups().map((group) => Number(group.style.opacity))).toEqual([0, 1]);
  expect(fadeScale()).toBe(BAR_FADE_RATIO);
  scroller.scrollTop = 590;
  scroller.dispatchEvent(new Event("scroll"));
  await waitFor(() =>
    expect(y(groups()[1]!)).toBeCloseTo(initial[1]! - motion.moved),
  );
  expect(groups().map((group) => Number(group.style.opacity))).toEqual(
    partialOpacity,
  );
  scroller.scrollTop = 600;
  scroller.dispatchEvent(new Event("scroll"));
  await waitFor(() =>
    expect(groups().map((group) => Number(group.style.opacity))).toEqual([
      1, 0,
    ]),
  );
  slot.lifecycle.unmount();
});

it("eases fixed headings through a gentle handoff and switches modes", async () => {
  paneFixture({ recap: false });
  const scroller = document.querySelector<HTMLElement>(
    '[data-test="messages"]',
  )!;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: { configurable: true, writable: true, value: 600 },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 48, 900, 672),
  );
  const header = document.querySelector("header")!;
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 900, 48),
  );
  vi.spyOn(
    header.querySelector(".bb-thread-title")!,
    "getBoundingClientRect",
  ).mockReturnValue(new DOMRect(0, 0, 80, 48));
  vi.spyOn(header.lastElementChild!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(700, 0, 100, 48),
  );
  const slot = await mountHeading("fade");
  scroller.scrollTop = 600;
  scroller.dispatchEvent(new Event("scroll"));
  const groups = () => [
    ...overlay()!.querySelectorAll<HTMLElement>(".ws-goal-overlay__group"),
  ];
  await waitFor(() => expect(groups()).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 550));
  const readMotion = () =>
    groups().map((group) => {
      const match = group.style.transform.match(
        /translateY\(([-\d.]+)px\) scale\(([-\d.]+)\)/,
      )!;
      return {
        y: Number(match[1]),
        scale: Number(match[2]),
        opacity: Number(group.style.opacity),
      };
    });
  expect(readMotion()).toEqual([
    { y: 11.9, scale: 1, opacity: 1 },
    { y: 4, scale: 0.99, opacity: 0 },
  ]);
  const distance = titleExitDistance(14, null, 1);
  let previousDistance = 0;
  let previous = readMotion();
  let first50: ReturnType<typeof readMotion> | null = null;
  for (const fromBottom of [20, 50, 80, 50]) {
    scroller.scrollTop = 600 - fromBottom;
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(() =>
      expect(Number(groups()[1]!.style.opacity)).not.toBe(previous[1]!.opacity),
    );
    const current = readMotion();
    const direction = Math.sign(fromBottom - previousDistance);
    expect(current[0]!.opacity + current[1]!.opacity).toBeCloseTo(1);
    expect(
      (current[0]!.opacity - previous[0]!.opacity) * direction,
    ).toBeLessThan(0);
    expect((current[0]!.y - previous[0]!.y) * direction).toBeLessThan(0);
    expect((current[0]!.scale - previous[0]!.scale) * direction).toBeLessThan(
      0,
    );
    expect(
      (current[1]!.opacity - previous[1]!.opacity) * direction,
    ).toBeGreaterThan(0);
    expect((current[1]!.y - previous[1]!.y) * direction).toBeLessThan(0);
    expect(
      (current[1]!.scale - previous[1]!.scale) * direction,
    ).toBeGreaterThan(0);
    if (fromBottom === 50 && first50) expect(current).toEqual(first50);
    if (fromBottom === 50) first50 = current;
    previous = current;
    previousDistance = fromBottom;
  }
  const fadeAt50 = groups().map((group) => group.style.transform);
  const plate = overlay()!.querySelector<HTMLElement>(
    ".ws-sticky-goal__plate",
  )!;
  expect(Number(plate.style.opacity)).toBeCloseTo(
    headingBackdropOpacity(
      headingScroll(50, titleExitDistance(14, null, 1), "fade").progress,
    ),
  );
  expect(Number(plate.style.opacity)).toBeGreaterThan(0.95);
  const plateBox = overlay()!.querySelector<HTMLElement>(
    '[data-ws-heading="expanded"]',
  )!;
  const height = Number.parseFloat(plateBox.style.height);
  expect(plate.style.transform).toBe(`scaleY(${(height - 21) / height})`);
  expect(
    overlay()!
      .querySelector<HTMLElement>(".ws-goal-background")!
      .style.getPropertyValue("--ws-plate-height"),
  ).toBe(`${height - 21}px`);
  await slot.behavior.emitRealtime("prefs", {
    prefs: parsePrefs({ threads: { headingTransition: "scroll" } }),
  });
  await waitFor(() =>
    expect(groups()[0]!.style.transform).not.toBe(fadeAt50[0]),
  );
  expect(groups()[1]!.style.transform).not.toBe(fadeAt50[1]);
  const scrollOpacity = headingOpacity(headingScroll(50, distance).progress);
  expect(Number(groups()[0]!.style.opacity)).toBeCloseTo(
    scrollOpacity.expanded,
  );
  expect(Number(groups()[1]!.style.opacity)).toBeCloseTo(scrollOpacity.compact);
  expect(Number(plate.style.opacity)).toBe(1);
  await slot.behavior.emitRealtime("prefs", {
    prefs: parsePrefs({ threads: { headingTransition: "fade" } }),
  });
  await waitFor(() =>
    expect(groups().map((group) => group.style.transform)).toEqual(fadeAt50),
  );
  scroller.scrollTop = 450;
  scroller.dispatchEvent(new Event("scroll"));
  await waitFor(() => expect(Number(groups()[1]!.style.opacity)).toBe(1));
  expect(Number(plate.style.opacity)).toBe(0);
  expect(scroller.style.scrollPaddingTop).toBe("0px");
  expect(
    overlay()!
      .querySelector<HTMLElement>(".ws-goal-background")!
      .style.getPropertyValue("--ws-fade-below-bar"),
  ).toBe("1");
  await slot.behavior.emitRealtime("prefs", {
    prefs: parsePrefs({ threads: { headingTransition: "scroll" } }),
  });
  await nextFrame();
  await nextFrame();
  await slot.behavior.emitRealtime("prefs", {
    prefs: parsePrefs({ threads: { headingTransition: "fade" } }),
  });
  expect(Number(groups()[1]!.style.opacity)).toBe(1);
  expect(Number(groups()[0]!.style.opacity)).toBe(0);
  slot.lifecycle.unmount();
});

it.each(["fade", "scroll"] as const)(
  "scales one pinned title in place in %s mode",
  async (mode) => {
    paneFixture({ recap: false });
    const scroller = document.querySelector<HTMLElement>(
      '[data-test="messages"]',
    )!;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    });
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 48, 900, 672),
    );
    const slot = await mountHeading(mode);
    const groups = () => [
      ...overlay()!.querySelectorAll<HTMLElement>(".ws-goal-overlay__group"),
    ];
    const title = () =>
      overlay()!.querySelector<HTMLElement>(
        '[data-ws-heading="expanded"] .ws-sticky-goal__title',
      )!;
    await waitFor(() => expect(groups()).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 550));
    scroller.scrollTop = 100;
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(() =>
      expect(title().style.transform).toBe("translateY(0px) scale(1)"),
    );
    expect(groups().map((group) => Number(group.style.opacity))).toEqual([
      1, 0,
    ]);

    scroller.scrollTop = 50;
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(() =>
      expect(title().style.transform).not.toBe("translateY(0px) scale(1)"),
    );
    const middle = title().style.transform.match(
      /translateY\(([-\d.]+)px\) scale\(([-\d.]+)\)/,
    )!;
    expect(Number(middle[1])).toBeLessThan(0);
    expect(Number(middle[2])).toBeLessThan(1);
    expect(Number(middle[2])).toBeGreaterThan(pinnedTitleScale(1));
    expect(groups().map((group) => Number(group.style.opacity))).toEqual([
      1, 0,
    ]);
    expect(
      overlay()!
        .querySelector<HTMLElement>(".ws-goal-background")!
        .style.getPropertyValue("--ws-plate-fade-scale"),
    ).toBe("1");

    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    const finalY = 14 * (0.3 - 0.85);
    await waitFor(() => {
      const match = title().style.transform.match(
        /translateY\(([-\d.]+)px\) scale\(([-\d.]+)\)/,
      )!;
      expect(Number(match[1])).toBeCloseTo(finalY);
      expect(Number(match[2])).toBeCloseTo(pinnedTitleScale(1));
    });
    expect(groups().map((group) => Number(group.style.opacity))).toEqual([
      1, 0,
    ]);
    slot.lifecycle.unmount();
  },
);

it("left aligns a pinned title and its goal when title alignment is centered", async () => {
  paneFixture({ recap: false });
  const scroller = document.querySelector<HTMLElement>(
    '[data-test="messages"]',
  )!;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: { configurable: true, writable: true, value: 600 },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 48, 900, 672),
  );
  const slot = await mountHeading("scroll", "Finish the release", undefined, {
    headingAlign: "center",
  });
  const expanded = () =>
    overlay()!.querySelector<HTMLElement>(
      '[data-ws-heading="expanded"] .ws-goal-overlay__group',
    )!;
  const title = () =>
    expanded().querySelector<HTMLElement>(".ws-sticky-goal__title")!;
  const goal = () =>
    expanded().querySelector<HTMLElement>(".ws-sticky-goal__subtitle")!;
  await waitFor(() => expect(title().style.transform).toContain("scale(1)"));
  await new Promise((resolve) => setTimeout(resolve, 550));
  scroller.scrollTop = 520;
  scroller.dispatchEvent(new Event("scroll"));
  await waitFor(() => {
    const opacity = Number(goal().style.opacity);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });
  expect(expanded().getAttribute("data-ws-align")).toBeNull();
  expect(expanded().style.opacity).toBe("1");
  expect(title().style.transformOrigin).toBe("0 0");
  expect(Number(goal().style.opacity)).toBeLessThan(1);
  slot.lifecycle.unmount();
});

it.each([false, true])(
  "keeps a two-line pinned title through scaling with reduced motion %s",
  async (reduced) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduced && query === REDUCED_MOTION_QUERY,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const probeHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("ws-sticky-goal__probe") ? 56 : 0;
      });
    paneFixture({ recap: false });
    const scroller = document.querySelector<HTMLElement>(
      '[data-test="messages"]',
    )!;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    });
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 48, 500, 672),
    );
    const slot = await mountHeading("fade");
    const title = () =>
      overlay()!.querySelector<HTMLElement>(
        '[data-ws-heading="expanded"] .ws-sticky-goal__title',
      )!;
    try {
      await waitFor(() => expect(title().style.webkitLineClamp).toBe("2"));
      await new Promise((resolve) => setTimeout(resolve, 550));
      scroller.scrollTop = 50;
      scroller.dispatchEvent(new Event("scroll"));
      await nextFrame();
      await nextFrame();
      const match = title().style.transform.match(/scale\(([-\d.]+)\)/)!;
      if (reduced) expect(Number(match[1])).toBe(1);
      else expect(Number(match[1])).toBeLessThan(1);
      expect(title().style.webkitLineClamp).toBe("2");

      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll"));
      await waitFor(() =>
        expect(root()!.getAttribute("data-collapsed")).toBe("true"),
      );
      expect(title().style.webkitLineClamp).toBe("2");
      const height = headingHeight(14, false, 2, 0);
      expect(
        overlay()!.querySelector<HTMLElement>(".ws-sticky-goal__plate")!.style
          .transform,
      ).toBe(`scaleY(${pinnedHeight(14, null, 2) / height})`);
    } finally {
      probeHeight.mockRestore();
      slot.lifecycle.unmount();
    }
  },
);

it.each(["fade", "scroll"] as const)(
  "keeps titles and backdrop stationary under reduced motion in %s mode",
  async (mode) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === REDUCED_MOTION_QUERY,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    paneFixture({ recap: false });
    const scroller = document.querySelector<HTMLElement>(
      '[data-test="messages"]',
    )!;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 600 },
    });
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 48, 900, 672),
    );
    const header = document.querySelector("header")!;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 900, 48),
    );
    vi.spyOn(
      header.querySelector(".bb-thread-title")!,
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(0, 0, 80, 48));
    vi.spyOn(header.lastElementChild!, "getBoundingClientRect").mockReturnValue(
      new DOMRect(700, 0, 100, 48),
    );
    const slot = await mountHeading(mode);
    const groups = () => [
      ...overlay()!.querySelectorAll<HTMLElement>(".ws-goal-overlay__group"),
    ];
    await waitFor(() => expect(groups()).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 550));
    const transforms = groups().map((group) => group.style.transform);
    const plate = overlay()!.querySelector<HTMLElement>(
      ".ws-sticky-goal__plate",
    )!;
    const plateTransform = plate.style.transform;
    expect(transforms).toEqual([
      "translateY(11.9px) scale(1)",
      "translateY(0px) scale(1)",
    ]);
    scroller.scrollTop = 550;
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(() => {
      const opacity = Number(groups()[1]!.style.opacity);
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThan(1);
    });
    expect(groups().map((group) => group.style.transform)).toEqual(transforms);
    expect(plate.style.transform).toBe(plateTransform);
    expect(
      overlay()!
        .querySelector<HTMLElement>(".ws-goal-background")!
        .style.getPropertyValue("--ws-plate-fade-scale"),
    ).toBe("1");
    slot.lifecycle.unmount();
  },
);

it("swaps a pinned backdrop at the endpoint under reduced motion", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  paneFixture({ recap: false });
  const scroller = document.querySelector<HTMLElement>(
    '[data-test="messages"]',
  )!;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: { configurable: true, writable: true, value: 600 },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 48, 900, 672),
  );
  const slot = await mountHeading("scroll");
  const groups = () => [
    ...overlay()!.querySelectorAll<HTMLElement>(".ws-goal-overlay__group"),
  ];
  const plate = () =>
    overlay()!.querySelector<HTMLElement>(".ws-sticky-goal__plate")!;
  const title = () =>
    overlay()!.querySelector<HTMLElement>(
      '[data-ws-heading="expanded"] .ws-sticky-goal__title',
    )!;
  await waitFor(() => expect(groups()).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 550));
  const expandedHeight = headingHeight(14, false, 1, 0);
  expect(plate().style.transform).toBe("scaleY(1)");
  expect(scroller.style.scrollPaddingTop).toBe(`${expandedHeight}px`);

  scroller.scrollTop = 520;
  scroller.dispatchEvent(new Event("scroll"));
  await nextFrame();
  await nextFrame();
  expect(title().style.transform).toBe("translateY(0px) scale(1)");
  expect(groups().map((group) => Number(group.style.opacity))).toEqual([1, 0]);
  expect(plate().style.transform).toBe("scaleY(1)");
  expect(scroller.style.scrollPaddingTop).toBe(`${expandedHeight}px`);
  expect(
    overlay()!
      .querySelector<HTMLElement>(".ws-goal-background")!
      .style.getPropertyValue("--ws-plate-fade-scale"),
  ).toBe("1");

  scroller.scrollTop = 450;
  scroller.dispatchEvent(new Event("scroll"));
  await waitFor(() =>
    expect(root()!.getAttribute("data-collapsed")).toBe("true"),
  );
  const finalY = 14 * (0.3 - 0.85);
  const finalTransform = title().style.transform.match(
    /translateY\(([-\d.]+)px\) scale\(([-\d.]+)\)/,
  )!;
  expect(Number(finalTransform[1])).toBeCloseTo(finalY);
  expect(Number(finalTransform[2])).toBeCloseTo(pinnedTitleScale(1));
  expect(groups().map((group) => Number(group.style.opacity))).toEqual([1, 0]);
  const compactHeight = pinnedHeight(14, null);
  expect(plate().style.transform).toBe(
    `scaleY(${compactHeight / expandedHeight})`,
  );
  expect(scroller.style.scrollPaddingTop).toBe(`${compactHeight}px`);
  slot.lifecycle.unmount();
});

it.each(["fade", "scroll"] as const)(
  "starts fully compact in %s mode when the timeline is short",
  async (mode) => {
    paneFixture({ recap: false });
    const scroller = document.querySelector<HTMLElement>(
      '[data-test="messages"]',
    )!;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 900, 300),
    );
    const slot = await mountHeading(mode);
    await waitFor(() => {
      const groups = overlay()!.querySelectorAll<HTMLElement>(
        ".ws-goal-overlay__group",
      );
      expect([...groups].map((group) => Number(group.style.opacity))).toEqual([
        1, 0,
      ]);
    });
    expect(root()!.getAttribute("data-collapsed")).toBe("true");
    expect(
      Number(
        overlay()!.querySelector<HTMLElement>(".ws-sticky-goal__plate")!.style
          .opacity,
      ),
    ).toBe(1);
    slot.lifecycle.unmount();
  },
);

it("falls back to the body when the sliding surface is missing", async () => {
  paneFixture({ recap: false });
  document.querySelector("main")!.removeAttribute("data-sidebar");
  const slot = await mountHeading();
  await waitFor(() => expect(overlay()).not.toBeNull());
  expect(overlay()!.parentElement).toBe(document.body);
  slot.lifecycle.unmount();
});

it("does not scan for a scroller after unrelated DOM updates", async () => {
  paneFixture({ recap: false });
  const column = document.querySelector<HTMLElement>('[data-test="column"]')!;
  const stream = document.createElement("p");
  column.append(stream);
  const slot = await mountHeading();
  await waitFor(() => expect(root()).not.toBeNull());
  const composer = document.querySelector<HTMLElement>("[data-app-composer]")!;
  const composerText = document.createElement("div");
  composer.append(composerText);
  const sidebar = document.createElement("aside");
  document.body.append(sidebar);
  const queries = vi.spyOn(document, "querySelectorAll");
  const scans = () =>
    queries.mock.calls.filter(
      ([selector]) => selector === "[data-thread-window] .thread-scrollbar",
    ).length;
  const flush = () =>
    act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await flush();
  queries.mockClear();

  try {
    for (const value of ["H", "He", "Hel"]) {
      composerText.textContent = value;
      await flush();
    }
    const composerScans = scans();
    for (const label of ["One", "Two"]) {
      sidebar.append(document.createTextNode(label));
      await flush();
    }
    const sidebarScans = scans() - composerScans;
    const beforeStreaming = scans();
    for (const chunk of ["Working", " on", " the", " answer"]) {
      stream.append(document.createTextNode(chunk));
      await flush();
    }
    const streamingScans = scans() - beforeStreaming;

    expect({ composerScans, sidebarScans, streamingScans }).toEqual({
      composerScans: 0,
      sidebarScans: 0,
      streamingScans: 0,
    });
  } finally {
    queries.mockRestore();
    slot.lifecycle.unmount();
  }
});

it("coalesces pane replacements before measuring the message scroller", async () => {
  paneFixture({ recap: false });
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const queries = vi.spyOn(document, "querySelectorAll");
  const slot = await mountHeading();
  try {
    expect(root()).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    const scroller = document.querySelector('[data-test="messages"]')!;
    await act(async () => {
      scroller.innerHTML = "<div><div data-scroll-attached>Loading</div></div>";
      await Promise.resolve();
      scroller.innerHTML =
        "<div><div data-scroll-attached data-test='final-column'>Ready</div></div>";
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      queries.mock.calls.filter(
        ([selector]) => selector === "[data-thread-window] .thread-scrollbar",
      ),
    ).toHaveLength(0);
    await act(async () => {
      const callback = frames.get(1)!;
      frames.delete(1);
      callback(16);
    });
    expect(root()?.parentElement?.dataset.test).toBe("final-column");
    expect(
      queries.mock.calls.filter(
        ([selector]) => selector === "[data-thread-window] .thread-scrollbar",
      ),
    ).toHaveLength(1);
  } finally {
    queries.mockRestore();
    slot.lifecycle.unmount();
  }
});

it("cancels pending heading attachment when its overlay unmounts", async () => {
  paneFixture({ recap: false });
  const request = vi.fn(() => 42);
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  const slot = await mountHeading();
  expect(request).toHaveBeenCalledTimes(1);
  expect(root()).toBeNull();
  slot.lifecycle.unmount();
  expect(cancel).toHaveBeenCalledWith(42);
  await act(async () => {
    document.querySelector('[data-test="column"]')!.remove();
    await Promise.resolve();
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(overlay()).toBeNull();
});

it("reattaches after scroller replacement and split-pane changes", async () => {
  paneFixture({ recap: false });
  const slot = await mountHeading();
  await waitFor(() => expect(root()).not.toBeNull());
  const original = document.querySelector<HTMLElement>(
    '[data-test="messages"]',
  )!;
  const replacement = document.createElement("div");
  replacement.className = "thread-scrollbar";
  replacement.dataset.test = "replacement";
  replacement.innerHTML =
    "<div><div data-test='replacement-column' data-scroll-attached></div></div>";
  original.replaceWith(replacement);
  await waitFor(() =>
    expect(root()?.parentElement?.dataset.test).toBe("replacement-column"),
  );

  const secondPane = document.createElement("div");
  secondPane.innerHTML =
    "<div data-thread-window><div class='thread-scrollbar'><div><div data-scroll-attached></div></div></div></div>";
  document.querySelector("main")!.append(secondPane);
  await waitFor(() => expect(root()).toBeNull());
  secondPane.remove();
  await waitFor(() =>
    expect(root()?.parentElement?.dataset.test).toBe("replacement-column"),
  );
  slot.lifecycle.unmount();
});

it.each(["fade", "scroll"] as const)(
  "skips collapsed heading commits and follows reentry in %s mode",
  async (mode) => {
    paneFixture({ recap: false });
    const scroller = document.querySelector<HTMLElement>(
      '[data-test="messages"]',
    )!;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 600 },
    });
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 900, 672),
    );
    const commits = vi.fn();
    const slot = await mountHeading(mode, null, commits);
    try {
      await waitFor(() => expect(overlay()).not.toBeNull());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 550));
      });
      scroller.scrollTop = 350;
      scroller.dispatchEvent(new Event("scroll"));
      await waitFor(() =>
        expect(root()?.getAttribute("data-collapsed")).toBe("true"),
      );
      commits.mockClear();
      for (let step = 0; step < 20; step++) {
        await act(async () => {
          scroller.scrollTop = 340 - step * 5;
          scroller.dispatchEvent(new Event("scroll"));
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
      }
      expect(commits).not.toHaveBeenCalled();
      scroller.scrollTop = 590;
      scroller.dispatchEvent(new Event("scroll"));
      await waitFor(() =>
        expect(root()?.getAttribute("data-collapsed")).toBe("false"),
      );
      expect(commits.mock.calls.length).toBeGreaterThan(0);
      const expanded = overlay()!.querySelector<HTMLElement>(
        '[data-ws-heading="expanded"] .ws-goal-overlay__group',
      )!;
      expect(Number(expanded.style.opacity)).toBeGreaterThan(0);
    } finally {
      slot.lifecycle.unmount();
    }
  },
);
