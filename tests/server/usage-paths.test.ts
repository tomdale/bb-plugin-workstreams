/**
 * The spending paths outside `Inference`, in the running plugin: enhanced
 * responses, debug threads, and recap reminders. Each asks the spend guard
 * before it spends and leaves one usage row after.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import { RECAP_TOOL } from "../../src/domain/recap.ts";
import { openDatabase } from "../../src/server/db.ts";
import { promptHash } from "../../src/server/usage.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { DEPLOYED_CHANGE } from "../fixtures/postTurn.ts";
import { fakeWorld } from "./fake-bb.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
const worlds: World[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const w of worlds.splice(0)) await w.harness.lifecycle.dispose();
});

async function world(options: Parameters<typeof fakeWorld>[0] = {}) {
  const w = await fakeWorld(options);
  worlds.push(w);
  return w;
}

type Row = {
  id: string;
  source: string;
  path: string;
  model: string;
  thread_id: string | null;
  trace_id: string | null;
  status: string;
  calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost: number | null;
  prompt_hash: string | null;
  prompt_chars: number | null;
  replay: number;
};
const PAUSE = "the-row-that-reaches-the-cap";
/** The usage rows the plugin wrote, oldest first. */
const rows = (w: World) =>
  (
    openDatabase(w.bb)
      .prepare("SELECT * FROM ws_usage ORDER BY rowid")
      .all() as Row[]
  ).filter((row) => row.id !== PAUSE);

/** Spends past every default cap, which pauses Workstreams' model calls. */
const pause = (w: World) =>
  openDatabase(w.bb)
    .prepare(
      `INSERT INTO ws_usage (id, at, source, path, model, status, calls, cost)
       VALUES (?, ?, 'turn-end', 'gateway', 'test/model', 'ok', 1, 1000)`,
    )
    .run(PAUSE, Date.now());
const resume = (w: World) => w.harness.behavior.callRpc("usageResume", null);

