/**
 * An unreported cost is `null` from the gateway response to the screen: never
 * `0`, which would claim the call was free.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { debugThreadMessage } from "../../src/domain/debug-thread.ts";
import { costText, usageSchema, type Trace } from "../../src/domain/trace.ts";
import { hostContract } from "../../src/server/inference/contract.ts";
import {
  gatewayComplete,
  reportedCost,
} from "../../src/server/inference/gateway.ts";
import { gatewayToolModel } from "../../src/server/inference/presentation/gatewayModel.ts";
import { openDatabase } from "../../src/server/db.ts";
import { fakeWorld } from "./fake-bb.ts";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body));

/** `[the cost field as the gateway sent it, what it means]` */
const COSTS: [unknown, number | null][] = [
  [undefined, null],
  ["0.0031", 0.0031],
  [0.002, 0.002],
  [0, 0],
  ["0", 0],
  ["", null],
  ["n/a", null],
];

describe("reportedCost", () => {
  it.each(COSTS)("reads %j as %j", (sent, cost) => {
    expect(reportedCost(sent)).toBe(cost);
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, {}, true])(
    "reads %j as not reported",
    (sent) => {
      expect(reportedCost(sent)).toBeNull();
    },
  );
});

describe("a gateway completion", () => {
  const complete = async (body: unknown, chat = false) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(body)));
    return (
      await gatewayComplete({
        prompt: "classify",
        model: "google/test",
        apiKey: "test-key",
        ...(chat ? { reasoningLevel: "low" } : {}),
      })
    ).usage;
  };

  it.each(COSTS)(
    "reads a Messages response whose cost is %j as %j",
    async (sent, cost) => {
      const usage = await complete({
        content: [{ type: "text", text: "{}" }],
        usage: { input_tokens: 120, output_tokens: 30 },
        ...(sent === undefined
          ? {}
          : { provider_metadata: { gateway: { cost: sent } } }),
      });
      expect(usage).toEqual({ input: 120, output: 30, cost });
    },
  );

  it.each(COSTS)(
    "reads a Chat Completions response whose cost is %j as %j",
    async (sent, cost) => {
      const usage = await complete(
        {
          choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            ...(sent === undefined ? {} : { cost: sent }),
          },
        },
        true,
      );
      expect(usage).toEqual({ input: 120, output: 30, cost });
    },
  );

  it("reports no cost for a response with no usage at all", async () => {
    expect(
      await complete(
        { choices: [{ message: { content: "{}" }, finish_reason: "stop" }] },
        true,
      ),
    ).toEqual({ input: 0, output: 0, cost: null });
    expect(await complete({ content: [{ type: "text", text: "{}" }] })).toEqual(
      { input: 0, output: 0, cost: null },
    );
  });
});

describe("the composition loop's model client", () => {
  it.each(COSTS)("reads a cost of %j as %j", async (sent, cost) => {
    const model = gatewayToolModel({
      model: "anthropic/test",
      apiKey: "test-key",
      fetch: (async () =>
        json({
          content: [{ type: "text", text: "null" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 900, output_tokens: 40 },
          ...(sent === undefined
            ? {}
            : { provider_metadata: { gateway: { cost: sent } } }),
        })) as typeof fetch,
    });
    const reply = await model({
      system: "",
      messages: [],
      tools: [],
      maxTokens: 1024,
      signal: new AbortController().signal,
    });
    expect(reply.usage).toEqual({ input: 900, output: 40, cost });
  });
});

describe("the shapes a cost travels in", () => {
  it("accepts a null cost, and still reads a stored number", () => {
    expect(
      usageSchema.parse({ input: 1, output: 2, cost: null }).cost,
    ).toBeNull();
    expect(usageSchema.parse({ input: 1, output: 2, cost: 0.5 }).cost).toBe(
      0.5,
    );
    expect(usageSchema.safeParse({ input: 1, output: 2 }).success).toBe(false);
  });

  it("lets the machine answer with no cost", () => {
    const usage = { input: 1, output: 2, cost: null };
    expect(
      hostContract.complete.output.parse({ text: "{}", usage }).usage.cost,
    ).toBeNull();
    expect(
      hostContract.present.output.parse({
        kind: "failed",
        reason: "The final answer was not JSON.",
        invalid: true,
        previews: 0,
        modelCalls: 1,
        usage,
      }),
    ).toMatchObject({ invalid: true, usage: { cost: null } });
  });
});

describe("a cost nobody reported, as text", () => {
  const trace = (usage: Trace["usage"]): Trace => ({
    id: "tr_1",
    at: Date.UTC(2026, 1, 1, 11, 30),
    kind: "tidy",
    status: "ok",
    label: "12 threads, 4 workstreams",
    model: "anthropic/claude-sonnet-5.5",
    durationMs: 4_200,
    replayOf: null,
    usage,
    error: null,
    summary: null,
    threads: [],
    provider: "gateway",
    thinking: "medium",
    system: "",
    prompt: "prompt",
    input: null,
    response: "{}",
    reasoning: null,
    stopReason: "stop",
    parsed: {},
    outcome: null,
    links: [],
    replays: [],
  });
  const subject = {
    surface: "Activity",
    headline: "A model call",
    facts: [],
    calls: { traceIds: ["tr_1"] },
  };

  it("says so instead of printing a zero", () => {
    expect(costText(null)).toBe("no cost reported");
    expect(costText(0)).toBe("$0.0000");
    expect(costText(0.01234)).toBe("$0.0123");
  });

  it("reads that way in a debug thread's brief", () => {
    const unreported = debugThreadMessage(subject, [
      trace({ input: 5_400, output: 320, cost: null }),
    ]);
    expect(unreported).toContain("out · no cost reported");
    expect(unreported).not.toContain("$");
    expect(
      debugThreadMessage(subject, [
        trace({ input: 5_400, output: 320, cost: 0.0123 }),
      ]),
    ).toContain("out · $0.0123");
  });

  it("reads that way in bb workstreams trace", async () => {
    const world = await fakeWorld({
      prefs: { advanced: { debugRecord: true } },
      complete: () =>
        JSON.stringify({ recap: "Done.", state: "review", ask: null }),
    });
    try {
      world.addThread("t1", { title: "Alpha parser" });
      world.converse("t1", ["Fix the parser"]);
      await world.harness.behavior.callRpc("refresh", null);
      await world.harness.behavior.runCli(["analyze", "t1", "--json"]);
      const db = openDatabase(world.bb);
      const { id } = db
        .prepare("SELECT id FROM ws_trace WHERE kind = 'turn-end' LIMIT 1")
        .get() as { id: string };
      const show = async () =>
        (await world.harness.behavior.runCli(["trace", id])).stdout;
      expect(await show()).toContain("100 in / 20 out · $0.0001");
      db.prepare(
        "UPDATE ws_trace SET data = json_set(data, '$.usage.cost', json('null')) WHERE id = ?",
      ).run(id);
      const text = await show();
      expect(text).toContain("100 in / 20 out · no cost reported");
      expect(text).not.toContain("$0.0000");
    } finally {
      await world.harness.lifecycle.dispose();
    }
  });
});
