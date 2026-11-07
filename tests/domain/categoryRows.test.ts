import { describe, expect, it } from "vitest";
import { categoryRows } from "../../src/domain/categoryRows.ts";

const row = (id: string, depth = 0) => ({
  depth,
  thread: { id },
  workstreamId: "stable-section",
});
const generation = {
  id: "generation",
  categories: [
    { id: "b", name: "Second", threadIds: ["b"] },
    { id: "a", name: "First", threadIds: ["a"] },
  ],
};

describe("category rows", () => {
  it("keeps delegates with their root and preserves workstream identity", () => {
    const rows = [row("a"), row("a-child", 1), row("b"), row("b-child", 1)];
    const buckets = categoryRows(rows, generation);
    expect(
      buckets.map((bucket) => bucket.rows.map((item) => item.thread.id)),
    ).toEqual([
      ["b", "b-child"],
      ["a", "a-child"],
    ]);
    expect(
      buckets
        .flatMap((bucket) => bucket.rows)
        .every((item) => item.workstreamId === "stable-section"),
    ).toBe(true);
  });
  it("leaves arrivals visible before categorization and hides empty categories", () => {
    const rows = [row("arrival"), row("child", 1), row("a")];
    const buckets = categoryRows(rows, generation);
    expect(buckets.map((bucket) => bucket.name)).toEqual([null, "First"]);
    expect(buckets[0]!.rows).toEqual(rows.slice(0, 2));
    expect(buckets.flatMap((bucket) => bucket.rows)).toHaveLength(3);
  });
  it("lists each tree once even if stored membership contains a duplicate", () => {
    const corrupt = {
      id: "g",
      categories: [
        { id: "one", name: "One", threadIds: ["a"] },
        { id: "two", name: "Two", threadIds: ["a"] },
      ],
    };
    expect(
      categoryRows([row("a"), row("child", 1)], corrupt).flatMap(
        (bucket) => bucket.rows,
      ),
    ).toHaveLength(2);
  });
  it("retains the original list without a category generation", () => {
    const rows = [row("a"), row("child", 1)];
    expect(categoryRows(rows)).toEqual([{ id: null, name: null, rows }]);
  });
  it("keeps each category's place when a sibling has nothing filed in it", () => {
    const empty = {
      id: "g",
      categories: [
        { id: "one", name: "One", threadIds: ["gone"] },
        { id: "two", name: "Two", threadIds: ["a"] },
      ],
    };
    expect(
      categoryRows([row("a")], empty).map((bucket) => bucket.name),
    ).toEqual(["Two"]);
  });
  it("puts arrivals after every category", () => {
    const buckets = categoryRows([row("a"), row("arrival")], generation);
    expect(buckets.map((bucket) => bucket.name)).toEqual([null, "First"]);
  });
});
