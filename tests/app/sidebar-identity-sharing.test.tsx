// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  arrangeGroups,
  type WorkstreamTopics,
} from "../../src/domain/groups.ts";
import * as groups from "../../src/domain/groups.ts";
import * as project from "../../src/domain/project.ts";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { shareArrangement } from "../../src/app/shareNodes.ts";
import { section, sidebarThread } from "./fixtures.ts";
import { mount } from "./sidebar-fixture.tsx";

const sections = [section("sec_a", "Alpha"), section("sec_b", "Beta")];
const now = Date.now();

/** Two workstreams of work: a root with a child, and a second root. */
function snapshot(title = "Root task"): PluginSidebarThread[] {
  return [
    sidebarThread("root", {
      sectionId: "sec_a",
      title,
      latestAttentionAt: now,
    }),
    sidebarThread("kid", {
      parentThreadId: "root",
      sectionId: "sec_a",
      title: "Kid task",
      latestAttentionAt: now - 60_000,
    }),
    sidebarThread("other", {
      sectionId: "sec_b",
      title: "Other task",
      latestAttentionAt: now - 120_000,
    }),
  ];
}

/** The same threads with one retitled, so only that thread's data changes. */
function withRenamedRoot(threads: readonly PluginSidebarThread[]) {
  return [
    { ...threads[0]!, title: "Renamed task", displayTitle: "Renamed task" },
    ...threads.slice(1),
  ];
}

type Projection = project.Projection<PluginSidebarThread>;

const arrange = (projection: Projection) =>
  arrangeGroups(projection, "alphabetical");

const groupIn = (projection: Projection, id: string) =>
  projection.groups.find((group) => group.id === id);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps rows and groups that a new projection leaves unchanged", () => {
  const threads = snapshot();
  const first = project.projectWorkstreams(threads, sections, { now });
  const second = project.projectWorkstreams(threads, sections, {
    now: now + 60_000,
    previous: first,
  });

  for (const thread of threads)
    expect(second.rowOf.get(thread.id)).toBe(first.rowOf.get(thread.id));
  expect(second.groups.map((group) => group.id)).toEqual(
    first.groups.map((group) => group.id),
  );
  for (const [index, group] of second.groups.entries())
    expect(group).toBe(first.groups[index]);
  // The maps and the arrays around the shared nodes are new each time.
  expect(second.rowOf).not.toBe(first.rowOf);
  expect(second.groups).not.toBe(first.groups);
});

it("replaces the row and group of the thread that changed", () => {
  const threads = snapshot();
  const before = project.projectWorkstreams(threads, sections, { now });
  const after = project.projectWorkstreams(withRenamedRoot(threads), sections, {
    now,
    previous: before,
  });

  expect(after.rowOf.get("root")).not.toBe(before.rowOf.get("root"));
  expect(after.rowOf.get("root")?.thread.displayTitle).toBe("Renamed task");
  expect(after.rowOf.get("kid")).toBe(before.rowOf.get("kid"));
  expect(after.rowOf.get("other")).toBe(before.rowOf.get("other"));
  expect(groupIn(after, "sec_b")).toBe(groupIn(before, "sec_b"));
  expect(groupIn(after, "sec_a")).not.toBe(groupIn(before, "sec_a"));
});

it("replaces a row whose depth or status changed, even with the same thread", () => {
  const threads = snapshot();
  const before = project.projectWorkstreams(threads, sections, { now });
  // The child thread gains a child of its own: its row's depth and
  // has-children state change while the thread object stays the same.
  const after = project.projectWorkstreams(
    [
      ...threads,
      sidebarThread("grandkid", {
        parentThreadId: "kid",
        sectionId: "sec_a",
        title: "Grandkid task",
        latestAttentionAt: now - 180_000,
      }),
    ],
    sections,
    { now, previous: before },
  );
  expect(after.rowOf.get("kid")).not.toBe(before.rowOf.get("kid"));
  expect(after.rowOf.get("kid")?.depth).toBe(1);
  expect(after.rowOf.get("root")).toBe(before.rowOf.get("root"));

  // A thread the user now has to answer draws a different row.
  const waiting = project.projectWorkstreams(threads, sections, {
    now,
    previous: before,
    needsYou: (thread) => thread.id === "other",
  });
  expect(waiting.rowOf.get("other")).not.toBe(before.rowOf.get("other"));
  expect(waiting.rowOf.get("other")?.needsYou).toBe(true);
  expect(waiting.rowOf.get("root")).toBe(before.rowOf.get("root"));
});

