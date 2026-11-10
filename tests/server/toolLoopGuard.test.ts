import { createTestPluginHost } from "./test-host.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { ToolLoopGuard } from "../../src/server/toolLoopGuard.ts";
import { AgentRecaps } from "../../src/server/recap.ts";
import { openDatabase } from "../../src/server/db.ts";
import { parseRecapPrefs } from "../../src/domain/recapPrefs.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function world(disableOnLoop = true) {
  const events: Array<{
    seq: number;
    type: string;
    scope: { kind: "turn"; turnId: string };
    data: Record<string, unknown>;
  }> = [];
  let thread = makeThreadResponse({ id: "t1", status: "active" });
  const lists: Array<{ types?: readonly string[]; afterSeq?: string }> = [];
  let enabled = true;
  let loops = 0;
  const { bb, harness } = createTestPluginHost({
    sdk: {
      threads: {
        get: async () => thread,
        stop: async () => ({ ok: true }),
        events: {
          list: async (args: {
            types?: readonly string[];
            afterSeq?: string;
            limit?: string;
            order?: string;
          }) => {
            lists.push({ types: args.types, afterSeq: args.afterSeq });
            let rows = events.filter(
              (event) =>
                (!args.types || args.types.includes(event.type)) &&
                event.seq > Number(args.afterSeq ?? 0),
            );
            if (args.order === "desc") rows = [...rows].reverse();
            return rows.slice(0, Number(args.limit ?? 100));
          },
        },
      },
    },
  });
  const guard = new ToolLoopGuard({
    bb,
    enabled: () => enabled,
    onLoop: () => {
      loops++;
      if (disableOnLoop) enabled = false;
    },
  });
  cleanups.push(async () => {
    await guard.dispose();
    await harness.lifecycle.dispose();
  });
  let turnId = "turn1";
  const add = (type: string, data: Record<string, unknown> = {}) => {
    events.push({
      seq: events.length + 1,
      type,
      scope: { kind: "turn", turnId },
      data,
    });
  };
  const fail = (
    result = "Invalid arguments: next belongs only in continuing",
    tool = "WorkstreamsRecap",
  ) =>
    add("item/completed", {
      item: {
        type: "toolCall",
        id: `call-${events.length}`,
        tool,
        status: "failed",
        arguments: { goal: `Wording ${events.length}` },
        result,
      },
    });
  const success = (
    result = "ok",
    tool = "WorkstreamsRecap",
    args: Record<string, unknown> = { goal: "Clarified Up Next rows" },
  ) =>
    add("item/completed", {
      item: {
        type: "toolCall",
        id: `call-${events.length}`,
        tool,
        status: "completed",
        arguments: args,
        result,
      },
    });
  const command = (command: string) =>
    add("item/completed", {
      item: {
        type: "commandExecution",
        id: `call-${events.length}`,
        command,
        status: "completed",
        result: "",
      },
    });
  const observe = () => guard.observe("t1", events.length);
  add("turn/started");
  return {
    events,
    lists,
    add,
    fail,
    success,
    command,
    observe,
    guard,
    harness,
    loops: () => loops,
    disable: () => {
      enabled = false;
    },
    idle: () => {
      thread = { ...thread, status: "idle" };
    },
    nextTurn: () => {
      turnId = "turn2";
      add("turn/started");
    },
  };
}

describe("repeated successful call guard", () => {
  it("stops on the fifth identical successful call", async () => {
    const w = world();
    for (let i = 0; i < 4; i++) {
      w.success();
      await w.observe();
    }
    expect(w.loops()).toBe(0);
    w.success();
    await w.observe();
    expect(w.loops()).toBe(1);
    expect(w.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);
    w.success();
    await w.observe();
    expect(w.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);
  });

  it("counts only exact repeats of tool, arguments, and output", async () => {
    const w = world();
    const four = (
      result = "ok",
      tool = "WorkstreamsRecap",
      args: Record<string, unknown> = { goal: "Clarified Up Next rows" },
    ) => {
      for (let i = 0; i < 4; i++) w.success(result, tool, args);
    };
    four();
    // Same call, new output: the model learned something.
    four("Recap complete");
    // Same output, new arguments: a different question.
    four("Recap complete", "WorkstreamsRecap", { goal: "Other goal" });
    // A different tool.
    four("Recap complete", "read", { path: "README.md" });
    await w.observe();
    expect(w.loops()).toBe(0);
  });

  it("keeps counting repeats across text and reasoning between calls", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) {
      w.add("item/completed", {
        item: { type: "reasoning", id: `r-${i}`, content: ["Stop."] },
      });
      w.add("item/completed", {
        item: { type: "agentMessage", id: `m-${i}`, text: "Ending." },
      });
      w.success();
    }
    await w.observe();
    expect(w.loops()).toBe(1);
  });

  it("leaves repeated shell commands and interleaved commands alone", async () => {
    const w = world();
    for (let i = 0; i < 8; i++) w.command("bb thread wait thr_1");
    // A command between identical calls breaks the run.
    for (let i = 0; i < 4; i++) w.success();
    w.command("npm test");
    for (let i = 0; i < 4; i++) w.success();
    await w.observe();
    expect(w.loops()).toBe(0);
  });

  it("never carries repeats into a fresh turn", async () => {
    const w = world();
    for (let i = 0; i < 4; i++) w.success();
    await w.observe();
    w.nextTurn();
    w.success();
    await w.observe();
    expect(w.loops()).toBe(0);
    for (let i = 0; i < 4; i++) w.success();
    await w.observe();
    expect(w.loops()).toBe(1);
  });

  it("treats a failure as a new event rather than a repeat", async () => {
    const w = world();
    for (let i = 0; i < 4; i++) w.success();
    w.fail();
    for (let i = 0; i < 4; i++) w.success();
    await w.observe();
    expect(w.loops()).toBe(0);
  });
});

