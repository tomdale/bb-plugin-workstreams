/**
 * An enhanced-response composition whose caller stops waiting while the
 * analysis machine is still composing, in the running plugin: the thread is
 * deleted mid-flight. The attempt may have been billed, so it leaves one
 * `aborted` usage row, and no document is stored.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../src/server/db.ts";
import { promptHash } from "../../src/server/usage.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { DEPLOYED_CHANGE } from "../fixtures/postTurn.ts";
import { fakeWorld } from "./fake-bb.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
const worlds: World[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.harness.lifecycle.dispose();
});

type Row = {
  source: string;
  path: string;
  thread_id: string | null;
  status: string;
  calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost: number | null;
  prompt_hash: string | null;
};
const TEXT = "Presets sync now.";

/**
 * A world composing for the thread `task`, whose machine answers when the
 * host call's signal aborts, with what `onAbort` returns or throws.
 */
async function composing(onAbort: (signal: AbortSignal) => unknown) {
  let signalOf: AbortSignal | undefined;
  const w = await fakeWorld({
    present: (_input, signal) =>
      new Promise((resolve, reject) => {
        signalOf = signal;
        signal!.addEventListener("abort", () => {
          try {
            resolve(onAbort(signal!));
          } catch (error) {
            reject(error);
          }
        });
      }),
  });
  worlds.push(w);
  const db = openDatabase(w.bb);
  const store = new WorkstreamStore(db);
  w.addThread("task", { title: "Sync presets" });
  store.assign("task", store.create("Snooze", "Workstreams").id, {
    provenance: "automatic",
  });
  await w.harness.behavior.callRpc("refresh", null);
  await w.harness.behavior.callRpc("setPresentationPrefs", {
    patch: { enabled: true },
  });
  w.turn("task");
  w.say("task", TEXT);
  await w.harness.behavior.emitThreadEvent("thread.idle", {
    thread: w.threads.get("task")!,
    lastAssistantText: TEXT,
  });
  // The machine has the request and has not answered.
  await vi.waitFor(() => expect(w.presents).toHaveLength(1));
  const rows = () =>
    db.prepare("SELECT * FROM ws_usage ORDER BY rowid").all() as Row[];
  expect(rows()).toEqual([]);
  expect(signalOf?.aborted).toBe(false);
  /** Deletes the thread, which stops its composition. */
  const stop = async () => {
    await w.harness.behavior.emitThreadEvent("thread.deleted", {
      thread: w.threads.get("task")!,
    });
    expect(signalOf?.aborted).toBe(true);
    await vi.waitFor(() => expect(rows()).not.toEqual([]));
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const stored = async () => ({
    items: (
      (await w.harness.behavior.callRpc("presentations", {
        threadId: "task",
      })) as { items: unknown[] }
    ).items,
    tableRows: (
      db.prepare("SELECT COUNT(*) AS n FROM ws_post_turn_document").get() as {
        n: number;
      }
    ).n,
  });
  return { w, rows, stop, stored };
}

describe("an enhanced-response composition stopped mid-flight", () => {
  it("records one aborted request of unknown tokens and cost, and stores no document", async () => {
    const s = await composing((signal) => {
      throw signal.reason;
    });
    await s.stop();
    expect(s.rows()).toMatchObject([
      {
        source: "presentation",
        path: "presentation",
        thread_id: "task",
        status: "aborted",
        calls: 1,
        input_tokens: null,
        output_tokens: null,
        cost: null,
        prompt_hash: promptHash(TEXT),
      },
    ]);
    expect(s.rows()).toHaveLength(1);
    expect(await s.stored()).toEqual({ items: [], tableRows: 0 });
  });

  it("records what the machine reported when it answers the abort with a failure", async () => {
    const s = await composing(() => ({
      kind: "failed",
      reason: "Stopped.",
      previews: 1,
      modelCalls: 3,
      usage: { input: 4000, output: 300, cost: 0.02 },
    }));
    await s.stop();
    expect(s.rows()).toMatchObject([
      {
        status: "aborted",
        calls: 3,
        input_tokens: 4000,
        output_tokens: 300,
        cost: 0.02,
      },
    ]);
    expect(s.rows()).toHaveLength(1);
    expect(await s.stored()).toEqual({ items: [], tableRows: 0 });
  });

  it("stores no document the machine finished after the abort, and still counts what it spent", async () => {
    const s = await composing(() => ({
      kind: "document",
      document: DEPLOYED_CHANGE,
      reason: null,
      previews: 1,
      modelCalls: 2,
      usage: { input: 1000, output: 400, cost: 0.01 },
    }));
    await s.stop();
    // The answer was not used, so the row is not `ok`.
    expect(s.rows()).toMatchObject([
      {
        status: "aborted",
        calls: 2,
        input_tokens: 1000,
        output_tokens: 400,
        cost: 0.01,
      },
    ]);
    expect(s.rows()).toHaveLength(1);
    expect(await s.stored()).toEqual({ items: [], tableRows: 0 });
  });
});
