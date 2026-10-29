import { afterEach, describe, expect, it } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { openDatabase } from "../../src/server/db.ts";
import type { SuggestionsStateWire } from "../../src/server/contract.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

const SPLIT = "it is splitting into subgroups";
const REPAIR = "holds threads beside its subgroups";
const TIDY = "You maintain the topic tree";

/** A world whose model answers split and tidy prompts with these. */
async function setup(answers: {
  split?: (prompt: string) => object;
  tidy?: (prompt: string) => object;
}) {
  world = await fakeWorld({
    complete: ({ prompt }) =>
      JSON.stringify(
        prompt.includes(SPLIT) || prompt.includes(REPAIR)
          ? (answers.split?.(prompt) ?? {
              reason: "",
              subgroups: [],
              threads: [],
            })
          : prompt.includes(TIDY)
            ? (answers.tidy?.(prompt) ?? { edits: [] })
            : { recap: "r", state: "in_progress" },
      ),
  });
  const w = world;
  const topics = new TopicStore(openDatabase(w.bb));
  const rpc = <T>(method: string, input: unknown = null) =>
    w.harness.behavior.callRpc(method, input) as Promise<T>;
  const run = async () =>
    (await rpc<{ state: SuggestionsStateWire }>("suggestionsRun")).state;
  const decide = (ids: string[], decision: "accept" | "decline") =>
    rpc<{ applied: string[]; failed: { id: string; reason: string }[] }>(
      "suggestionsDecide",
      { ids, decision },
    );
  return { w, topics, rpc, run, decide };
}

const tidyEdit = (fields: Record<string, unknown>) => ({
  op: "rename",
  reason: "Because",
  from: null,
  into: null,
  topic: null,
  parent: null,
  name: null,
  description: null,
  children: null,
  thread: null,
  ...fields,
});

