import { mountWithBands } from "./sidebar-fixture.tsx";
// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sidebarThread } from "./fixtures.ts";
import { hintText } from "./hints.ts";
import { groupRows, mount } from "./sidebar-fixture.tsx";
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("focused workstreams", () => {
  const regions = (slot: Awaited<ReturnType<typeof mount>>) =>
    slot.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
  const asking = (id: string, sectionId: string, at: number) =>
    sidebarThread(id, {
      sectionId,
      title: `Ask ${id}`,
      hasPendingInteraction: true,
      latestAttentionAt: at,
    });

  it("focuses from the header's inline button", async () => {
    const slot = await mount(
      [
        sidebarThread("a1", { sectionId: "sec_a", title: "Alpha task" }),
        sidebarThread("b1", { sectionId: "sec_b", title: "Beta task" }),
      ],
      {
        activeThreadId: null,
        settings: { showRecent: false, showForYou: false },
      },
    );
    await waitFor(() => expect(regions(slot)).toEqual(["Alpha", "Beta"]));
    fireEvent.click(slot.getByRole("button", { name: "Focus on Beta" }));
    await waitFor(() => expect(regions(slot)).toEqual(["Beta"]));
    const off = slot.getByRole("button", { name: "Stop focusing on Beta" });
    expect(off.getAttribute("aria-pressed")).toBe("true");
    // The click stays on the button: the group doesn't collapse.
    expect(groupRows(slot, "Beta")).toEqual(["Beta task"]);
    fireEvent.click(off);
    await waitFor(() => expect(regions(slot)).toEqual(["Alpha", "Beta"]));
    expect(slot.queryByRole("button", { name: "Focus on Unfiled" })).toBeNull();
    const focus = slot.getByRole("button", { name: "Focus on Alpha" });
    const newWork = slot.getByRole("button", { name: "New work in Alpha" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    expect(await hintText(focus)).toBe("Focus");
    expect(await hintText(newWork)).toBe("New work in Alpha");
    slot.lifecycle.unmount();
  });

  it("names both the focused-workstream action and indicator in hints", async () => {
    const slot = await mountWithBands(
      [
        sidebarThread("z1", {
          sectionId: "sec_z",
          title: "Ask z1",
          hasPendingInteraction: true,
        }),
      ],
      {
        activeThreadId: null,
        order: { workstreams: [], threads: {}, prioritized: ["sec_z"] },
      },
    );
    const action = await slot.findByRole("button", {
      name: "Stop focusing on Zeta",
    });
    const indicator = slot.getByRole("img", {
      name: "Showing focused workstreams",
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    expect(await hintText(action)).toBe("Stop focusing");
    expect(await hintText(indicator)).toBe("Showing focused workstreams");
    slot.lifecycle.unmount();
  });

  it("shows only focused workstreams' threads in Up Next while one is blocked on you", async () => {
    const recaps = {
      recap: {
        id: "read-recap",
        turnId: "turn",
        at: 50,
        state: "complete",
        goal: "Finished",
        latest: ["Ready"],
        review: [],
        links: [],
      },
    };
    const slot = await mountWithBands(
      [
        asking("a1", "sec_a", 300),
        asking("b1", "sec_b", 200),
        sidebarThread("loose", { title: "Unfiled quiet" }),
        asking("z1", "sec_z", 100),
        sidebarThread("z2", {
          sectionId: "sec_z",
          title: "Zeta quiet",
          latestAttentionAt: 400,
        }),
        sidebarThread("recap", { title: "Read recap", latestAttentionAt: 50 }),
      ],
      {
        activeThreadId: null,
        order: { workstreams: [], threads: {}, prioritized: ["sec_z"] },
        recaps,
      },
    );
    // The rules then apply to the focused workstream's threads alone.
    await waitFor(() =>
      expect(groupRows(slot, "Up Next")).toEqual([
        "Ask z1, Needs you",
        "Zeta quiet",
      ]),
    );
    const band = slot.getByRole("region", { name: "Up Next" });
    expect(
      within(band).getByRole("img", { name: "Showing focused workstreams" }),
    ).toBeTruthy();
    // The toggle and revealed groups use the same attention treatment for
    // threads blocked on you.
    const toggle = slot.getByRole("button", {
      name: "Show other workstreams, 2 waiting on you, 4 threads",
    });
    const count = toggle.querySelector(".ws-needs-you-pill");
    expect(count?.textContent).toBe("2");
    expect(count?.nextElementSibling?.textContent).toBe("4");
    expect(count?.nextElementSibling?.className).not.toContain(
      "ws-needs-you-pill",
    );
    fireEvent.click(toggle);
    expect(slot.getByRole("region", { name: "Alpha" })).toBeTruthy();
    expect(slot.getByRole("region", { name: "Beta" })).toBeTruthy();
    expect(slot.getByRole("region", { name: "Unfiled" })).toBeTruthy();
    expect(
      slot.getByRole("button", { name: "Hide other workstreams" }),
    ).toBeTruthy();
    const alpha = within(slot.getByRole("region", { name: "Alpha" }));
    expect(
      alpha
        .getByRole("button", { name: "Expand Alpha" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    const waiting = alpha.getByTitle("1 waiting on you");
    expect(waiting.className).toContain("ws-needs-you-pill");
    const total = waiting.nextElementSibling;
    expect(total?.textContent).toBe("1");
    expect(total?.className).not.toContain("ws-needs-you-pill");

    // With nothing in a focused workstream blocked on you, Up Next shows
    // every workstream.
    slot.lifecycle.unmount();
    const unfocused = await mountWithBands(
      [
        asking("a1", "sec_a", 300),
        asking("b1", "sec_b", 200),
        sidebarThread("z2", {
          sectionId: "sec_z",
          title: "Zeta quiet",
          latestAttentionAt: 400,
        }),
        sidebarThread("recap", { title: "Read recap", latestAttentionAt: 50 }),
      ],
      {
        activeThreadId: null,
        order: { workstreams: [], threads: {}, prioritized: ["sec_z"] },
        recaps,
      },
    );
    await waitFor(() =>
      expect(groupRows(unfocused, "Up Next")).toEqual([
        "Ask a1, Needs you",
        "Ask b1, Needs you",
        "Zeta quiet",
        "Read recap",
      ]),
    );
    expect(
      within(unfocused.getByRole("region", { name: "Up Next" })).queryByRole(
        "img",
        { name: "Showing focused workstreams" },
      ),
    ).toBeNull();
    expect(
      unfocused.getByRole("button", {
        name: "Show other workstreams, 2 waiting on you, 3 threads",
      }),
    ).toBeTruthy();
    unfocused.lifecycle.unmount();
  });

  it("wires count preferences to the collapsed toggle and hides counts when expanded", async () => {
    const settings = { waitingCount: "never", threadCount: "always" };
    const name = "Show other workstreams, 2 threads";
    const slot = await mount(
      [
        asking("a1", "sec_a", 100),
        sidebarThread("a2", { sectionId: "sec_a" }),
        sidebarThread("z1", { sectionId: "sec_z" }),
      ],
      {
        activeThreadId: null,
        settings,
        order: { workstreams: [], threads: {}, prioritized: ["sec_z"] },
      },
    );
    const toggle = await slot.findByRole("button", { name });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    const hide = slot.getByRole("button", { name: "Hide other workstreams" });
    expect(hide.querySelector(".ws-needs-you-pill")).toBeNull();
    expect(hide.textContent).toBe("Hide other workstreams");
    slot.lifecycle.unmount();
  });

  it("hides other workstreams until revealed, then shows them collapsed", async () => {
    const slot = await mount(
      [
        sidebarThread("a1", { sectionId: "sec_a", title: "Alpha task" }),
        sidebarThread("z1", { sectionId: "sec_z", title: "Zeta task" }),
        sidebarThread("loose", { title: "Loose task" }),
      ],
      {
        activeThreadId: null,
        settings: { showRecent: false, showForYou: false },
        order: { workstreams: [], threads: {}, prioritized: ["sec_z"] },
      },
    );
    await waitFor(() => expect(regions(slot)).toEqual(["Zeta"]));
    expect(groupRows(slot, "Zeta")).toEqual(["Zeta task"]);
    const show = slot.getByRole("button", {
      name: "Show other workstreams, 2 threads",
    });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(show);
    expect(regions(slot)).toEqual(["Zeta", "Alpha", "Unfiled"]);
    const alpha = slot.getByRole("region", { name: "Alpha" });
    expect(within(alpha).queryAllByRole("link")).toHaveLength(0);
    fireEvent.click(
      within(alpha).getByRole("button", { name: "Expand Alpha" }),
    );
    expect(groupRows(slot, "Alpha")).toEqual(["Alpha task"]);

    // Hiding and revealing again starts every one collapsed.
    fireEvent.click(
      slot.getByRole("button", { name: "Hide other workstreams" }),
    );
    expect(regions(slot)).toEqual(["Zeta"]);
    fireEvent.click(
      slot.getByRole("button", { name: "Show other workstreams, 2 threads" }),
    );
    expect(
      within(slot.getByRole("region", { name: "Alpha" })).queryAllByRole(
        "link",
      ),
    ).toHaveLength(0);

    // Without focus, every workstream shows with its own collapse state.
    fireEvent.click(
      slot.getByRole("button", { name: "Stop focusing on Zeta" }),
    );
    await waitFor(() =>
      expect(regions(slot)).toEqual(["Alpha", "Zeta", "Unfiled"]),
    );
    expect(groupRows(slot, "Alpha")).toEqual(["Alpha task"]);
    expect(
      slot.queryByRole("button", { name: /other workstreams/ }),
    ).toBeNull();
    slot.lifecycle.unmount();
  });

  it("holds the open thread's row in place when focus arrives", async () => {
    const threads = [
      asking("a1", "sec_a", 100),
      sidebarThread("z1", {
        sectionId: "sec_z",
        title: "Zeta task",
        latestAttentionAt: 50,
      }),
    ];
    const slot = await mountWithBands(threads, {
      activeThreadId: "a1",
      order: { workstreams: [], threads: {}, prioritized: ["sec_z"] },
    });
    await waitFor(() =>
      expect(groupRows(slot, "Up Next")).toEqual([
        "Ask a1, Needs you",
        "Zeta task",
      ]),
    );
    threads[1] = asking("z1", "sec_z", 200);
    slot.selectThread("a1");
    await waitFor(() =>
      expect(groupRows(slot, "Up Next")).toEqual([
        "Ask a1, Needs you",
        "Ask z1, Needs you",
      ]),
    );
    // Group counts include the held row, irrespective of its Up Next position.
    expect(
      slot.getByRole("button", {
        name: "Show other workstreams, 1 waiting on you, 1 thread",
      }),
    ).toBeTruthy();
    slot.selectThread("z1");
    await waitFor(() =>
      expect(groupRows(slot, "Up Next")).toEqual(["Ask z1, Needs you"]),
    );
    expect(
      slot.getByRole("button", {
        name: "Show other workstreams, 1 waiting on you, 1 thread",
      }),
    ).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("removes a leaving row and fades its replacement without animating layout", async () => {
    // jsdom has no Web Animations; motion runs only where they exist.
    const animations = new Map<HTMLElement, Keyframe[]>();
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: function (this: HTMLElement, frames: Keyframe[]) {
        animations.set(this, frames);
        return { cancel() {} };
      },
    });
    try {
      const threads = [asking("a1", "sec_a", 100)];
      const slot = await mountWithBands(threads, {
        activeThreadId: null,
        order: { workstreams: [], threads: {}, prioritized: ["sec_z"] },
      });
      await waitFor(() =>
        expect(groupRows(slot, "Up Next")).toEqual(["Ask a1, Needs you"]),
      );
      threads.push(asking("z1", "sec_z", 200));
      slot.selectThread(null);
      await waitFor(() =>
        expect(groupRows(slot, "Up Next")).toEqual(["Ask z1, Needs you"]),
      );
      const band = slot.getByRole("region", { name: "Up Next" });
      expect(band.textContent).toContain("Ask z1");
      expect(band.textContent).not.toContain("Ask a1");
      expect(band.querySelector("[data-presence]")).toBeNull();
      const entering = band.querySelector<HTMLElement>(
        '[data-flip-row="needs-you:z1"]',
      )!;
      expect(entering.style.zIndex).toBe("3");
      expect(
        entering.firstElementChild &&
          animations.get(entering.firstElementChild as HTMLElement),
      ).toEqual([{ opacity: 0 }, { opacity: 1 }]);
      slot.lifecycle.unmount();
    } finally {
      delete (Element.prototype as { animate?: unknown }).animate;
    }
  });
});
