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
          prompt.match(new RegExp(`\\[(t\\d+)\\] ${name} `))?.[1] ?? null;
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
          tidyEdit({ op: "reparent", topic: "t1", parent: "t2" }),
          tidyEdit({
            op: "create",
            name: "Plugins",
            description: "BB plugins",
            parent: null,
            children: ["t1", "t2"],
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
            children: ["t1"],
          }),
          tidyEdit({ op: "reparent", topic: "t2", parent: "new:Vercel" }),
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
  it("says it can't apply, and doesn't hold up the next pass", async () => {
    const { w, topics, run, decide, rpc } = await setup({
      tidy: () => ({
        edits: [
          tidyEdit({
            op: "create",
            name: "Vercel",
            description: "Work",
            parent: null,
            children: ["t1"],
          }),
          tidyEdit({ op: "reparent", topic: "t2", parent: "new:Vercel" }),
        ],
      }),
    });
    topics.create("Alpha", "");
    topics.create("Beta", "");
    await rpc("refresh");
    const [create] = (await run()).suggestions;
    await decide([create!.id], "decline");
    const { state } = await rpc<{ state: SuggestionsStateWire }>("suggestions");
    expect(state.suggestions.find((s) => s.status === "pending")).toMatchObject(
      {
        summary: "Move Beta under Vercel",
        problem: "It needs a topic another suggestion would have created.",
      },
    );
  });
});

describe("suggestions CLI", () => {
  it("lists, runs, and accepts suggestions", async () => {
    const { w, topics, rpc } = await setup({
      tidy: () => ({
        edits: [tidyEdit({ op: "rename", topic: "t1", name: "Alpha Two" })],
      }),
    });
    const a = topics.create("Alpha", "");
    w.addThread("t1", { title: "Alpha task" });
    topics.assign("t1", a.id);
    await rpc("refresh");
    const cli = (...args: string[]) => w.harness.behavior.runCli(args);
    expect((await cli("suggestions")).stdout).toBe("No suggestions waiting.");
    const ran = await cli("suggestions", "run");
    expect(ran.stdout).toContain("Rename Alpha to Alpha Two\n    Because");
    const accepted = await cli("suggestions", "accept", "all");
    expect(accepted.stdout).toBe("Accepted 1 suggestion.");
    expect(topics.getById(a.id)?.name).toBe("Alpha Two");
  });
});
