import { mountWithBands } from "./sidebar-fixture.tsx";
// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sidebarThread } from "./fixtures.ts";
import { hintText } from "./hints.ts";
import {
  mount,
  snoozeSettings,
  thirtyMinutes,
  threeHours,
  weekend,
} from "./sidebar-fixture.tsx";
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("row hover buttons", () => {
  const rowOf = async (slot: Awaited<ReturnType<typeof mount>>) =>
    (
      await waitFor(() =>
        within(slot.getByRole("region", { name: "Alpha" })).getByRole("link", {
          name: "Root task",
        }),
      )
    ).parentElement!;

  const snoozeButton = (row: HTMLElement) =>
    within(row).getByRole("button", { name: /^Snooze until/ });

  it("cancels a passing hover, then opens presets without moving focus and closes after leaving", async () => {
    const slot = await mount(undefined, {
      settings: { showRecent: false },
      snoozePrefs: snoozeSettings(thirtyMinutes, weekend),
    });
    const composer = document.createElement("textarea");
    document.body.append(composer);
    composer.focus();
    try {
      const button = snoozeButton(await rowOf(slot));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      fireEvent.pointerEnter(button, { pointerType: "mouse" });
      fireEvent.pointerLeave(button, { pointerType: "mouse" });
      await act(async () => vi.advanceTimersByTimeAsync(500));
      expect(screen.queryByRole("menu")).toBeNull();
      fireEvent.pointerEnter(button, { pointerType: "mouse" });
      await act(async () => vi.advanceTimersByTimeAsync(349));
      expect(screen.queryByRole("menu")).toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(1));
      const menu = screen.getByRole("menu");
      expect(document.activeElement).toBe(composer);
      expect(button.getAttribute("data-state")).toBe("open");
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual([
        expect.stringMatching(/^30 minutes/),
        expect.stringMatching(/^This weekend/),
        "Custom…",
      ]);
      fireEvent.pointerLeave(button, { pointerType: "mouse" });
      fireEvent.pointerEnter(menu, { pointerType: "mouse" });
      await act(async () => vi.advanceTimersByTimeAsync(300));
      expect(screen.queryByRole("menu")).not.toBeNull();
      fireEvent.pointerLeave(menu, { pointerType: "mouse" });
      await act(async () => vi.advanceTimersByTimeAsync(199));
      expect(screen.queryByRole("menu")).not.toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(screen.queryByRole("menu")).toBeNull();
      fireEvent.pointerEnter(button, { pointerType: "mouse" });
      await act(async () => vi.advanceTimersByTimeAsync(350));
      fireEvent.click(
        within(screen.getByRole("menu")).getByRole("menuitem", {
          name: /^30 minutes/,
        }),
      );
      await act(async () => vi.advanceTimersByTimeAsync(300));
      expect(screen.queryByRole("menu")).toBeNull();
      expect(
        slot.inspection.rpcCalls.find((call) => call.method === "snooze")
          ?.input,
      ).toMatchObject({ threadIds: ["root"] });
    } finally {
      composer.remove();
      slot.lifecycle.unmount();
    }
  });

  it("snoozes on click, and opens the menu from the keyboard with ArrowDown", async () => {
    const slot = await mount(undefined, { settings: { showRecent: false } });
    const button = snoozeButton(await rowOf(slot));
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    const [first, second] = within(menu).getAllByRole("menuitem");
    await waitFor(() => expect(document.activeElement).toBe(first));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(slot.inspection.rpcCalls.some((c) => c.method === "snooze")).toBe(
        true,
      ),
    );
    slot.lifecycle.unmount();
  });

  it("opens the Custom… dialog from the hover menu and snoozes until there's an update", async () => {
    const slot = await mount(undefined, {
      settings: { showRecent: false },
      snoozePrefs: snoozeSettings(thirtyMinutes),
    });
    const button = snoozeButton(await rowOf(slot));
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    const custom = within(menu).getByRole("menuitem", { name: "Custom…" });
    // Arrow keys move among the menu's items, ending on Custom….
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(custom);
    fireEvent.click(custom);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("radio", { name: "Until there's an update" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Snooze" }));
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.find((c) => c.method === "snooze")?.input,
      ).toMatchObject({ threadIds: ["root"], until: null }),
    );
    slot.lifecycle.unmount();
  });

  it("offers the presets and Custom… in the right-click Snooze menu", async () => {
    const slot = await mount(undefined, {
      settings: { showRecent: false },
      snoozePrefs: snoozeSettings(threeHours, weekend),
    });
    fireEvent.contextMenu(
      within(slot.getByRole("region", { name: "Alpha" })).getByRole("link", {
        name: "Root task",
      }),
    );
    const trigger = await screen.findByRole("menuitem", { name: "Snooze" });
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    const submenu = await waitFor(() => {
      const menus = screen.getAllByRole("menu");
      expect(menus.length).toBeGreaterThan(1);
      return menus.at(-1)!;
    });
    expect(
      within(submenu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringMatching(/^3 hours\(default\)/),
      expect.stringMatching(/^This weekend/),
      "Custom…",
    ]);
    slot.lifecycle.unmount();
  });

  it("puts the age right after the title and archive and snooze at the end", async () => {
    const slot = await mount(undefined, { settings: { showRecent: false } });
    const row = await rowOf(slot);
    expect(
      within(row)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"))
        .filter((label) => label === "Archive" || /^Snooze/.test(label ?? "")),
    ).toEqual(["Archive", expect.stringMatching(/^Snooze until/)]);
    const age = row.querySelector("[data-timestamp]")!;
    expect(age.textContent).toBe("now");
    expect(age.previousElementSibling!.textContent).toBe("Root task");
    // The hover buttons are the row's last element, as on a header.
    expect(
      row.lastElementChild!.contains(
        within(row).getByRole("button", { name: /^Snooze until/ }),
      ),
    ).toBe(true);
    slot.lifecycle.unmount();
  });

  it.each([false, true])(
    "keeps a populated workstream's Focus after its hover-only actions (focused: %s)",
    async (focused) => {
      const slot = await mount(undefined, {
        settings: { showRecent: false },
        order: {
          workstreams: [],
          threads: {},
          prioritized: focused ? ["sec_a"] : [],
        },
      });
      if (focused)
        await slot.findByRole("button", { name: "Stop focusing on Alpha" });
      const header = (await rowOf(slot))
        .closest("section")!
        .querySelector(".group\\/row")!;
      const actions = within(header as HTMLElement)
        .getAllByRole("button")
        .slice(1);
      expect(
        actions.map((button) => button.getAttribute("aria-label")),
      ).toEqual([
        "New work in Alpha",
        expect.stringMatching(/^Snooze 2 threads in Alpha until/),
        focused ? "Stop focusing on Alpha" : "Focus on Alpha",
      ]);
      expect(actions[2]!.hasAttribute("data-revealed")).toBe(focused);
      slot.lifecycle.unmount();
    },
  );

  it.each([false, true])(
    "keeps an empty workstream's New work after Focus (focused: %s)",
    async (focused) => {
      const slot = await mount([], {
        settings: { showRecent: false, showForYou: false },
        order: {
          workstreams: [],
          threads: {},
          prioritized: focused ? ["sec_z"] : [],
        },
      });
      const section = await slot.findByRole("region", { name: "Zeta" });
      const header = section.querySelector(".group\\/row")!;
      // An empty workstream keeps no fold control, so its actions lead.
      const actions = within(header as HTMLElement).getAllByRole("button");
      expect(
        actions.map((button) => button.getAttribute("aria-label")),
      ).toEqual([
        focused ? "Stop focusing on Zeta" : "Focus on Zeta",
        "New work in Zeta",
      ]);
      expect(actions[1]!.hasAttribute("data-revealed")).toBe(true);
      slot.lifecycle.unmount();
    },
  );

  it("keeps only a focused workstream's Focus and a recent empty one's New work in view", async () => {
    const slot = await mount(undefined, {
      settings: { showRecent: false, showForYou: false },
      lastPopulatedAt: { sec_z: Date.now() },
      order: { workstreams: [], threads: {}, prioritized: ["sec_b"] },
    });
    const revealed = () =>
      [...slot.container.querySelectorAll("button[data-revealed]")].map((b) =>
        b.getAttribute("aria-label"),
      );
    await waitFor(() => expect(revealed()).toEqual(["Stop focusing on Beta"]));
    fireEvent.click(
      slot.getByRole("button", { name: /^Show other workstreams/ }),
    );
    await waitFor(() =>
      expect(revealed()).toEqual(["Stop focusing on Beta", "New work in Zeta"]),
    );
    slot.lifecycle.unmount();
  });

  it("offers New work on a Dormant workstream, as on any other", async () => {
    const long = Date.now() - 60 * 24 * 3_600_000;
    const slot = await mount(
      [
        sidebarThread("old", {
          sectionId: "sec_b",
          title: "Old task",
          latestAttentionAt: long,
        }),
      ],
      { activeThreadId: null, settings: { showRecent: false } },
    );
    fireEvent.click(
      await waitFor(() => slot.getByRole("button", { name: /^Dormant/ })),
    );
    const beta = within(slot.getByRole("region", { name: "Beta" }));
    expect(beta.getByRole("button", { name: "Focus on Beta" })).toBeTruthy();
    expect(beta.getByRole("button", { name: "New work in Beta" })).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("names the view menus and archive action in hints", async () => {
    const slot = await mountWithBands(undefined, {
      settings: { showForYou: false },
    });
    const recent = await slot.findByRole("button", { name: "Recent options" });
    const sort = slot.getByRole("button", { name: "Sort workstreams" });
    const archive = within(await rowOf(slot)).getByRole("button", {
      name: "Archive",
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (const [target, name] of [
      [recent, "Recent options"],
      [sort, "Sort workstreams"],
      [archive, "Archive"],
    ] as const)
      expect(await hintText(target)).toBe(name);
    slot.lifecycle.unmount();
  });
});
