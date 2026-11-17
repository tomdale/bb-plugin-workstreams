import { DEFAULT_MODELS } from "../../src/domain/prefs.ts";
/**
 * How a new thread gets its first workstream and title: the workstream you
 * picked in the composer, the workstream whose ＋ opened it, the
 * workstream of the thread it was started from, or the start call on its first
 * request, which also titles it. The composer's own title for the same text
 * is kept.
 */
import { afterEach, describe, expect, it } from "vitest";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { choosesWorkstream, fakeWorld, isStart } from "./fake-bb.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { openDatabase } from "../../src/server/db.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

const isQuick = (prompt: string) =>
  prompt.includes("You name one new agent thread");
const isPlacement = (prompt: string) =>
  prompt.includes("You choose the workstream for one agent thread");
const startCalls = (w: World) => w.completions.filter((c) => isStart(c.prompt));

/**
 * The workstream choice for the first request settles a moment later. Unless
 * a test asks for its answer, it fails, so the starting workstream stands.
 */
async function setup(placed?: () => string | null) {
  let workstreamId = "";
  world = await fakeWorld({
    // The fake asks a start's workstream as a workstream-choice prompt.
    complete: ({ prompt }) =>
      isPlacement(prompt)
        ? placed
          ? JSON.stringify({ workstreamId: placed(), proposed: null })
          : "not json"
        : isQuick(prompt)
          ? JSON.stringify({
              title: "Parser tab handling",
              workstreamId: workstreamId,
              proposed: null,
            })
          : JSON.stringify({ recap: "r", state: "needs-input" }),
  });
  const w = world;
  const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
  const parser = workstreamStore.create("Parser", "Parser product");
  const docs = workstreamStore.create("Docs", "Docs product");
  // A workstream's threads start in its project.
  workstreamStore.edit(parser.id, {
    projectId: "proj_1",
    projectSource: "manual",
  });
  workstreamStore.edit(docs.id, {
    projectId: "proj_1",
    projectSource: "manual",
  });
  workstreamId = parser.id;
  const hook = w.harness.registrations.hooks["message.dispatch"]!;
  const dispatch = async (
    threadId: string,
    text: string,
    overrides: Record<string, unknown> = {},
    thread: Record<string, unknown> = {},
  ) => {
    const created = w.addThread(threadId, {
      title: null,
      status: "starting",
      createdAt: Date.now(),
      ...thread,
    });
    const context = makeMessageDispatchHookContext({
      thread: created,
      input: { text },
      parentThreadId: null,
      origin: "app",
      experimental_submission: null,
      ...overrides,
    });
    expect(await hook(context)).toEqual({ action: "proceed" });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  const quickCalls = () => w.completions.filter((c) => isQuick(c.prompt));
  return {
    w,
    workstreamStore: workstreamStore,
    parser,
    docs,
    dispatch,
    settle,
    quickCalls,
  };
}

describe("a new thread's first workstream", () => {
  it("is settled by the start call on the first request", async () => {
    let docsId = "";
    const {
      w,
      workstreamStore: workstreamStore,
      docs,
      dispatch,
      settle,
    } = await setup(() => docsId);
    docsId = docs.id;
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(
      w.completions
        .filter((c) => choosesWorkstream(c.prompt))
        .map((c) => c.prompt),
    ).toEqual([expect.stringContaining("Make the parser handle tabs")]);
    expect(workstreamStore.assignment("t1")).toMatchObject({
      workstreamId: docs.id,
      provenance: "automatic",
    });
  });

  it("weighs the workstream it was started from when that is a group", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      parser,
      dispatch,
      settle,
    } = await setup(() => null);
    workstreamStore.create("Tabs", "Tab handling", parser.id);
    const section = w.addSection("Parser");
    workstreamStore.bindGroup(section.id, parser.id);
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Make the parser handle tabs",
      identity: {
        workstreamId: null,
        proposal: null,
        provenance: "inherited",
        sectionId: section.id,
      },
    });
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    const prompt = w.completions.find((c) =>
      choosesWorkstream(c.prompt),
    )!.prompt;
    expect(prompt).toContain("It was started from the Parser workstream.");
    expect(prompt).toContain("Tabs — Tab handling");
    expect(workstreamStore.assignment("t1").workstreamId).not.toBe(parser.id);
  });

  it("comes from one start call that also titles it", async () => {
    let parserId = "";
    const {
      w,
      workstreamStore: workstreamStore,
      parser,
      dispatch,
      settle,
    } = await setup(() => parserId);
    parserId = parser.id;
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(startCalls(w)).toHaveLength(1);
    expect(startCalls(w)[0]!.prompt).toContain("Make the parser handle tabs");
    expect(startCalls(w)[0]!.prompt).toContain("<workstream_tree>");
    expect(workstreamStore.assignment("t1")).toMatchObject({
      workstreamId: parser.id,
      provenance: "automatic",
    });
    // The title leaves out the name of the workstream the same answer chose.
    expect(w.threads.get("t1")?.title).toBe("Tab handling");
  });

  it("chooses the workstream by the composer's preview until the start call answers", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      docs,
      dispatch,
      settle,
    } = await setup();
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Write the docs",
      identity: {
        workstreamId: docs.id,
        proposal: null,
        provenance: "automatic",
      },
    });
    await dispatch("t1", "Write the docs");
    await settle();
    // The start call asks title and workstream; here the workstream part fails,
    // so the preview's workstream stands.
    expect(startCalls(w)).toHaveLength(1);
    expect(startCalls(w)[0]!.prompt).toContain("<workstream_tree>");
    expect(workstreamStore.assignment("t1")).toMatchObject({
      workstreamId: docs.id,
      provenance: "composer",
    });
  });

  it("is the workstream you picked, which the start call never replaces", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      docs,
      dispatch,
      settle,
    } = await setup();
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Make the parser handle tabs",
      identity: { workstreamId: docs.id, proposal: null, provenance: "manual" },
    });
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(workstreamStore.assignment("t1")).toMatchObject({
      workstreamId: docs.id,
      provenance: "manual",
    });
    // The start call still titles it.
    expect(w.threads.get("t1")?.title).toBe("Parser tab handling");
  });

  it("is the workstream you picked even in a project other than its own", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      docs,
      dispatch,
      settle,
    } = await setup();
    workstreamStore.edit(docs.id, {
      projectId: "proj_elsewhere",
      projectSource: "manual",
    });
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Make the parser handle tabs",
      identity: { workstreamId: docs.id, proposal: null, provenance: "manual" },
    });
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(workstreamStore.assignment("t1")).toMatchObject({
      workstreamId: docs.id,
      provenance: "manual",
    });
  });

  it("keeps an automatic preview across projects", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      docs,
      dispatch,
      settle,
    } = await setup();
    workstreamStore.edit(docs.id, {
      projectId: "proj_elsewhere",
      projectSource: "manual",
    });
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Make the parser handle tabs",
      identity: {
        workstreamId: docs.id,
        proposal: null,
        provenance: "automatic",
      },
    });
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(workstreamStore.assignment("t1")).toMatchObject({
      workstreamId: docs.id,
      provenance: "composer",
    });
    expect(w.threads.get("t1")?.projectId).toBe("proj_1");
    expect(startCalls(w)).toHaveLength(1);
  });

  it("is the workstream whose ＋ opened the composer", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      docs,
      dispatch,
      settle,
    } = await setup();
    const section = w.addSection("Docs");
    workstreamStore.bindGroup(section.id, docs.id);
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Make the parser handle tabs",
      identity: {
        workstreamId: null,
        proposal: null,
        provenance: "inherited",
        sectionId: section.id,
      },
    });
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(workstreamStore.assignment("t1")).toMatchObject({
      workstreamId: docs.id,
      provenance: "inherited",
    });
  });

  it("is the workstream of the thread an agent started it from", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      docs,
      dispatch,
      settle,
    } = await setup();
    w.addThread("caller", { title: "Caller" });
    workstreamStore.assign("caller", docs.id, { provenance: "automatic" });
    await dispatch("t1", "Make the parser handle tabs", {
      origin: "agent",
      initiator: "agent",
      senderThreadId: "caller",
    });
    await settle();
    expect(workstreamStore.assignment("t1")).toMatchObject({
      workstreamId: docs.id,
      provenance: "inherited",
    });
  });

  it("isn't given to a child, which follows its parent", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      parser,
      dispatch,
      settle,
    } = await setup();
    w.addThread("parent", { title: "Parent" });
    await dispatch(
      "child",
      "Run the tests",
      { parentThreadId: "parent", origin: "agent", initiator: "agent" },
      { parentThreadId: "parent" },
    );
    await settle();
    await w.harness.behavior.callRpc("refresh", null);
    expect(workstreamStore.assignment("child").inheritedFrom).toBe("parent");
    expect(workstreamStore.assignment("parent").workstreamId).not.toBe(
      parser.id,
    );
  });
});

