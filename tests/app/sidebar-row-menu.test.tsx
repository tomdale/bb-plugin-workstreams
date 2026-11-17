// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workstreamIndex } from "../../src/domain/workstream-path.ts";
import { sidebarThread } from "./fixtures.ts";
import { mount } from "./sidebar-fixture.tsx";

vi.mock("../../src/domain/workstream-path.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/domain/workstream-path.ts")
    >();
  return { ...actual, workstreamIndex: vi.fn(actual.workstreamIndex) };
});

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

/**
 * A tree whose top group holds workstreams, so it cannot hold a thread itself
 * (see `takesThreads`), beside a top-level workstream that can.
 */
const tree = {
  workstreams: [
    {
      id: "area",
      name: "Area",
      description: "",
      parentId: null,
      aliases: [],
    },
    {
      id: "shipping",
      name: "Shipping",
      description: "",
      parentId: "area",
      aliases: [],
    },
    {
      id: "loose",
      name: "Loose ends",
      description: "",
      parentId: null,
      aliases: [],
    },
  ],
  groups: { sec_a: "shipping", sec_b: "loose" },
};

const threads = () => [
  sidebarThread("parent", { sectionId: "sec_a", title: "Parent task" }),
];

/** Opens a row's Move to submenu and returns its items. */
const workstreamChoices = async (
  slot: Awaited<ReturnType<typeof mount>>,
  title: string,
) => {
  fireEvent.contextMenu(
    within(slot.getByRole("region", { name: "Alpha" }))
      .getByRole("link", { name: title })
      .closest("li")!,
  );
  fireEvent.keyDown(await screen.findByRole("menuitem", { name: "Move to" }), {
    key: "ArrowRight",
  });
  const submenu = await waitFor(() => {
    const menus = screen.getAllByRole("menu");
    expect(menus.length).toBeGreaterThan(1);
    return menus.at(-1)!;
  });
  return within(submenu).getAllByRole("menuitem");
};

describe("the row menu's Move to submenu", () => {
  it("does no workstream indexing while the menu is closed", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showUpNext: false },
      tree,
    });
    await slot.findByRole("link", { name: "Parent task" });
    vi.mocked(workstreamIndex).mockClear();
    expect(workstreamIndex).not.toHaveBeenCalled();
    await workstreamChoices(slot, "Parent task");
    expect(workstreamIndex).toHaveBeenCalledOnce();
    slot.lifecycle.unmount();
  });

  it("offers only workstreams that can hold threads", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showUpNext: false },
      tree,
    });
    const choices = await workstreamChoices(slot, "Parent task");
    expect(choices.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^Automatic/),
      "Area › Shipping",
      "Loose ends",
    ]);
    // The group heads its workstream and holds no threads of its own.
    expect(screen.queryByRole("menuitem", { name: /^Area$/ })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("shows a failed workstream change in the sidebar", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showUpNext: false },
      tree,
      assignmentError: "Topic assignment failed",
    });
    const choices = await workstreamChoices(slot, "Parent task");
    fireEvent.click(choices.find((item) => item.textContent === "Loose ends")!);
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toBe("Topic assignment failed");
    slot.lifecycle.unmount();
  });

  it("moves to a chosen workstream without reporting an error", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showUpNext: false },
      tree,
    });
    const choices = await workstreamChoices(slot, "Parent task");
    fireEvent.click(choices.find((item) => item.textContent === "Loose ends")!);
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.find((c) => c.method === "threadMove")?.input,
      ).toEqual({ threadId: "parent", workstreamId: "loose" }),
    );
    expect(slot.queryByRole("alert")).toBeNull();
    slot.lifecycle.unmount();
  });
});
