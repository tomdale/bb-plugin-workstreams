import { expect, it } from "vitest";
import {
  descendantsOf,
  foldDefault,
  foldKey,
  groupSnoozeRequest,
  planArchived,
  planBandRows,
  treesOf,
  unfoldedRows,
  visibleEntries,
  type ThreadRow,
} from "../../src/app/sidebar/rows.ts";
import { projectWorkstreams } from "../../src/domain/project.ts";
import { arrangeGroups } from "../../src/domain/groups.ts";
import { sidebarThread, section } from "./fixtures.ts";

const row = (
  id: string,
  patch: Partial<ThreadRow["thread"]> = {},
  depth = 0,
): ThreadRow => ({
  thread: sidebarThread(id, { title: id, ...patch }),
  depth,
  hasChildren: false,
  workstreamId: patch.sectionId ?? null,
  needsYou: false,
});
const ids = (rows: readonly ThreadRow[]) => rows.map((r) => r.thread.id);
/** The top-level threads of a band sorted by `sort`, as the band lists them. */
const sortedBand = (
  rows: readonly ThreadRow[],
  sort: Parameters<typeof planBandRows>[2]["sort"],
  snoozeOf: Parameters<typeof planBandRows>[3],
) =>
  planBandRows(
    rows,
    "recent",
    { sort, grouped: false },
    snoozeOf,
    names,
  )[0]!.trees.flat();
const names = new Map([
  ["a", "Alpha"],
  ["b", "Beta"],
]);

it.each([
  ["title", ["a", "b", "c"]],
  ["activity", ["b", "c", "a"]],
  ["archived", ["c", "a", "b"]],
  ["wake", ["a", "b", "c"]],
] as const)(
  "orders bands by %s, without mutating the source",
  (sort, expected) => {
    const rows = [
      row("c", { latestAttentionAt: 2, archivedAt: 30 }),
      row("b", { latestAttentionAt: 3, archivedAt: 10 }),
      row("a", { latestAttentionAt: 1, archivedAt: 20 }),
    ];
    expect(
      ids(
        sortedBand(rows, sort, (t) => ({
          until: t.id === "a" ? 10 : null,
        })),
      ),
    ).toEqual(expected);
    expect(ids(rows)).toEqual(["c", "b", "a"]);
  },
);

it("breaks every sort's ties by identity, including indefinite wakes", () => {
  const rows = [
    row("b", { title: "Same", latestAttentionAt: 1 }),
    row("a", { title: "Same", latestAttentionAt: 1 }),
  ];
  for (const sort of ["title", "activity", "archived", "wake"] as const)
    expect(ids(sortedBand(rows, sort, () => undefined))).toEqual(["a", "b"]);
});

it("sorts snoozed threads while keeping descendants in tree order and under their parent thread's workstream", () => {
  const rows = [
    row("later", { sectionId: "b" }),
    row("child", { sectionId: "a" }, 1),
    row("early", { sectionId: "a" }),
  ];
  const snooze = (t: ThreadRow["thread"]) => ({
    until: t.id === "early" ? 10 : 20,
  });
  const flat = planBandRows(
    rows,
    "snoozed",
    { sort: "wake", grouped: false },
    snooze,
    names,
  );
  expect(flat.map((g) => g.trees.map(ids))).toEqual([
    [["early"], ["later", "child"]],
  ]);
  const grouped = planBandRows(
    rows,
    "snoozed",
    { sort: "wake", grouped: true },
    snooze,
    names,
  );
  expect(grouped.map((g) => [g.name, g.trees.map(ids)])).toEqual([
    ["Alpha", [["early"]]],
    ["Beta", [["later", "child"]]],
  ]);
});

it("labels unknown workstreams and No workstream and preserves within-group sorting", () => {
  const rows = [
    row("z", { sectionId: "a" }),
    row("a", { sectionId: "a" }),
    row("loose"),
    row("unknown", { sectionId: "gone" }),
  ];
  const grouped = planBandRows(
    rows,
    "recent",
    { sort: "title", grouped: true },
    () => undefined,
    names,
  );
  expect(grouped.map((g) => [g.name, ids(g.trees.flat())])).toEqual([
    ["Alpha", ["a", "z"]],
    ["Other", ["loose", "unknown"]],
  ]);
});

it("folds a complete subtree without hiding its next sibling and keeps placements independent", () => {
  const rows = [
    row("parent"),
    row("child", {}, 1),
    row("grandchild", {}, 2),
    row("sibling", {}, 1),
    row("other"),
  ];
  const before = rows.slice();
  expect(treesOf(rows).map(ids)).toEqual([
    ["parent", "child", "grandchild", "sibling"],
    ["other"],
  ]);
  expect(
    [...descendantsOf([rows])].map(([id, children]) => [id, ids(children)]),
  ).toEqual([
    ["parent", ["child", "grandchild", "sibling"]],
    ["child", ["grandchild"]],
  ]);
  expect(ids(unfoldedRows(rows, (id) => id === "child"))).toEqual([
    "parent",
    "child",
    "sibling",
    "other",
  ]);
  expect(ids(unfoldedRows(rows, (id) => id === "parent"))).toEqual([
    "parent",
    "other",
  ]);
  expect(rows).toEqual(before);
  expect(foldKey("group", "parent")).toBe("thread:parent");
  expect(foldKey("up-next", "parent")).toBe("up-next:thread:parent");
  expect(foldDefault("group")).toBe(false);
  expect(foldDefault("snoozed")).toBe(false);
  expect(foldDefault("up-next")).toBe(true);
  expect(foldDefault("recent")).toBe(true);
});

