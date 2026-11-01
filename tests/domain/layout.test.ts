import { describe, expect, it } from "vitest";
import {
  layoutGroups,
  layoutLabel,
  startsWith,
} from "../../src/domain/layout.ts";

const topics = [
  { id: "vertex", name: "Vertex", parentId: null },
  { id: "agent", name: "Vercel Agent", parentId: null },
  { id: "review", name: "Code Review", parentId: "agent" },
  { id: "automations", name: "Automations", parentId: "agent" },
];

describe("durable topic layout", () => {
  it("lists a one-level product and each populated second-level topic", () => {
    const layout = layoutGroups({
      topics,
      counts: { vertex: 1, review: 4, automations: 4 },
    });
    expect(layout.listed).toEqual(["automations", "review", "vertex"]);
    expect(layout.nodes.map(layoutLabel)).toEqual([
      "Vercel Agent: Automations",
      "Vercel Agent: Code Review",
      "Vertex",
    ]);
    expect(
      layout.nodes.every((node) => node.lists && node.children.length === 0),
    ).toBe(true);
  });
  it("does not change section identity or topic shape with volume", () => {
    const small = layoutGroups({ topics, counts: { vertex: 1, review: 1 } });
    const busy = layoutGroups({ topics, counts: { vertex: 100, review: 100 } });
    expect(small.listed).toEqual(busy.listed);
    expect(small.nodes.map(({ total, ...identity }) => identity)).toEqual(
      busy.nodes.map(({ total, ...identity }) => identity),
    );
  });
  it("does not list empty topics", () => {
    expect(layoutGroups({ topics, counts: {} })).toEqual({
      nodes: [],
      listed: [],
    });
  });
  it("does not repeat a product prefix already present in its child's name", () => {
    const layout = layoutGroups({
      topics: [
        { id: "a", name: "Vercel", parentId: null },
        { id: "b", name: "Vercel Agent", parentId: "a" },
      ],
      counts: { b: 1 },
    });
    expect(layout.nodes[0]!.prefix).toEqual([]);
    expect(startsWith("Vercel Agent", "Vercel")).toBe(true);
    expect(startsWith("Vercelish", "Vercel")).toBe(false);
  });
  it("refuses deeper identities before changing any sections", () => {
    expect(() =>
      layoutGroups({
        topics: [
          ...topics,
          { id: "third", name: "Approvals", parentId: "review" },
        ],
        counts: { third: 1 },
      }),
    ).toThrow("at most two levels");
  });
  it("refuses threads beside child topics until a filing plan is reviewed", () => {
    expect(() =>
      layoutGroups({ topics, counts: { agent: 1, review: 4 } }),
    ).toThrow("reviewed filing plan");
  });
  it("rejects missing parents and cycles without losing their threads", () => {
    expect(() =>
      layoutGroups({
        topics: [{ id: "a", name: "A", parentId: "missing" }],
        counts: { a: 1 },
      }),
    ).toThrow("Unknown topic");
    expect(() =>
      layoutGroups({
        topics: [{ id: "a", name: "A", parentId: "a" }],
        counts: { a: 1 },
      }),
    ).toThrow("cycle");
  });
  it("ignores invalid counts", () => {
    expect(
      layoutGroups({ topics, counts: { vertex: Number.NaN, review: -1 } })
        .listed,
    ).toEqual([]);
  });
});
