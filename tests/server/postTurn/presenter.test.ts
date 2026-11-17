import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitializedTestPluginHost } from "../test-host.ts";
import { openDatabase } from "../../../src/server/db.ts";
import { findFinalMessage } from "../../../src/server/postTurn/anchor.ts";
import { PresentationStore } from "../../../src/server/postTurn/store.ts";
import {
  PostTurnPresenter,
  type Compose,
  type ComposeResult,
} from "../../../src/server/postTurn/presenter.ts";
import { assistantMessageId } from "../../../src/domain/postTurn/message.ts";
import {
  DEFAULT_PRESENTATION_MODEL,
  type PresentationPrefs,
} from "../../../src/domain/postTurn/prefs.ts";
import { CORRECTION, DEPLOYED_CHANGE } from "../../fixtures/postTurn.ts";
import { eventLog } from "./events.ts";

const THREAD = "thr_root";
const idOf = (turnId: string, itemId = `${turnId}-final`) =>
  assistantMessageId({ threadId: THREAD, turnId, itemId });

const sdkFor = (log: ReturnType<typeof eventLog>) =>
  ({ threads: { events: { list: log.list } } }) as never;

describe("findFinalMessage", () => {
  it("finds the latest root turn's last root message by identity", async () => {
    const log = eventLog();
    log.turn("t1", "First answer.");
    log.startTurn("t2");
    log.message("t2", "t2-a", "Looking.");
    log.startTurn("t2-sub", true);
    log.message("t2", "t2-nested", "Subagent text.", true);
    log.message("t2", "t2-final", "Second answer.");
    log.tool("t2", "t2-after");
    log.endTurn("t2");
    const found = await findFinalMessage(sdkFor(log), THREAD, "Second answer.");
    expect(found).toMatchObject({
      ok: true,
      message: {
        threadId: THREAD,
        turnId: "t2",
        itemId: "t2-final",
        messageId: idOf("t2"),
        text: "Second answer.",
      },
    });
  });

  it.each([
    [
      "no final text",
      (log: ReturnType<typeof eventLog>) => log.turn("t1", "Done."),
      null,
      "The turn ended without a final response.",
    ],
    [
      "an interrupted turn",
      (log: ReturnType<typeof eventLog>) => {
        log.startTurn("t1");
        log.message("t1", "m", "Partial.");
        log.endTurn("t1", "interrupted");
      },
      "Partial.",
      "The turn ended interrupted.",
    ],
    [
      "a thread whose only turn is still running",
      (log: ReturnType<typeof eventLog>) => {
        log.startTurn("t1");
        log.message("t1", "m", "Partial.");
      },
      "Partial.",
      "No recent root turn has finished.",
    ],
    [
      "a question-only turn",
      (log: ReturnType<typeof eventLog>) => {
        log.startTurn("t1");
        log.tool("t1", "ask");
        log.endTurn("t1");
      },
      "Earlier text",
      "The turn has no final assistant message.",
    ],
    [
      "text that differs from the final message",
      (log: ReturnType<typeof eventLog>) => log.turn("t1", "Done."),
      "Something else.",
      "The turn's final message differs from the finished response; the thread changed.",
    ],
    ["no turn", () => {}, "Done.", "The thread has no agent turn."],
  ])("gives up on %s", async (_, build, text, reason) => {
    const log = eventLog();
    build(log);
    expect(await findFinalMessage(sdkFor(log), THREAD, text)).toEqual({
      ok: false,
      reason,
    });
  });

  it("finds the finished turn while a newer one is still running", async () => {
    const log = eventLog();
    log.turn("t1", "Done.");
    // A recap reminder or a queued message starts the next turn at once.
    log.startTurn("t2");
    log.tool("t2", "recap");
    expect(await findFinalMessage(sdkFor(log), THREAD, "Done.")).toMatchObject({
      ok: true,
      message: { turnId: "t1", itemId: "t1-final" },
    });
    // Once that turn finishes without text, its idle event finds nothing, and
    // the earlier response keeps the document composed for it.
    log.endTurn("t2");
    expect(await findFinalMessage(sdkFor(log), THREAD, null)).toEqual({
      ok: false,
      reason: "The turn ended without a final response.",
    });
    expect(await findFinalMessage(sdkFor(log), THREAD, "Done.")).toEqual({
      ok: false,
      reason: "The turn has no final assistant message.",
    });
  });

  it("finds a root turn behind many subagent turns and many tool items", async () => {
    const log = eventLog();
    log.startTurn("t1");
    log.message("t1", "t1-final", "Done after delegating.");
    for (let i = 0; i < 30; i++) {
      log.startTurn(`sub${i}`, true);
      log.tool("t1", `tool${i}`);
    }
    log.endTurn("t1");
    expect(
      await findFinalMessage(sdkFor(log), THREAD, "Done after delegating."),
    ).toMatchObject({
      ok: true,
      message: { turnId: "t1", itemId: "t1-final" },
    });
  });

  it("uses a named turn without matching text", async () => {
    const log = eventLog();
    log.turn("t1", "First.");
    log.turn("t2", "Second.");
    expect(
      await findFinalMessage(sdkFor(log), THREAD, null, { turnId: "t1" }),
    ).toMatchObject({ ok: true, message: { text: "First." } });
    expect(
      await findFinalMessage(sdkFor(log), THREAD, null, { turnId: "t9" }),
    ).toEqual({ ok: false, reason: "No recent root turn has that id." });
  });

  it("composes for a narrative that accompanies a question", async () => {
    const log = eventLog();
    log.startTurn("t1");
    log.message("t1", "t1-final", "Both options work; which should ship?");
    log.tool("t1", "ask-question");
    log.endTurn("t1");
    expect(
      await findFinalMessage(
        sdkFor(log),
        THREAD,
        "Both options work; which should ship?",
      ),
    ).toMatchObject({ ok: true, message: { itemId: "t1-final" } });
  });
});

