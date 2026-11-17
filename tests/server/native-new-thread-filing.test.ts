/**
 * A thread BB's New thread view creates gets its workstream like a New work
 * start: the workstream its banner showed, even when a plain Enter sent no
 * submit data, and journaled as started.
 */
import { afterEach, describe, expect, it } from "vitest";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { fakeWorld } from "./fake-bb.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { openDatabase } from "../../src/server/db.ts";
import { ComposedDrafts, draftText } from "../../src/server/composed-drafts.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;

afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

describe("ComposedDrafts", () => {
  it("hands a reported draft's identity to the dispatch with its text", () => {
    const drafts = new ComposedDrafts();
    drafts.report("d1", "Fix  the parser\n", {
      workstreamId: "e1",
      provenance: "manual",
    });
    expect(drafts.claim("t1", "Fix the parser")).toEqual({
      identity: { workstreamId: "e1", provenance: "manual" },
    });
    // Claimed once.
    expect(drafts.claim("t2", "Fix the parser")).toBeUndefined();
  });

  it("matches a dispatch that arrives before its draft's report", () => {
    const drafts = new ComposedDrafts();
    expect(drafts.claim("t1", "Write docs")).toBeUndefined();
    expect(drafts.report("d1", "Write docs", null)).toEqual({ threadId: "t1" });
    expect(drafts.report("d1", "Write docs", null)).toBeNull();
  });

  it("forgets an emptied or consumed draft and stops waiting after a while", () => {
    let now = 0;
    const drafts = new ComposedDrafts(() => now);
    drafts.report("d1", "One", null);
    drafts.report("d1", "", null);
    expect(drafts.claim("t1", "One")).toBeUndefined();
    drafts.report("d2", "Two", null);
    drafts.consume("Two");
    expect(drafts.claim("t2", "Two")).toBeUndefined();
    now += 60_000;
    expect(drafts.report("d3", "Two", null)).toBeNull();
  });

  it("keeps equal-text project reports separate in either arrival order", () => {
    const drafts = new ComposedDrafts();
    const choice = { projectId: "one", source: "workstreams" as const };
    drafts.report("d1", "Same request", null, choice);
    expect(drafts.claim("t2", "Same request", "two")).toBeUndefined();
    expect(drafts.claim("t1", "Same request", "one")).toEqual({
      identity: null,
      projectChoice: choice,
    });
    expect(drafts.report("d2", "Same request", null, choice)).toBeNull();
    expect(
      drafts.report("d3", "Same request", null, {
        projectId: "two",
        source: "independent",
      }),
    ).toEqual({ threadId: "t2" });
  });

  it("normalizes whitespace", () => {
    expect(draftText("  a \n\n b  ")).toBe("a b");
  });
});

describe("message.dispatch for the New thread view", () => {
  async function setup() {
    world = await fakeWorld();
    const w = world;
    const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
    const feature = workstreamStore.create("Parser", "Parser feature");
    workstreamStore.edit(feature.id, {
      projectId: "proj_1",
      projectSource: "manual",
    });
    const hook = w.harness.registrations.hooks["message.dispatch"]!;
    const dispatch = async (threadId: string, text: string) => {
      const thread = w.addThread(threadId, { createdAt: Date.now() });
      const context = makeMessageDispatchHookContext({
        thread,
        input: { text },
        parentThreadId: null,
        origin: "app",
        experimental_submission: null,
      });
      expect(await hook(context)).toEqual({ action: "proceed" });
      return context;
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
    const starts = async (threadId: string) => {
      const { entries } = (await w.harness.behavior.callRpc(
        "journal",
        null,
      )) as {
        entries: {
          action: string;
          source: string;
          rationale: string;
          threads: { id: string }[];
        }[];
      };
      // Starts only; the organizer's own move is a separate entry.
      return entries.filter(
        (e) =>
          e.action === "thread-started" &&
          e.threads.some((t) => t.id === threadId),
      );
    };
    return {
      w,
      workstreamStore: workstreamStore,
      feature,
      hook,
      dispatch,
      settle,
      starts,
    };
  }

  it("moves a plain Enter's thread to the workstream the banner reported", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      feature,
      dispatch,
      settle,
      starts,
    } = await setup();
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "root",
      text: "Fix the parser",
      identity: {
        workstreamId: feature.id,
        proposal: null,
        provenance: "manual",
      },
    });
    await dispatch("t-enter", "Fix the parser");
    await settle();
    expect(workstreamStore.assignment("t-enter")).toMatchObject({
      workstreamId: feature.id,
      provenance: "manual",
    });
    expect(await starts("t-enter")).toEqual([
      expect.objectContaining({
        action: "thread-started",
        source: "you",
        rationale: "Started from New thread",
      }),
    ]);
  });

  it("uses a report that arrives after the dispatch", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      feature,
      dispatch,
      settle,
    } = await setup();
    await dispatch("t-late", "Fix the parser");
    await settle();
    expect(workstreamStore.assignment("t-late").workstreamId).toBeNull();
    expect(
      await w.harness.behavior.callRpc("draftIdentity", {
        draftKey: "root",
        text: "Fix the parser",
        identity: {
          workstreamId: feature.id,
          proposal: null,
          provenance: "manual",
        },
      }),
    ).toEqual({ filed: true });
    expect(workstreamStore.assignment("t-late").workstreamId).toBe(feature.id);
  });

  it("journals a start once across repeated passes", async () => {
    const { hook, dispatch, settle, starts } = await setup();
    const context = await dispatch("t-repeat", "Something new");
    expect(await hook(context)).toEqual({ action: "proceed" });
    await settle();
    expect(await starts("t-repeat")).toHaveLength(1);
  });

  it("leaves a thread naming an unknown subject for classification", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      dispatch,
      settle,
      starts,
    } = await setup();
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "root",
      text: "Stale pick",
      identity: {
        workstreamId: "ent_gone",
        proposal: null,
        provenance: "manual",
      },
    });
    await dispatch("t-stale", "Stale pick");
    await settle();
    expect(workstreamStore.assignment("t-stale").workstreamId).toBeNull();
    expect(await starts("t-stale")).toHaveLength(1);
  });

  it("moves and journals nothing for an agent-started thread", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      feature,
      hook,
      settle,
      starts,
    } = await setup();
    await w.harness.behavior.callRpc("draftIdentity", {
      draftKey: "root",
      text: "Delegated",
      identity: {
        workstreamId: feature.id,
        proposal: null,
        provenance: "manual",
      },
    });
    const thread = w.addThread("t-agent", { createdAt: Date.now() });
    await hook(
      makeMessageDispatchHookContext({
        thread,
        input: { text: "Delegated" },
        parentThreadId: null,
        origin: "plugin",
        initiator: "agent",
        experimental_submission: null,
      }),
    );
    await settle();
    expect(workstreamStore.assignment("t-agent").workstreamId).toBeNull();
    expect(await starts("t-agent")).toEqual([]);
  });
});
