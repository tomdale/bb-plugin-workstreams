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
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, get: scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollHeight() - clientHeight,
      set: () => {},
    },
  });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 48, 900, 672),
  );
  const replaceColumn = () => {
    const next = document.createElement("div");
    next.setAttribute("data-scroll-attached", "");
    column().replaceWith(next);
    return next;
  };
  return { replaceColumn };
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
  const frames: { coreTitle: boolean; expanded: number; compact: number }[] =
    [];
  let frame = requestAnimationFrame(function sample() {
    frames.push({
      coreTitle: !header().hasAttribute("data-ws-hide-title"),
      expanded: opacity("expanded"),
      compact: opacity("compact"),
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
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  expect(drawn("expanded")).toBeNull();
  expect(drawn("compact")).toBeNull();

  await act(async () => {
    column.innerHTML = "<div>Destination transcript</div>";
  });
  await waitFor(() =>
    expect(
      document.querySelector('[data-ws-heading="expanded"] h2')?.textContent,
    ).toBe("Building suggestions"),
  );
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  recording.stop();

  expect(recording.frames.some((frame) => frame.coreTitle)).toBe(false);
  expect(recording.frames.some((frame) => frame.compact > 0)).toBe(false);
  expect(opacity("expanded")).toBe(1);
  slot.lifecycle.unmount();
  expect(header().hasAttribute("data-ws-hide-title")).toBe(false);
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
