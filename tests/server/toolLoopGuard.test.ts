import { createTestPluginHost } from "./test-host.ts";
import { afterEach, describe, expect, it } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { ToolLoopGuard } from "../../src/server/toolLoopGuard.ts";

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
