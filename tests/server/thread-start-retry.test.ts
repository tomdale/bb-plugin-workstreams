import { afterEach, describe, expect, it, vi } from "vitest";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { fakeWorld } from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import type { Inference } from "../../src/server/model.ts";
import { Placement } from "../../src/server/placement.ts";
import { ThreadStart } from "../../src/server/start.ts";
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
    log,
  });
  const starts = new ThreadStart({
    sdk: () => world!.bb.sdk,
    inference: { run, annotate: vi.fn() } as unknown as Inference,
    model: async () => ({ kind: "gateway", model: "test" }),
    // Only the topic is asked, so these tests follow filing alone.
    titles: () => false,
    analyzed: () => false,
    title: async () => {},
    listing: () => ({ group: null, parent: null }),
    question: (thread, request) => placement.question(thread, [request]),
    unsettled: (threadId) =>
      topics.assignment(threadId).provenance !== "manual" &&
      !topics.basis(threadId),
    file: apply,
    log,
  });
  const thread = world.addThread("new", { environmentId: null });
  const first = () =>
    starts.onFirstRequest({
      thread,
      attempt: "start-turn",
      origin: "cli",
      input: { text: "Write the docs" },
    });
  vi.useFakeTimers();
  return { topic, topics, run, apply, log, starts, first, thread };
}

const answer = (subjectId: string) => ({
  value: {
    title: null,
    topic: { subjectId, proposed: null, scopeShift: false },
  },
  traceId: "success-trace",
});

describe("first-request start retries", () => {
  it("retries a failed host call from the first-message dispatch", async () => {
    let topicId = "";
    let attempts = 0;
    world = await fakeWorld({
      complete: ({ prompt }) => {
        if (prompt.includes("You file one agent thread under a topic")) {
          if (++attempts === 1) throw new TypeError("fetch failed");
          return JSON.stringify({ subjectId: topicId, proposed: null });
        }
        return JSON.stringify({ title: "Write docs", subjectId: null });
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

  it("never places a hidden worker thread", async () => {
    let placements = 0;
    world = await fakeWorld({
      complete: ({ prompt }) => {
        if (prompt.includes("You file one agent thread under a topic"))
          placements++;
        return JSON.stringify({ title: null, subjectId: null });
      },
    });
    const topics = new TopicStore(openDatabase(world.bb));
    topics.create("Docs", "Documentation");
    const thread = world.addThread("worker", {
      status: "starting",
      createdAt: Date.now(),
      environmentId: null,
      visibility: "hidden",
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
    await vi.advanceTimersByTimeAsync(3_000);
    expect(placements).toBe(0);
    expect(topics.assignment(thread.id).provenance).toBeNull();
  });

  it("cancels first-request retries when a newer request arrives", async () => {
    let attempts = 0;
    world = await fakeWorld({
      complete: ({ prompt }) => {
        if (prompt.includes("You file one agent thread under a topic")) {
          attempts++;
          throw new TypeError("fetch failed");
        }
        return JSON.stringify({ title: "Write docs", subjectId: null });
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
    const { topic, topics, run, apply, log, first, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    run.mockResolvedValueOnce(answer(topic.id));
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(topics.assignment(thread.id).provenance).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(
      thread.id,
      answer(topic.id).value.topic,
      "first-request",
      "success-trace",
    );
    expect(topics.assignment(thread.id)).toMatchObject({
      entityId: topic.id,
      provenance: "full",
    });
  });

  it("stops after three failed attempts without changing the topic", async () => {
    const { topics, run, apply, log, first, thread } = await setup();
    run.mockRejectedValue(new TypeError("fetch failed"));
    const pending = first();
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(3);
    expect(apply).not.toHaveBeenCalled();
    expect(topics.assignment(thread.id).provenance).toBeNull();
  });

  it("does not retry or overwrite a manual correction made during the delay", async () => {
    const { topic, topics, run, apply, first, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    topics.assign(thread.id, topic.id, { provenance: "manual" });
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(topics.assignment(thread.id).provenance).toBe("manual");
  });

  it("stops retrying when another analysis settles the thread", async () => {
    const { topic, topics, run, apply, first, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    topics.applyAnalysis(
      thread.id,
      answer(topic.id).value.topic,
      "full",
      "later",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(topics.basis(thread.id)).toBe("later");
  });

  it("does not apply an in-flight answer after a manual correction", async () => {
    const { topic, topics, run, apply, first, thread } = await setup();
    let resolve!: (value: ReturnType<typeof answer>) => void;
    run.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    topics.assign(thread.id, topic.id, { provenance: "manual" });
    resolve(answer(topic.id));
    await pending;
    expect(apply).not.toHaveBeenCalled();
    expect(topics.assignment(thread.id).provenance).toBe("manual");
  });

  it("rebuilds the placement question against the current topic tree", async () => {
    const { topics, run, first, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    const newTopic = topics.create("More Docs", "More documentation");
    run.mockResolvedValueOnce(answer(newTopic.id));
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run.mock.calls[1]![1].placement.entities).toContainEqual(
      expect.objectContaining({ id: newTopic.id }),
    );
    expect(topics.assignment(thread.id).entityId).toBe(newTopic.id);
  });

  it("aborts an in-flight model call on disposal", async () => {
    const { run, apply, starts, first } = await setup();
    let signal: AbortSignal | undefined;
    run.mockImplementationOnce((_kind, _input, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason));
      });
    });
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    starts.dispose();
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not start a late dispatch after disposal", async () => {
    const { run, starts, first } = await setup();
    starts.dispose();
    await first();
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["forget", "dispose"] as const)(
    "%s cancels a pending retry",
    async (action) => {
      const { run, apply, starts, first } = await setup();
      run.mockRejectedValueOnce(new TypeError("fetch failed"));
      const pending = first();
      await vi.advanceTimersByTimeAsync(0);
      if (action === "forget") starts.forget("new");
      else starts.dispose();
      await vi.advanceTimersByTimeAsync(3_000);
      await pending;
      expect(run).toHaveBeenCalledTimes(1);
      expect(apply).not.toHaveBeenCalled();
    },
  );
});
