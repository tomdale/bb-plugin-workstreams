// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { emptyState, sidebarThread } from "./fixtures.ts";
import {
  headingBackdropOpacity,
  headingOpacity,
  headingScroll,
  titleExitDistance,
} from "../../src/app/goalHeading.ts";
import { parsePrefs } from "../../src/domain/prefs.ts";

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
              <div data-test="sentinel" class="invisible w-px"></div>
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

async function mountHeading(headingTransition: "fade" | "scroll" = "scroll") {
  stubResizeObserver();
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  const heading = app.appOverlays.find(
    (overlay) => overlay.id === "sticky-thread-goal",
  )!;
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
        state: () => emptyState(),
        prefs: () => ({
          prefs: parsePrefs({ threads: { headingTransition } }),
        }),
      },
    },
  );
}

const root = () => document.querySelector("[data-workstreams-sticky-goal]");
const overlay = () => document.querySelector("[data-workstreams-goal-overlay]");

it("attaches to the message scroller although a recap card scrolls its own text", async () => {
  paneFixture({ recap: true });
  const slot = await mountHeading();
  await waitFor(() => expect(root()).not.toBeNull());
  expect(document.querySelector('[data-test="column"]')!.contains(root())).toBe(
    true,
  );
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
    new DOMRect(0, 0, 900, 672),
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
  expect(fadeScale()).toBeGreaterThan(1.5 / 4);
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
  expect(fadeScale()).toBe(1.5 / 4);
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

it("crossfades stationary headings and switches modes on preference changes", async () => {
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
  const transforms = groups().map((group) => group.style.transform);
  expect(transforms[1]).toBe("translateY(0px)");
  scroller.scrollTop = 550;
  scroller.dispatchEvent(new Event("scroll"));
  await waitFor(() =>
    expect(Number(groups()[1]!.style.opacity)).toBeGreaterThan(0),
  );
  expect(groups().map((group) => group.style.transform)).toEqual(transforms);
  const plate = overlay()!.querySelector<HTMLElement>(
    ".ws-sticky-goal__plate",
  )!;
  expect(Number(plate.style.opacity)).toBeCloseTo(
    headingBackdropOpacity(
      headingScroll(50, titleExitDistance(14, null, 1)).progress,
    ),
  );
  expect(Number(plate.style.opacity)).toBeGreaterThan(0.95);
  expect(plate.style.transform).toBe("scaleY(1)");
  await slot.behavior.emitRealtime("prefs", {
    prefs: parsePrefs({ threads: { headingTransition: "scroll" } }),
  });
  await waitFor(() =>
    expect(groups()[0]!.style.transform).not.toBe(transforms[0]),
  );
  expect(groups()[1]!.style.transform).not.toBe(transforms[1]);
  expect(Number(plate.style.opacity)).toBe(1);
  await slot.behavior.emitRealtime("prefs", {
    prefs: parsePrefs({ threads: { headingTransition: "fade" } }),
  });
  await waitFor(() =>
    expect(groups().map((group) => group.style.transform)).toEqual(transforms),
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
        0, 1,
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
