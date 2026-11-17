/**
 * What `Inference` tells the usage gate: it asks before every request, and
 * leaves one row for every request it sent, however the request ended.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelChoice } from "../../src/domain/prefs.ts";
import type { StartInput } from "../../src/domain/start.ts";
import type { WorkstreamChoiceInput } from "../../src/domain/workstreamChoice.ts";
import { openDatabase } from "../../src/server/db.ts";
import { Inference, type Complete } from "../../src/server/model.ts";
import { SpendCapError } from "../../src/server/spendGuard.ts";
import { TraceStore } from "../../src/server/trace.ts";
import { fakeUsageGate } from "./fake-usage-gate.ts";
import { createInitializedTestPluginHost } from "./test-host.ts";

const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
});

const GATEWAY: ModelChoice = {
  kind: "gateway",
  model: "google/gemini-3.1-flash-lite",
};
const WORKER: ModelChoice = {
  kind: "provider",
  providerId: "codex",
  model: "gpt-5",
  reasoningLevel: "low",
};
const START: StartInput = {
  request: "Fix the parser's handling of tabs",
  project: null,
  choice: null,
};
const CHOICE: WorkstreamChoiceInput = {
  title: null,
  requests: ["Fix the parser's handling of tabs"],
  project: null,
  checkout: null,
  workstreams: [],
  hints: [],
  current: null,
};
const TITLE = JSON.stringify({
  title: { verb: "Fix", subject: "parser tabs" },
});
const USAGE = { input: 120, output: 30, cost: 0.004 };

type Answer = Awaited<ReturnType<Complete>>;
const answer = (text: string, usage: Answer["usage"] = USAGE): Answer => ({
  text,
  usage,
});

async function setup(
  complete: Complete,
  options: { record?: boolean; now?: () => number } = {},
) {
  const host = await createInitializedTestPluginHost({ pluginId: "model" });
  disposals.push(() => host.harness.lifecycle.dispose());
  const traces = new TraceStore(openDatabase(host.bb));
  const usage = fakeUsageGate();
  const calls = vi.fn(complete);
  const inference = new Inference({
    complete: calls,
    traces,
    record: async () => options.record ?? true,
    usage,
    ...(options.now ? { now: options.now } : {}),
  });
  return { inference, traces, usage, calls };
}

const digest = (prompt: string) =>
  createHash("sha256").update(prompt).digest("hex").slice(0, 16);

describe("a call that was sent", () => {
  it("leaves one row with what the provider reported", async () => {
    // Recent, so the trace store's retention keeps the call's trace.
    const started = Date.now();
    let now = started;
    const { inference, traces, usage, calls } = await setup(
      async () => {
        now += 850;
        return answer(TITLE);
      },
      { now: () => now },
    );
    const { traceId } = await inference.run("start", START, {
      model: GATEWAY,
      threadId: "t1",
    });
    const prompt = calls.mock.calls[0]![0];

    expect(usage.admitted).toEqual(["start"]);
    expect(traceId).not.toBeNull();
    expect(usage.rows).toEqual([
      {
        at: started,
        source: "start",
        path: "gateway",
        model: "google/gemini-3.1-flash-lite",
        threadId: "t1",
        traceId,
        status: "ok",
        calls: 1,
        inputTokens: 120,
        outputTokens: 30,
        cost: 0.004,
        promptHash: digest(prompt),
        promptChars: prompt.length,
        durationMs: 850,
        replay: false,
      },
    ]);
    expect(usage.rows[0]!.promptHash).toMatch(/^[0-9a-f]{16}$/);
    expect(traces.get(traceId!)?.status).toBe("ok");
  });

  it("keeps a cost the provider did not report as null, with its tokens", async () => {
    const { inference, usage } = await setup(async () =>
      answer(TITLE, { input: 120, output: 30, cost: null }),
    );
    await inference.run("start", START, { model: GATEWAY });
    expect(usage.rows).toMatchObject([
      { status: "ok", inputTokens: 120, outputTokens: 30, cost: null },
    ]);
  });

  it("counts a worker call as a request with no tokens or cost", async () => {
    const { inference, usage } = await setup(async () => answer(TITLE, null));
    await inference.run("start", START, { model: WORKER });
    expect(usage.rows).toMatchObject([
      {
        path: "worker",
        model: "codex/gpt-5",
        status: "ok",
        inputTokens: null,
        outputTokens: null,
        cost: null,
      },
    ]);
  });

  it("takes the thread from the call's links when no thread is named", async () => {
    const { inference, usage } = await setup(async () => answer(TITLE));
    await inference.run("start", START, {
      model: GATEWAY,
      links: [
        { kind: "entry", ref: "entry-1" },
        { kind: "thread", ref: "t7" },
        { kind: "thread", ref: "t8" },
      ],
    });
    await inference.run("start", START, { model: GATEWAY });
    expect(usage.rows.map((row) => row.threadId)).toEqual(["t7", null]);
  });

  it("still leaves a row while trace recording is off", async () => {
    const { inference, traces, usage } = await setup(
      async () => answer(TITLE),
      { record: false },
    );
    const { traceId } = await inference.run("start", START, { model: GATEWAY });
    expect(traceId).toBeNull();
    expect(traces.list({})).toEqual([]);
    expect(usage.rows).toMatchObject([
      { status: "ok", traceId: null, cost: 0.004 },
    ]);
  });

  it("gives identical prompts the same digest and different prompts different ones", async () => {
    const { inference, usage } = await setup(async () => answer(TITLE));
    await inference.run("start", START, { model: GATEWAY });
    await inference.run("start", START, { model: GATEWAY });
    await inference.run(
      "start",
      { ...START, request: "Rename the lexer" },
      { model: GATEWAY },
    );
    const [first, second, third] = usage.rows.map((row) => row.promptHash);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  it("is not changed by a gate that fails to record", async () => {
    const { inference, usage } = await setup(async () => answer(TITLE));
    usage.record = () => {
      throw new Error("disk full");
    };
    const { value } = await inference.run("start", START, { model: GATEWAY });
    expect(value.title).toBe("Fix parser tabs");
  });
});

describe("a call that did not produce an answer", () => {
  it("records an unusable answer as invalid, with the usage it cost", async () => {
    const { inference, traces, usage, calls } = await setup(async () =>
      answer("not json"),
    );
    await expect(
      inference.run("workstream-choice", CHOICE, { model: GATEWAY }),
    ).rejects.toThrow();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(usage.rows).toMatchObject([
      {
        source: "workstream-choice",
        status: "invalid",
        inputTokens: 120,
        outputTokens: 30,
        cost: 0.004,
      },
    ]);
    expect(traces.get(usage.rows[0]!.traceId!)?.status).toBe("invalid");
  });

  it("records a failed request with no tokens and no cost", async () => {
    const { inference, traces, usage } = await setup(async () => {
      throw new Error("AI Gateway returned 500.");
    });
    await expect(
      inference.run("workstream-choice", CHOICE, { model: GATEWAY }),
    ).rejects.toThrow("AI Gateway returned 500.");
    expect(usage.rows).toMatchObject([
      { status: "failed", inputTokens: null, outputTokens: null, cost: null },
    ]);
    expect(traces.get(usage.rows[0]!.traceId!)?.status).toBe("failed");
  });

  it("records a timeout as a failed request", async () => {
    const { inference, usage } = await setup(
      (_prompt, _choice, signal) =>
        new Promise((_resolve, reject) =>
          signal!.addEventListener("abort", () => reject(signal!.reason)),
        ),
    );
    await expect(
      inference.run("workstream-choice", CHOICE, {
        model: GATEWAY,
        timeoutMs: 20,
      }),
    ).rejects.toThrow("The model didn't answer within 20 ms.");
    expect(usage.rows).toMatchObject([
      { status: "failed", inputTokens: null, outputTokens: null, cost: null },
    ]);
    expect(usage.rows[0]!.traceId).not.toBeNull();
  });

  it("sends, admits, and records nothing when its answer already stopped mattering", async () => {
    const { inference, traces, usage, calls } = await setup(async () =>
      answer(TITLE),
    );
    const abort = new AbortController();
    const reason = new Error("The draft changed.");
    abort.abort(reason);
    await expect(
      inference.run("start", START, { model: GATEWAY, signal: abort.signal }),
    ).rejects.toBe(reason);
    expect(calls).not.toHaveBeenCalled();
    expect(usage.admitted).toEqual([]);
    expect(usage.rows).toEqual([]);
    expect(traces.list({})).toEqual([]);
  });

  it("records a request aborted in flight, which the provider may have billed", async () => {
    const abort = new AbortController();
    const reason = new Error("The draft changed.");
    const { inference, traces, usage } = await setup(
      (_prompt, _choice, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason));
          queueMicrotask(() => abort.abort(reason));
        }),
    );
    await expect(
      inference.run("start", START, {
        model: GATEWAY,
        threadId: "t1",
        signal: abort.signal,
      }),
    ).rejects.toBe(reason);
    expect(usage.rows).toMatchObject([
      {
        status: "aborted",
        threadId: "t1",
        traceId: null,
        inputTokens: null,
        outputTokens: null,
        cost: null,
      },
    ]);
    // An aborted call explains nothing, so it leaves no trace; and it is not
    // asked again.
    expect(traces.list({})).toEqual([]);
    expect(usage.admitted).toEqual(["start"]);
  });
});

describe("the start repair retry", () => {
  it("is a second request with its own row", async () => {
    const answers = [
      answer("not json"),
      answer(TITLE, { ...USAGE, cost: 0.01 }),
    ];
    const { inference, usage, calls } = await setup(async () =>
      answers.shift()!,
    );
    const { value, traceId } = await inference.run("start", START, {
      model: GATEWAY,
      threadId: "t1",
    });
    expect(value.title).toBe("Fix parser tabs");
    expect(calls).toHaveBeenCalledTimes(2);
    expect(usage.admitted).toEqual(["start", "start"]);
    expect(usage.rows).toMatchObject([
      { status: "invalid", cost: 0.004, threadId: "t1", replay: false },
      { status: "ok", cost: 0.01, threadId: "t1", replay: false, traceId },
    ]);
    expect(usage.rows[0]!.traceId).not.toBe(traceId);
    expect(usage.rows[1]!.promptHash).not.toBe(usage.rows[0]!.promptHash);
  });

  it("counts an answer whose workstream is refused as invalid, and asks again", async () => {
    const input: StartInput = {
      ...START,
      choice: {
        project: null,
        checkout: null,
        workstreams: [
          {
            id: "ws_1",
            name: "Alpha",
            description: null,
            parentId: null,
            aliases: [],
          },
        ],
        hints: [],
        current: null,
      },
    };
    const titled = (workstream: string | null) =>
      answer(
        JSON.stringify({
          title: { verb: "Fix", subject: "parser tabs" },
          workstream,
          propose: null,
          scopeShift: false,
        }),
      );
    const answers = [titled("bogus"), titled(null)];
    const { inference, usage } = await setup(async () => answers.shift()!);
    const { value } = await inference.run("start", input, { model: GATEWAY });
    expect(value.workstreamError).toBeUndefined();
    expect(usage.rows.map((row) => row.status)).toEqual(["invalid", "ok"]);
  });

  it("does not ask again for an answer nobody is waiting for", async () => {
    const abort = new AbortController();
    const { inference, usage, calls } = await setup(async () => {
      abort.abort(new Error("gone"));
      return answer("not json");
    });
    await expect(
      inference.run("start", START, { model: GATEWAY, signal: abort.signal }),
    ).rejects.toThrow();
    expect(calls).toHaveBeenCalledTimes(1);
    expect(usage.rows).toMatchObject([{ status: "invalid" }]);
  });
});

describe("a replay", () => {
  it("is marked as one and points at its own trace", async () => {
    const { inference, usage } = await setup(async () => answer(TITLE));
    const { traceId } = await inference.run("start", START, {
      model: GATEWAY,
      threadId: "t1",
    });
    const replay = await inference.replay(traceId!);
    expect(usage.admitted).toEqual(["start", "start"]);
    expect(usage.rows).toMatchObject([
      { replay: false, traceId },
      {
        replay: true,
        source: "start",
        traceId: replay.id,
        status: "ok",
        promptHash: usage.rows[0]!.promptHash,
      },
    ]);
  });
});

describe("a call the spend guard refuses", () => {
  it("rejects with the guard's error and sends, records, and retries nothing", async () => {
    const { inference, traces, usage, calls } = await setup(async () =>
      answer("not json"),
    );
    usage.refusing = true;
    const error = await inference
      .run("start", START, { model: GATEWAY, threadId: "t1" })
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );
    expect(error).toBeInstanceOf(SpendCapError);
    expect(calls).not.toHaveBeenCalled();
    expect(usage.rows).toEqual([]);
    expect(traces.list({})).toEqual([]);
  });

  it("keeps the first answer's row when the cap is reached before the repair", async () => {
    const { inference, usage, calls } = await setup(async () => {
      usage.refusing = true;
      return answer("not json");
    });
    await expect(
      inference.run("start", START, { model: GATEWAY }),
    ).rejects.toBeInstanceOf(SpendCapError);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(usage.rows).toMatchObject([{ status: "invalid", cost: 0.004 }]);
  });

  it("refuses a replay the same way", async () => {
    const { inference, traces, usage, calls } = await setup(async () =>
      answer(TITLE),
    );
    const { traceId } = await inference.run("start", START, { model: GATEWAY });
    usage.refusing = true;
    await expect(inference.replay(traceId!)).rejects.toBeInstanceOf(
      SpendCapError,
    );
    expect(calls).toHaveBeenCalledTimes(1);
    expect(usage.rows).toHaveLength(1);
    expect(traces.get(traceId!)?.replays).toEqual([]);
  });
});