describe("PostTurnPresenter", () => {
  const disposers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(disposers.splice(0).map((dispose) => dispose()));
  });

  async function setup(
    options: {
      compose?: Compose;
      prefs?: Partial<PresentationPrefs>;
    } = {},
  ) {
    const host = await createInitializedTestPluginHost();
    disposers.push(() => host.harness.lifecycle.dispose());
    const db = openDatabase(host.bb);
    const store = new PresentationStore(db);
    const log = eventLog();
    const changed = vi.fn();
    const compose = vi.fn(
      options.compose ??
        (async (): Promise<ComposeResult> => ({
          kind: "document",
          document: CORRECTION,
        })),
    );
    const warn = vi.fn();
    const presenter = new PostTurnPresenter({
      sdk: () => sdkFor(log),
      store,
      prefs: () => ({
        enabled: true,
        model: DEFAULT_PRESENTATION_MODEL,
        ...options.prefs,
      }),
      compose,
      title: () => "Summary model check",
      topic: () => ({ name: "Evals", color: { hue: 200, level: 0 } }),
      changed,
      log: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } as never,
    });
    disposers.push(async () => presenter.dispose());
    const thread = {
      id: THREAD,
      visibility: "visible",
      parentThreadId: null,
      archivedAt: null,
    };
    return { store, log, changed, compose, presenter, thread, warn };
  }

  it("stores one document for a repeated idle event, under the turn's message", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const w = await setup({
      compose: async () => {
        await gate;
        return { kind: "document", document: CORRECTION };
      },
    });
    w.log.turn("t1", "Answer.");
    const first = w.presenter.present(THREAD, "Answer.");
    const second = w.presenter.present(THREAD, "Answer.");
    await vi.waitFor(() => expect(w.compose).toHaveBeenCalledTimes(1));
    release();
    expect(await first).toEqual({ kind: "stored", messageId: idOf("t1") });
    expect(await second).toEqual({ kind: "stored", messageId: idOf("t1") });
    expect(await w.presenter.present(THREAD, "Answer.")).toEqual({
      kind: "skipped",
      reason: "This response already has one.",
    });
    expect(w.compose).toHaveBeenCalledTimes(1);
    expect(w.changed).toHaveBeenCalledTimes(1);
    expect(w.store.list(THREAD)).toMatchObject([
      {
        messageId: idOf("t1"),
        turnId: "t1",
        topic: { name: "Evals" },
        document: CORRECTION,
      },
    ]);
    expect(w.compose.mock.calls[0]![0]).toMatchObject({
      response: "Answer.",
      title: "Summary model check",
      topic: { name: "Evals" },
    });
  });

  it("keeps a late document under the message it was composed for", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const w = await setup({
      compose: async () => {
        await gate;
        return { kind: "document", document: CORRECTION };
      },
    });
    w.log.turn("t1", "Answer.");
    const pending = w.presenter.present(THREAD, "Answer.");
    await vi.waitFor(() => expect(w.compose).toHaveBeenCalled());
    // A new turn starts and finishes before the composition does.
    w.log.turn("t2", "Next answer.");
    release();
    expect(await pending).toEqual({ kind: "stored", messageId: idOf("t1") });
    expect(w.store.list(THREAD).map((entry) => entry.messageId)).toEqual([
      idOf("t1"),
    ]);
  });

  it.each([
    [
      "the composition failed",
      { kind: "failed", reason: "Model unavailable." },
      "Model unavailable.",
    ],
    [
      "the model chose nothing",
      { kind: "none", reason: "Nothing to add." },
      "Nothing to add.",
    ],
    [
      "the document is invalid",
      {
        kind: "document",
        document: { version: 1, blocks: [{ type: "script" }] },
      },
      /^The document is invalid: blocks\[0\]\.type/,
    ],
  ] as const)("stores nothing when %s", async (_, result, reason) => {
    const w = await setup({ compose: async () => result as ComposeResult });
    w.log.turn("t1", "Answer.");
    const outcome = await w.presenter.present(THREAD, "Answer.");
    expect(outcome.kind).toBe("skipped");
    expect((outcome as { reason: string }).reason).toMatch(reason);
    expect(w.store.list(THREAD)).toEqual([]);
    expect(w.changed).not.toHaveBeenCalled();
  });

  it("does not enhance a reply block or an over-long response", async () => {
    const w = await setup();
    const block = ':::reply{state="complete"}\n# Done\n:::';
    w.log.turn("t1", block);
    expect(await w.presenter.present(THREAD, block)).toEqual({
      kind: "skipped",
      reason: "The response is a reply block; it is drawn as one.",
    });
    const long = "x".repeat(24_001);
    w.log.turn("t2", long);
    expect((await w.presenter.present(THREAD, long)).kind).toBe("skipped");
    expect(w.compose).not.toHaveBeenCalled();
  });

  it("ignores hidden, child, and archived threads, and everything while off", async () => {
    const w = await setup();
    w.log.turn("t1", "Answer.");
    w.presenter.onIdle({ ...w.thread, visibility: "hidden" }, "Answer.");
    w.presenter.onIdle(
      { ...w.thread, parentThreadId: "thr_parent" },
      "Answer.",
    );
    w.presenter.onIdle({ ...w.thread, archivedAt: 1 }, "Answer.");
    const off = await setup({ prefs: { enabled: false } });
    off.log.turn("t1", "Answer.");
    off.presenter.onIdle(off.thread, "Answer.");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(w.compose).not.toHaveBeenCalled();
    expect(off.compose).not.toHaveBeenCalled();
    expect(w.presenter.appliesTo({ parentThreadId: null })).toBe(true);
    expect(w.presenter.appliesTo({ parentThreadId: "thr_parent" })).toBe(false);
    expect(off.presenter.appliesTo({ parentThreadId: null })).toBe(false);
  });

  it("composes on idle for a visible thread with no parent", async () => {
    const w = await setup();
    w.log.turn("t1", "Answer.");
    w.presenter.onIdle(w.thread, "Answer.");
    await vi.waitFor(() => expect(w.changed).toHaveBeenCalledWith(THREAD));
    expect(w.store.has(idOf("t1"))).toBe(true);
  });

  it("drops a thread's documents and its running composition when it is deleted", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const w = await setup({
      compose: async ({ signal }) => {
        await gate;
        expect(signal.aborted).toBe(true);
        return { kind: "document", document: DEPLOYED_CHANGE };
      },
    });
    w.store.save({
      messageId: idOf("t0"),
      threadId: THREAD,
      turnId: "t0",
      topic: null,
      document: CORRECTION,
      createdAt: 1,
    });
    w.log.turn("t1", "Answer.");
    const pending = w.presenter.present(THREAD, "Answer.");
    await vi.waitFor(() => expect(w.compose).toHaveBeenCalled());
    w.presenter.forget(THREAD);
    release();
    expect(await pending).toEqual({
      kind: "skipped",
      reason: "The thread is gone.",
    });
    expect(w.store.list(THREAD)).toEqual([]);
    expect(w.changed).toHaveBeenCalledWith(THREAD);
  });

  it("stores nothing when the thread is deleted while its message is looked up", async () => {
    const w = await setup();
    w.log.turn("t1", "Answer.");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const list = w.log.list;
    w.log.list = async (args) => {
      await gate;
      return list(args);
    };
    const pending = w.presenter.present(THREAD, "Answer.");
    w.presenter.forget(THREAD);
    release();
    expect(await pending).toEqual({
      kind: "skipped",
      reason: "The thread is gone.",
    });
    expect(w.compose).not.toHaveBeenCalled();
    expect(w.store.list(THREAD)).toEqual([]);
  });

  it("skips a response while two compositions are running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const w = await setup({
      compose: async () => {
        await gate;
        return { kind: "document", document: CORRECTION };
      },
    });
    w.log.turn("t1", "One.");
    const first = w.presenter.present(THREAD, "One.");
    await vi.waitFor(() => expect(w.compose).toHaveBeenCalledTimes(1));
    w.log.turn("t2", "Two.");
    const second = w.presenter.present(THREAD, "Two.");
    await vi.waitFor(() => expect(w.compose).toHaveBeenCalledTimes(2));
    w.log.turn("t3", "Three.");
    expect(await w.presenter.present(THREAD, "Three.")).toEqual({
      kind: "skipped",
      reason: "Other compositions are running.",
    });
    release();
    await Promise.all([first, second]);
    expect(w.store.list(THREAD)).toHaveLength(2);
  });

  it("stores an injected document without composing", async () => {
    const w = await setup();
    w.log.turn("t1", "Answer.");
    expect(
      await w.presenter.present(THREAD, "Answer.", {
        document: DEPLOYED_CHANGE,
      }),
    ).toEqual({
      kind: "stored",
      messageId: idOf("t1"),
    });
    expect(w.compose).not.toHaveBeenCalled();
    expect(
      await w.presenter.present(THREAD, "Answer.", {
        document: { version: 1, blocks: [] },
      }),
    ).toMatchObject({ kind: "skipped" });
  });
});

describe("PresentationStore", () => {
  it("skips a stored row that no longer validates", async () => {
    const host = await createInitializedTestPluginHost();
    try {
      const db = openDatabase(host.bb);
      const store = new PresentationStore(db);
      store.save({
        messageId: "m1",
        threadId: THREAD,
        turnId: "t1",
        topic: null,
        document: CORRECTION,
        createdAt: 1,
      });
      db.prepare(
        "INSERT INTO ws_post_turn_document VALUES ('m2', ?, 't2', NULL, '{\"version\":9}', 2)",
      ).run(THREAD);
      expect(store.list(THREAD).map((entry) => entry.messageId)).toEqual([
        "m1",
      ]);
      expect(store.forget(THREAD)).toBe(2);
      expect(store.list(THREAD)).toEqual([]);
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });
});
