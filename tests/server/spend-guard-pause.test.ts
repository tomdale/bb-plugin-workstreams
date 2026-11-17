/*
 * What each model-calling feature does while a spend cap pauses Workstreams,
 * in the whole plugin: nothing is asked, nothing a thread has is changed or
 * counted as failed, user-initiated actions say why, and the deferred work
 * runs again when the pause lifts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import {
  choosesWorkstream,
  fakeWorld,
  type FakeCompletion,
} from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import { UsageLedger } from "../../src/server/usage.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await world?.harness.lifecycle.dispose();
  world = null;
});

/** No thresholds, so only `pause` pauses. */
const NO_LIMITS = {
  hourSpendWarn: null,
  hourSpendCap: null,
  daySpendWarn: null,
  daySpendCap: null,
  monthSpendWarn: null,
  monthSpendCap: null,
  hourCallsWarn: null,
  hourCallsCap: null,
};
const PAUSED = /^Workstreams is paused: requests in the last hour reached/;

const rpc = <T = unknown>(w: World, method: string, input: unknown = null) =>
  w.harness.behavior.callRpc(method, input) as Promise<T>;

async function setup(
  complete?: (
    call: Parameters<FakeCompletion>[0],
  ) => ReturnType<FakeCompletion> | null,
) {
  world = await fakeWorld({
    prefs: { usage: NO_LIMITS, advanced: { debugProjectId: "proj_1" } },
    complete: (call) =>
      complete?.(call) ??
      JSON.stringify({ recap: "Fixed the bug.", state: "review", ask: null }),
  });
  return world;
}

/** Records 1,000 requests in the last hour, twice the cap `pause` sets. */
function spend(w: World) {
  new UsageLedger(openDatabase(w.bb)).record({
    at: Date.now(),
    source: "turn-end",
    path: "worker",
    model: "test",
    threadId: null,
    traceId: null,
    status: "ok",
    calls: 1_000,
    inputTokens: null,
    outputTokens: null,
    cost: null,
    promptHash: null,
    promptChars: null,
    durationMs: 1,
    replay: false,
  });
}
const setCap = (w: World) =>
  rpc(w, "setPrefs", { patch: { usage: { hourCallsCap: 500 } } });

/**
 * Reaches the requests cap: the rolling hour has no calendar boundary, so the
 * pause lasts however far a test moves its timers.
 */
async function pause(w: World) {
  spend(w);
  await setCap(w);
  expect((await rpc<{ level: string }>(w, "usageStatus")).level).toBe("capped");
}
const resume = (w: World) => rpc(w, "usageResume");

type Analysis = { recap: string; state: string; revision: number };
const analysisOf = async (w: World, id: string) =>
  (await rpc<{ analysis: Record<string, Analysis> }>(w, "state")).analysis[id];
const idle = (w: World, id: string) =>
  w.harness.behavior.emitThreadEvent("thread.idle", {
    thread: w.threads.get(id)!,
    lastAssistantText: "Done.",
  });
const flush = async (ticks = 60) => {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
};
const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
};
const describing = (w: World) =>
  w.completions.filter((c) =>
    c.prompt.includes("You describe one agent thread"),
  );
const traces = async (w: World) =>
  (await rpc<{ traces: { status: string }[] }>(w, "traces", {})).traces;
const journal = async (w: World) =>
  (await rpc<{ entries: { action: string }[] }>(w, "journal", {})).entries;

