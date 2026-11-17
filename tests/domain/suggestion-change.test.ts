import { describe, expect, it } from "vitest";
import {
  applyDelta,
  changeDelta,
  changeHeadline,
  changeLines,
  newWorkstreamId,
  suggestionChange,
  type ChangeContext,
} from "../../src/domain/suggestion-change.ts";

const workstream = (
  id: string,
  name: string,
  parentId: string | null = null,
  aliases: string[] = [],
) => ({ id, name, parentId, aliases });

/**
 * bb holds Todo; Toolbelt holds two threads; Agent › Automations holds a
 * thread beside its Alerts workstream.
 */
const context = (extra: Partial<ChangeContext> = {}): ChangeContext => ({
  workstreams: [
    workstream("bb", "bb"),
    workstream("todo", "Todo Plugin", "bb"),
    workstream("toolbelt", "Toolbelt"),
    workstream("agent", "Agent"),
    workstream("auto", "Automations", "agent"),
    workstream("alerts", "Alert Investigations", "auto", ["Alerts"]),
  ],
  threadWorkstream: {
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
  it("moves a thread from where it is, or from Other", () => {
    expect(
      suggestionChange(
        { op: "move-thread", thread: "t1", workstream: "todo" },
        context(),
      ),
    ).toEqual({
      op: "move-thread",
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
      suggestionChange(
        { op: "move-thread", thread: "t5", workstream: "todo" },
        context(),
      )?.moves[0],
    ).toMatchObject({ from: null, threads: listed("t5") });
  });

  it("splits a workstream's threads into the workstreams it would create", () => {
    expect(
      suggestionChange(
        {
          workstreamId: "toolbelt",
          workstreams: [
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
        workstreamId: "toolbelt",
        workstreams: [
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

  it("moves threads beside child workstreams into existing ones by name or alias", () => {
    const change = suggestionChange(
      {
        workstreamId: "auto",
        repair: true,
        workstreams: [{ name: "alerts", description: "", threadIds: ["t3"] }],
      },
      context(),
    );
    expect(change?.op).toBe("repair");
    expect(change?.moves[0]?.to).toEqual([
      ...at("Agent", "Automations"),
      { name: "alerts", created: false },
    ]);
  });

  it("merges a workstream's threads and child workstreams into another", () => {
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

  it("moves a workstream with every thread below it", () => {
    expect(
      suggestionChange(
        { op: "move-workstream", workstream: "agent", parent: "bb" },
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
        { op: "move-workstream", workstream: "todo", parent: null },
        context(),
      )?.moves[0],
    ).toMatchObject({ from: at("bb", "Todo Plugin"), to: at("Todo Plugin") });
  });

  it("counts only visible threads moving with a workstream", () => {
    const hidden = context({ visible: (id) => id !== "t4" && id !== "t1" });
    expect(
      suggestionChange(
        { op: "move-workstream", workstream: "agent", parent: "bb" },
        hidden,
      )?.moves[0],
    ).toMatchObject({ carried: 1 });
    expect(
      suggestionChange({ op: "merge", from: "toolbelt", into: "bb" }, hidden)
        ?.moves[0]?.threads,
    ).toEqual(listed("t2"));
  });

  it("renames a workstream in place", () => {
    expect(
      suggestionChange(
        { op: "rename", workstream: "todo", name: "Todos" },
        context(),
      )?.moves[0],
    ).toMatchObject({ from: at("bb", "Todo Plugin"), to: at("bb", "Todos") });
  });

  it("creates a group around workstreams, or a workstream on its own", () => {
    expect(
      suggestionChange(
        {
          op: "group",
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
          op: "group",
          name: "Plugins",
          description: "",
          parent: null,
          children: [],
        },
        context(),
      )?.moves,
    ).toEqual([{ from: null, to: [made("Plugins")], threads: [], carried: 0 }]);
  });

  it("places a workstream another suggestion of the pass creates", () => {
    const change = suggestionChange(
      { op: "move-thread", thread: "t1", workstream: "new:plugins" },
      context({
        creates: new Map([["plugins", { name: "Plugins", parent: "bb" }]]),
      }),
    );
    expect(change?.moves[0]?.to).toEqual([...at("bb"), made("Plugins")]);
  });

  it("is null when a thread or workstream it names is gone", () => {
    expect(
      suggestionChange(
        { op: "move-thread", thread: "gone", workstream: "todo" },
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
        op: "repair",
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
      "No workstream → Agent › Evals (new)",
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
    expect(
      headline({ op: "move-thread", thread: "t1", workstream: "todo" }),
    ).toBe("Move “Thread t1” to Todo Plugin");
    expect(
      headline({
        workstreamId: "toolbelt",
        workstreams: [
          { name: "Shell", description: "", threadIds: ["t1"] },
          { name: "Sidebar", description: "", threadIds: ["t2"] },
        ],
      }),
    ).toBe("Split Toolbelt into Shell and Sidebar");
    // Three or more destinations read as their count: the preview names each.
    expect(
      headline({
        workstreamId: "toolbelt",
        workstreams: [
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
        workstreamId: "auto",
        repair: true,
        workstreams: [{ name: "Alerts", description: "", threadIds: ["t3"] }],
      }),
    ).toBe("Move “Thread t3” to Alerts");
    expect(
      headline({
        workstreamId: "toolbelt",
        repair: true,
        workstreams: [
          { name: "Shell", description: "", threadIds: ["t1"] },
          { name: "Sidebar", description: "", threadIds: ["t2"] },
        ],
      }),
    ).toBe("Move 2 Toolbelt threads into Shell and Sidebar");
    expect(
      headline({
        workstreamId: "toolbelt",
        repair: true,
        workstreams: [
          { name: "Shell", description: "", threadIds: ["t1"] },
          { name: "Sidebar", description: "", threadIds: ["gone"] },
        ],
      }),
    ).toBe("Move 1 Toolbelt thread into Shell and Sidebar");
    expect(
      headline({
        workstreamId: "toolbelt",
        repair: true,
        workstreams: [
          { name: "Shell", description: "", threadIds: ["t1"] },
          { name: "Sidebar", description: "", threadIds: ["t2"] },
          { name: "Docs", description: "", threadIds: ["t3"] },
        ],
      }),
    ).toBe("Move 3 Toolbelt threads into 3 workstreams");
    // Threads gone since leave no count.
    expect(
      headline({
        workstreamId: "toolbelt",
        workstreams: [{ name: "Shell", description: "", threadIds: ["gone"] }],
      }),
    ).toBe("Move threads to Shell");
    expect(headline({ op: "merge", from: "auto", into: "todo" })).toBe(
      "Merge Automations into Todo Plugin",
    );
    expect(
      headline({ op: "move-workstream", workstream: "agent", parent: "bb" }),
    ).toBe("Move Agent into bb");
    expect(
      headline({ op: "move-workstream", workstream: "todo", parent: null }),
    ).toBe("Move Todo Plugin out of its group");
    expect(
      headline({
        op: "move-workstream",
        workstream: "agent",
        parent: "bb",
        name: "Agents",
      }),
    ).toBe("Move Agent into bb as Agents");
    expect(headline({ op: "rename", workstream: "todo", name: "Todos" })).toBe(
      "Rename Todo Plugin to Todos",
    );
    expect(
      headline({
        op: "group",
        name: "Work",
        description: "",
        parent: null,
        children: ["agent", "toolbelt", "bb"],
      }),
    ).toBe("Group 3 workstreams under a new Work");
    expect(
      headline({
        op: "group",
        name: "Plugins",
        description: "",
        parent: "bb",
        children: [],
      }),
    ).toBe("Create Plugins in bb");
  });
});

describe("changeDelta", () => {
  /**
   * Billing holds Invoices and Payments; Docs holds two threads; Infra holds
   * one beside no child workstreams; "Automations" is empty. t9 is archived
   * work in Payments.
   */
  const world = (extra: Partial<ChangeContext> = {}): ChangeContext => ({
    workstreams: [
      workstream("billing", "Billing"),
      workstream("invoices", "Invoices", "billing"),
      workstream("payments", "Payments", "billing", ["Pay"]),
      workstream("docs", "Docs"),
      workstream("infra", "Infra"),
      workstream("auto", "Automations"),
      workstream("web", "Web"),
      workstream("invoices-web", "Invoices", "web"),
    ],
    threadWorkstream: {
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

  it("moves a thread, and moves one with no workstream", () => {
    expect(
      changeDelta(
        { op: "move-thread", thread: "d1", workstream: "infra" },
        world(),
      ),
    ).toMatchObject({
      workstreams: [],
      removed: [],
      assignments: [{ threadId: "d1", workstreamId: "infra" }],
      // Where it leaves and where it lands.
      held: [
        { threadId: "d1", workstreamId: "docs" },
        { threadId: "d2", workstreamId: "docs" },
        { threadId: "f1", workstreamId: "infra" },
      ],
    });
    expect(
      changeDelta(
        { op: "move-thread", thread: "u1", workstream: "docs" },
        world(),
      )?.assignments,
    ).toEqual([{ threadId: "u1", workstreamId: "docs" }]);
  });

  it("moves nothing for a rename, and names the workstream as it will be", () => {
    expect(
      changeDelta(
        { op: "rename", workstream: "docs", name: " Documentation " },
        world(),
      ),
    ).toMatchObject({
      workstreams: [{ id: "docs", name: "Documentation", parentId: null }],
      removed: [],
      assignments: [],
      held: [
        { threadId: "d1", workstreamId: "docs" },
        { threadId: "d2", workstreamId: "docs" },
      ],
    });
  });

  it("reparents a workstream, with or without a new name", () => {
    expect(
      changeDelta(
        { op: "move-workstream", workstream: "docs", parent: "billing" },
        world(),
      )?.workstreams,
    ).toEqual([{ id: "docs", name: "Docs", parentId: "billing" }]);
    expect(
      changeDelta(
        {
          op: "move-workstream",
          workstream: "invoices",
          parent: null,
          name: "Billing Docs",
        },
        world(),
      )?.workstreams,
    ).toEqual([{ id: "invoices", name: "Billing Docs", parentId: null }]);
  });

  it("merges a workstream into another: threads follow and the source is removed", () => {
    expect(
      changeDelta({ op: "merge", from: "docs", into: "infra" }, world()),
    ).toMatchObject({
      workstreams: [],
      removed: ["docs"],
      assignments: [
        { threadId: "d1", workstreamId: "infra" },
        { threadId: "d2", workstreamId: "infra" },
      ],
      held: [
        { threadId: "d1", workstreamId: "docs" },
        { threadId: "d2", workstreamId: "docs" },
        { threadId: "f1", workstreamId: "infra" },
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

  it("merges a group, joining child workstreams of the same name", () => {
    expect(
      changeDelta({ op: "merge", from: "web", into: "billing" }, world()),
    ).toMatchObject({
      workstreams: [],
      removed: ["web", "invoices-web"],
      assignments: [{ threadId: "w1", workstreamId: "invoices" }],
      held: [
        { threadId: "i1", workstreamId: "invoices" },
        { threadId: "w1", workstreamId: "invoices-web" },
      ],
    });
  });

  it("lets a merge target inside the source take the source's place", () => {
    const merged = changeDelta(
      { op: "merge", from: "billing", into: "payments" },
      world(),
    )!;
    expect(merged.removed).toEqual(["billing"]);
    expect(merged.workstreams).toEqual(
      expect.arrayContaining([
        { id: "payments", name: "Payments", parentId: null },
        { id: "invoices", name: "Invoices", parentId: "payments" },
      ]),
    );
  });

  it("creates a workstream, adopting the workstreams it names", () => {
    const created = changeDelta(
      {
        op: "group",
        name: "Money",
        description: "",
        parent: null,
        children: ["docs", "infra"],
      },
      world(),
    )!;
    expect(created.workstreams).toEqual(
      expect.arrayContaining([
        { id: newWorkstreamId(null, "Money"), name: "Money", parentId: null },
        { id: "docs", name: "Docs", parentId: newWorkstreamId(null, "Money") },
        {
          id: "infra",
          name: "Infra",
          parentId: newWorkstreamId(null, "Money"),
        },
      ]),
    );
    expect(
      changeDelta(
        {
          op: "group",
          name: "Ops",
          description: "",
          parent: null,
          children: [],
        },
        world(),
      ),
    ).toMatchObject({
      workstreams: [
        { id: newWorkstreamId(null, "Ops"), name: "Ops", parentId: null },
      ],
      removed: [],
      assignments: [],
      held: [],
    });
  });

  it("splits a workstream into new workstreams and reuses a matching one", () => {
    const split = changeDelta(
      {
        workstreamId: "docs",
        workstreams: [
          { name: "Guides", description: "", threadIds: ["d1"] },
          { name: "Reference", description: "", threadIds: ["d2"] },
          { name: "Unused", description: "", threadIds: [] },
        ],
      },
      world(),
    )!;
    expect(split.workstreams).toEqual([
      {
        id: newWorkstreamId("docs", "Guides"),
        name: "Guides",
        parentId: "docs",
      },
      {
        id: newWorkstreamId("docs", "Reference"),
        name: "Reference",
        parentId: "docs",
      },
    ]);
    expect(split.assignments).toEqual([
      { threadId: "d1", workstreamId: newWorkstreamId("docs", "Guides") },
      { threadId: "d2", workstreamId: newWorkstreamId("docs", "Reference") },
    ]);
    // A subgroup named like an existing workstream, or its alias, moves into
    // it.
    expect(
      changeDelta(
        {
          workstreamId: "billing",
          workstreams: [
            { name: "pay", description: "", threadIds: ["p1", "t9"] },
          ],
        },
        world(),
      ),
    ).toMatchObject({
      workstreams: [],
      removed: [],
      assignments: [],
      held: [],
    });
  });

  it("names the threads in a workstream it touches, with titles, and leaves archived ones out", () => {
    const delta = changeDelta(
      { op: "rename", workstream: "payments", name: "Billing Payments" },
      world({ visible: (id) => id !== "t9" }),
    )!;
    expect(delta.held).toEqual([
      { threadId: "p1", workstreamId: "payments", title: "Thread p1" },
      { threadId: "p2", workstreamId: "payments", title: "Thread p2" },
    ]);
  });

  it("counts the archived threads it moves, and does not name them", () => {
    const delta = changeDelta(
      { op: "merge", from: "payments", into: "invoices" },
      world({ visible: (id) => id !== "t9" }),
    )!;
    expect(delta.archived).toBe(1);
    expect(delta.assignments).toHaveLength(3);
    expect(delta.held.some((h) => h.threadId === "t9")).toBe(false);
    expect(
      changeDelta(
        { op: "move-thread", thread: "d1", workstream: "infra" },
        world(),
      )!.archived,
    ).toBe(0);
  });

  it("is null when a workstream or thread it names is gone", () => {
    expect(
      changeDelta(
        { op: "move-thread", thread: "gone", workstream: "docs" },
        world(),
      ),
    ).toBeNull();
    expect(
      changeDelta(
        { op: "move-thread", thread: "d1", workstream: "gone" },
        world(),
      ),
    ).toBeNull();
    expect(
      changeDelta({ op: "rename", workstream: "gone", name: "X" }, world()),
    ).toBeNull();
    expect(
      changeDelta(
        {
          workstreamId: "docs",
          workstreams: [{ name: "A", description: "", threadIds: ["gone"] }],
        },
        world(),
      ),
    ).toBeNull();
  });

  it("is null while it needs a workstream another suggestion creates", () => {
    expect(
      changeDelta(
        { op: "move-thread", thread: "d1", workstream: "new:Money" },
        world(),
      ),
    ).toBeNull();
  });

  it("is null when the result would pass two levels", () => {
    expect(
      changeDelta(
        { op: "move-workstream", workstream: "docs", parent: "invoices" },
        world(),
      ),
    ).toBeNull();
    expect(
      changeDelta(
        { op: "move-workstream", workstream: "billing", parent: "docs" },
        world(),
      ),
    ).toBeNull();
  });

  it("applies to workstreams and thread workstreams without changing its inputs", () => {
    const context = world();
    const change = changeDelta(
      { op: "merge", from: "docs", into: "infra" },
      context,
    )!;
    const placed = { ...context.threadWorkstream };
    const after = applyDelta(context.workstreams, placed, change);
    expect(after.workstreams.map((t) => t.id)).not.toContain("docs");
    expect(after.placed.d1).toBe("infra");
    expect(placed.d1).toBe("docs");
    expect(context.workstreams.map((t) => t.id)).toContain("docs");
  });
});