describe("split suggestions", () => {
  it("proposes splitting a topic past 5 threads, and accepting files every thread", async () => {
    const { w, topics, run, decide, rpc } = await setup({
      split: () => ({
        reason: "Planning apart from triggers",
        subgroups: [
          { name: "Planning", description: "Design" },
          { name: "Triggers", description: "Events" },
        ],
        threads: [1, 2, 3, 4, 5, 6].map((n) => ({
          id: `r${n}`,
          subgroup: n <= 3 ? "Planning" : "Triggers",
        })),
      }),
    });
    const auto = topics.create("Automations", "The product");
    for (let i = 1; i <= 6; i++) {
      w.addThread(`t${i}`, { title: `Task ${i}` });
      topics.assign(`t${i}`, auto.id);
    }
    await rpc("refresh");
    const state = await run();
    const [split] = state.suggestions;
    expect(split).toMatchObject({
      kind: "split",
      status: "pending",
      summary: "Split Automations into Planning, Triggers",
      reason: "Planning apart from triggers",
      problem: null,
    });
    expect(split!.headline).toBe(
      "Split Automations into Planning and Triggers",
    );
    // Review shows each new subgroup and the threads that go to it.
    expect(split!.change).toEqual({
      op: "split",
      moves: [
        ["Planning", [1, 2, 3]],
        ["Triggers", [4, 5, 6]],
      ].map(([name, threads]) => ({
        from: [{ name: "Automations", created: false }],
        to: [
          { name: "Automations", created: false },
          { name, created: true },
        ],
        threads: (threads as number[]).map((n) => ({
          id: `t${n}`,
          title: `Task ${n}`,
        })),
        carried: 0,
      })),
    });
    // Nothing changes until it's accepted.
    expect(topics.subtopics(auto.id)).toBe(0);

    expect((await decide([split!.id], "accept")).applied).toEqual([split!.id]);
    expect(topics.getById(auto.id)?.partitioned).toBe(true);
    expect(topics.assignment("t1").label).toBe("Automations: Planning");
    expect(topics.assignment("t6").label).toBe("Automations: Triggers");

    // Undo puts the tree back, even after the organizer has bound the new
    // subgroups' workstreams.
    await rpc("organization", { action: "rebuild" });
    const { entries } = await rpc<{
      entries: { id: string; action: string }[];
    }>("journal", {});
    const entry = entries.find((e) => e.action === "suggestion")!;
    await rpc("undo", { entryId: entry.id });
    expect(topics.subtopics(auto.id)).toBe(0);
    expect(topics.assignment("t1").entityId).toBe(auto.id);
  });

  it("still applies after threads move, close, or join, filing newcomers", async () => {
    const prompts: string[] = [];
    const { w, topics, run, decide, rpc } = await setup({
      split: (prompt) => {
        prompts.push(prompt);
        if (prompts.length > 1)
          // The newcomer, filed among the proposed subgroups.
          return {
            reason: "",
            subgroups: [{ name: "Triggers", description: "" }],
            threads: [{ id: "r1", subgroup: "Triggers" }],
          };
        return {
          reason: "Planning apart from triggers",
          subgroups: [
            { name: "Planning", description: "Design" },
            { name: "Triggers", description: "Events" },
          ],
          threads: [1, 2, 3, 4, 5, 6].map((n) => ({
            id: `r${n}`,
            subgroup: n <= 3 ? "Planning" : "Triggers",
          })),
        };
      },
    });
    const auto = topics.create("Automations", "The product");
    const other = topics.create("Other", "");
    for (let i = 1; i <= 6; i++) {
      w.addThread(`t${i}`, { title: `Task ${i}` });
      topics.assign(`t${i}`, auto.id);
    }
    await rpc("refresh");
    const [split] = (await run()).suggestions;

    // One thread moves elsewhere and a new one joins.
    topics.assign("t6", other.id);
    w.addThread("t7", { title: "Task 7" });
    topics.assign("t7", auto.id);
    await rpc("refresh");
    const { state } = await rpc<{ state: SuggestionsStateWire }>("suggestions");
    expect(state.suggestions[0]).toMatchObject({
      problem: null,
      arrivals: [{ id: "t7", title: "Task 7" }],
    });

    expect((await decide([split!.id], "accept")).applied).toEqual([split!.id]);
    expect(prompts[1]).toContain('"Planning", "Triggers"');
    expect(topics.assignment("t1").label).toBe("Automations: Planning");
    expect(topics.assignment("t7").label).toBe("Automations: Triggers");
    // The thread that moved away stays where it went.
    expect(topics.assignment("t6").entityId).toBe(other.id);
  });

  it("repairs a topic that holds threads beside subtopics", async () => {
    const { w, topics, run, decide, rpc } = await setup({
      split: (prompt) => {
        expect(prompt).toContain('"Triggers"');
        return {
          reason: "Files the loose thread",
          subgroups: [{ name: "Triggers", description: "" }],
          threads: [{ id: "r1", subgroup: "Triggers" }],
        };
      },
    });
    const db = openDatabase(w.bb);
    const auto = topics.create("Automations", "The product");
    const triggers = topics.create("Triggers", "Events", auto.id);
    w.addThread("loose", { title: "Loose task" });
    db.prepare(
      "INSERT INTO ws_corpus_subject(thread_id, entity_id, source) VALUES ('loose', ?, 'full')",
    ).run(auto.id);
    await rpc("refresh");
    const [repair] = (await run()).suggestions;
    await decide([repair!.id], "accept");
    expect(topics.assignment("loose").entityId).toBe(triggers.id);
  });
});

