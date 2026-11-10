import { describe, expect, it } from "vitest";
import type { ChangeContext } from "../../src/domain/suggestion-change.ts";
import {
  suggestionPreview,
  type PreviewRow,
} from "../../src/domain/suggestion-preview.ts";

const topic = (
  id: string,
  name: string,
  parentId: string | null = null,
  aliases: string[] = [],
) => ({ id, name, parentId, aliases });

/**
 * bb holds Todo and Workforest; Payments and Billing are top-level leaves;
 * Agent › Code Review holds a thread; Automations holds a thread beside its
 * Alerts subtopic. t9 is archived.
 */
const context = (extra: Partial<ChangeContext> = {}): ChangeContext => ({
  topics: [
    topic("bb", "bb"),
    topic("todo", "Todo Plugin", "bb"),
    topic("wf", "Workforest", "bb"),
    topic("pay", "Payments"),
    topic("bill", "Billing"),
    topic("handoff", "Handoff Plugin"),
    topic("agent", "Agent"),
    topic("review", "Code Review", "agent"),
    topic("auto", "Automations"),
    topic("alerts", "Alerts", "auto"),
  ],
  threadTopic: {
    t1: "pay",
    t2: "pay",
    t3: "bill",
    t4: "handoff",
    t5: "todo",
    t6: "review",
    t7: "auto",
    t8: "alerts",
    t9: "pay",
    t10: null,
  },
  title: (id) => `Thread ${id}`,
  visible: (id) => id !== "t9",
  ...extra,
});
/** The slices without the color each row takes, which one test covers. */
const preview = (body: Parameters<typeof suggestionPreview>[0]) => {
  const result = suggestionPreview(body, context());
  const plain = (rows: readonly PreviewRow[]) =>
    rows.map(({ colorTopicId: _color, ...row }) => row);
  return result && { before: plain(result.before), after: plain(result.after) };
};
const titled = (...ids: string[]) =>
  ids.map((id) => ({ id, title: `Thread ${id}` }));