it("keeps unchanged workstream nodes across an arrangement update", () => {
  const topics: WorkstreamTopics = {
    entities: [
      { id: "t1", name: "Container", parentId: null },
      { id: "t2", name: "Alpha", parentId: "t1" },
      { id: "t3", name: "Beta", parentId: "t1" },
    ],
    bindings: { sec_a: "t2", sec_b: "t3" },
    layout: [
      {
        topicId: "t1",
        prefix: [],
        name: "Container",
        lists: false,
        total: 3,
        children: [
          {
            topicId: "t2",
            prefix: ["Container"],
            name: "Alpha",
            lists: true,
            total: 2,
            children: [],
          },
          {
            topicId: "t3",
            prefix: ["Container"],
            name: "Beta",
            lists: true,
            total: 1,
            children: [],
          },
        ],
      },
    ],
  };
  const threads = snapshot();
  const projection = project.projectWorkstreams(threads, sections, { now });
  const first = shareArrangement(
    undefined,
    arrangeGroups(projection, "alphabetical", topics),
  );
  // Nothing changed but the clock: every workstream node, the nesting header
  // included, is the same object again.
  const second = shareArrangement(
    first,
    arrangeGroups(
      project.projectWorkstreams(threads, sections, {
        now: now + 60_000,
        previous: projection,
      }),
      "alphabetical",
      topics,
    ),
  );

  expect(second.pinned).toBe(first.pinned);
  expect(second.populated).toBe(first.populated);
  expect(second.dormant).toBe(first.dormant);
  expect(second.unfiled).toBe(first.unfiled);
  expect(second.populated[0]!.subgroups).toBe(first.populated[0]!.subgroups);

  // A thread in one nested workstream replaces that node and the one heading
  // it, and leaves its sibling alone.
  const changed = project.projectWorkstreams(
    withRenamedRoot(threads),
    sections,
    {
      now,
      previous: projection,
    },
  );
  const third = shareArrangement(
    second,
    arrangeGroups(changed, "alphabetical", topics),
  );
  const subgroups = (arrangement: typeof third) =>
    arrangement.populated[0]!.subgroups.map((node) => node.id);
  expect(subgroups(third)).toEqual(subgroups(second));
  expect(third.populated[0]).not.toBe(second.populated[0]);
  expect(third.populated[0]!.subgroups[0]).not.toBe(
    second.populated[0]!.subgroups[0],
  );
  expect(third.populated[0]!.subgroups[1]).toBe(
    second.populated[0]!.subgroups[1],
  );
});

it("replaces only the workstream node whose thread changed", () => {
  const threads = snapshot();
  const projection = project.projectWorkstreams(threads, sections, { now });
  const before = shareArrangement(undefined, arrange(projection));
  const after = shareArrangement(
    before,
    arrange(
      project.projectWorkstreams(withRenamedRoot(threads), sections, {
        now,
        previous: projection,
      }),
    ),
  );

  const byId = (groups: readonly { id: string }[], id: string) =>
    groups.find((group) => group.id === id);
  expect(byId(after.populated, "sec_a")).not.toBe(
    byId(before.populated, "sec_a"),
  );
  expect(byId(after.populated, "sec_b")).toBe(byId(before.populated, "sec_b"));
});

it("shares rows in the sidebar's own projection update", async () => {
  // The arrangement takes the projection the sidebar computed, so it carries
  // the rows the app itself is drawing.
  const arrangements = vi.spyOn(groups, "arrangeGroups");
  const projection = () =>
    arrangements.mock.calls.at(-1)![0] as unknown as Projection;

  const slot = await mount(snapshot(), {
    settings: {
      showForYou: false,
      showRecent: false,
      showSnoozed: false,
      showArchived: false,
    },
  });
  const labels = slot
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label"));
  for (const label of ["Root task", "Kid task", "Other task"])
    expect(labels).toContain(label);
  const mounted = projection();
  slot.replaceThread("other", (thread) => ({
    ...thread,
    title: "Renamed other",
    displayTitle: "Renamed other",
  }));

  const updated = projection();
  expect(updated).not.toBe(mounted);
  expect(updated.rowOf.get("other")).not.toBe(mounted.rowOf.get("other"));
  expect(updated.rowOf.get("root")).toBe(mounted.rowOf.get("root"));
  expect(updated.rowOf.get("kid")).toBe(mounted.rowOf.get("kid"));
  expect(groupIn(updated, "sec_a")).toBe(groupIn(mounted, "sec_a"));
  slot.lifecycle.unmount();
});