describe("tidy suggestions", () => {
  it("proposes edits with reasons, applies accepted ones, and remembers declined ones", async () => {
    let prompts: string[] = [];
    const { w, topics, run, decide, rpc } = await setup({
      tidy: (prompt) => {
        prompts.push(prompt);
        const id = (name: string) =>
          prompt.match(new RegExp(`\\[([a-z0-9-]+)\\] ${name} `))?.[1] ?? null;
        return {
          edits: [
            tidyEdit({
              op: "merge",
              from: id("Alpha"),
              into: id("Beta"),
              reason: "Same product",
            }),
            tidyEdit({ op: "rename", topic: id("Gamma"), name: "Gamma Two" }),
          ],
        };
      },
    });
    const a = topics.create("Alpha", "");
    const b = topics.create("Beta", "");
    const g = topics.create("Gamma", "");
    w.addThread("t1", { title: "Alpha task" });
    topics.assign("t1", a.id);
    w.addThread("t2", { title: "Beta task" });
    topics.assign("t2", b.id);
    w.addThread("t3", { title: "Gamma task" });
    topics.assign("t3", g.id);
    await rpc("refresh");
    const state = await run();
    expect(state.suggestions.map((s) => [s.summary, s.reason])).toEqual([
      ["Merge Alpha into Beta", "Same product"],
      ["Rename Gamma to Gamma Two", "Because"],
    ]);
    const [merge, rename] = state.suggestions;
    expect(merge!.change).toEqual({
      op: "merge",
      moves: [
        {
          from: [{ name: "Alpha", created: false }],
          to: [{ name: "Beta", created: false }],
          threads: [{ id: "t1", title: "Alpha task" }],
          carried: 0,
        },
      ],
    });
    await decide([merge!.id], "accept");
    await decide([rename!.id], "decline");
    expect(topics.getById(a.id)).toBeNull();
    expect(topics.assignment("t1").entityId).toBe(b.id);
    expect(topics.getById(g.id)?.name).toBe("Gamma");

    // The next pass hears both decisions and drops the declined edit.
    prompts = [];
    const next = await run();
    expect(prompts[0]).toContain("You accepted: Merge Alpha into Beta");
    expect(prompts[0]).toContain("- Rename Gamma to Gamma Two");
    expect(next.suggestions.filter((s) => s.status === "pending")).toEqual([]);
  });

  it("drops an edit that would put threads beside subtopics", async () => {
    const { w, topics, run, rpc } = await setup({
      tidy: () => ({
        edits: [
          tidyEdit({ op: "reparent", topic: "alpha", parent: "beta" }),
          tidyEdit({
            op: "create",
            name: "Plugins",
            description: "BB plugins",
            parent: null,
            children: ["alpha", "beta"],
          }),
        ],
      }),
    });
    topics.create("Alpha", "");
    const b = topics.create("Beta", "");
    w.addThread("t1", { title: "Beta task" });
    topics.assign("t1", b.id);
    await rpc("refresh");
    const state = await run();
    expect(state.suggestions.map((s) => s.summary)).toEqual([
      "Create Plugins, holding Alpha, Beta",
    ]);
  });

  it("applies a create, then an edit that names the created topic", async () => {
    const { w, topics, run, decide, rpc } = await setup({
      tidy: () => ({
        edits: [
          tidyEdit({
            op: "create",
            name: "Vercel",
            description: "Work",
            parent: null,
            children: ["alpha"],
          }),
          tidyEdit({ op: "reparent", topic: "beta", parent: "new:Vercel" }),
        ],
      }),
    });
    const a = topics.create("Alpha", "");
    const b = topics.create("Beta", "");
    w.addThread("t1", { title: "Alpha task" });
    topics.assign("t1", a.id);
    await rpc("refresh");
    const [create, reparent] = (await run()).suggestions;
    expect(reparent!.summary).toBe("Move Beta under Vercel");
    expect(reparent!.headline).toBe("Move Beta under Vercel");
    // The topic the create would make reads as new until it exists.
    expect(reparent!.change?.moves).toEqual([
      {
        from: [{ name: "Beta", created: false }],
        to: [
          { name: "Vercel", created: true },
          { name: "Beta", created: false },
        ],
        threads: [],
        carried: 0,
      },
    ]);
    // Accepted alone, the reparent waits for its topic.
    const early = await decide([reparent!.id], "accept");
    expect(early.failed).toHaveLength(1);
    await decide([create!.id, reparent!.id], "accept");
    const vercel = topics.resolve("Vercel")!;
    expect(vercel).toBeTruthy();
    expect(topics.getById(a.id)?.parentId).toBe(vercel.id);
    expect(topics.getById(b.id)?.parentId).toBe(vercel.id);
  });
});