describe("enhanced responses", () => {
  const composed = {
    kind: "document",
    document: DEPLOYED_CHANGE,
    reason: null,
    previews: 1,
    modelCalls: 2,
    usage: { input: 1000, output: 400, cost: 0.01 },
  };
  const TEXT = "Presets sync now.";

  async function setup(present: () => unknown) {
    const w = await world({ present });
    const store = new WorkstreamStore(openDatabase(w.bb));
    w.addThread("task", { title: "Sync presets" });
    store.assign("task", store.create("Snooze", "Workstreams").id, {
      provenance: "automatic",
    });
    await w.harness.behavior.callRpc("refresh", null);
    await w.harness.behavior.callRpc("setPresentationPrefs", {
      patch: { enabled: true },
    });
    return w;
  }
  /** Ends a turn with `TEXT` and waits for its composition to settle. */
  async function compose(w: World) {
    const before = w.presents.length;
    w.turn("task");
    w.say("task", TEXT);
    await w.harness.behavior.emitThreadEvent("thread.idle", {
      thread: w.threads.get("task")!,
      lastAssistantText: TEXT,
    });
    await vi.waitFor(() => expect(w.presents).toHaveLength(before + 1));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const documents = async (w: World) =>
    (
      (await w.harness.behavior.callRpc("presentations", {
        threadId: "task",
      })) as { items: unknown[] }
    ).items;

  it("records a stored document as one row for all its requests", async () => {
    const w = await setup(() => composed);
    await compose(w);
    expect(await documents(w)).toHaveLength(1);
    expect(rows(w)).toMatchObject([
      {
        source: "presentation",
        path: "presentation",
        model: "anthropic/claude-sonnet-5.5",
        thread_id: "task",
        trace_id: null,
        status: "ok",
        calls: 2,
        input_tokens: 1000,
        output_tokens: 400,
        cost: 0.01,
        prompt_hash: promptHash(TEXT),
        prompt_chars: TEXT.length,
        replay: 0,
      },
    ]);
  });

  it.each([
    ["the model's choice to add nothing", { kind: "none" }, "ok"],
    ["a composition that failed", { kind: "failed" }, "failed"],
    [
      "an answer it could not use",
      { kind: "failed", invalid: true },
      "invalid",
    ],
  ])("records %s", async (_name, outcome, status) => {
    const w = await setup(() => ({
      reason: "Because.",
      previews: 1,
      modelCalls: 5,
      usage: { input: 9000, output: 800, cost: null },
      ...outcome,
    }));
    await compose(w);
    expect(await documents(w)).toEqual([]);
    expect(rows(w)).toMatchObject([
      {
        status,
        calls: 5,
        input_tokens: 9000,
        output_tokens: 800,
        // No call of the composition reported a cost: unknown, not free.
        cost: null,
      },
    ]);
  });

  it("records a machine that did not answer as one failed request of unknown cost", async () => {
    const w = await setup(() => {
      throw new Error("The analysis machine went away.");
    });
    await compose(w);
    expect(rows(w)).toMatchObject([
      {
        source: "presentation",
        thread_id: "task",
        status: "failed",
        calls: 1,
        input_tokens: null,
        output_tokens: null,
        cost: null,
      },
    ]);
  });

  it("records nothing for a composition that never reached a model", async () => {
    const w = await setup(() => ({
      kind: "failed",
      reason: "No Chrome on this machine for previews. Set CHROME_PATH.",
      previews: 0,
      modelCalls: 0,
      usage: { input: 0, output: 0, cost: null },
    }));
    await compose(w);
    expect(rows(w)).toEqual([]);
  });

  it("composes nothing while a cap pauses calls, and composes again after", async () => {
    const w = await setup(() => composed);
    pause(w);
    w.turn("task");
    w.say("task", TEXT);
    await w.harness.behavior.emitThreadEvent("thread.idle", {
      thread: w.threads.get("task")!,
      lastAssistantText: TEXT,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(w.presents).toEqual([]);
    expect(rows(w)).toEqual([]);
    expect(await documents(w)).toEqual([]);

    // The paused response was not marked as tried: it can still get one.
    await resume(w);
    w.converse("task", ["Sync presets"], TEXT);
    const outcome = await w.harness.behavior.runCli(["present", "task"]);
    expect(outcome.exitCode).toBe(0);
    expect(await documents(w)).toHaveLength(1);
    expect(rows(w)).toMatchObject([{ status: "ok", thread_id: "task" }]);
  });
});

describe("debug threads", () => {
  const brief = { title: "Debug: a call", message: "Where it came from." };
  const PROJECT = { prefs: { advanced: { debugProjectId: "proj_other" } } };

  it("counts the thread it starts as one request of unknown cost", async () => {
    const w = await world(PROJECT);
    const { threadId } = (await w.harness.behavior.callRpc(
      "debugThread",
      brief,
    )) as { threadId: string };
    expect(rows(w)).toMatchObject([
      {
        source: "debug-thread",
        path: "thread",
        model: "BB thread",
        thread_id: threadId,
        status: "ok",
        calls: 1,
        input_tokens: null,
        output_tokens: null,
        cost: null,
        prompt_hash: null,
      },
    ]);
  });

  it("counts a thread that failed to start, which may have started", async () => {
    const w = await world({
      ...PROJECT,
      spawn: async () => {
        throw new Error("No environment.");
      },
    });
    await expect(
      w.harness.behavior.callRpc("debugThread", brief),
    ).rejects.toThrow();
    expect(rows(w)).toMatchObject([
      { source: "debug-thread", thread_id: null, status: "failed", cost: null },
    ]);
  });

  it("starts no thread while a cap pauses calls, and says why", async () => {
    const w = await world(PROJECT);
    pause(w);
    await expect(
      w.harness.behavior.callRpc("debugThread", brief),
    ).rejects.toThrow(/Workstreams is paused/);
    expect(w.spawned).toEqual([]);
    expect(rows(w)).toEqual([]);

    await resume(w);
    await w.harness.behavior.callRpc("debugThread", brief);
    expect(w.spawned).toHaveLength(1);
    expect(rows(w)).toHaveLength(1);
  });
});

describe("recap reminders", () => {
  async function setup(options: Parameters<typeof fakeWorld>[0] = {}) {
    const w = await world(options);
    w.addThread("t1", {
      status: "idle",
      queuedMessageCount: 0,
      createdAt: Date.now(),
    });
    await w.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext({
        thread: { id: "t1", parentThreadId: null },
      }),
    );
    const idle = () =>
      w.harness.behavior.emitThreadEvent("thread.idle", {
        thread: w.threads.get("t1")!,
        lastAssistantText: "Done.",
      });
    const sentWith = (key: "recapReminder" | "waitingRecapId") =>
      w.sent.filter(
        (send) =>
          (send.pluginSubmission as { data?: Record<string, unknown> })?.data?.[
            key
          ],
      );
    const budget = async () =>
      (await w.harness.behavior.callRpc("recap_get", {
        threadId: "t1",
      })) as { reminders: number; capped: boolean };
    return { w, idle, sentWith, budget };
  }
  const reminderRow = {
    source: "recap-reminder",
    path: "thread",
    model: "BB thread",
    thread_id: "t1",
    status: "ok",
    calls: 1,
    input_tokens: null,
    output_tokens: null,
    cost: null,
  };

  it("counts a reminder as one request of unknown cost in the user's thread", async () => {
    const s = await setup();
    s.w.turn("t1");
    await s.idle();
    expect(s.sentWith("recapReminder")).toHaveLength(1);
    expect(rows(s.w)).toMatchObject([reminderRow]);
  });

  it("counts a reminder whose send failed, since a turn may have started", async () => {
    const s = await setup({
      send: async () => {
        throw new Error("The thread is busy.");
      },
    });
    s.w.turn("t1");
    await s.idle();
    expect(rows(s.w)).toMatchObject([{ ...reminderRow, status: "failed" }]);
  });

  it("holds a reminder back while a cap pauses calls, spending none of the budget", async () => {
    const s = await setup();
    pause(s.w);
    s.w.turn("t1");
    await s.idle();
    await s.idle();
    expect(s.sentWith("recapReminder")).toEqual([]);
    expect(await s.budget()).toMatchObject({ reminders: 0, capped: false });
    expect(rows(s.w)).toEqual([]);

    // Calls resume: the same turn's reminder goes out, once.
    await resume(s.w);
    await vi.waitFor(() => expect(s.sentWith("recapReminder")).toHaveLength(1));
    expect(await s.budget()).toMatchObject({ reminders: 1, capped: false });
    expect(rows(s.w)).toMatchObject([reminderRow]);
    expect(s.sentWith("recapReminder")[0]!.input).toMatchObject([
      { text: expect.stringContaining("Reminder 1 of") },
    ]);
  });

  it("still marks a spent budget while paused, without asking to send", async () => {
    const s = await setup();
    await s.w.harness.behavior.callRpc("setRecapPrefs", {
      patch: { reminders: 1 },
    });
    s.w.turn("t1");
    await s.idle();
    expect(s.sentWith("recapReminder")).toHaveLength(1);
    pause(s.w);
    s.w.turn("t1");
    await s.idle();
    expect(s.sentWith("recapReminder")).toHaveLength(1);
    expect(await s.budget()).toMatchObject({ reminders: 1, capped: true });
  });

  it("holds a waiting check back while paused and sends it once calls resume", async () => {
    const s = await setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    s.w.turn("t1");
    await s.w.harness.behavior.callAgentTool(
      RECAP_TOOL,
      { state: "waiting", headline: "Waiting for test worker", timeout: 10 },
      { threadId: "t1" },
    );
    pause(s.w);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(s.sentWith("waitingRecapId")).toEqual([]);
    const nudged = () =>
      openDatabase(s.w.bb)
        .prepare(
          "SELECT waiting_nudged FROM ws_agent_recap WHERE thread_id = 't1'",
        )
        .get();
    expect(nudged()).toEqual({ waiting_nudged: 0 });
    expect(rows(s.w)).toEqual([]);

    await resume(s.w);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(s.sentWith("waitingRecapId")).toHaveLength(1);
    expect(nudged()).toEqual({ waiting_nudged: 1 });
    expect(rows(s.w)).toMatchObject([reminderRow]);
  });

  it("does not count the user's own message sent from a recap", async () => {
    const s = await setup();
    s.w.turn("t1");
    await s.w.harness.behavior.callAgentTool(
      RECAP_TOOL,
      {
        state: "complete",
        headline: "Ported handoffs",
        latest: ["Moved the recap tool."],
        next: ["Ship it"],
      },
      { threadId: "t1" },
    );
    const { recap } = (await s.w.harness.behavior.callRpc("recap_get", {
      threadId: "t1",
    })) as { recap: { id: string } };
    pause(s.w);
    await s.w.harness.behavior.callRpc("recap_send", {
      threadId: "t1",
      recapId: recap.id,
      action: "Ship it",
    });
    expect(s.w.sent).toHaveLength(1);
    expect(rows(s.w)).toEqual([]);
  });
});