describe("suggestionPreview", () => {
  it("crosses out a renamed topic and shows the new name", () => {
    expect(preview({ op: "rename", topic: "todo", name: "Todos" })).toEqual({
      before: [
        { kind: "topic", name: "bb", depth: 0, mark: "same" },
        {
          kind: "topic",
          name: "Todo Plugin",
          depth: 1,
          mark: "gone",
          count: 1,
        },
      ],
      after: [
        { kind: "topic", name: "bb", depth: 0, mark: "same" },
        { kind: "topic", name: "Todos", depth: 1, mark: "new", count: 1 },
      ],
    });
  });

  it("nests a topic under its new parent, with the threads it takes", () => {
    expect(preview({ op: "reparent", topic: "handoff", parent: "bb" })).toEqual(
      {
        before: [
          { kind: "topic", name: "bb", depth: 0, mark: "same" },
          {
            kind: "topic",
            name: "Handoff Plugin",
            depth: 0,
            mark: "gone",
            count: 1,
          },
        ],
        after: [
          { kind: "topic", name: "bb", depth: 0, mark: "same" },
          {
            kind: "topic",
            name: "Handoff Plugin",
            depth: 1,
            mark: "new",
            count: 1,
            arriving: titled("t4"),
          },
        ],
      },
    );
  });

  it("brings a topic out to the top level beside its old parent", () => {
    expect(
      preview({ op: "reparent", topic: "todo", parent: null })?.after,
    ).toEqual([
      { kind: "topic", name: "bb", depth: 0, mark: "same" },
      {
        kind: "topic",
        name: "Todo Plugin",
        depth: 0,
        mark: "new",
        count: 1,
        arriving: titled("t5"),
      },
    ]);
  });

  it("adds the merged topic's visible threads to the one it joins", () => {
    expect(preview({ op: "merge", from: "pay", into: "bill" })).toEqual({
      before: [
        { kind: "topic", name: "Billing", depth: 0, mark: "same", count: 1 },
        { kind: "topic", name: "Payments", depth: 0, mark: "gone", count: 2 },
      ],
      after: [
        {
          kind: "topic",
          name: "Billing",
          depth: 0,
          mark: "new",
          count: 3,
          arriving: titled("t1", "t2"),
        },
      ],
    });
  });

  it("splits a topic's threads into new subtopics under it", () => {
    expect(
      preview({
        topicId: "pay",
        subgroups: [
          { name: "Refunds", description: "", threadIds: ["t1", "t9"] },
          { name: "Invoices", description: "", threadIds: ["t2"] },
        ],
      }),
    ).toEqual({
      before: [
        { kind: "topic", name: "Payments", depth: 0, mark: "same", count: 2 },
      ],
      after: [
        { kind: "topic", name: "Payments", depth: 0, mark: "same" },
        {
          kind: "topic",
          name: "Refunds",
          depth: 1,
          mark: "new",
          created: true,
          count: 1,
          arriving: titled("t1"),
        },
        {
          kind: "topic",
          name: "Invoices",
          depth: 1,
          mark: "new",
          created: true,
          count: 1,
          arriving: titled("t2"),
        },
      ],
    });
  });

  it("files a topic's loose threads into the subtopics it has", () => {
    expect(
      preview({
        topicId: "auto",
        repair: true,
        subgroups: [{ name: "Alerts", description: "", threadIds: ["t7"] }],
      }),
    ).toEqual({
      before: [
        { kind: "topic", name: "Automations", depth: 0, mark: "same" },
        { kind: "threads", name: "", depth: 1, mark: "gone", count: 1 },
        { kind: "topic", name: "Alerts", depth: 1, mark: "same", count: 1 },
      ],
      after: [
        { kind: "topic", name: "Automations", depth: 0, mark: "same" },
        {
          kind: "topic",
          name: "Alerts",
          depth: 1,
          mark: "new",
          count: 2,
          arriving: titled("t7"),
        },
      ],
    });
  });

  it("gathers topics under a new parent", () => {
    expect(
      preview({
        op: "create",
        name: "Finance",
        description: "",
        parent: null,
        children: ["pay", "bill"],
      })?.after,
    ).toEqual([
      { kind: "topic", name: "Finance", depth: 0, mark: "new", created: true },
      {
        kind: "topic",
        name: "Payments",
        depth: 1,
        mark: "new",
        count: 2,
        arriving: titled("t1", "t2"),
      },
      {
        kind: "topic",
        name: "Billing",
        depth: 1,
        mark: "new",
        count: 1,
        arriving: titled("t3"),
      },
    ]);
  });

  it("adds an empty topic beside its parent's subtopics", () => {
    expect(
      preview({
        op: "create",
        name: "Evals",
        description: "",
        parent: "agent",
        children: [],
      }),
    ).toEqual({
      before: [
        { kind: "topic", name: "Agent", depth: 0, mark: "same" },
        {
          kind: "topic",
          name: "Code Review",
          depth: 1,
          mark: "same",
          count: 1,
        },
      ],
      after: [
        { kind: "topic", name: "Agent", depth: 0, mark: "same" },
        {
          kind: "topic",
          name: "Code Review",
          depth: 1,
          mark: "same",
          count: 1,
        },
        { kind: "topic", name: "Evals", depth: 1, mark: "new", created: true },
      ],
    });
  });

  it("moves a thread from Unfiled into a nested topic, named with its parent", () => {
    expect(preview({ op: "move", thread: "t10", topic: "review" })).toEqual({
      before: [
        { kind: "topic", name: "Unfiled", depth: 0, mark: "same" },
        { kind: "thread", name: "Thread t10", depth: 1, mark: "gone" },
      ],
      after: [
        {
          kind: "topic",
          name: "Code Review",
          depth: 0,
          mark: "same",
          within: "Agent",
        },
        { kind: "thread", name: "Thread t10", depth: 1, mark: "new" },
      ],
    });
  });

  it("colors each row by its topic, a new one by its parent's", () => {
    const colors = (body: Parameters<typeof suggestionPreview>[0]) =>
      suggestionPreview(body, context())!.after.map((row) => row.colorTopicId);
    expect(
      colors({
        topicId: "pay",
        subgroups: [{ name: "Refunds", description: "", threadIds: ["t1"] }],
      }),
    ).toEqual(["pay", "pay"]);
    expect(colors({ op: "move", thread: "t10", topic: "review" })).toEqual([
      "review",
      "review",
    ]);
    expect(
      colors({
        op: "create",
        name: "Finance",
        description: "",
        parent: null,
        children: ["pay"],
      }),
    ).toEqual([undefined, "pay"]);
  });

  it("is null when a topic it names is gone", () => {
    expect(preview({ op: "rename", topic: "gone", name: "X" })).toBeNull();
  });
});
