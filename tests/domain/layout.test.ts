import { describe, expect, it } from "vitest";
import {
  EMPTY_LAYOUT_STATE,
  layoutGroups,
  layoutLabel,
  type LayoutNode,
  type LayoutState,
  type LayoutTopic,
} from "../../src/domain/layout.ts";

/** The design's target tree: contexts, families, and two partitioned products. */
const topics: LayoutTopic[] = [
  { id: "vercel", name: "Vercel", parentId: null },
  { id: "agent", name: "Vercel Agent", parentId: "vercel" },
  { id: "auto", name: "Automations", parentId: "agent", partitioned: true },
  { id: "alerts", name: "Alert Investigations", parentId: "auto" },
  { id: "planning", name: "Planning", parentId: "auto" },
  { id: "upkeep", name: "PR Upkeep", parentId: "auto" },
  { id: "triggers", name: "Triggers", parentId: "auto" },
  { id: "review", name: "Code Review", parentId: "agent" },
  { id: "inside", name: "Inside Vercel", parentId: "vercel" },
  { id: "foundations", name: "Agent Foundations", parentId: "vercel" },
  { id: "bb", name: "BB", parentId: null },
  { id: "fork", name: "Fork & Core", parentId: "bb" },
  { id: "plugins", name: "Plugins", parentId: "bb" },
  { id: "sandbox", name: "Vercel Sandbox", parentId: "plugins" },
  { id: "walkthrough", name: "Walkthrough", parentId: "plugins" },
  { id: "workforest", name: "Workforest", parentId: "plugins" },
  { id: "fx", name: "fx provider", parentId: "plugins" },
  { id: "ws", name: "Workstreams", parentId: "plugins", partitioned: true },
  { id: "demo", name: "Demo", parentId: "ws" },
  { id: "org", name: "Organization", parentId: "ws" },
  { id: "questions", name: "Questions", parentId: "ws" },
  { id: "recaps", name: "Recaps", parentId: "ws" },
  { id: "sidebar", name: "Sidebar", parentId: "ws" },
  { id: "architecture", name: "Architecture", parentId: "ws" },
  { id: "personal", name: "Personal", parentId: null },
  { id: "skills", name: "Agent Skills", parentId: "personal" },
];