describe("an edit that needs a declined create", () => {
  it("is retired with the create it needs", async () => {
    const { w, topics, run, decide, rpc } = await setup({
      tidy: () => ({
        edits: [
          tidyEdit({
            op: "create",
            name: "Vercel",
            description: "Work",
            parent: null,
            children: ["alpha"],
          }),
          tidyEdit({ op: "reparent", topic: "beta", parent: "new:Vercel" }),
        ],
      }),
    });
    topics.create("Alpha", "");
    topics.create("Beta", "");
    await rpc("refresh");
    const [create] = (await run()).suggestions;
    await decide([create!.id], "decline");
    const { state } = await rpc<{ state: SuggestionsStateWire }>("suggestions");
    expect(state.suggestions.filter((s) => s.status === "pending")).toEqual([]);
    expect(
      state.suggestions.find((s) => s.summary === "Move Beta under Vercel"),
    ).toMatchObject({
      status: "stale",
      problem:
        "Nothing left to change: It needs a topic another suggestion would have created.",
    });
  });
});

describe("retiring", () => {
  it("retires suggestions that would change nothing, and keeps ones blocked for now", async () => {
    const { w, topics, run, rpc } = await setup({
      tidy: (prompt) => {
        const id = (name: string) =>
          prompt.match(new RegExp(`\\[([a-z0-9-]+)\\] ${name} `))?.[1] ?? null;
        const thread = prompt.match(/\[(r\d+)\] Gamma task/)?.[1] ?? null;
        return {
          edits: [
            tidyEdit({ op: "rename", topic: id("Alpha"), name: "Alpha Two" }),
            tidyEdit({ op: "move", thread, topic: id("Beta") }),
            tidyEdit({
              op: "reparent",
              topic: id("Delta"),
              parent: id("Beta"),
            }),
          ],
        };
      },
    });
    const a = topics.create("Alpha", "");
    const b = topics.create("Beta", "");
    const g = topics.create("Gamma", "");
    topics.create("Delta", "");
    w.addThread("t1", { title: "Gamma task" });
    topics.assign("t1", g.id);
    await rpc("refresh");
    const pending = (await run()).suggestions;
    expect(pending.map((s) => s.summary)).toEqual([
      "Rename Alpha to Alpha Two",
      "Refile “Gamma task” into Beta",
      "Move Delta under Beta",
    ]);
    // Done by hand since: the rename and the refile change nothing now.
    // Beta now holds a thread, so moving Delta under it is blocked, but only
    // for now.
    topics.rename(a.id, "Alpha Two");
    topics.assign("t1", b.id);
    await rpc("organization", { action: "rebuild" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { state } = await rpc<{ state: SuggestionsStateWire }>("suggestions");
    expect(
      state.suggestions
        .map((s) => [s.summary, s.status, s.problem])
        .sort(
          (x, y) =>
            String(x[1]).localeCompare(String(y[1])) ||
            String(x[0]).localeCompare(String(y[0])),
        ),
    ).toEqual([
      [
        "Move Delta under Beta",
        "pending",
        "The new parent holds threads, so it can't take subtopics.",
      ],
      [
        "Refile “Gamma task” into Beta",
        "stale",
        "Nothing left to change: The thread is already there.",
      ],
      [
        "Rename Alpha to Alpha Two",
        "stale",
        "Nothing left to change: It already has that name.",
      ],
    ]);
  });
});

describe("suggestions CLI", () => {
  it("lists, runs, and accepts suggestions", async () => {
    const { w, topics, rpc } = await setup({
      tidy: () => ({
        edits: [tidyEdit({ op: "rename", topic: "alpha", name: "Alpha Two" })],
      }),
    });
    const a = topics.create("Alpha", "");
    w.addThread("t1", { title: "Alpha task" });
    topics.assign("t1", a.id);
    await rpc("refresh");
    const cli = (...args: string[]) => w.harness.behavior.runCli(args);
    expect((await cli("suggestions")).stdout).toBe("No suggestions waiting.");
    const ran = await cli("suggestions", "run");
    expect(ran.stdout).toContain(
      "Rename Alpha to Alpha Two\n    Alpha → Alpha Two (with 1 thread)\n    Because",
    );
    const accepted = await cli("suggestions", "accept", "all");
    expect(accepted.stdout).toBe("Accepted 1 suggestion.");
    expect(topics.getById(a.id)?.name).toBe("Alpha Two");
  });
});
