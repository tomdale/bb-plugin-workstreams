// @vitest-environment jsdom
// jsdom has no Web Animations, so the sidebar changes instantly there. These
// tests lend it the one thing `canAnimate` looks for, then step the timers a
// fold uses, to check that closing contents stay mounted while they close and
// that opening contents re-enter.
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENTER_MS } from "../../src/app/sidebar/motion.ts";
import { sidebarThread } from "./fixtures.ts";
import { mount } from "./sidebar-fixture.tsx";

const threads = () => [
  sidebarThread("a1", { sectionId: "sec_a", title: "Alpha task" }),
  sidebarThread("b1", { sectionId: "sec_b", title: "Beta task" }),
];

/** The workstream's contents, which a closed fold unmounts. */
const contents = (slot: Awaited<ReturnType<typeof mount>>, name: string) =>
  slot.getByRole("region", { name }).querySelector(".ws-fold");

beforeEach(() => {
  window.localStorage.clear();
  // `canAnimate` asks only whether Web Animations exist; the CSS keyframes do
  // the moving, so a stub is enough to turn motion on.
  Element.prototype.animate ??= () => ({}) as Animation;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Mounts with real timers, then steps time, so a phase ends when it should. */
const stepTime = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe("workstream fold motion", () => {
  it("keeps a closing group's rows mounted while it closes", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
    });
    const alpha = within(await slot.findByRole("region", { name: "Alpha" }));
    const collapse = alpha.getByRole("button", { name: "Collapse Alpha" });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(collapse);

    const closing = contents(slot, "Alpha");
    expect(closing?.getAttribute("data-presence")).toBe("leave");
    expect(closing?.getAttribute("aria-hidden")).toBe("true");
    expect(closing?.hasAttribute("inert")).toBe(true);

    await stepTime(ENTER_MS);

    expect(contents(slot, "Alpha")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("enters a group's rows when it opens", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
    });
    const alpha = within(await slot.findByRole("region", { name: "Alpha" }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(alpha.getByRole("button", { name: "Collapse Alpha" }));
    await stepTime(ENTER_MS);

    fireEvent.click(alpha.getByRole("button", { name: "Expand Alpha" }));

    const opening = contents(slot, "Alpha");
    expect(opening?.getAttribute("data-presence")).toBe("enter");
    expect(opening?.getAttribute("aria-hidden")).toBeNull();

    await stepTime(ENTER_MS);

    expect(contents(slot, "Alpha")?.hasAttribute("data-presence")).toBe(false);
    slot.lifecycle.unmount();
  });

  it("starts closed groups unmounted, with nothing to animate", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
    });
    await slot.findByRole("region", { name: "Alpha" });
    // Every group starts open here, so a mounted fold is idle rather than
    // entering: opening the list is not a change the user made.
    expect(contents(slot, "Beta")?.hasAttribute("data-presence")).toBe(false);
    slot.lifecycle.unmount();
  });
});