/** Labels as an indented outline, lists marked with their totals. */
function outline(nodes: readonly LayoutNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${"  ".repeat(depth)}${layoutLabel(node)}${node.lists ? ` (${node.total})` : ""}`,
    ...outline(node.children, depth + 1),
  ]);
}

const day32 = {
  fork: 2,
  sandbox: 2,
  walkthrough: 1,
  workforest: 1,
  fx: 1,
  demo: 2,
  org: 1,
  questions: 1,
  recaps: 1,
  sidebar: 1,
  alerts: 1,
  planning: 2,
  upkeep: 1,
  triggers: 2,
  review: 3,
  inside: 2,
  foundations: 1,
  skills: 1,
};

describe("layoutGroups", () => {
  it("draws the design's target from its month of history", () => {
    const previous: LayoutState = {
      split: ["auto", "plugins", "ws"],
      promoted: ["ws"],
    };
    const layout = layoutGroups({ topics, counts: day32, previous });
    expect(outline(layout.nodes)).toEqual([
      "BB: Fork & Core (2)",
      "BB: Plugins",
      "  fx provider (1)",
      "  Vercel Sandbox (2)",
      "  Walkthrough (1)",
      "  Workforest (1)",
      "BB Plugins: Workstreams",
      "  Demo (2)",
      "  Organization (1)",
      "  Questions (1)",
      "  Recaps (1)",
      "  Sidebar (1)",
      "Personal: Agent Skills (1)",
      "Vercel Agent: Automations",
      "  Alert Investigations (1)",
      "  Planning (2)",
      "  PR Upkeep (1)",
      "  Triggers (2)",
      "Vercel Agent: Code Review (3)",
      "Vercel: Agent Foundations (1)",
      "Vercel: Inside Vercel (2)",
    ]);
    // Contexts and families split by count too, which matters once they
    // stop collapsing.
    expect(layout.state).toEqual({
      split: ["agent", "auto", "bb", "plugins", "vercel", "ws"],
      promoted: ["ws"],
    });
  });

  it("takes a promoted group's threads out of its parent's count", () => {
    // Without history, BB Plugins keeps 5 once Workstreams leaves, which is
    // not more than 5, so it lists them as one group.
    const layout = layoutGroups({ topics, counts: day32 });
    expect(outline(layout.nodes).slice(0, 3)).toEqual([
      "BB: Fork & Core (2)",
      "BB: Plugins (5)",
      "BB Plugins: Workstreams",
    ]);
    expect(layout.state.promoted).toEqual(["ws"]);
    expect(layout.state.split).not.toContain("plugins");
  });

  it("collapses a family of three into prefixes, even one that splits", () => {
    // Day 20: BB Plugins has three plugins with threads, so it has no
    // header and Workstreams can't move up from it.
    const layout = layoutGroups({
      topics,
      counts: {
        workforest: 1,
        architecture: 1,
        demo: 2,
        org: 1,
        questions: 1,
        recaps: 1,
        fx: 2,
      },
      previous: { split: ["plugins"], promoted: [] },
    });
    expect(outline(layout.nodes)).toEqual([
      "BB Plugins: fx provider (2)",
      "BB Plugins: Workforest (1)",
      "BB Plugins: Workstreams",
      "  Architecture (1)",
      "  Demo (2)",
      "  Organization (1)",
      "  Questions (1)",
      "  Recaps (1)",
    ]);
    expect(layout.state.promoted).toEqual([]);
  });

  it("keeps a split group split until it merges back at 3", () => {
    const counts = { planning: 2, triggers: 2 };
    const was = { split: ["auto"], promoted: [] };
    expect(
      outline(layoutGroups({ topics, counts, previous: was }).nodes),
    ).toEqual([
      "Vercel Agent: Automations",
      "  Planning (2)",
      "  Triggers (2)",
    ]);
    expect(outline(layoutGroups({ topics, counts }).nodes)).toEqual([
      "Vercel Agent: Automations (4)",
    ]);
    const merged = layoutGroups({
      topics,
      counts: { planning: 2, triggers: 1 },
      previous: was,
    });
    expect(outline(merged.nodes)).toEqual(["Vercel Agent: Automations (3)"]);
    expect(merged.listed).toEqual(["auto"]);
    expect(merged.state.split).toEqual([]);
  });

  it("splits a group above 5", () => {
    const layout = layoutGroups({
      topics,
      counts: { planning: 3, triggers: 3 },
    });
    expect(outline(layout.nodes)).toEqual([
      "Vercel Agent: Automations",
      "  Planning (3)",
      "  Triggers (3)",
    ]);
    expect(layout.listed).toEqual(["planning", "triggers"]);
  });

  it("shows an only child under its own name", () => {
    const layout = layoutGroups({ topics, counts: { review: 2 } });
    expect(outline(layout.nodes)).toEqual(["Vercel Agent: Code Review (2)"]);
  });

  it("keeps a partitioned group's header with one subgroup in use", () => {
    const layout = layoutGroups({
      topics,
      counts: { planning: 6 },
    });
    expect(outline(layout.nodes)).toEqual([
      "Vercel Agent: Automations",
      "  Planning (6)",
    ]);
  });

  it("drops a prefix that the next name starts with", () => {
    const layout = layoutGroups({
      topics: [
        { id: "bb", name: "BB", parentId: null },
        { id: "fork", name: "BB fork", parentId: "bb" },
        { id: "pibb", name: "Pibb", parentId: "bb" },
      ],
      counts: { fork: 1, pibb: 1 },
    });
    expect(outline(layout.nodes)).toEqual(["BB fork (1)", "BB: Pibb (1)"]);
  });

  it("promotes two co-dominant siblings", () => {
    const layout = layoutGroups({
      topics,
      counts: {
        demo: 4,
        recaps: 4,
        sandbox: 7,
        walkthrough: 1,
        fx: 1,
        workforest: 1,
      },
      previous: { split: ["ws"], promoted: [] },
    });
    // Sandbox is a leaf, so only Workstreams can split and move up.
    expect(layout.state.promoted).toEqual(["ws"]);
  });

  it("demotes below 30% and keeps a group promoted down to it", () => {
    const counts = {
      demo: 2,
      recaps: 2,
      sandbox: 5,
      walkthrough: 2,
      fx: 1,
      workforest: 1,
    };
    // Workstreams holds 4 of 13 (31%): enough to stay, not to move up.
    const was = { split: ["ws", "plugins"], promoted: ["ws"] };
    expect(
      layoutGroups({ topics, counts, previous: was }).state.promoted,
    ).toEqual(["ws"]);
    expect(
      layoutGroups({
        topics,
        counts,
        previous: { split: ["ws", "plugins"], promoted: [] },
      }).state.promoted,
    ).toEqual([]);
    expect(
      layoutGroups({
        topics,
        counts: { ...counts, sandbox: 7 },
        previous: was,
      }).state.promoted,
    ).toEqual([]);
  });

  it("promotes a group that would form a fourth level", () => {
    const deep: LayoutTopic[] = [
      { id: "x", name: "X", parentId: null },
      { id: "a", name: "A", parentId: "x" },
      { id: "b", name: "B", parentId: "a", partitioned: true },
      { id: "c", name: "C", parentId: "b", partitioned: true },
      { id: "c1", name: "C1", parentId: "c" },
      { id: "c2", name: "C2", parentId: "c" },
      { id: "g", name: "G", parentId: "b" },
      { id: "h", name: "H", parentId: "b" },
      { id: "d", name: "D", parentId: "a" },
      { id: "e", name: "E", parentId: "a" },
      { id: "f", name: "F", parentId: "a" },
    ];
    const layout = layoutGroups({
      topics: deep,
      counts: { c1: 3, c2: 3, g: 7, h: 7, d: 20, e: 10, f: 10 },
    });
    expect(outline(layout.nodes)).toEqual([
      "X: A",
      "  B",
      "    G (7)",
      "    H (7)",
      "  D (20)",
      "  E (10)",
      "  F (10)",
      "X A B: C",
      "  C1 (3)",
      "  C2 (3)",
    ]);
  });

  it("lists a legacy topic's own threads beside its subgroups", () => {
    const layout = layoutGroups({
      topics: [
        { id: "p", name: "Workstreams Plugin", parentId: null },
        { id: "r", name: "Reply Block", parentId: "p" },
        { id: "s", name: "Sidebar", parentId: "p" },
      ],
      counts: { p: 2, r: 4, s: 1 },
    });
    expect(outline(layout.nodes)).toEqual([
      "Workstreams Plugin (7)",
      "  Reply Block (4)",
      "  Sidebar (1)",
    ]);
    expect(layout.listed).toEqual(["p", "r", "s"]);
  });

  it("is a fixed point of its own state", () => {
    const cases: Record<string, number>[] = [
      day32,
      { planning: 4 },
      { demo: 9, fx: 1 },
    ];
    for (const counts of cases) {
      const first = layoutGroups({ topics, counts });
      const again = layoutGroups({ topics, counts, previous: first.state });
      expect(again).toEqual(first);
    }
  });

  it("survives a cycle and an unknown parent", () => {
    const layout = layoutGroups({
      topics: [
        { id: "a", name: "A", parentId: "b" },
        { id: "b", name: "B", parentId: "a" },
        { id: "c", name: "C", parentId: "missing" },
      ],
      counts: { a: 1, b: 1, c: 1 },
      previous: EMPTY_LAYOUT_STATE,
    });
    expect(outline(layout.nodes)).toEqual(["A (1)", "B (1)", "C (1)"]);
  });
});
