import { afterEach, describe, expect, it, vi } from "vitest";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { fakeWorld } from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import type { Inference } from "../../src/server/model.ts";
import { Placement } from "../../src/server/placement.ts";
import { TopicStore } from "../../src/server/topics.ts";

let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await world?.harness.lifecycle.dispose();
  world = undefined;
});

async function setup() {
  world = await fakeWorld();
  const db = openDatabase(world.bb);
  const topics = new TopicStore(db);
  const topic = topics.create("Docs", "Documentation");
  const run = vi.fn();
  const apply = vi.fn((id, answer, basis) =>
    topics.applyAnalysis(id, answer, "full", basis),
  );
  const log = vi.fn();
  const placement = new Placement({
    sdk: () => world!.bb.sdk,
    db,
    inference: { run } as unknown as Inference,
    model: async () => ({ kind: "gateway", model: "test" }),
    topics,
    project: async () => "Project",
    basisOf: () => "first-request",
    apply,
    log,
  });
  const thread = world.addThread("new", { environmentId: null });
  vi.useFakeTimers();
  return { topic, topics, run, apply, log, placement, thread };
}

const answer = (subjectId: string) => ({
  value: { subjectId, proposed: null, scopeShift: false },
  traceId: "success-trace",
});

describe("first-request placement retries", () => {
  it("retries a failed host call from the first-message dispatch", async () => {
    let topicId = "";
    let attempts = 0;
    world = await fakeWorld({
      complete: ({ prompt }) => {
        if (prompt.includes("You file one agent thread under a topic")) {
          if (++attempts === 1) throw new TypeError("fetch failed");
          return JSON.stringify({ subjectId: topicId, proposed: null });
        }
        return JSON.stringify({ goal: "Write docs", subjectId: null });
      },
    });
    const topics = new TopicStore(openDatabase(world.bb));
    topicId = topics.create("Docs", "Documentation").id;
    const thread = world.addThread("new", {
      status: "starting",
      createdAt: Date.now(),
      environmentId: null,
    });
    vi.useFakeTimers();
    const hook = world.harness.registrations.hooks["message.dispatch"]!;
    await hook(
      makeMessageDispatchHookContext({
        thread,
        input: { text: "Write the docs" },
        origin: "cli",
        parentThreadId: null,
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(2);
    expect(topics.assignment(thread.id)).toMatchObject({
      entityId: topicId,
      provenance: "full",
    });
  });

  it("cancels first-request retries when a newer request arrives", async () => {
    let attempts = 0;
    world = await fakeWorld({
      complete: ({ prompt }) => {
        if (prompt.includes("You file one agent thread under a topic")) {
          attempts++;
          throw new TypeError("fetch failed");
        }
        return JSON.stringify({ goal: "Write docs", subjectId: null });
      },
    });
    const topics = new TopicStore(openDatabase(world.bb));
    topics.create("Docs", "Documentation");
    const thread = world.addThread("new", {
      status: "starting",
      createdAt: Date.now(),
      environmentId: null,
    });
    vi.useFakeTimers();
    const hook = world.harness.registrations.hooks["message.dispatch"]!;
    await hook(
      makeMessageDispatchHookContext({
        thread,
        input: { text: "Write the docs" },
        origin: "cli",
        parentThreadId: null,
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(1);
    await hook(
      makeMessageDispatchHookContext({
        thread,
        input: { text: "Instead, fix the parser" },
        origin: null,
        parentThreadId: null,
      }),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(attempts).toBe(1);
    expect(topics.assignment(thread.id).provenance).toBeNull();
  });

  it("retries a fetch failure and files the successful answer", async () => {
    const { topic, topics, run, apply, log, placement, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    run.mockResolvedValueOnce(answer(topic.id));
    const pending = placement.onFirstRequest(thread, "Write the docs");
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(topics.assignment(thread.id).provenance).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(
      thread.id,
      answer(topic.id).value,
      "first-request",
      "success-trace",
    );
    expect(topics.assignment(thread.id)).toMatchObject({
      entityId: topic.id,
      provenance: "full",
    });
  });

  it("stops after three failed attempts without changing the topic", async () => {
    const { topics, run, apply, log, placement, thread } = await setup();
    run.mockRejectedValue(new TypeError("fetch failed"));
    const pending = placement.onFirstRequest(thread, "Write the docs");
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(3);
    expect(apply).not.toHaveBeenCalled();
    expect(topics.assignment(thread.id).provenance).toBeNull();
  });

  it("does not retry or overwrite a manual correction made during the delay", async () => {
    const { topic, topics, run, apply, placement, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    const pending = placement.onFirstRequest(thread, "Write the docs");
    await vi.advanceTimersByTimeAsync(0);
    topics.assign(thread.id, topic.id, { provenance: "manual" });
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(topics.assignment(thread.id).provenance).toBe("manual");
  });

  it("stops retrying when another analysis settles the thread", async () => {
    const { topic, topics, run, apply, placement, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    const pending = placement.onFirstRequest(thread, "Write the docs");
    await vi.advanceTimersByTimeAsync(0);
    topics.applyAnalysis(thread.id, answer(topic.id).value, "full", "later");
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(topics.basis(thread.id)).toBe("later");
  });

  it("does not apply an in-flight answer after a manual correction", async () => {
    const { topic, topics, run, apply, placement, thread } = await setup();
    let resolve!: (value: ReturnType<typeof answer>) => void;
    run.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    const pending = placement.onFirstRequest(thread, "Write the docs");
    await vi.advanceTimersByTimeAsync(0);
    topics.assign(thread.id, topic.id, { provenance: "manual" });
    resolve(answer(topic.id));
    await pending;
    expect(apply).not.toHaveBeenCalled();
    expect(topics.assignment(thread.id).provenance).toBe("manual");
  });

  it("rebuilds the placement question against the current topic tree", async () => {
    const { topics, run, placement, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    const pending = placement.onFirstRequest(thread, "Write the docs");
    await vi.advanceTimersByTimeAsync(0);
    const newTopic = topics.create("More Docs", "More documentation");
    run.mockResolvedValueOnce(answer(newTopic.id));
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run.mock.calls[1]![1].entities).toContainEqual(
      expect.objectContaining({ id: newTopic.id }),
    );
    expect(topics.assignment(thread.id).entityId).toBe(newTopic.id);
  });

  it("aborts an in-flight model call on disposal", async () => {
    const { run, apply, placement, thread } = await setup();
    let signal: AbortSignal | undefined;
    run.mockImplementationOnce((_kind, _input, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason));
      });
    });
    const pending = placement.onFirstRequest(thread, "Write the docs");
    await vi.advanceTimersByTimeAsync(0);
    placement.dispose();
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not start a late dispatch after disposal", async () => {
    const { run, placement, thread } = await setup();
    placement.dispose();
    await placement.onFirstRequest(thread, "Write the docs");
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["forget", "dispose"] as const)(
    "%s cancels a pending retry",
    async (action) => {
      const { run, apply, placement, thread } = await setup();
      run.mockRejectedValueOnce(new TypeError("fetch failed"));
      const pending = placement.onFirstRequest(thread, "Write the docs");
      await vi.advanceTimersByTimeAsync(0);
      if (action === "forget") placement.forget(thread.id);
      else placement.dispose();
      await vi.advanceTimersByTimeAsync(3_000);
      await pending;
      expect(run).toHaveBeenCalledTimes(1);
      expect(apply).not.toHaveBeenCalled();
    },
  );
});
