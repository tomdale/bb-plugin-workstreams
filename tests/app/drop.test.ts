import { describe, expect, it } from "vitest";
import { acceptsThreadDrop, planDrop } from "../../src/app/sidebar/drop.ts";
import { EMPTY_ORDER } from "../../src/domain/order.ts";
import { projectWorkstreams } from "../../src/domain/project.ts";
import { thread } from "../domain/fixtures.ts";

const now = 1_000_000;
const sections = [
  { id: "sec_a", name: "Alpha" },
  { id: "sec_b", name: "Beta" },
  { id: "sec_c", name: "Gamma" },
];
const projection = projectWorkstreams(
  [
    thread("a1", { sectionId: "sec_a", latestAttentionAt: now - 1 }),
    thread("a2", { sectionId: "sec_a", latestAttentionAt: now - 2 }),
    thread("kid", { parentThreadId: "a2", latestAttentionAt: now }),
    thread("a3", { sectionId: "sec_a", latestAttentionAt: now - 3 }),
    thread("b1", { sectionId: "sec_b", latestAttentionAt: now }),
    thread("c1", { sectionId: "sec_c", latestAttentionAt: now }),
    thread("u1", { latestAttentionAt: now }),
  ],
  sections,
  { now },
);
const topics = {
  entities: [
    { id: "a", name: "Alpha", parentId: null },
    { id: "b", name: "Beta", parentId: null },
    { id: "c", name: "Gamma", parentId: null },
  ],
  bindings: { sec_a: "a", sec_b: "b", sec_c: "c" },
};
const threadDrop = (over: Partial<Parameters<typeof planDrop>[0]> = {}) =>
  ({
    kind: "thread",
    threadId: "b1",
    fromGroupId: "sec_b",
    toGroupId: "sec_a",
    overThreadId: "a2",
    below: false,
    ...over,
  }) as Parameters<typeof planDrop>[0];

describe("planDrop", () => {
  it("reorders workstreams by moving one into the target's slot", () => {
    expect(
      planDrop(
        { kind: "group", groupId: "sec_c", overGroupId: "sec_a" },
        projection,
        sections,
        EMPTY_ORDER,
      ),
    ).toEqual({
      reorder: { kind: "workstreams", ids: ["sec_c", "sec_a", "sec_b"] },
    });
  });

  it("reorders roots within a group, ignoring children", () => {
    expect(
      planDrop(
        threadDrop({
          threadId: "a3",
          fromGroupId: "sec_a",
          overThreadId: "a1",
        }),
        projection,
        sections,
        EMPTY_ORDER,
      ),
    ).toEqual({
      reorder: { kind: "threads", groupId: "sec_a", ids: ["a3", "a1", "a2"] },
    });
  });

  it.each([
    { overThreadId: "a2", below: false, ids: ["a1", "b1", "a2", "a3"] },
    { overThreadId: "a2", below: true, ids: ["a1", "a2", "b1", "a3"] },
    { overThreadId: "a3", below: true, ids: ["a1", "a2", "a3", "b1"] },
    { overThreadId: null, below: false, ids: ["b1", "a1", "a2", "a3"] },
  ])(
    "assigns the destination topic and places the root at the drop position: $ids",
    ({ overThreadId, below, ids }) => {
      expect(
        planDrop(
          threadDrop({ overThreadId, below }),
          projection,
          sections,
          EMPTY_ORDER,
          topics,
        ),
      ).toEqual({
        assign: { threadId: "b1", entityId: "a" },
        reorder: { kind: "threads", groupId: "sec_a", ids },
      });
    },
  );

  it("clears the topic when dropped in Unfiled", () => {
    expect(
      planDrop(
        threadDrop({ toGroupId: "unsorted", overThreadId: null }),
        projection,
        sections,
        EMPTY_ORDER,
        topics,
      ),
    ).toEqual({
      assign: { threadId: "b1", entityId: null },
      reorder: { kind: "threads", groupId: "unsorted", ids: ["b1", "u1"] },
    });
  });

  it("files an Unfiled root by the destination topic", () => {
    expect(
      planDrop(
        threadDrop({ threadId: "u1", fromGroupId: "unsorted" }),
        projection,
        sections,
        EMPTY_ORDER,
        topics,
      ),
    ).toMatchObject({
      assign: { threadId: "u1", entityId: "a" },
    });
  });

  it("accepts an empty workstream header", () => {
    const empty = [...sections, { id: "sec_empty", name: "Empty" }];
    const projected = projectWorkstreams(
      [thread("b1", { sectionId: "sec_b" })],
      empty,
      { now },
    );
    const catalog = {
      ...topics,
      entities: [
        ...topics.entities,
        { id: "empty", name: "Empty", parentId: null },
      ],
      bindings: { ...topics.bindings, sec_empty: "empty" },
    };
    expect(
      planDrop(
        threadDrop({ toGroupId: "sec_empty", overThreadId: null }),
        projected,
        empty,
        EMPTY_ORDER,
        catalog,
      ),
    ).toEqual({
      assign: { threadId: "b1", entityId: "empty" },
      reorder: { kind: "threads", groupId: "sec_empty", ids: ["b1"] },
    });
  });

  it("rejects cross-group moves without a known leaf topic", () => {
    const withChild = {
      ...topics,
      entities: [
        ...topics.entities,
        { id: "child", name: "Child", parentId: "a" },
      ],
    };
    for (const catalog of [undefined, { ...topics, entities: [] }, withChild]) {
      expect(acceptsThreadDrop("sec_b", "sec_a", catalog)).toBe(false);
      expect(
        planDrop(threadDrop(), projection, sections, EMPTY_ORDER, catalog),
      ).toEqual({ reorder: null });
    }
    expect(acceptsThreadDrop("sec_a", "sec_a")).toBe(true);
    expect(acceptsThreadDrop("sec_a", "unsorted")).toBe(true);
    expect(acceptsThreadDrop("sec_a", "topic:a", withChild)).toBe(false);
  });

  it.each([
    { threadId: "kid", fromGroupId: "sec_a" },
    { threadId: "missing" },
    { overThreadId: "kid" },
    { overThreadId: "missing" },
    { toGroupId: "missing", overThreadId: null },
  ])("ignores stale or non-root drops: %s", (change) => {
    expect(
      planDrop(threadDrop(change), projection, sections, EMPTY_ORDER, topics),
    ).toEqual({ reorder: null });
  });
});
