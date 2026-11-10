import { mountWithBands } from "./sidebar-fixture.tsx";
// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { section, sidebarThread } from "./fixtures.ts";
import {
  groupRows,
  mount,
  snoozeSettings,
  thirtyMinutes,
  threeHours,
  untilUpdate,
} from "./sidebar-fixture.tsx";
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("snoozing", () => {
  const later = () => Date.now() + 3_600_000;
  const threads = () => [
    sidebarThread("ask", {
      sectionId: "sec_a",
      title: "Asking task",
      hasPendingInteraction: true,
      indicator: "waiting-for-input",
    }),
    sidebarThread("nap", { sectionId: "sec_a", title: "Napping task" }),
    sidebarThread("other", { sectionId: "sec_b", title: "Other task" }),
  ];

  it("moves snoozed threads into a collapsed Snoozed fold", async () => {
    const slot = await mountWithBands(
      [
        ...threads(),
        sidebarThread("nap-child", {
          parentThreadId: "nap",
          sectionId: "sec_a",
          title: "Nap child task",
        }),
      ],
      {
        sections: [section("sec_a", "Alpha"), section("sec_b", "Beta")],
        snoozes: {
          ask: { until: later(), attentionAt: 0, at: 0 },
          nap: { until: null, attentionAt: Date.now() + 1, at: 0 },
        },
      },
    );
    await waitFor(() =>
      expect(slot.getByRole("button", { name: /^Snoozed\d*$/ })).toBeTruthy(),
    );
    expect(groupRows(slot, "Up Next")).toEqual(["Other task"]);
    expect(slot.queryByRole("region", { name: "Recent" })).toBeNull();
    // Nothing visible is left in it, so its header goes with them.
    expect(slot.queryByRole("region", { name: "Alpha" })).toBeNull();
    const fold = slot.getByRole("button", { name: /^Snoozed\d*$/ });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fold);
    expect(groupRows(slot, "Snoozed")).toEqual([
      "Asking task, Needs you",
      "Napping task",
      "Nap child task",
    ]);
    const napRow = within(slot.getByRole("region", { name: "Snoozed" }))
      .getByRole("link", { name: "Napping task" })
      .closest("li")!;
    fireEvent.click(
      within(napRow).getByRole("button", { name: "Hide child threads" }),
    );
    expect(groupRows(slot, "Snoozed")).toEqual([
      "Asking task, Needs you",
      "Napping task",
    ]);
    fireEvent.click(
      within(napRow).getByRole("button", { name: "Show child threads" }),
    );
    expect(groupRows(slot, "Snoozed")).toEqual([
      "Asking task, Needs you",
      "Napping task",
      "Nap child task",
    ]);
    expect(
      within(slot.getByRole("region", { name: "Snoozed" })).getByText(
        "On update",
      ),
    ).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("hides snoozed threads without resurfacing them in other groups", async () => {
    const slot = await mountWithBands(threads(), {
      settings: { showSnoozed: false },
      sections: [section("sec_a", "Alpha"), section("sec_b", "Beta")],
      snoozes: { nap: { until: later(), attentionAt: 0, at: 0 } },
    });
    await waitFor(() =>
      expect(groupRows(slot, "Alpha")).toEqual(["Asking task, Needs you"]),
    );
    expect(slot.queryByRole("button", { name: /^Snoozed\d*$/ })).toBeNull();
    expect(slot.queryAllByRole("link", { name: "Napping task" })).toHaveLength(
      0,
    );
    expect(groupRows(slot, "Up Next")).toEqual([
      "Asking task, Needs you",
      "Other task",
    ]);
    expect(groupRows(slot, "Alpha")).toEqual(["Asking task, Needs you"]);
    slot.lifecycle.unmount();
  });

  it("snoozes with the default choice from the row's hover button", async () => {
    const slot = await mount(threads().slice(0, 2), {
      settings: { showRecent: false },
      sections: [section("sec_a", "Alpha")],
      snoozePrefs: snoozeSettings(threeHours, untilUpdate),
    });
    const alpha = await waitFor(() =>
      slot.getByRole("region", { name: "Alpha" }),
    );
    const before = Date.now();
    fireEvent.click(
      within(alpha).getAllByRole("button", {
        name: /^Snooze until (?:tomorrow, )?\d/,
      })[0]!,
    );
    await waitFor(() =>
      expect(groupRows(slot, "Alpha")).toEqual(["Napping task"]),
    );
    const call = slot.inspection.rpcCalls.find((c) => c.method === "snooze")!;
    const input = call.input as { threadIds: string[]; until: number };
    expect(input.threadIds).toEqual(["ask"]);
    expect(input.until - before).toBeGreaterThanOrEqual(3 * 3_600_000);
    expect(input.until - before).toBeLessThan(3 * 3_600_000 + 5_000);
    slot.lifecycle.unmount();
  });

  it("wakes a thread from the Snoozed fold", async () => {
    const slot = await mount(threads().slice(0, 2), {
      settings: { showRecent: false },
      sections: [section("sec_a", "Alpha")],
      snoozes: { nap: { until: later(), attentionAt: 0, at: 0 } },
    });
    fireEvent.click(
      await waitFor(() => slot.getByRole("button", { name: /^Snoozed\d*$/ })),
    );
    fireEvent.click(
      within(slot.getByRole("region", { name: "Snoozed" })).getByRole(
        "button",
        { name: /^Wake now/ },
      ),
    );
    await waitFor(() =>
      expect(groupRows(slot, "Alpha")).toEqual([
        "Asking task, Needs you",
        "Napping task",
      ]),
    );
    expect(
      slot.inspection.rpcCalls.some(
        (call) =>
          call.method === "unsnooze" &&
          (call.input as { threadIds: string[] }).threadIds.includes("nap"),
      ),
    ).toBe(true);
    slot.lifecycle.unmount();
  });
});

describe("snoozing a workstream row", () => {
  const threads = () => [
    sidebarThread("ask", { sectionId: "sec_a", title: "Asking task" }),
    sidebarThread("nap", { sectionId: "sec_a", title: "Napping task" }),
    sidebarThread("nap-child", {
      parentThreadId: "nap",
      title: "Nap child task",
    }),
    sidebarThread("other", { sectionId: "sec_b", title: "Other task" }),
  ];
  const snoozeCalls = (slot: Awaited<ReturnType<typeof mount>>) =>
    slot.inspection.rpcCalls
      .filter((call) => call.method === "snooze")
      .map((call) => call.input as { threadIds: string[]; until: number });

  it("snoozes every thread the row lists with the default choice", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
      sections: [section("sec_a", "Alpha"), section("sec_b", "Beta")],
      snoozePrefs: snoozeSettings(threeHours, untilUpdate),
    });
    const alpha = await waitFor(() =>
      slot.getByRole("region", { name: "Alpha" }),
    );
    // A folded parent's child still counts: it leaves with its parent.
    fireEvent.click(
      within(alpha).getByRole("button", { name: "Hide child threads" }),
    );
    expect(groupRows(slot, "Alpha")).toEqual(["Asking task", "Napping task"]);
    const before = Date.now();
    fireEvent.click(
      within(alpha).getByRole("button", {
        name: /^Snooze 3 threads in Alpha until (?:tomorrow, )?\d/,
      }),
    );
    await waitFor(() =>
      expect(slot.queryByRole("region", { name: "Alpha" })).toBeNull(),
    );
    const [call, ...rest] = snoozeCalls(slot);
    expect(rest).toEqual([]);
    // Roots only; each takes its children along and wakes with them.
    expect([...call!.threadIds].sort()).toEqual(["ask", "nap"]);
    expect(call!.until - before).toBeGreaterThanOrEqual(3 * 3_600_000);
    expect(call!.until - before).toBeLessThan(3 * 3_600_000 + 5_000);
    expect(groupRows(slot, "Beta")).toEqual(["Other task"]);
    expect(
      slot.getByRole("button", { name: /^Snoozed\d*$/ }).textContent,
    ).toContain("2");
    slot.lifecycle.unmount();
  });

  it("offers the presets under a heading naming the batch", async () => {
    const slot = await mount(threads().slice(0, 3), {
      settings: { showRecent: false, showForYou: false },
      sections: [section("sec_a", "Alpha")],
      snoozePrefs: snoozeSettings(thirtyMinutes, untilUpdate),
    });
    const alpha = await waitFor(() =>
      slot.getByRole("region", { name: "Alpha" }),
    );
    const button = within(alpha).getByRole("button", {
      name: /^Snooze 3 threads in Alpha/,
    });
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    const menu = await screen.findByRole("menu", {}, { timeout: 2000 });
    expect(within(menu).getByText("Snooze 3 threads")).toBeTruthy();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringMatching(/^30 minutes\(default\)/),
      "Until there's an update",
      "Custom…",
    ]);
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Until there's an update" }),
    );
    await waitFor(() => expect(snoozeCalls(slot)).toHaveLength(1));
    expect(snoozeCalls(slot)[0]).toMatchObject({ until: null });
    expect([...snoozeCalls(slot)[0]!.threadIds].sort()).toEqual(["ask", "nap"]);
    slot.lifecycle.unmount();
  });

  it("snoozes Unfiled, and draws no header for a workstream with no threads", async () => {
    const slot = await mount(
      [
        sidebarThread("ask", { sectionId: "sec_a", title: "Asking task" }),
        sidebarThread("other", { sectionId: "sec_b", title: "Other task" }),
        sidebarThread("loose", { title: "Loose task" }),
      ],
      {
        settings: { showRecent: false, showForYou: false },
        sections: [
          section("sec_a", "Alpha"),
          section("sec_b", "Beta"),
          section("sec_z", "Zeta"),
        ],
      },
    );
    await waitFor(() =>
      expect(slot.getByRole("region", { name: "Alpha" })).toBeTruthy(),
    );
    expect(slot.queryByRole("region", { name: "Zeta" })).toBeNull();
    fireEvent.click(
      within(slot.getByRole("region", { name: "Unfiled" })).getByRole(
        "button",
        { name: /^Snooze 1 thread in Unfiled until/ },
      ),
    );
    await waitFor(() =>
      expect(snoozeCalls(slot)).toEqual([
        expect.objectContaining({ threadIds: ["loose"] }),
      ]),
    );
    await waitFor(() =>
      expect(slot.queryByRole("region", { name: "Unfiled" })).toBeNull(),
    );
    slot.lifecycle.unmount();
  });

  /** Opens a header's right-click menu, as a long press does on touch. */
  const headerMenu = async (
    slot: Awaited<ReturnType<typeof mount>>,
    name: string,
  ) => {
    const region = await waitFor(() => slot.getByRole("region", { name }));
    fireEvent.contextMenu(region.querySelector(".group\\/row")!);
    return screen.findByRole("menu", { name: "Workstream actions" });
  };
  const items = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);

  it("offers a header's hover actions in its right-click menu, in their order", async () => {
    const slot = await mount(threads().slice(0, 3), {
      settings: { showRecent: false, showForYou: false },
      sections: [section("sec_a", "Alpha")],
      snoozePrefs: snoozeSettings(threeHours, untilUpdate),
    });
    expect(items(await headerMenu(slot, "Alpha"))).toEqual([
      "Focus",
      "New work",
      "Snooze 3 threads",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Focus" }));
    await waitFor(() =>
      expect(
        slot.getByRole("button", { name: "Stop focusing on Alpha" }),
      ).toBeTruthy(),
    );
    expect(items(await headerMenu(slot, "Alpha"))[0]).toBe("Stop focusing");
    fireEvent.click(screen.getByRole("menuitem", { name: "New work" }));
    expect(slot.inspection.navigateCalls.at(-1)).toEqual({
      method: "toCompose",
      options: { focusPrompt: true },
    });
    slot.lifecycle.unmount();
  });

  it("snoozes a header's threads from its right-click Snooze menu", async () => {
    const slot = await mount(threads().slice(0, 3), {
      settings: { showRecent: false, showForYou: false },
      sections: [section("sec_a", "Alpha")],
      snoozePrefs: snoozeSettings(threeHours, untilUpdate),
    });
    await headerMenu(slot, "Alpha");
    fireEvent.keyDown(
      screen.getByRole("menuitem", { name: "Snooze 3 threads" }),
      { key: "ArrowRight" },
    );
    const submenu = await waitFor(() => {
      const menus = screen.getAllByRole("menu");
      expect(menus.length).toBeGreaterThan(1);
      return menus.at(-1)!;
    });
    expect(items(submenu)).toEqual([
      expect.stringMatching(/^3 hours\(default\)/),
      expect.stringMatching(/^Until there's an update/),
      "Custom…",
    ]);
    fireEvent.click(
      within(submenu).getByRole("menuitem", {
        name: /^Until there's an update/,
      }),
    );
    await waitFor(() => expect(snoozeCalls(slot)).toHaveLength(1));
    expect(snoozeCalls(slot)[0]).toMatchObject({ until: null });
    expect([...snoozeCalls(slot)[0]!.threadIds].sort()).toEqual(["ask", "nap"]);
    slot.lifecycle.unmount();
  });

  it("offers only Snooze on Unfiled's header", async () => {
    const slot = await mount(
      [
        sidebarThread("ask", { sectionId: "sec_a", title: "Asking task" }),
        sidebarThread("loose", { title: "Loose task" }),
      ],
      {
        settings: { showRecent: false, showForYou: false },
        sections: [section("sec_a", "Alpha")],
      },
    );
    expect(items(await headerMenu(slot, "Unfiled"))).toEqual([
      "Snooze 1 thread",
    ]);
    slot.lifecycle.unmount();
  });
});

it("keeps a snoozed child moving with its parent", async () => {
  const slot = await mount(
    [
      sidebarThread("root", { sectionId: "sec_a", title: "Root task" }),
      sidebarThread("kid", { parentThreadId: "root", title: "Kid task" }),
    ],
    {
      settings: { showRecent: false },
      sections: [section("sec_a", "Alpha")],
      snoozes: { kid: { until: Date.now() + 60_000, attentionAt: 0, at: 0 } },
    },
  );
  fireEvent.click(
    await waitFor(() => slot.getByRole("button", { name: /^Snoozed\d*$/ })),
  );
  expect(groupRows(slot, "Alpha")).toEqual(["Root task"]);
  fireEvent.contextMenu(
    within(slot.getByRole("region", { name: "Snoozed" })).getByRole("link", {
      name: "Kid task",
    }),
  );
  expect(screen.getByText("Wake now")).toBeTruthy();
  slot.lifecycle.unmount();
});

it("marks the row menu's submenus with a chevron", async () => {
  const slot = await mount(
    [sidebarThread("root", { sectionId: "sec_a", title: "Root task" })],
    {
      settings: { showRecent: false },
      sections: [section("sec_a", "Alpha")],
    },
  );
  fireEvent.contextMenu(
    within(slot.getByRole("region", { name: "Alpha" })).getByRole("link", {
      name: "Root task",
    }),
  );
  for (const name of ["Topic", "Snooze"]) {
    const item = await screen.findByRole("menuitem", { name });
    expect(item.getAttribute("aria-haspopup")).toBe("menu");
    expect(item.querySelector('[data-icon="ChevronRight"]')).not.toBeNull();
  }
  expect(
    screen
      .getByRole("menuitem", { name: "Rename…" })
      .querySelector('[data-icon="ChevronRight"]'),
  ).toBeNull();
  slot.lifecycle.unmount();
});
