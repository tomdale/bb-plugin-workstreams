// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { topicIndex } from "../../src/domain/topic-path.ts";
import { sidebarThread } from "./fixtures.ts";
import { mount } from "./sidebar-fixture.tsx";

vi.mock("../../src/domain/topic-path.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/domain/topic-path.ts")>();
  return { ...actual, topicIndex: vi.fn(actual.topicIndex) };
});

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

/**
 * A topic tree whose root holds subtopics, so it cannot hold a thread itself
 * (see `takesThreads`), beside a root that can.
 */
const catalog = {
  entities: [
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
  sidebarThread("root", { sectionId: "sec_a", title: "Root task" }),
];

/** Opens a row's Topic submenu and returns its items. */
const topicChoices = async (
  slot: Awaited<ReturnType<typeof mount>>,
  title: string,
) => {
  fireEvent.contextMenu(
    within(slot.getByRole("region", { name: "Alpha" }))
      .getByRole("link", { name: title })
      .closest("li")!,
  );
  fireEvent.keyDown(await screen.findByRole("menuitem", { name: "Topic" }), {
    key: "ArrowRight",
  });
  const submenu = await waitFor(() => {
    const menus = screen.getAllByRole("menu");
    expect(menus.length).toBeGreaterThan(1);
    return menus.at(-1)!;
  });
  return within(submenu).getAllByRole("menuitem");
};

describe("the row menu's Topic submenu", () => {
  it("does no catalog indexing while the menu is closed", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
      catalog,
    });
    await slot.findByRole("link", { name: "Root task" });
    vi.mocked(topicIndex).mockClear();
    expect(topicIndex).not.toHaveBeenCalled();
    await topicChoices(slot, "Root task");
    expect(topicIndex).toHaveBeenCalledOnce();
    slot.lifecycle.unmount();
  });

  it("offers only topics that can hold threads", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
      catalog,
    });
    const choices = await topicChoices(slot, "Root task");
    expect(choices.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^Automatic/),
      "Area › Shipping",
      "Loose ends",
    ]);
    // The parent heads its subtopic and holds no threads of its own.
    expect(screen.queryByRole("menuitem", { name: /^Area$/ })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("shows a failed topic change in the sidebar", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
      catalog,
      assignmentError: "Topic assignment failed",
    });
    const choices = await topicChoices(slot, "Root task");
    fireEvent.click(choices.find((item) => item.textContent === "Loose ends")!);
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toBe("Topic assignment failed");
    slot.lifecycle.unmount();
  });

  it("assigns a chosen topic without reporting an error", async () => {
    const slot = await mount(threads(), {
      settings: { showRecent: false, showForYou: false },
      catalog,
    });
    const choices = await topicChoices(slot, "Root task");
    fireEvent.click(choices.find((item) => item.textContent === "Loose ends")!);
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.find((c) => c.method === "taskAssign")?.input,
      ).toEqual({ threadId: "root", entityId: "loose" }),
    );
    expect(slot.queryByRole("alert")).toBeNull();
    slot.lifecycle.unmount();
  });
});
