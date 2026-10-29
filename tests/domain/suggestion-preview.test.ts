import { describe, expect, it } from "vitest";
import type { ChangeContext } from "../../src/domain/suggestion-change.ts";
import {
  suggestionPreview,
  type PreviewGroup,
} from "../../src/domain/suggestion-preview.ts";

const topic = (
  id: string,
  name: string,
  parentId: string | null = null,
  aliases: string[] = [],
) => ({ id, name, parentId, aliases });

/**
 * bb holds Todo and Sandbox; Agent › Automations holds three threads beside
 * its Alerts subgroup; Empty has no threads.
 */
const context = (extra: Partial<ChangeContext> = {}): ChangeContext => ({
  topics: [
    topic("bb", "bb"),
    topic("todo", "Todo Plugin", "bb"),
    topic("sandbox", "Sandbox", "bb"),
    topic("agent", "Agent"),
    topic("auto", "Automations", "agent"),
    topic("alerts", "Alert Investigations", "auto", ["Alerts"]),
    topic("empty", "Empty"),
  ],
  threadTopic: {
    a1: "auto",
    a2: "auto",
    a3: "auto",
    al: "alerts",
    t1: "todo",
    s1: "sandbox",
    u1: null,
  },
  title: (id) => `Thread ${id}`,
  ...extra,
});

/** A group as a compact outline: names, flags, and threads (* moves). */
const outline = (groups: readonly PreviewGroup[], depth = 0): string[] =>
  groups.flatMap((g) => [
    `${"  ".repeat(depth)}${g.context ? `(${g.name})` : g.name}${[
      g.created && " new",
      g.removed && " removed",
      g.moved && " moved",
      g.renamedFrom && ` was ${g.renamedFrom}`,
      g.collapsed !== null && ` · ${g.collapsed}`,
    ]
      .filter(Boolean)
      .join("")}`,
    ...g.threads.map(
      (t) => `${"  ".repeat(depth + 1)}${t.moved ? "*" : "-"} ${t.title}`,
    ),
    ...(g.more ? [`${"  ".repeat(depth + 1)}+${g.more} threads`] : []),
    ...outline(g.groups, depth + 1),
    ...(g.others ? [`${"  ".repeat(depth + 1)}+${g.others} groups`] : []),
  ]);

const preview = (
  body: Parameters<typeof suggestionPreview>[0],
  ctx = context(),
) => {
  const result = suggestionPreview(body, ctx);
  return (
    result && { before: outline(result.before), after: outline(result.after) }
  );
};

describe("suggestionPreview", () => {
  it("shows a group's threads leaving for the subgroups a split makes", () => {
    expect(
      preview({
        topicId: "auto",
        repair: true,
        subgroups: [
          { name: "PR Upkeep", description: "", threadIds: ["a1", "a2"] },
          { name: "alerts", description: "", threadIds: ["a3"] },
        ],
      }),
    ).toEqual({
      before: [
        "(Agent)",
        "  Automations",
        "    * Thread a1",
        "    * Thread a2",
        "    * Thread a3",
        "    Alert Investigations",
        "      - Thread al",
      ],
      after: [
        "(Agent)",
        "  Automations",
        "    Alert Investigations",
        "      * Thread a3",
        "      - Thread al",
        "    PR Upkeep new",
        "      * Thread a1",
        "      * Thread a2",
      ],
    });
  });

  it("files an Unfiled thread", () => {
    expect(preview({ op: "move", thread: "u1", topic: "sandbox" })).toEqual({
      before: [
        "(bb)",
        "  Sandbox",
        "    - Thread s1",
        "Unfiled",
        "  * Thread u1",
      ],
      after: ["(bb)", "  Sandbox", "    * Thread u1", "    - Thread s1"],
    });
  });

  it("moves a group with its threads under another", () => {
    const moved = [
      "  Automations moved",
      "    - Thread a1",
      "    - Thread a2",
      "    - Thread a3",
      "    Alert Investigations · 1",
    ];
    expect(preview({ op: "reparent", topic: "auto", parent: "bb" })).toEqual({
      before: ["(Agent)", ...moved],
      after: ["(bb)", ...moved],
    });
  });

  it("folds a merged group's same-named subgroups together", () => {
    const base = context();
    const ctx = context({
      topics: [
        ...base.topics,
        topic("ops", "Ops"),
        topic("opsbox", "Sandbox", "ops"),
      ],
      threadTopic: { ...base.threadTopic, o1: "opsbox" },
    });
    expect(preview({ op: "merge", from: "ops", into: "bb" }, ctx)).toEqual({
      before: [
        "(bb)",
        "  Sandbox",
        "    - Thread s1",
        "Ops removed",
        "  Sandbox removed",
        "    * Thread o1",
      ],
      after: ["(bb)", "  Sandbox", "    * Thread o1", "    - Thread s1"],
    });
  });

  it("shows a rename on the group's own header", () => {
    expect(
      preview({ op: "rename", topic: "todo", name: "Todos" })?.after,
    ).toEqual(["(bb)", "  Todos was Todo Plugin", "    - Thread t1"]);
  });

  it("lists a few unchanged threads and groups, and counts the rest", () => {
    const base = context();
    const ctx = context({
      topics: [
        ...base.topics,
        topic("c", "Cli", "bb"),
        topic("d", "Docs", "bb"),
      ],
      threadTopic: {
        ...base.threadTopic,
        ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`x${n}`, "sandbox"])),
        c1: "c",
        d1: "d",
      },
    });
    expect(
      preview({ op: "move", thread: "u1", topic: "sandbox" }, ctx)?.after,
    ).toEqual([
      "(bb)",
      "  Sandbox",
      "    * Thread u1",
      "    - Thread s1",
      "    - Thread x1",
      "    - Thread x2",
      "    +3 threads",
    ]);
    expect(
      preview({ op: "rename", topic: "bb", name: "BB" }, ctx)?.after,
    ).toEqual([
      "BB was bb",
      "  Todo Plugin · 1",
      "  Sandbox · 6",
      "  +2 groups",
    ]);
  });

  it("is null when no thread changes groups, or something is gone", () => {
    expect(
      suggestionPreview(
        { op: "reparent", topic: "empty", parent: "bb" },
        context(),
      ),
    ).toBeNull();
    expect(
      suggestionPreview(
        { op: "move", thread: "gone", topic: "todo" },
        context(),
      ),
    ).toBeNull();
  });
});
