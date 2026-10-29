import { describe, expect, it } from "vitest";
import {
  changeHeadline,
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
const listed = (...ids: string[]) =>
  ids.map((id) => ({ id, title: `Thread ${id}` }));

describe("suggestionChange", () => {
  it("refiles a thread from where it is, or from Unfiled", () => {
    expect(
      suggestionChange({ op: "move", thread: "t1", topic: "todo" }, context()),
    ).toEqual({
      op: "refile",
      moves: [
        {
          from: at("Toolbelt"),
          to: at("bb", "Todo Plugin"),
          threads: listed("t1"),
          carried: 0,
        },
      ],
    });
    expect(
      suggestionChange({ op: "move", thread: "t5", topic: "todo" }, context())
        ?.moves[0],
    ).toMatchObject({ from: null, threads: listed("t5") });
  });

  it("splits a topic's threads into the subtopics it would create", () => {
    expect(
      suggestionChange(
        {
          topicId: "toolbelt",
          subgroups: [
            { name: "Shell", description: "", threadIds: ["t2"] },
            { name: "Sidebar", description: "", threadIds: ["t1"] },
          ],
        },
        context(),
      ),
    ).toEqual({
      op: "split",
      moves: [
        {
          from: at("Toolbelt"),
          to: [...at("Toolbelt"), made("Shell")],
          threads: listed("t2"),
          carried: 0,
        },
        {
          from: at("Toolbelt"),
          to: [...at("Toolbelt"), made("Sidebar")],
          threads: listed("t1"),
          carried: 0,
        },
      ],
    });
  });

  it("shows a split's threads from where they are now, and drops gone ones", () => {
    const change = suggestionChange(
      {
        topicId: "toolbelt",
        subgroups: [
          { name: "Shell", description: "", threadIds: ["t1", "t3"] },
          { name: "Sidebar", description: "", threadIds: ["gone"] },
        ],
      },
      context(),
    );
    expect(change?.moves).toEqual([
      {
        from: at("Toolbelt"),
        to: [...at("Toolbelt"), made("Shell")],
        threads: listed("t1"),
        carried: 0,
      },
      {
        from: at("Agent", "Automations"),
        to: [...at("Toolbelt"), made("Shell")],
        threads: listed("t3"),
        carried: 0,
      },
      {
        from: at("Toolbelt"),
        to: [...at("Toolbelt"), made("Sidebar")],
        threads: [],
        carried: 0,
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
    expect(change?.moves[0]?.to).toEqual([
      ...at("Agent", "Automations"),
      { name: "alerts", created: false },
    ]);
  });

  it("merges a topic's threads and subtopics into another", () => {
    expect(
      suggestionChange({ op: "merge", from: "auto", into: "todo" }, context()),
    ).toEqual({
      op: "merge",
      moves: [
        {
          from: at("Agent", "Automations"),
          to: at("bb", "Todo Plugin"),
          threads: listed("t3"),
          carried: 0,
        },
        {
          from: at("Agent", "Automations", "Alert Investigations"),
          to: at("bb", "Todo Plugin", "Alert Investigations"),
          threads: [],
          carried: 1,
        },
      ],
    });
  });

  it("moves a topic with every thread below it", () => {
    expect(
      suggestionChange(
        { op: "reparent", topic: "agent", parent: "bb" },
        context(),
      )?.moves,
    ).toEqual([
      { from: at("Agent"), to: at("bb", "Agent"), threads: [], carried: 2 },
    ]);
    expect(
      suggestionChange(
        { op: "reparent", topic: "todo", parent: null },
        context(),
      )?.moves[0],
    ).toMatchObject({ from: at("bb", "Todo Plugin"), to: at("Todo Plugin") });
  });

  it("renames a topic in place", () => {
    expect(
      suggestionChange(
        { op: "rename", topic: "todo", name: "Todos" },
        context(),
      )?.moves[0],
    ).toMatchObject({ from: at("bb", "Todo Plugin"), to: at("bb", "Todos") });
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
      )?.moves,
    ).toEqual([
      {
        from: at("bb", "Todo Plugin"),
        to: [...at("bb"), made("Plugins"), ...at("Todo Plugin")],
        threads: [],
        carried: 0,
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
      )?.moves,
    ).toEqual([{ from: null, to: [made("Plugins")], threads: [], carried: 0 }]);
  });

  it("places a topic another suggestion of the pass creates", () => {
    const change = suggestionChange(
      { op: "move", thread: "t1", topic: "new:plugins" },
      context({
        creates: new Map([["plugins", { name: "Plugins", parent: "bb" }]]),
      }),
    );
    expect(change?.moves[0]?.to).toEqual([...at("bb"), made("Plugins")]);
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
  it("writes each move as from → to, with its threads below", () => {
    expect(
      changeLines({
        op: "file",
        moves: [
          {
            from: null,
            to: [...at("Agent"), made("Evals")],
            threads: [{ id: "t5", title: "Fix CI" }],
            carried: 0,
          },
          { from: at("Agent"), to: at("bb", "Agent"), threads: [], carried: 2 },
          { from: null, to: [made("Plugins")], threads: [], carried: 0 },
        ],
      }),
    ).toEqual([
      "Unfiled → Agent › Evals (new)",
      "  “Fix CI”",
      "Agent → bb › Agent (with 2 threads)",
      "Plugins (new)",
    ]);
  });
});

describe("changeHeadline", () => {
  const headline = (body: Parameters<typeof suggestionChange>[0]) =>
    changeHeadline(suggestionChange(body, context())!);

  it("names what moves and where", () => {
    expect(headline({ op: "move", thread: "t1", topic: "todo" })).toBe(
      "Move “Thread t1” to Todo Plugin",
    );
    expect(
      headline({
        topicId: "toolbelt",
        subgroups: [
          { name: "Shell", description: "", threadIds: ["t1"] },
          { name: "Sidebar", description: "", threadIds: ["t2"] },
        ],
      }),
    ).toBe("Split Toolbelt into Shell and Sidebar");
    expect(
      headline({
        topicId: "auto",
        repair: true,
        subgroups: [{ name: "Alerts", description: "", threadIds: ["t3"] }],
      }),
    ).toBe("Move “Thread t3” to Alerts");
    expect(
      headline({
        topicId: "toolbelt",
        repair: true,
        subgroups: [
          { name: "Shell", description: "", threadIds: ["t1"] },
          { name: "Sidebar", description: "", threadIds: ["t2"] },
        ],
      }),
    ).toBe("Move 2 Toolbelt threads into Shell and Sidebar");
    expect(
      headline({
        topicId: "toolbelt",
        repair: true,
        subgroups: [
          { name: "Shell", description: "", threadIds: ["t1"] },
          { name: "Sidebar", description: "", threadIds: ["gone"] },
        ],
      }),
    ).toBe("Move 1 Toolbelt thread into Shell and Sidebar");
    // Threads gone since leave no count.
    expect(
      headline({
        topicId: "toolbelt",
        subgroups: [{ name: "Shell", description: "", threadIds: ["gone"] }],
      }),
    ).toBe("Move threads to Shell");
    expect(headline({ op: "merge", from: "auto", into: "todo" })).toBe(
      "Merge Automations into Todo Plugin",
    );
    expect(headline({ op: "reparent", topic: "agent", parent: "bb" })).toBe(
      "Move Agent under bb",
    );
    expect(headline({ op: "reparent", topic: "todo", parent: null })).toBe(
      "Move Todo Plugin to the top level",
    );
    expect(headline({ op: "rename", topic: "todo", name: "Todos" })).toBe(
      "Rename Todo Plugin to Todos",
    );
    expect(
      headline({
        op: "create",
        name: "Work",
        description: "",
        parent: null,
        children: ["agent", "toolbelt", "bb"],
      }),
    ).toBe("Group Agent, Toolbelt, and bb under a new Work");
    expect(
      headline({
        op: "create",
        name: "Plugins",
        description: "",
        parent: "bb",
        children: [],
      }),
    ).toBe("Create Plugins under bb");
  });
});
