import { describe, expect, it } from "vitest";
import {
  applyDelta,
  changeDelta,
  changeHeadline,
  changeLines,
  newTopicId,
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
      {
        from: at("Agent"),
        to: at("bb", "Agent"),
        threads: [],
        carried: 2,
      },
    ]);
    expect(
      suggestionChange(
        { op: "reparent", topic: "todo", parent: null },
        context(),
      )?.moves[0],
    ).toMatchObject({ from: at("bb", "Todo Plugin"), to: at("Todo Plugin") });
  });

  it("counts only visible threads moving with a topic", () => {
    const hidden = context({ visible: (id) => id !== "t4" && id !== "t1" });
    expect(
      suggestionChange({ op: "reparent", topic: "agent", parent: "bb" }, hidden)
        ?.moves[0],
    ).toMatchObject({ carried: 1 });
    expect(
      suggestionChange({ op: "merge", from: "toolbelt", into: "bb" }, hidden)
        ?.moves[0]?.threads,
    ).toEqual(listed("t2"));
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
    // Three or more destinations read as their count: the preview names each.
    expect(
      headline({
        topicId: "toolbelt",
        subgroups: [
          { name: "Shell", description: "", threadIds: ["t1"] },
          { name: "Sidebar", description: "", threadIds: ["t2"] },
          { name: "Docs", description: "", threadIds: ["t3"] },
          { name: "Plugins", description: "", threadIds: ["t4"] },
          { name: "Skills", description: "", threadIds: ["t5"] },
        ],
      }),
    ).toBe("Split Toolbelt into 5 workstreams");
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
    expect(
      headline({
        topicId: "toolbelt",
        repair: true,
        subgroups: [
          { name: "Shell", description: "", threadIds: ["t1"] },
          { name: "Sidebar", description: "", threadIds: ["t2"] },
          { name: "Docs", description: "", threadIds: ["t3"] },
        ],
      }),
    ).toBe("Move 3 Toolbelt threads into 3 workstreams");
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
    expect(
      headline({
        op: "reparent",
        topic: "agent",
        parent: "bb",
        name: "Agents",
      }),
    ).toBe("Move Agent under bb as Agents");
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
    ).toBe("Group 3 topics under a new Work");
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

describe("changeDelta", () => {
  /**
   * Billing holds Invoices and Payments; Docs holds two threads; Infra holds
   * one beside no subtopics; "Automations" is empty. t9 is archived work
   * filed under Payments.
   */
  const world = (extra: Partial<ChangeContext> = {}): ChangeContext => ({
    topics: [
      topic("billing", "Billing"),
      topic("invoices", "Invoices", "billing"),
      topic("payments", "Payments", "billing", ["Pay"]),
      topic("docs", "Docs"),
      topic("infra", "Infra"),
      topic("auto", "Automations"),
      topic("web", "Web"),
      topic("invoices-web", "Invoices", "web"),
    ],
    threadTopic: {
      i1: "invoices",
      p1: "payments",
      p2: "payments",
      t9: "payments",
      d1: "docs",
      d2: "docs",
      f1: "infra",
      u1: null,
      w1: "invoices-web",
    },
    title: (id) => `Thread ${id}`,
    ...extra,
  });

  it("refiles a thread, and files an unfiled one", () => {
    expect(
      changeDelta({ op: "move", thread: "d1", topic: "infra" }, world()),
    ).toEqual({
      topics: [],
      removed: [],
      assignments: [{ threadId: "d1", topicId: "infra" }],
    });
    expect(
      changeDelta({ op: "move", thread: "u1", topic: "docs" }, world())
        ?.assignments,
    ).toEqual([{ threadId: "u1", topicId: "docs" }]);
  });

  it("moves nothing for a rename, and names the topic as it will be", () => {
    expect(
      changeDelta(
        { op: "rename", topic: "docs", name: " Documentation " },
        world(),
      ),
    ).toEqual({
      topics: [{ id: "docs", name: "Documentation", parentId: null }],
      removed: [],
      assignments: [],
    });
  });

  it("reparents a topic, with or without a new name", () => {
    expect(
      changeDelta({ op: "reparent", topic: "docs", parent: "billing" }, world())
        ?.topics,
    ).toEqual([{ id: "docs", name: "Docs", parentId: "billing" }]);
    expect(
      changeDelta(
        {
          op: "reparent",
          topic: "invoices",
          parent: null,
          name: "Billing Docs",
        },
        world(),
      )?.topics,
    ).toEqual([{ id: "invoices", name: "Billing Docs", parentId: null }]);
  });

  it("merges a topic into another: threads follow and the source is removed", () => {
    expect(
      changeDelta({ op: "merge", from: "docs", into: "infra" }, world()),
    ).toEqual({
      topics: [],
      removed: ["docs"],
      assignments: [
        { threadId: "d1", topicId: "infra" },
        { threadId: "d2", topicId: "infra" },
      ],
    });
  });

  it("moves archived assignments along with a merge", () => {
    const merged = changeDelta(
      { op: "merge", from: "payments", into: "invoices" },
      world({ visible: (id) => id !== "t9" }),
    )!;
    expect(merged.assignments.map((a) => a.threadId).sort()).toEqual([
      "p1",
      "p2",
      "t9",
    ]);
  });

  it("merges a topic with subtopics, joining subtopics of the same name", () => {
    expect(
      changeDelta({ op: "merge", from: "web", into: "billing" }, world()),
    ).toEqual({
      topics: [],
      removed: ["web", "invoices-web"],
      assignments: [{ threadId: "w1", topicId: "invoices" }],
    });
  });

  it("lets a merge target inside the source take the source's place", () => {
    const merged = changeDelta(
      { op: "merge", from: "billing", into: "payments" },
      world(),
    )!;
    expect(merged.removed).toEqual(["billing"]);
    expect(merged.topics).toEqual(
      expect.arrayContaining([
        { id: "payments", name: "Payments", parentId: null },
        { id: "invoices", name: "Invoices", parentId: "payments" },
      ]),
    );
  });

  it("creates a topic, adopting the topics it names", () => {
    const created = changeDelta(
      {
        op: "create",
        name: "Money",
        description: "",
        parent: null,
        children: ["docs", "infra"],
      },
      world(),
    )!;
    expect(created.topics).toEqual(
      expect.arrayContaining([
        { id: newTopicId(null, "Money"), name: "Money", parentId: null },
        { id: "docs", name: "Docs", parentId: newTopicId(null, "Money") },
        { id: "infra", name: "Infra", parentId: newTopicId(null, "Money") },
      ]),
    );
    expect(
      changeDelta(
        {
          op: "create",
          name: "Ops",
          description: "",
          parent: null,
          children: [],
        },
        world(),
      ),
    ).toEqual({
      topics: [{ id: newTopicId(null, "Ops"), name: "Ops", parentId: null }],
      removed: [],
      assignments: [],
    });
  });

  it("splits a topic into new subtopics and reuses a matching one", () => {
    const split = changeDelta(
      {
        topicId: "docs",
        subgroups: [
          { name: "Guides", description: "", threadIds: ["d1"] },
          { name: "Reference", description: "", threadIds: ["d2"] },
          { name: "Unused", description: "", threadIds: [] },
        ],
      },
      world(),
    )!;
    expect(split.topics).toEqual([
      { id: newTopicId("docs", "Guides"), name: "Guides", parentId: "docs" },
      {
        id: newTopicId("docs", "Reference"),
        name: "Reference",
        parentId: "docs",
      },
    ]);
    expect(split.assignments).toEqual([
      { threadId: "d1", topicId: newTopicId("docs", "Guides") },
      { threadId: "d2", topicId: newTopicId("docs", "Reference") },
    ]);
    // A subgroup named like an existing subtopic, or its alias, files into it.
    expect(
      changeDelta(
        {
          topicId: "billing",
          subgroups: [
            { name: "pay", description: "", threadIds: ["p1", "t9"] },
          ],
        },
        world(),
      ),
    ).toEqual({
      topics: [],
      removed: [],
      assignments: [],
    });
  });

  it("is null when a topic or thread it names is gone", () => {
    expect(
      changeDelta({ op: "move", thread: "gone", topic: "docs" }, world()),
    ).toBeNull();
    expect(
      changeDelta({ op: "move", thread: "d1", topic: "gone" }, world()),
    ).toBeNull();
    expect(
      changeDelta({ op: "rename", topic: "gone", name: "X" }, world()),
    ).toBeNull();
    expect(
      changeDelta(
        {
          topicId: "docs",
          subgroups: [{ name: "A", description: "", threadIds: ["gone"] }],
        },
        world(),
      ),
    ).toBeNull();
  });

  it("is null while it needs a topic another suggestion creates", () => {
    expect(
      changeDelta({ op: "move", thread: "d1", topic: "new:Money" }, world()),
    ).toBeNull();
  });

  it("is null when the result would pass two levels", () => {
    expect(
      changeDelta(
        { op: "reparent", topic: "docs", parent: "invoices" },
        world(),
      ),
    ).toBeNull();
    expect(
      changeDelta(
        { op: "reparent", topic: "billing", parent: "docs" },
        world(),
      ),
    ).toBeNull();
  });

  it("applies to topics and filing without changing its inputs", () => {
    const context = world();
    const change = changeDelta(
      { op: "merge", from: "docs", into: "infra" },
      context,
    )!;
    const filing = { ...context.threadTopic };
    const after = applyDelta(context.topics, filing, change);
    expect(after.topics.map((t) => t.id)).not.toContain("docs");
    expect(after.filing.d1).toBe("infra");
    expect(filing.d1).toBe("docs");
    expect(context.topics.map((t) => t.id)).toContain("docs");
  });
});