describe("failing tool loop guard", () => {
  it("stops on the fifth same-tool same-error failure despite reworded arguments", async () => {
    const w = world();
    for (let i = 0; i < 4; i++) {
      w.fail();
      await w.observe();
    }
    expect(w.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
    w.fail();
    await w.observe();
    expect(w.loops()).toBe(1);
    expect(w.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);
    w.fail();
    await w.observe();
    expect(w.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);
  });

  it("covers other tools and batched history after startup or reload", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) w.fail("Unknown method", "mcp");
    await Promise.all([w.observe(), w.observe()]);
    expect(w.loops()).toBe(1);
    expect(w.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(1);
  });

  it("resets after success, a different tool, or a different error", async () => {
    const w = world();
    for (let i = 0; i < 4; i++) w.fail();
    w.success();
    for (let i = 0; i < 4; i++) w.fail();
    w.fail("Different error");
    for (let i = 0; i < 4; i++) w.fail();
    w.fail(undefined, "read");
    for (let i = 0; i < 4; i++) w.fail();
    await w.observe();
    expect(w.loops()).toBe(0);
  });

  it("paginates past more than one page of output", async () => {
    const w = world();
    for (let i = 0; i < 150; i++)
      w.add("item/agentMessage/delta", { delta: "output" });
    for (let i = 0; i < 5; i++) w.fail();
    await w.observe();
    expect(w.loops()).toBe(1);
  });

  it("does not stop completed turns, idle threads, or disabled enrollment", async () => {
    for (const finish of ["completed", "idle", "disabled"]) {
      const w = world();
      for (let i = 0; i < 5; i++) w.fail();
      if (finish === "completed")
        w.add("turn/completed", { status: "completed" });
      if (finish === "idle") w.idle();
      if (finish === "disabled") w.disable();
      await w.observe();
      expect(w.loops()).toBe(0);
    }
  });

  it("never carries failures into a fresh turn", async () => {
    const w = world();
    for (let i = 0; i < 4; i++) w.fail();
    await w.observe();
    w.nextTurn();
    w.fail();
    await w.observe();
    expect(w.loops()).toBe(0);
    for (let i = 0; i < 4; i++) w.fail();
    await w.observe();
    expect(w.loops()).toBe(1);
  });

  it("retries a failed stop", async () => {
    const w = world(false);
    let attempts = 0;
    w.harness.inspection.sdk.stub("threads.stop", async () => {
      if (++attempts === 1) throw new Error("Transport failed");
      return { ok: true };
    });
    for (let i = 0; i < 5; i++) w.fail();
    await w.observe();
    expect(attempts).toBe(1);
    w.fail();
    await w.observe();
    expect(attempts).toBe(2);
  });

  it("cancels a scan invalidated before its first history read finishes", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) w.fail();
    const original = w.events[0]!;
    w.harness.inspection.sdk.stub("threads.events.list", async () => {
      w.guard.forget("t1");
      return [original];
    });
    await w.observe();
    expect(w.loops()).toBe(0);
  });

  it("forgets an in-flight scan when fresh input arrives", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) w.fail();
    w.harness.inspection.sdk.stub("threads.get", async () => {
      w.guard.forget("t1");
      return makeThreadResponse({ id: "t1", status: "active" });
    });
    await w.observe();
    expect(w.loops()).toBe(0);
  });
});

