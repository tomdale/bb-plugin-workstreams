import { describe, expect, it } from "vitest";
import {
  arrangeGroups,
  sharedWorkstreamId,
  type GroupSort,
  type WorkstreamTree,
} from "../../src/domain/groups.ts";
import { DAY_MS, projectWorkstreams } from "../../src/domain/project.ts";
import { placePullRequests } from "../../src/app/sidebar/pullRequestGroups.ts";
import { EMPTY_ORDER, thread } from "../domain/fixtures.ts";

const now = 100 * DAY_MS;
const sections = [
  { id: "sec_harbor", name: "Harbor" },
  { id: "sec_quay", name: "Quay" },
  { id: "sec_dock", name: "Dock" },
];
const tree: WorkstreamTree = {
  workstreams: [
    { id: "ws_harbor", name: "Harbor", parentId: null },
    { id: "ws_quay", name: "Quay", parentId: null },
    { id: "ws_dock", name: "Dock", parentId: null },
    { id: "ws_pier", name: "Pier", parentId: "ws_dock" },
    { id: "ws_lost", name: "Lost", parentId: null },
  ],
  bindings: {
    sec_harbor: "ws_harbor",
    sec_quay: "ws_quay",
    sec_dock: "ws_dock",
  },
};

function place(
  workstreamIds: string[],
  options: {
    sort?: GroupSort;
    focused?: string[];
    threads?: ReturnType<typeof thread>[];
  } = {},
) {
  const projection = projectWorkstreams(
    [
      thread("h1", { sectionId: "sec_harbor", latestAttentionAt: now - 1 }),
      thread("loose", { latestAttentionAt: now - 2 }),
      ...(options.threads ?? []),
    ],
    sections,
    {
      now,
      order: { ...EMPTY_ORDER, focused: options.focused ?? [] },
    },
  );
  const sort = options.sort ?? "alphabetical";
  const arrangement = arrangeGroups(projection, sort, tree);
  return placePullRequests({
    arrangement,
    workstreamIds,
    all: projection.all,
    tree,
    sort,
  });
}

const names = (groups: readonly { name: string }[]) =>
  groups.map((group) => group.name);

describe("placing pull requests in workstream groups", () => {
  it("changes nothing without a pull request", () => {
    const placed = place([]);
    expect(placed.scopes).toEqual({});
    expect(names(placed.arrangement.populated)).toEqual(["Harbor"]);
    expect(placed.otherHasPullRequests).toBe(false);
  });

  it("draws a workstream's pull requests in its own group", () => {
    const placed = place(["ws_harbor"]);
    expect(placed.scopes).toEqual({ sec_harbor: ["ws_harbor"] });
    expect(names(placed.arrangement.populated)).toEqual(["Harbor"]);
  });

  it("keeps a workstream with a pull request and no thread on the list", () => {
    const placed = place(["ws_quay"]);
    expect(names(placed.arrangement.populated)).toEqual(["Harbor", "Quay"]);
    const quay = placed.arrangement.populated.find((g) => g.name === "Quay")!;
    expect(quay.total).toBe(0);
    expect(quay.rows).toEqual([]);
    expect(placed.scopes).toEqual({ sec_quay: ["ws_quay"] });
    expect(placed.arrangement.hasLower).toBe(true);
  });

  it("gives a workstream with no section a header of its own", () => {
    const placed = place(["ws_lost"]);
    const lost = placed.arrangement.populated.find((g) => g.name === "Lost")!;
    expect(lost.id).toBe(sharedWorkstreamId("ws_lost"));
    expect(lost.hasSection).toBe(false);
    expect(placed.scopes).toEqual({ [lost.id]: ["ws_lost"] });
  });

  it("sorts the returned groups by the chosen sort, and adds to a manual order at the end", () => {
    expect(
      names(
        place(["ws_dock", "ws_quay"], { sort: "alphabetical" }).arrangement
          .populated,
      ),
    ).toEqual(["Dock", "Harbor", "Quay"]);
    expect(
      names(
        place(["ws_quay", "ws_dock"], { sort: "manual" }).arrangement.populated,
      ),
    ).toEqual(["Harbor", "Quay", "Dock"]);
  });

  it("hangs a nested workstream with only a pull request under its drawn group", () => {
    const placed = place(["ws_pier"], {
      threads: [
        thread("d1", { sectionId: "sec_dock", latestAttentionAt: now - 3 }),
      ],
    });
    expect(names(placed.arrangement.populated)).toEqual(["Dock", "Harbor"]);
    const dock = placed.arrangement.populated.find((g) => g.name === "Dock")!;
    expect(dock.workstreams.map((sub) => sub.name)).toEqual(["Pier"]);
    const pier = dock.workstreams[0]!;
    expect(pier.total).toBe(0);
    expect(pier.rows).toEqual([]);
    expect(pier.inline).toBeFalsy();
    expect(placed.scopes[pier.id]).toEqual(["ws_pier"]);
    // Nothing joins the top level beside it.
    expect(placed.arrangement.populated.some((g) => g.id === pier.id)).toBe(
      false,
    );
  });

  it("draws a header for a group with no visible thread, holding the nested workstream", () => {
    const placed = place(["ws_pier"]);
    const dock = placed.arrangement.populated.find((g) => g.name === "Dock")!;
    expect(dock.hasSection).toBe(false);
    expect(dock.workstreamId).toBe("ws_dock");
    expect(dock.workstreams.map((sub) => sub.name)).toEqual(["Pier"]);
    expect(placed.scopes[dock.workstreams[0]!.id]).toEqual(["ws_pier"]);
    expect(placed.scopes[dock.id]).toBeUndefined();
    expect(
      placed.arrangement.populated.some((g) => g.name.includes("Pier")),
    ).toBe(false);
  });

  it("puts a pull request whose workstream is gone under Other", () => {
    const placed = place(["ws_deleted"]);
    expect(placed.otherHasPullRequests).toBe(true);
    expect(placed.scopes).toEqual({ other: ["ws_deleted"] });
    expect(placed.arrangement.hasLower).toBe(true);
  });

  it("tiers the list when a workstream with only pull requests is focused", () => {
    const placed = place(["ws_quay"], { focused: ["sec_quay"] });
    expect(names(placed.arrangement.focused)).toEqual(["Quay"]);
    expect(placed.arrangement.tiered).toBe(true);
  });

  it("leaves pull requests where their stored workstream is, whatever its threads do", () => {
    // The thread that linked it moved to Harbor, but the pull request is Quay's.
    const placed = place(["ws_quay", "ws_harbor"]);
    expect(placed.scopes.sec_quay).toEqual(["ws_quay"]);
    expect(placed.scopes.sec_harbor).toEqual(["ws_harbor"]);
  });
});
