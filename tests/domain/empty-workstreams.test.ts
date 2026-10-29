import { describe, expect, it } from "vitest";
import {
  EMPTY_WORKSTREAM_GRACE_MS as grace,
  retainedEmptyWorkstreams,
} from "../../src/domain/empty-workstreams.ts";
import { projectWorkstreams } from "../../src/domain/project.ts";
import { arrangeGroups } from "../../src/domain/groups.ts";
import { thread } from "./fixtures.ts";

const now = 100 * grace;
const sections = ["a", "b", "c", "d", "old", "unknown"].map((id) => ({
  id,
  name: id,
}));

describe("recent empty workstreams", () => {
  it("keeps only the three most recently populated, strictly less than ten minutes old", () => {
    expect([
      ...retainedEmptyWorkstreams(
        sections.map((s) => s.id),
        {
          a: now - 4,
          b: now - 3,
          c: now - 2,
          d: now - 1,
          old: now - grace,
        },
        now,
      ),
    ]).toEqual(["d", "c", "b"]);
    expect([
      ...retainedEmptyWorkstreams(["a"], { a: now - grace + 1 }, now),
    ]).toEqual(["a"]);
    expect([
      ...retainedEmptyWorkstreams(["a"], { a: now - grace }, now),
    ]).toEqual([]);
  });

  it("rejects missing, nonfinite, and future timestamps and breaks ties by identity", () => {
    expect([
      ...retainedEmptyWorkstreams(
        ["b", "a", "c", "d"],
        {
          a: now,
          b: now,
          c: Number.NaN,
          d: now + 1,
        },
        now,
      ),
    ]).toEqual(["a", "b"]);
  });

  it("does not exempt focused empties or put expired ones in Dormant", () => {
    const projection = projectWorkstreams([], sections, {
      now,
      lastPopulatedAt: { a: now - grace, b: now - 1 },
      order: { workstreams: [], threads: {}, prioritized: ["a", "b"] },
    });
    const arrangement = arrangeGroups(projection, "alphabetical");
    expect(arrangement.pinned.map((g) => g.id)).toEqual(["b"]);
    expect(arrangement.dormant).toEqual([]);
    expect(projection.all).toHaveLength(sections.length);
    expect(
      arrangeGroups(projectWorkstreams([], sections, { now }), "manual").other,
    ).toEqual([]);
  });

  it("uses one budget across focused and nested workstreams", () => {
    const projection = projectWorkstreams(
      [thread("live", { sectionId: "old", latestAttentionAt: now })],
      sections,
      {
        now,
        lastPopulatedAt: { a: now - 4, b: now - 3, c: now - 2, d: now - 1 },
        order: { workstreams: [], threads: {}, prioritized: ["b"] },
      },
    );
    const arranged = arrangeGroups(projection, "manual", {
      entities: [
        { id: "product", name: "Product", parentId: null },
        ...["a", "b", "c", "d", "old"].map((id) => ({
          id,
          name: id,
          parentId: "product",
        })),
      ],
      bindings: { a: "a", b: "b", c: "c", d: "d", old: "old" },
    });
    expect(arranged.pinned).toHaveLength(1);
    expect(arranged.pinned[0]!.subgroups.map((g) => g.id)).toEqual([
      "b",
      "c",
      "d",
      "old",
    ]);
    expect(projection.groups.filter((g) => g.total === 0)).toHaveLength(3);
  });

  it("does not hide a header whose nested workstreams still contain threads", () => {
    const projection = projectWorkstreams(
      [thread("live", { sectionId: "b", latestAttentionAt: now })],
      sections,
      { now },
    );
    const arranged = arrangeGroups(projection, "manual", {
      entities: [
        { id: "product", name: "Product", parentId: null },
        { id: "child", name: "Child", parentId: "product" },
      ],
      bindings: { a: "product", b: "child" },
    });
    expect(arranged.populated[0]!.total).toBe(1);
    expect(arranged.populated[0]!.subgroups[0]!.total).toBe(1);
  });

  it("never hides populated workstreams regardless of attention age", () => {
    const projection = projectWorkstreams(
      [thread("live", { sectionId: "a", latestAttentionAt: now - 20 * grace })],
      sections,
      { now },
    );
    expect(projection.groups.map((g) => g.id)).toEqual(["a"]);
  });
});
