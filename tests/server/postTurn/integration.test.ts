import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeWorld } from "../fake-bb.ts";
import { openDatabase } from "../../../src/server/db.ts";
import { WorkstreamStore } from "../../../src/server/workstreams.ts";
import { assistantMessageId } from "../../../src/domain/postTurn/message.ts";
import { DEPLOYED_CHANGE } from "../../fixtures/postTurn.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

const composed = {
  kind: "document",
  document: DEPLOYED_CHANGE,
  reason: null,
  previews: 1,
  modelCalls: 2,
  usage: { input: 1000, output: 400, cost: 0.01 },
};

async function setup(present?: () => unknown) {
  world = await fakeWorld({ present });
  const w = world;
  const store = new WorkstreamStore(openDatabase(w.bb));
  const snooze = store.create("Snooze", "Workstreams");
  w.addThread("task", { title: "Sync presets" });
  store.assign("task", snooze.id, { provenance: "automatic" });
  await w.harness.behavior.callRpc("refresh", null);
  return w;
}
const idle = (w: World, id: string, text: string) =>
  w.harness.behavior.emitThreadEvent("thread.idle", {
    thread: w.threads.get(id)!,
    lastAssistantText: text,
  });
const finish = (w: World, id: string, text: string) => {
  const turnId = w.turn(id);
  w.say(id, text);
  return turnId;
};
const list = async (w: World, threadId: string) =>
  (await w.harness.behavior.callRpc("presentations", { threadId })) as {
    enabled: boolean;
    items: { messageId: string; document: unknown }[];
  };

describe("bb workstreams present", () => {
  it("refuses while off, for a child thread, and for --document without the server switch", async () => {
    const w = await setup();
    w.addThread("kid", { parentThreadId: "task", title: "Child" });
    const doc = JSON.stringify(DEPLOYED_CHANGE);
    const off = await w.harness.behavior.runCli(["present", "task"]);
    expect(off.exitCode).not.toBe(0);
    expect(`${off.stdout}${off.stderr}`).toContain(
      "Enhanced responses are off.",
    );
    await w.harness.behavior.callRpc("setPresentationPrefs", {
      patch: { enabled: true },
    });
    const child = await w.harness.behavior.runCli(["present", "kid"]);
    expect(`${child.stdout}${child.stderr}`).toContain(
      "only to open top-level threads",
    );
    const locked = await w.harness.behavior.runCli([
      "present",
      "task",
      "--document",
      doc,
    ]);
    expect(`${locked.stdout}${locked.stderr}`).toContain(
      "WORKSTREAMS_PRESENT_DOCUMENTS=1",
    );
    expect(w.presents).toEqual([]);
  });

  it("stores a given document when the server allows it", async () => {
    vi.stubEnv("WORKSTREAMS_PRESENT_DOCUMENTS", "1");
    try {
      const w = await setup();
      await w.harness.behavior.callRpc("setPresentationPrefs", {
        patch: { enabled: true },
      });
      const turnId = finish(w, "task", "Presets sync now.");
      w.converse("task", ["Sync presets"], "Presets sync now.");
      const invalid = await w.harness.behavior.runCli([
        "present",
        "task",
        "--document",
        "{nope",
      ]);
      expect(`${invalid.stdout}${invalid.stderr}`).toContain(
        "--document is not JSON.",
      );
      const stored = await w.harness.behavior.runCli([
        "present",
        "task",
        "--document",
        JSON.stringify(DEPLOYED_CHANGE),
      ]);
      expect(stored.exitCode).toBe(0);
      expect(stored.stdout).toContain(
        assistantMessageId({ threadId: "task", turnId, itemId: "item0" }),
      );
      const again = await w.harness.behavior.runCli([
        "present",
        "task",
        "--document",
        JSON.stringify(DEPLOYED_CHANGE),
      ]);
      expect(again.exitCode).toBe(1);
      expect(again.stdout).toBe(
        "Nothing stored: This response already has one.",
      );
      expect(w.presents).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Enhanced responses through the plugin", () => {
  it("does nothing while the experiment is off", async () => {
    const w = await setup(() => composed);
    finish(w, "task", "Presets sync now.");
    await idle(w, "task", "Presets sync now.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(w.presents).toEqual([]);
    expect(await list(w, "task")).toEqual({ enabled: false, items: [] });
  });

  it("composes on the analysis machine, stores the document, and publishes it", async () => {
    const w = await setup(() => composed);
    await w.harness.behavior.callRpc("setPresentationPrefs", {
      patch: { enabled: true },
    });
    const turnId = finish(w, "task", "Presets sync now.");
    await idle(w, "task", "Presets sync now.");
    const messageId = assistantMessageId({
      threadId: "task",
      turnId,
      itemId: "item0",
    });
    await vi.waitFor(async () =>
      expect((await list(w, "task")).items).toEqual([
        {
          messageId,
          // This world binds no section, so the workstream has no color yet.
          workstream: { name: "Snooze", color: null },
          document: DEPLOYED_CHANGE,
        },
      ]),
    );
    expect(w.presents).toHaveLength(1);
    expect(w.presents[0]).toMatchObject({
      model: "anthropic/claude-sonnet-5.5",
      response: "Presets sync now.",
      title: "Sync presets",
      workstream: { name: "Snooze" },
    });
    // A repeated idle event and a reload read the stored document.
    await idle(w, "task", "Presets sync now.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(w.presents).toHaveLength(1);
    // Nothing was sent to the working agent's thread.
    expect(w.sent).toEqual([]);
    await w.harness.behavior.emitThreadEvent("thread.deleted", {
      thread: w.threads.get("task")!,
    });
    expect((await list(w, "task")).items).toEqual([]);
  });

  it("stores nothing when the host fails or returns an invalid document", async () => {
    let answer: unknown = {
      ...composed,
      kind: "failed",
      document: undefined,
      reason: "Deadline passed.",
    };
    const w = await setup(() => answer);
    await w.harness.behavior.callRpc("setPresentationPrefs", {
      patch: { enabled: true },
    });
    finish(w, "task", "First.");
    await idle(w, "task", "First.");
    await vi.waitFor(() => expect(w.presents).toHaveLength(1));
    answer = { ...composed, document: { version: 1, blocks: [{ type: "x" }] } };
    finish(w, "task", "Second.");
    await idle(w, "task", "Second.");
    await vi.waitFor(() => expect(w.presents).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await list(w, "task")).items).toEqual([]);
  });
});
