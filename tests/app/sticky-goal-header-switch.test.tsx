// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StickyGoalHeader } from "../../src/app/StickyGoalHeader.tsx";
import { parsePrefs } from "../../src/domain/prefs.ts";
import { emptyState, sidebarThread } from "./fixtures.ts";

// The SDK harness fixes the slot's context at render time; a thread switch
// needs the selected thread to change under a mounted heading.
const selection = vi.hoisted(() => ({ threadId: null as string | null }));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...actual,
    useBbContext: () => {
      const context = actual.useBbContext();
      return selection.threadId === null
        ? context
        : { ...context, threadId: selection.threadId };
    },
  };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  selection.threadId = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * BB's thread pane during a switch: the title bar persists, and the message
 * column is replaced by an empty one that fills when the transcript renders.
 * The scroller only has scroll range once its column holds a transcript.
 */
function paneFixture(text: string | null) {
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
              <div data-scroll-attached>${text ? `<div>${text}</div>` : ""}</div>
            </div>
          </div>
          <div data-app-composer></div>
        </div>
      </div>
    </main>`;
  const scroller = document.querySelector<HTMLElement>(
    '[data-test="messages"]',
  )!;
  const column = () =>
    scroller.querySelector<HTMLElement>("[data-scroll-attached]")!;
  const clientHeight = 600;
  const scrollHeight = () =>
    column().textContent?.trim() ? 3000 : clientHeight;
  let fromBottom = 0;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, get: scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => Math.max(0, scrollHeight() - clientHeight - fromBottom),
      set: () => {},
    },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 48, 900, 672),
  );
  const replaceColumn = (text = "") => {
    const next = document.createElement("div");
    next.setAttribute("data-scroll-attached", "");
    if (text)
      next.append(
        Object.assign(document.createElement("div"), { textContent: text }),
      );
    column().replaceWith(next);
    return next;
  };
  /** BB's late transcript layout moving the reader off the newest message. */
  const shiftReader = (distance: number) => {
    fromBottom = distance;
    scroller.dispatchEvent(new Event("scroll"));
  };
  return { replaceColumn, shiftReader };
}

function mountHeading() {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return renderSlot(
    { component: StickyGoalHeader },
    {},
    {
      context: { threadId: "t1", projectId: "proj_1" },
      sidebarThreads: {
        sections: [],
        threads: [
          sidebarThread("t1", { title: "Auditing projects" }),
          sidebarThread("t2", { title: "Building suggestions" }),
        ],
      },
      rpc: {
        state: () => emptyState(),
        prefs: () => ({ prefs: parsePrefs({}) }),
      },
    },
  );
}

const header = () => document.querySelector("header")!;
const drawn = (copy: "expanded" | "compact") =>
  document.querySelector<HTMLElement>(
    `[data-ws-heading="${copy}"] .ws-goal-overlay__group`,
  );
const opacity = (copy: "expanded" | "compact") =>
  Number(drawn(copy)?.style.opacity ?? 0);

/** What the title bar and the heading show at each animation frame. */
function recordFrames() {
  const frames: {
    coreTitle: boolean;
    expanded: number;
    compact: number;
    collapsed: boolean;
  }[] = [];
  let frame = requestAnimationFrame(function sample() {
    frames.push({
      coreTitle: !header().hasAttribute("data-ws-hide-title"),
      expanded: opacity("expanded"),
      compact: opacity("compact"),
      collapsed:
        document
          .querySelector("[data-workstreams-sticky-goal]")
          ?.getAttribute("data-collapsed") === "true",
    });
    frame = requestAnimationFrame(sample);
  });
  return { frames, stop: () => cancelAnimationFrame(frame) };
}

it("draws the destination's title once, expanded, across a thread switch", async () => {
  const pane = paneFixture("Earlier transcript");
  const slot = mountHeading();
  await waitFor(() => expect(opacity("expanded")).toBe(1));
  expect(header().hasAttribute("data-ws-hide-title")).toBe(true);

  const recording = recordFrames();
  selection.threadId = "t2";
  slot.lifecycle.rerender(<StickyGoalHeader />);
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  const column = pane.replaceColumn();
  // The empty column outlasts the heading's settling delay, as a slow
  // transcript does.
  for (const wait of [50, 700])
    await act(() => new Promise((resolve) => setTimeout(resolve, wait)));
  expect(drawn("expanded")).toBeNull();
  expect(drawn("compact")).toBeNull();

  await act(async () => {
    column.append(
      Object.assign(document.createElement("div"), {
        textContent: "Destination transcript",
      }),
    );
  });
  await waitFor(() =>
    expect(
      document.querySelector('[data-ws-heading="expanded"] h2')?.textContent,
    ).toBe("Building suggestions"),
  );
  for (const distance of [160, 40, 0]) {
    await act(async () => {
      pane.shiftReader(distance);
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }
  recording.stop();

  expect(recording.frames.some((frame) => frame.coreTitle)).toBe(false);
  expect(recording.frames.some((frame) => frame.compact > 0)).toBe(false);
  expect(recording.frames.some((frame) => frame.collapsed)).toBe(false);
  expect(opacity("expanded")).toBe(1);
  slot.lifecycle.unmount();
  expect(header().hasAttribute("data-ws-hide-title")).toBe(false);
});

it("draws a warm switch's heading in the frame its column attaches", async () => {
  const pane = paneFixture("Earlier transcript");
  const slot = mountHeading();
  await waitFor(() => expect(opacity("expanded")).toBe(1));
  selection.threadId = "t2";
  slot.lifecycle.rerender(<StickyGoalHeader />);
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

  pane.replaceColumn("Destination transcript");
  // Mutation delivery schedules the attachment; a frame callback queued after
  // it runs once the attachment has committed, before that frame paints.
  await Promise.resolve();
  const title = await new Promise<string | null | undefined>((resolve) =>
    requestAnimationFrame(() =>
      resolve(
        document.querySelector('[data-ws-heading="expanded"] h2')?.textContent,
      ),
    ),
  );
  expect(title).toBe("Building suggestions");
  slot.lifecycle.unmount();
});

it("draws a cold switch's heading at its transcript's text inset", async () => {
  const pane = paneFixture("Earlier transcript");
  const slot = mountHeading();
  await waitFor(() => expect(opacity("expanded")).toBe(1));
  selection.threadId = "t2";
  slot.lifecycle.rerender(<StickyGoalHeader />);
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  const column = pane.replaceColumn();
  vi.spyOn(column, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 800, 1000),
  );
  for (const wait of [50, 100])
    await act(() => new Promise((resolve) => setTimeout(resolve, wait)));

  // Watch the overlay for the heading's first draw, since a later frame may
  // correct where it sits.
  const draws: string[] = [];
  const observer = new MutationObserver(() => {
    const transform = document.querySelector<HTMLElement>(
      '[data-ws-heading="expanded"]',
    )?.style.transform;
    if (transform && draws.at(-1) !== transform) draws.push(transform);
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
  });
  const message = document.createElement("div");
  message.dataset.messageColumn = "";
  message.style.padding = "0 24px";
  message.textContent = "Destination transcript";
  vi.spyOn(message, "getBoundingClientRect").mockReturnValue(
    new DOMRect(10, 0, 780, 50),
  );
  await act(async () => {
    column.append(message);
  });
  await waitFor(() => expect(draws.length).toBeGreaterThan(0));
  await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
  observer.disconnect();
  expect(draws[0]).toMatch(/^translate\(34px,/);
  expect(new Set(draws).size).toBe(1);
  slot.lifecycle.unmount();
});

it("draws the heading for a column that stays empty", async () => {
  paneFixture(null);
  const slot = mountHeading();
  await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
  expect(drawn("expanded")).toBeNull();
  expect(header().hasAttribute("data-ws-hide-title")).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(1600));
  await waitFor(() => expect(drawn("compact")).not.toBeNull());
  slot.lifecycle.unmount();
});

it("shows BB's title when the selected thread has no workstreams context", async () => {
  paneFixture("Earlier transcript");
  const slot = mountHeading();
  await waitFor(() => expect(opacity("expanded")).toBe(1));
  selection.threadId = "t-unknown";
  slot.lifecycle.rerender(<StickyGoalHeader />);
  await waitFor(() =>
    expect(header().hasAttribute("data-ws-hide-title")).toBe(false),
  );
  slot.lifecycle.unmount();
});
