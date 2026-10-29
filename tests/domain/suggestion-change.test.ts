import { describe, expect, it } from "vitest";
import {
  changeLines,
  suggestionChange,
  type ChangeContext,
} from "../../src/domain/suggestion-change.ts";

const topic = (
  id: string,
  name: string,
  parentId: string | null = null,
  aliases: string[] = [],
) => ({ id, name, parentId, aliases });

/**
 * bb holds Todo; Toolbelt holds two threads; Agent › Automations holds a
 * thread beside its Alerts subtopic.
 */
const context = (extra: Partial<ChangeContext> = {}): ChangeContext => ({
  topics: [
    topic("bb", "bb"),
    topic("todo", "Todo Plugin", "bb"),
    topic("toolbelt", "Toolbelt"),
    topic("agent", "Agent"),
    topic("auto", "Automations", "agent"),
    topic("alerts", "Alert Investigations", "auto", ["Alerts"]),
  ],
  threadTopic: {
    t1: "toolbelt",
    t2: "toolbelt",
    t3: "auto",
    t4: "alerts",
    t5: null,
  },
  title: (id) => `Thread ${id}`,
  ...extra,
});

const at = (...names: string[]) =>
  names.map((name) => ({ name, created: false }));
const made = (name: string) => ({ name, created: true });

describe("suggestionChange", () => {
  it("refiles a thread from where it is, or from Unfiled", () => {
    expect(
      suggestionChange({ op: "move", thread: "t1", topic: "todo" }, context()),
    ).toEqual({
      op: "refile",
      rows: [
        {
          kind: "thread",
          id: "t1",
          title: "Thread t1",
          from: at("Toolbelt"),
          to: at("bb", "Todo Plugin"),
        },
      ],
    });
    expect(
      suggestionChange({ op: "move", thread: "t5", topic: "todo" }, context())
        ?.rows[0],
    ).toMatchObject({ from: null });
  });

  it("splits a topic's threads into the subtopics it would create", () => {
    const change = suggestionChange(
      {
        topicId: "toolbelt",
        subgroups: [
          { name: "Shell", description: "", threadIds: ["t2"] },
          { name: "Sidebar", description: "", threadIds: ["t1"] },
        ],
      },
      context(),
    );
    expect(change?.op).toBe("split");
    expect(change?.rows).toEqual([
      {
        kind: "thread",
        id: "t2",
        title: "Thread t2",
        from: at("Toolbelt"),
        to: [...at("Toolbelt"), made("Shell")],
      },
      {
        kind: "thread",
        id: "t1",
        title: "Thread t1",
        from: at("Toolbelt"),
        to: [...at("Toolbelt"), made("Sidebar")],
      },
    ]);
  });

  it("files threads beside subtopics in existing subtopics by name or alias", () => {
    const change = suggestionChange(
      {
        topicId: "auto",
        repair: true,
        subgroups: [{ name: "alerts", description: "", threadIds: ["t3"] }],
      },
      context(),
    );
    expect(change?.op).toBe("file");
    expect(change?.rows[0]).toMatchObject({
      from: at("Agent", "Automations"),
      to: [...at("Agent", "Automations"), { name: "alerts", created: false }],
    });
  });

  it("merges a topic, with its threads and subtopics, into another", () => {
    const change = suggestionChange(
      { op: "merge", from: "auto", into: "todo" },
      context(),
    );
    expect(change).toEqual({
      op: "merge",
      rows: [
        {
          kind: "topic",
          name: "Automations",
          created: false,
          from: at("Agent"),
          to: at("bb", "Todo Plugin"),
          threads: 1,
        },
        {
          kind: "topic",
          name: "Alert Investigations",
          created: false,
          from: at("Agent", "Automations"),
          to: at("bb", "Todo Plugin"),
          threads: 1,
        },
      ],
    });
  });

  it("moves a topic with every thread below it", () => {
    expect(
      suggestionChange(
        { op: "reparent", topic: "agent", parent: "bb" },
        context(),
      )?.rows,
    ).toEqual([
      {
        kind: "topic",
        name: "Agent",
        created: false,
        from: [],
        to: at("bb"),
        threads: 2,
      },
    ]);
    expect(
      suggestionChange(
        { op: "reparent", topic: "todo", parent: null },
        context(),
      )?.rows[0],
    ).toMatchObject({ from: at("bb"), to: [] });
  });

  it("renames a topic in place", () => {
    expect(
      suggestionChange(
        { op: "rename", topic: "todo", name: "Todos" },
        context(),
      )?.rows[0],
    ).toMatchObject({
      name: "Todo Plugin",
      from: at("bb", "Todo Plugin"),
      to: at("bb", "Todos"),
    });
  });

  it("creates a parent around topics, or a topic on its own", () => {
    expect(
      suggestionChange(
        {
          op: "create",
          name: "Plugins",
          description: "",
          parent: "bb",
          children: ["todo"],
        },
        context(),
      )?.rows,
    ).toEqual([
      {
        kind: "topic",
        name: "Todo Plugin",
        created: false,
        from: at("bb"),
        to: [...at("bb"), made("Plugins")],
        threads: 0,
      },
    ]);
    expect(
      suggestionChange(
        {
          op: "create",
          name: "Plugins",
          description: "",
          parent: null,
          children: [],
        },
        context(),
      )?.rows,
    ).toEqual([
      {
        kind: "topic",
        name: "Plugins",
        created: true,
        from: null,
        to: [],
        threads: 0,
      },
    ]);
  });

  it("places a topic another suggestion of the pass creates", () => {
    const change = suggestionChange(
      { op: "move", thread: "t1", topic: "new:plugins" },
      context({
        creates: new Map([["plugins", { name: "Plugins", parent: "bb" }]]),
      }),
    );
    expect(change?.rows[0]).toMatchObject({
      to: [...at("bb"), made("Plugins")],
    });
  });

  it("is null when a thread or topic it names is gone", () => {
    expect(
      suggestionChange(
        { op: "move", thread: "gone", topic: "todo" },
        context(),
      ),
    ).toBeNull();
    expect(
      suggestionChange({ op: "merge", from: "gone", into: "todo" }, context()),
    ).toBeNull();
  });
});

describe("changeLines", () => {
  it("writes each row as item, from, and to", () => {
    expect(
      changeLines({
        op: "file",
        rows: [
          {
            kind: "thread",
            id: "t5",
            title: "Fix CI",
            from: null,
            to: [...at("Agent"), made("Evals")],
          },
          {
            kind: "topic",
            name: "Agent",
            created: false,
            from: [],
            to: at("bb"),
            threads: 2,
          },
        ],
      }),
    ).toEqual([
      "“Fix CI”: Unfiled → Agent › Evals (new)",
      "Topic Agent (2 threads): Top level → bb",
    ]);
  });
});