describe("guard reads", () => {
  it("reads the turn once, only scanned event types, and only new events", async () => {
    const w = world();
    w.success("first");
    await w.observe();
    expect(w.lists).toEqual([
      { types: ["turn/started"], afterSeq: undefined },
      {
        types: [
          "item/completed",
          "turn/started",
          "turn/completed",
          "client/turn/requested",
        ],
        afterSeq: "1",
      },
    ]);
    // Streaming events the guard doesn't scan move it past them unread.
    for (let i = 0; i < 250; i++) w.add("item/updated");
    w.lists.length = 0;
    await w.observe();
    expect(w.lists).toEqual([{ types: expect.any(Array), afterSeq: "2" }]);
    w.lists.length = 0;
    await w.observe();
    await w.observe();
    expect(w.lists).toEqual([]);
    w.success("second");
    await w.observe();
    expect(w.lists).toEqual([
      { types: expect.any(Array), afterSeq: String(w.events.length - 1) },
    ]);
  });

  it("still sees a new turn after skipping the turn read", async () => {
    const w = world();
    for (let i = 0; i < 4; i++) {
      w.success();
      await w.observe();
    }
    w.nextTurn();
    await w.observe();
    // The new turn starts a fresh count.
    for (let i = 0; i < 4; i++) {
      w.success();
      await w.observe();
    }
    expect(w.loops()).toBe(0);
    w.success();
    await w.observe();
    expect(w.loops()).toBe(1);
  });

  it("guards the next turn after stopping one", async () => {
    const w = world(false);
    for (let i = 0; i < 5; i++) w.fail();
    await w.observe();
    expect(w.loops()).toBe(1);
    // The stopped turn reads nothing more but its turn start.
    w.fail();
    w.lists.length = 0;
    await w.observe();
    expect(w.lists).toEqual([{ types: ["turn/started"], afterSeq: undefined }]);
    w.nextTurn();
    for (let i = 0; i < 5; i++) w.fail();
    await w.observe();
    expect(w.loops()).toBe(2);
  });

  it("scans events whose batch arrived during a read", async () => {
    const w = world();
    w.success();
    await w.observe();
    for (let i = 0; i < 3; i++) w.add("item/updated");
    w.lists.length = 0;
    let first = true;
    let late: Promise<void> | undefined;
    w.harness.inspection.sdk.stub(
      "threads.events.list",
      async (args: { afterSeq?: string; types?: readonly string[] }) => {
        w.lists.push({ types: args.types, afterSeq: args.afterSeq });
        await Promise.resolve();
        if (first) {
          first = false;
          // A failing run lands while the first page is in flight.
          for (let i = 0; i < 5; i++) w.fail();
          late = w.observe();
          return [];
        }
        return w.events.filter(
          (event) =>
            args.types!.includes(event.type) &&
            event.seq > Number(args.afterSeq ?? 0),
        );
      },
    );
    await w.guard.observe("t1", 5);
    // The batch joined the scan in flight rather than starting its own.
    expect(late).toBeDefined();
    expect(w.lists.map((read) => read.afterSeq)).toEqual(["2", "5", undefined]);
    expect(w.loops()).toBe(1);
  });
});

describe("guarded threads", () => {
  it("reads preferences and enrollment once, until they change", async () => {
    const { bb, harness } = createTestPluginHost({ pluginId: "guarded" });
    const db = openDatabase(bb);
    let required = true;
    const prefs = vi.fn(() => ({ ...parseRecapPrefs(null), required }));
    const recaps = new AgentRecaps({
      bb,
      db,
      prefs,
      since: () => 0,
      onChange: () => {},
    });
    recaps.register();
    cleanups.push(async () => {
      await recaps.dispose();
      await harness.lifecycle.dispose();
    });
    harness.sdk.stub("threads.events.list", async () => []);
    const thread = makeThreadResponse({ id: "t1", status: "active" });
    const batch = (sequence: number) =>
      harness.behavior.emitThreadEvent("experimental_thread.events", {
        thread,
        sequence,
      });
    recaps.configure("t1", true);
    prefs.mockClear();
    for (let sequence = 1; sequence <= 5; sequence++) await batch(sequence);
    expect(prefs).not.toHaveBeenCalled();
    expect(harness.inspection.sdk.callsTo("threads.events.list").length).toBe(
      5,
    );

    // Turning recaps off stops the guard at once.
    required = false;
    recaps.prefsChanged();
    const reads = harness.inspection.sdk.callsTo("threads.events.list").length;
    await batch(6);
    await batch(7);
    expect(prefs).toHaveBeenCalledTimes(1);
    expect(harness.inspection.sdk.callsTo("threads.events.list").length).toBe(
      reads,
    );

    // So does archiving, without reading preferences.
    required = true;
    recaps.prefsChanged();
    recaps.configure("t1", true);
    recaps.onArchived("t1");
    prefs.mockClear();
    await batch(8);
    expect(prefs).not.toHaveBeenCalled();
    expect(harness.inspection.sdk.callsTo("threads.events.list").length).toBe(
      reads,
    );
  });
});
