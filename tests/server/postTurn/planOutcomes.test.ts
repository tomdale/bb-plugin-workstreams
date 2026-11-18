import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitializedTestPluginHost } from "../test-host.ts";
import { openDatabase } from "../../../src/server/db.ts";
import { PresentationStore } from "../../../src/server/postTurn/store.ts";
import { PlanOutcomes } from "../../../src/server/postTurn/planOutcomes.ts";
import { SETTINGS_PLAN } from "../../fixtures/postTurn.ts";
import { eventLog } from "./events.ts";

const THREAD = "thr_plan";
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

/** An open plan stored for turn t1, whose turn has ended. */
async function setup() {
  const host = await createInitializedTestPluginHost();
  disposers.push(() => host.harness.lifecycle.dispose());
  const store = new PresentationStore(openDatabase(host.bb));
  const log = eventLog();
  log.request("Plan the settings move.");
  log.turn("t1", "Here's the plan.");
  store.save({
    messageId: "m1",
    threadId: THREAD,
    turnId: "t1",
    workstream: null,
    document: SETTINGS_PLAN,
    createdAt: 1,
  });
  const send = vi.fn(async (_args: unknown) => ({ status: "sent" }));
  const changed = vi.fn();
  const outcomes = new PlanOutcomes({
    sdk: () => ({ threads: { send, events: { list: log.list } } }) as never,
    store,
    enabled: () => true,
    changed,
  });
  const outcome = () => store.outcomes(THREAD).get("m1") ?? null;
  return { store, log, send, changed, outcomes, outcome };
}

describe("PlanOutcomes", () => {
  it("stays open through Workstreams' own reminders and waiting checks", async () => {
    const { log, outcomes, outcome, send } = await setup();
    log.request(
      "[Workstreams recap 0f3a 1 50]\nYour turn ended without a recap.",
    );
    log.turn("t2", "Done.");
    log.request("[Workstreams waiting 0f3a]\nThe waiting timeout expired.");
    log.startTurn("t3");
    await outcomes.onActive(THREAD);
    expect(outcome()).toBeNull();
    await outcomes.answer(THREAD, "m1", { kind: "approve" });
    expect(outcome()).toEqual({ kind: "approved" });
    expect(send).toHaveBeenCalledWith({
      threadId: THREAD,
      mode: "queue-if-active",
      input: [{ type: "text", text: "Approved.", mentions: [] }],
    });
  });

  it("supersedes the plan once the user sends anything else", async () => {
    const { log, outcomes, outcome, changed } = await setup();
    log.request("Actually, hold off.");
    log.startTurn("t2");
    await outcomes.onActive(THREAD);
    expect(outcome()).toEqual({ kind: "superseded" });
    expect(changed).toHaveBeenCalledWith(THREAD);
    // Answering again finds nothing open.
    await expect(
      outcomes.answer(THREAD, "m1", { kind: "approve" }),
    ).rejects.toThrow("already been answered");
  });

  it("refuses and supersedes at answer time when the active check missed it", async () => {
    const { log, outcomes, outcome, send } = await setup();
    log.request("Use Postgres instead.");
    await expect(
      outcomes.answer(THREAD, "m1", {
        kind: "reply",
        message: "What if the copy fails?",
      }),
    ).rejects.toThrow("A newer turn has replaced this plan.");
    expect(send).not.toHaveBeenCalled();
    expect(outcome()).toEqual({ kind: "superseded" });
  });

  it("keeps an answered plan's outcome when its own message starts a turn", async () => {
    const { log, outcomes, outcome } = await setup();
    await outcomes.answer(THREAD, "m1", {
      kind: "reply",
      message: "Keep dual writes through step 3.",
    });
    log.request("Keep dual writes through step 3.");
    log.startTurn("t2");
    await outcomes.onActive(THREAD);
    expect(outcome()).toEqual({
      kind: "replied",
      message: "Keep dual writes through step 3.",
    });
  });

  it("refuses a document that is not a plan, or one in another thread", async () => {
    const { store, outcomes } = await setup();
    store.save({
      messageId: "m2",
      threadId: THREAD,
      turnId: "t1",
      workstream: null,
      document: { version: 1, blocks: [{ type: "paragraph", text: "Hi." }] },
      createdAt: 2,
    });
    await expect(
      outcomes.answer(THREAD, "m2", { kind: "approve" }),
    ).rejects.toThrow("no longer available");
    await expect(
      outcomes.answer("thr_other", "m1", { kind: "approve" }),
    ).rejects.toThrow("no longer available");
  });
});
