/**
 * How a new root gets its first topic and title: the topic you
 * picked in the composer, the topic of the workstream whose ＋ opened it, the
 * topic of the thread it was started from, or the start call on its first
 * request, which also titles it. The composer's own title for the same text
 * is kept.
 */
import { afterEach, describe, expect, it } from "vitest";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { choosesTopic, fakeWorld, isStart } from "./fake-bb.ts";
import { TopicStore } from "../../src/server/topics.ts";
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
  prompt.includes("You file one agent thread under a topic");
const startCalls = (w: World) => w.completions.filter((c) => isStart(c.prompt));

/**
 * Placement of the first request settles the topic a moment later. Unless a
 * test asks for its answer, it fails, so the starting topic stands.
 */
async function setup(placed?: () => string | null) {
  let topicId = "";
  world = await fakeWorld({
    // The fake asks a start's topic as a placement prompt.
    complete: ({ prompt }) =>
      isPlacement(prompt)
        ? placed
          ? JSON.stringify({ subjectId: placed(), proposed: null })
          : "not json"
        : isQuick(prompt)
          ? JSON.stringify({
              goal: "Parser tab handling",
              subjectId: topicId,
              proposed: null,
            })
          : JSON.stringify({ recap: "r", state: "in_progress" }),
  });
  const w = world;
  const corpus = new TopicStore(openDatabase(w.bb));
  const parser = corpus.create("Parser", "Parser product");
  const docs = corpus.create("Docs", "Docs product");
  // A workstream's threads start in its project.
  corpus.edit(parser.id, { projectId: "proj_1", projectSource: "manual" });
  corpus.edit(docs.id, { projectId: "proj_1", projectSource: "manual" });
  topicId = parser.id;
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
  return { w, corpus, parser, docs, dispatch, settle, quickCalls };
}