it("lists archived children under their parent thread, excluding hidden and live threads", () => {
  const threads = [
    sidebarThread("parent", { sectionId: "a", isArchived: true }),
    sidebarThread("child", {
      sectionId: "b",
      parentThreadId: "parent",
      isArchived: true,
    }),
    sidebarThread("loose", { isArchived: true }),
    sidebarThread("unknown", { sectionId: "gone", isArchived: true }),
    sidebarThread("hidden", { isArchived: true, isHidden: true }),
    sidebarThread("live", { sectionId: "a" }),
  ];
  const archive = planArchived(
    threads,
    [section("a", "Alpha"), section("b", "Beta")],
    true,
  );
  expect(
    archive.rows.map((r) => [r.thread.id, r.workstreamId, r.depth]),
  ).toEqual([
    ["parent", "a", 0],
    ["child", "a", 0],
    ["loose", null, 0],
    ["unknown", null, 0],
  ]);
  expect(planArchived(threads, [], false).rows).toEqual([]);
});

it("bounds archived ancestry walks with missing or cyclic parents", () => {
  const threads = [
    sidebarThread("orphan", {
      parentThreadId: "absent",
      sectionId: "a",
      isArchived: true,
    }),
    sidebarThread("a", { parentThreadId: "b", isArchived: true }),
    sidebarThread("b", { parentThreadId: "a", isArchived: true }),
  ];
  const result = planArchived(threads, [section("a", "Alpha")], true);
  expect(result.rows).toHaveLength(3);
  expect(result.rows[0]!.workstreamId).toBe("a");
});

it("counts descendants in a snooze label but sends top-level threads, including Other", () => {
  const projection = projectWorkstreams(
    [
      sidebarThread("parent", { sectionId: "a" }),
      sidebarThread("child", { parentThreadId: "parent", sectionId: "b" }),
      sidebarThread("loose"),
    ],
    [section("a", "Alpha"), section("empty", "Empty")],
    { now: Date.now() },
  );
  const request = groupSnoozeRequest(
    projection.groups.find((g) => g.id === "a")!,
  );
  expect(request?.threads.map((t) => t.id)).toEqual(["parent"]);
  expect(request).toMatchObject({
    label: "Snooze 2 threads",
    subject: "2 threads in Alpha",
  });
  expect(groupSnoozeRequest(projection.other)).toMatchObject({
    label: "Snooze 1 thread",
    subject: "1 thread in Other",
  });
  expect(
    groupSnoozeRequest({ ...projection.other, total: 0, rows: [] }),
  ).toBeUndefined();
});

it("keeps the grouping policy without mounting rows: manual order, no empty workstream, and snoozed exclusion", () => {
  const now = Date.now();
  const projection = projectWorkstreams(
    [
      sidebarThread("a1", { sectionId: "a" }),
      sidebarThread("b1", { sectionId: "b" }),
      sidebarThread("b2", { sectionId: "b" }),
      sidebarThread("b3", { sectionId: "b" }),
      sidebarThread("nap", { sectionId: "a" }),
    ],
    [section("a", "Alpha"), section("b", "Beta"), section("empty", "Empty")],
    {
      now,
      order: {
        workstreams: ["b"],
        threads: { b: ["b3", "b1"] },
        focused: [],
      },
      snoozedUntil: (t) => (t.id === "nap" ? null : undefined),
    },
  );
  const groups = arrangeGroups(projection, "manual");
  expect(groups.populated.map((g) => g.id)).toEqual(["b", "a"]);
  expect(ids(groups.populated[0]!.rows)).toEqual(["b2", "b3", "b1"]);
  expect(groups.populated.map((g) => g.id)).not.toContain("empty");
  expect(ids(projection.snoozed)).toEqual(["nap"]);
  expect(ids(groups.populated.flatMap((g) => g.rows))).not.toContain("nap");
});

it("draws an overlay tree flat from its top thread and a group tree at its own depth", () => {
  const tree = [row("child", {}, 1), row("grandchild", {}, 2)];
  const entries = (placement: Parameters<typeof visibleEntries>[1]) =>
    visibleEntries(tree, placement, () => false).map(
      ({ depth, key }) => `${key}@${depth}`,
    );
  expect(entries("up-next")).toEqual(["child@0", "child/grandchild@1"]);
  expect(entries("group")).toEqual(["child@1", "grandchild@2"]);
  expect(visibleEntries(tree, "pinned", (id) => id === "child")).toHaveLength(
    1,
  );
  expect(visibleEntries([], "group", () => false)).toEqual([]);
});