describe("turn-end analysis during a pause", () => {
  it("asks nothing, stores nothing, and runs when the pause is resumed", async () => {
    const w = await setup();
    w.addThread("t1", { status: "idle", latestAttentionAt: 500 });
    w.converse("t1", ["Fix the bug"]);
    await rpc(w, "refresh");
    await pause(w);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await idle(w, "t1");
    await settle(6_000);
    expect(w.completions).toHaveLength(0);
    expect(await analysisOf(w, "t1")).toBeUndefined();
    expect(await traces(w)).toEqual([]);

    await resume(w);
    await settle(0);
    expect(describing(w)).toHaveLength(1);
    expect(await analysisOf(w, "t1")).toMatchObject({
      state: "review",
      revision: 500,
    });
  });

  it("leaves an earlier turn's analysis and the thread's workstream as they were", async () => {
    const w = await setup();
    const store = new WorkstreamStore(openDatabase(w.bb));
    const alpha = store.create("Alpha", "Alpha work");
    w.addThread("t1", { status: "idle", latestAttentionAt: 10 });
    w.converse("t1", ["Fix the Alpha bug"]);
    await rpc(w, "refresh");
    store.assign("t1", alpha.id, { provenance: "automatic", evidence: "old" });
    await w.harness.behavior.runCli(["analyze", "t1"]);
    const before = await analysisOf(w, "t1");
    const assigned = store.assignment("t1");
    const asked = w.completions.length;
    const entries = (await journal(w)).length;

    await pause(w);
    w.threads.set("t1", { ...w.threads.get("t1")!, latestAttentionAt: 20 });
    w.converse("t1", ["Fix the Alpha bug", "Now rewrite the Beta exporter"]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await idle(w, "t1");
    await settle(6_000);
    expect(w.completions).toHaveLength(asked);
    expect(await analysisOf(w, "t1")).toEqual(before);
    expect(store.assignment("t1")).toEqual(assigned);
    expect(await journal(w)).toHaveLength(entries);

    // Lifting by turning the cap off restarts it as a resume does.
    await rpc(w, "setPrefs", { patch: { usage: { hourCallsCap: null } } });
    await settle(0);
    expect(w.completions.length).toBeGreaterThan(asked);
    expect((await analysisOf(w, "t1"))?.revision).toBe(20);
  });

  it("counts no failed attempt, so a later real failure still gets its retries", async () => {
    let failing = false;
    const w = await setup(() => {
      if (failing) throw new Error("gateway down");
      return null;
    });
    w.addThread("t1", { status: "idle", latestAttentionAt: 500 });
    w.converse("t1", ["Fix the bug"]);
    await rpc(w, "refresh");
    await pause(w);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    // As many refusals as the attempts a failing call gets.
    for (let i = 0; i < 3; i++) {
      await idle(w, "t1");
      await settle(6_000);
    }
    expect(w.completions).toHaveLength(0);

    failing = true;
    await resume(w);
    await settle(0);
    expect(describing(w)).toHaveLength(1);
    expect(await analysisOf(w, "t1")).toBeUndefined();

    // One real failure waits out its first backoff and is asked again.
    failing = false;
    await settle(11 * 60_000);
    await w.harness.behavior.runCli(["analyze"]);
    await settle(0);
    expect(describing(w)).toHaveLength(2);
    expect((await analysisOf(w, "t1"))?.revision).toBe(500);
  });

  it("doesn't queue a refused thread again until the pause lifts", async () => {
    const w = await setup();
    w.addThread("t1", { status: "idle", latestAttentionAt: 500 });
    w.converse("t1", ["Fix the bug"]);
    await rpc(w, "refresh");
    await pause(w);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const catchUp = async () => {
      const result = await w.harness.behavior.runCli(["analyze", "--json"]);
      await settle(0);
      return JSON.parse(result.stdout) as {
        queued: number;
        lastError: string | null;
      };
    };
    expect(await catchUp()).toEqual({
      queued: 1,
      lastError: null,
      lastErrorScope: null,
    });
    // The refusal is no analyzer failure, and the thread waits for the lift.
    expect(await catchUp()).toMatchObject({ queued: 0, lastError: null });
    expect(w.completions).toHaveLength(0);

    await resume(w);
    await settle(0);
    expect(describing(w)).toHaveLength(1);
    expect(await catchUp()).toMatchObject({ queued: 0, lastError: null });
  });

  it("records no failed workstream choice for a thread that only lacks a workstream", async () => {
    let viewer = "";
    const w = await setup(() =>
      JSON.stringify({ workstreamId: viewer, proposed: null }),
    );
    const store = new WorkstreamStore(openDatabase(w.bb));
    viewer = store.create("Viewer", "Markdown viewer").id;
    w.addThread("t1", { status: "idle", latestAttentionAt: 10 });
    w.converse("t1", ["Add themes to the markdown viewer"]);
    await rpc(w, "refresh");
    // Analyzed before it had a workstream: only the choice is due.
    const stored = {
      recap: "Building the viewer.",
      state: "review",
      ask: null,
      title: null,
      goal: "Add themes to the markdown viewer.",
      digest: null,
      reported: false,
      requestsKey: null,
      revision: 10,
      at: 1,
      model: "test",
      traceId: null,
    };
    openDatabase(w.bb)
      .prepare(
        "INSERT INTO ws_analysis (thread_id, revision, at, result) VALUES ('t1', 10, 1, ?)",
      )
      .run(JSON.stringify(stored));
    await pause(w);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await w.harness.behavior.runCli(["analyze"]);
    await settle(0);
    expect(w.completions).toHaveLength(0);
    expect(await analysisOf(w, "t1")).toEqual(stored);
    expect(store.assignment("t1").provenance).toBeNull();

    await resume(w);
    await settle(0);
    expect(w.completions).toHaveLength(1);
    expect(w.completions[0]!.prompt).toContain(
      "You choose the workstream for one agent thread",
    );
    expect(store.assignment("t1")).toMatchObject({
      workstreamId: viewer,
      provenance: "automatic",
    });
    expect(await analysisOf(w, "t1")).toEqual(stored);
  });

  it("tells whoever analyzes a thread by hand, and hands no workstream back", async () => {
    const w = await setup();
    const store = new WorkstreamStore(openDatabase(w.bb));
    const alpha = store.create("Alpha", "Alpha work");
    w.addThread("t1", { status: "idle", latestAttentionAt: 10 });
    w.converse("t1", ["Fix the Alpha bug"]);
    await rpc(w, "refresh");
    store.assign("t1", alpha.id, { provenance: "manual" });
    await pause(w);

    const analyzed = await w.harness.behavior.runCli(["analyze", "t1"]);
    expect(analyzed.exitCode).toBe(1);
    expect(analyzed.stderr).toMatch(PAUSED);
    await expect(rpc(w, "threadAutomatic", { threadId: "t1" })).rejects.toThrow(
      PAUSED,
    );
    expect(store.assignment("t1")).toMatchObject({
      workstreamId: alpha.id,
      provenance: "manual",
    });
    expect(w.completions).toHaveLength(0);
  });
});

describe("handing a workstream back as a pause begins", () => {
  it("settles the workstream when the pause lifts", async () => {
    let viewer = "";
    const w = await setup(({ prompt }) =>
      choosesWorkstream(prompt)
        ? JSON.stringify({ workstreamId: viewer, proposed: null })
        : null,
    );
    const store = new WorkstreamStore(openDatabase(w.bb));
    const alpha = store.create("Alpha", "Alpha work");
    viewer = store.create("Viewer", "Viewer work").id;
    w.addThread("t1", { status: "idle", latestAttentionAt: 10 });
    w.converse("t1", ["Fix the Viewer bug"]);
    await rpc(w, "refresh");
    store.assign("t1", alpha.id, { provenance: "manual" });
    await w.harness.behavior.runCli(["analyze", "t1"]);
    const stored = await analysisOf(w, "t1");
    const asked = w.completions.length;

    // The cap is reached after the handover was admitted and before its run
    // asks the model: while the handover lists BB's threads.
    await setCap(w);
    const values = w.threads.values.bind(w.threads);
    vi.spyOn(w.threads, "values").mockImplementationOnce(() => {
      spend(w);
      return values();
    });
    await expect(rpc(w, "threadAutomatic", { threadId: "t1" })).rejects.toThrow(
      PAUSED,
    );
    expect(w.completions).toHaveLength(asked);
    // Nothing moved, and the thread is Workstreams' to settle.
    expect(store.assignment("t1")).toMatchObject({
      workstreamId: alpha.id,
      provenance: "automatic",
    });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await resume(w);
    await settle(0);
    expect(w.completions).toHaveLength(asked + 1);
    expect(w.completions.at(-1)!.prompt).toContain(
      "You choose the workstream for one agent thread",
    );
    expect(store.assignment("t1")).toMatchObject({
      workstreamId: viewer,
      provenance: "automatic",
    });
    expect(await analysisOf(w, "t1")).toEqual(stored);
  });
});

describe("a thread's start during a pause", () => {
  const REQUEST =
    "Fix the stale build cache in the monorepo, it keeps serving old output";
  const isOpening = (prompt: string) =>
    prompt.includes("You name one new agent thread from its opening request");

  it("is not retried, and names the still-running thread when the pause lifts", async () => {
    const w = await setup(({ prompt }) =>
      isOpening(prompt) ? JSON.stringify({ title: "Fix stale cache" }) : null,
    );
    new WorkstreamStore(openDatabase(w.bb)).assign("t1", null, {
      provenance: "manual",
    });
    w.addThread("t1", {
      title: null,
      titleFallback: "Fix the stale build cache…",
      status: "active",
      latestAttentionAt: 100,
      updatedAt: 100,
      createdAt: Date.now(),
    });
    w.converse("t1", [REQUEST], null);
    await rpc(w, "refresh");
    await pause(w);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await w.harness.registrations.hooks["message.dispatch"]!(
      makeMessageDispatchHookContext({
        thread: w.threads.get("t1")!,
        input: { blocks: [], text: REQUEST },
        origin: "app",
      }),
    );
    // Past both retry delays of a failed start.
    await settle(5_000);
    expect(w.completions).toHaveLength(0);
    expect(w.threads.get("t1")?.title).toBeNull();

    await resume(w);
    await settle(0);
    vi.useRealTimers();
    await vi.waitFor(() =>
      expect(w.threads.get("t1")?.title).toBe("Fix stale cache"),
    );
    expect(w.completions.filter((c) => isOpening(c.prompt))).toHaveLength(1);
  });
});

describe("user-initiated calls during a pause", () => {
  it("tell the composer's preview, a replay, and a debug thread why", async () => {
    const w = await setup();
    w.addThread("t1", { status: "idle", latestAttentionAt: 10 });
    w.converse("t1", ["Fix the bug"]);
    await rpc(w, "refresh");
    await w.harness.behavior.runCli(["analyze", "t1"]);
    const [recorded] = await rpc<{ traces: { id: string }[] }>(w, "traces", {})
      .then((result) => result.traces)
      .then((list) => list.slice(0, 1));
    expect(recorded).toBeTruthy();
    const asked = w.completions.length;
    await pause(w);

    await expect(
      rpc(w, "preview", { prompt: "Fix the parser so it handles tabs" }),
    ).rejects.toThrow(PAUSED);
    await expect(rpc(w, "traceReplay", { id: recorded!.id })).rejects.toThrow(
      PAUSED,
    );
    await expect(
      rpc(w, "debugThread", { title: "Debug", message: "Why this title?" }),
    ).rejects.toThrow(PAUSED);
    await expect(rpc(w, "suggestionsRun")).rejects.toThrow(PAUSED);
    expect(w.completions).toHaveLength(asked);
    expect(w.spawned).toHaveLength(0);
    // The replay left no trace of a failure behind.
    expect((await traces(w)).map((trace) => trace.status)).toEqual(["ok"]);
  });

  it("still previews a draft that names its workstream, which asks no model", async () => {
    const w = await setup();
    const store = new WorkstreamStore(openDatabase(w.bb));
    const section = w.addSection("Alpha");
    const alpha = store.create("Alpha", "Alpha work");
    store.bindSection(section.id, alpha.id);
    await pause(w);
    const preview = await rpc<{ workstreamId: string }>(w, "preview", {
      prompt: `Fix the parser @section:${section.id}`,
    });
    expect(preview.workstreamId).toBe(alpha.id);
  });
});