describe("a new root's first topic", () => {
  it("is settled by the start call on the first request", async () => {
    let docsId = "";
    const { w, corpus, docs, dispatch, settle } = await setup(() => docsId);
    docsId = docs.id;
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(
      w.completions.filter((c) => choosesTopic(c.prompt)).map((c) => c.prompt),
    ).toEqual([expect.stringContaining("Make the parser handle tabs")]);
    expect(corpus.assignment("t1")).toMatchObject({
      entityId: docs.id,
      provenance: "full",
    });
  });

  it("weighs the workstream it was started from when that topic has subtopics", async () => {
    const { w, corpus, parser, dispatch, settle } = await setup(() => null);
    corpus.create("Tabs", "Tab handling", parser.id);
    const section = w.addSection("Parser");
    corpus.bindGroup(section.id, parser.id);
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Make the parser handle tabs",
      identity: {
        entityId: null,
        proposal: null,
        provenance: "inherited",
        sectionId: section.id,
      },
    });
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    const prompt = w.completions.find((c) => choosesTopic(c.prompt))!.prompt;
    expect(prompt).toContain("It was started from the Parser workstream.");
    expect(prompt).toContain("Tabs — Tab handling");
    expect(corpus.assignment("t1").entityId).not.toBe(parser.id);
  });

  it("comes from one start call that also titles it", async () => {
    let parserId = "";
    const { w, corpus, parser, dispatch, settle } = await setup(() => parserId);
    parserId = parser.id;
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(startCalls(w)).toHaveLength(1);
    expect(startCalls(w)[0]!.prompt).toContain("Make the parser handle tabs");
    expect(startCalls(w)[0]!.prompt).toContain("<topic_tree>");
    expect(corpus.assignment("t1")).toMatchObject({
      entityId: parser.id,
      provenance: "full",
    });
    // The title leaves out the name of the topic the same answer chose.
    expect(w.threads.get("t1")?.title).toBe("Tab handling");
  });

  it("is the composer's preview of exactly the text sent, with no second call", async () => {
    const { w, corpus, docs, dispatch, settle } = await setup();
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Write the docs",
      identity: {
        entityId: docs.id,
        proposal: null,
        provenance: "automatic",
        goal: "Docs for tabs",
        answered: true,
      },
    });
    await dispatch("t1", "Write the docs");
    await settle();
    expect(startCalls(w)).toHaveLength(0);
    // The preview was the thread's start, so its topic is settled.
    expect(corpus.assignment("t1")).toMatchObject({
      entityId: docs.id,
      provenance: "full",
    });
    expect(corpus.basis("t1")).toBeTruthy();
    expect(w.threads.get("t1")?.title).toBe("Docs for tabs");
  });

  it("files by a preview of earlier text until the start call answers the text sent", async () => {
    const { w, corpus, docs, dispatch, settle } = await setup();
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Write the docs",
      identity: { entityId: docs.id, proposal: null, provenance: "automatic" },
    });
    await dispatch("t1", "Write the docs");
    await settle();
    // The start call asks title and topic; here the topic part fails, so the
    // preview's topic stands.
    expect(startCalls(w)).toHaveLength(1);
    expect(startCalls(w)[0]!.prompt).toContain("<topic_tree>");
    expect(corpus.assignment("t1")).toMatchObject({
      entityId: docs.id,
      provenance: "quick",
    });
  });

  it("is the topic you picked, which the start call never replaces", async () => {
    const { w, corpus, docs, dispatch, settle } = await setup();
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Make the parser handle tabs",
      identity: { entityId: docs.id, proposal: null, provenance: "manual" },
    });
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(corpus.assignment("t1")).toMatchObject({
      entityId: docs.id,
      provenance: "manual",
    });
    // The start call still titles it.
    expect(w.threads.get("t1")?.title).toBe("Parser tab handling");
  });

  it("is the topic you picked even in a project other than its workstream's", async () => {
    const { w, corpus, docs, dispatch, settle } = await setup();
    corpus.edit(docs.id, {
      projectId: "proj_elsewhere",
      projectSource: "manual",
    });
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Make the parser handle tabs",
      identity: { entityId: docs.id, proposal: null, provenance: "manual" },
    });
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(corpus.assignment("t1")).toMatchObject({
      entityId: docs.id,
      provenance: "manual",
    });
  });

  it("never files Quick analysis's topic under a workstream with a different project", async () => {
    const { w, corpus, docs, dispatch, settle } = await setup();
    corpus.edit(docs.id, {
      projectId: "proj_elsewhere",
      projectSource: "manual",
    });
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Make the parser handle tabs",
      identity: { entityId: docs.id, proposal: null, provenance: "automatic" },
    });
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(corpus.assignment("t1").entityId).not.toBe(docs.id);
  });

  it("is the topic of the workstream whose ＋ opened the composer", async () => {
    const { w, corpus, docs, dispatch, settle } = await setup();
    const section = w.addSection("Docs");
    corpus.bindGroup(section.id, docs.id);
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "d1",
      text: "Make the parser handle tabs",
      identity: {
        entityId: null,
        proposal: null,
        provenance: "inherited",
        sectionId: section.id,
      },
    });
    await dispatch("t1", "Make the parser handle tabs");
    await settle();
    expect(corpus.assignment("t1")).toMatchObject({
      entityId: docs.id,
      provenance: "inherited",
    });
  });

  it("is the topic of the thread an agent started it from", async () => {
    const { w, corpus, docs, dispatch, settle } = await setup();
    w.addThread("caller", { title: "Caller" });
    corpus.assign("caller", docs.id, { provenance: "full" });
    await dispatch("t1", "Make the parser handle tabs", {
      origin: "agent",
      initiator: "agent",
      senderThreadId: "caller",
    });
    await settle();
    expect(corpus.assignment("t1")).toMatchObject({
      entityId: docs.id,
      provenance: "inherited",
    });
  });

  it("isn't given to a child, which follows its parent", async () => {
    const { w, corpus, parser, dispatch, settle } = await setup();
    w.addThread("parent", { title: "Parent" });
    await dispatch(
      "child",
      "Run the tests",
      { parentThreadId: "parent", origin: "agent", initiator: "agent" },
      { parentThreadId: "parent" },
    );
    await settle();
    await w.harness.behavior.callRpc("refresh", null);
    expect(corpus.assignment("child").inheritedFrom).toBe("parent");
    expect(corpus.assignment("parent").entityId).not.toBe(parser.id);
  });
});

describe("the composer's preview", () => {
  it("gives a mentioned workstream's topic without a model call, and changes nothing", async () => {
    const { w, corpus, docs, quickCalls } = await setup();
    const section = w.addSection("Docs");
    corpus.bindGroup(section.id, docs.id);
    const revision = corpus.revision();
    const preview = (await w.harness.behavior.callRpc("preview", {
      prompt: `Add an example to @section:${section.id}`,
    })) as { subjectId: string | null; subject: string | null };
    expect(preview).toMatchObject({ subjectId: docs.id, subject: "Docs" });
    expect(quickCalls()).toHaveLength(0);
    expect(corpus.revision()).toBe(revision);
  });

  it("previews a draft with the start call and never creates a topic", async () => {
    let calls = 0;
    world = await fakeWorld({
      complete: () => {
        calls++;
        return JSON.stringify({
          title: { verb: "Reserving", subject: "shelves" },
          topic: null,
          propose: { name: "Reservations", description: "", parent: null },
          scopeShift: false,
        });
      },
    });
    const corpus = new TopicStore(openDatabase(world.bb));
    const preview = (await world.harness.behavior.callRpc("preview", {
      prompt: "Let people reserve shelves",
    })) as {
      goal: string | null;
      proposal: { name: string } | null;
      subject: string | null;
    };
    expect(calls).toBe(1);
    expect(preview).toMatchObject({
      goal: "Reserving shelves",
      subject: "Reservations",
      proposal: { name: "Reservations" },
    });
    expect(corpus.list()).toEqual([]);
  });
});