describe("the composer's preview", () => {
  it("gives the workstream a mention names without a model call, and changes nothing", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      docs,
      quickCalls,
    } = await setup();
    const section = w.addSection("Docs");
    workstreamStore.bindGroup(section.id, docs.id);
    const revision = workstreamStore.revision();
    const preview = (await w.harness.behavior.callRpc("preview", {
      prompt: `Add an example to @section:${section.id}`,
    })) as { workstreamId: string | null; subject: string | null };
    expect(preview).toMatchObject({ workstreamId: docs.id, subject: "Docs" });
    expect(quickCalls()).toHaveLength(0);
    expect(workstreamStore.revision()).toBe(revision);
  });

  it("previews a draft with the start call and never creates a workstream", async () => {
    let calls = 0;
    world = await fakeWorld({
      complete: () => {
        calls++;
        return JSON.stringify({
          title: { verb: "Reserving", subject: "shelves" },
          workstream: null,
          propose: { name: "Reservations", description: "", parent: null },
          scopeShift: false,
        });
      },
    });
    const workstreamStore = new WorkstreamStore(openDatabase(world.bb));
    const preview = (await world.harness.behavior.callRpc("preview", {
      prompt: "Let people reserve shelves",
    })) as {
      title: string | null;
      proposal: { name: string } | null;
      subject: string | null;
    };
    expect(calls).toBe(1);
    expect(preview).toMatchObject({
      title: "Reserving shelves",
      subject: "Reservations",
      proposal: { name: "Reservations" },
    });
    expect(workstreamStore.list()).toEqual([]);
    // The preview answers on the fast composer model, not the new-thread one.
    expect(world.completions.at(-1)).toMatchObject({
      model: DEFAULT_MODELS.composer.model,
    });
  });
});
