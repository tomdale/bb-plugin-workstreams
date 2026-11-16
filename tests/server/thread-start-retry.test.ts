import { afterEach, describe, expect, it, vi } from "vitest";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { fakeWorld } from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import type { Inference } from "../../src/server/model.ts";
import { WorkstreamChoice } from "../../src/server/placement.ts";
import { ThreadStart } from "../../src/server/start.ts";
import { WorkstreamStore } from "../../src/server/topics.ts";

let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await world?.harness.lifecycle.dispose();
  world = undefined;
});

async function setup() {
  world = await fakeWorld();
  const db = openDatabase(world.bb);
  const workstreamStore = new WorkstreamStore(db);
  const workstream = workstreamStore.create("Docs", "Documentation");
  const run = vi.fn();
  const apply = vi.fn((id, answer, basis) =>
    workstreamStore.applyAnalysis(id, answer, "automatic", basis),
  );
  const log = vi.fn();
  const workstreamChoice = new WorkstreamChoice({
    sdk: () => world!.bb.sdk,
    db,
    inference: { run } as unknown as Inference,
    model: async () => ({ kind: "gateway", model: "test" }),
    workstreamStore,
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
    listing: () => ({ workstream: null, parent: null }),
    question: (thread, request) => workstreamChoice.question(thread, [request]),
    unsettled: (threadId) =>
      workstreamStore.assignment(threadId).provenance !== "manual" &&
      !workstreamStore.basis(threadId),
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
  return { workstream, workstreamStore, run, apply, log, starts, first, thread };
}

const answer = (workstreamId: string) => ({
  value: {
    title: null,
    workstream: { workstreamId, proposed: null, scopeShift: false },
  },
  traceId: "success-trace",
});

describe("first-request start retries", () => {
  it("retries a failed host call from the first-message dispatch", async () => {
    let workstreamId = "";
    let attempts = 0;
    world = await fakeWorld({
      complete: ({ prompt }) => {
        if (prompt.includes("You choose the workstream for one agent thread")) {
          if (++attempts === 1) throw new TypeError("fetch failed");
          return JSON.stringify({ workstreamId: workstreamId, proposed: null });
        }
        return JSON.stringify({ title: "Write docs", workstreamId: null });
      },
    });
    const workstreamStore = new WorkstreamStore(openDatabase(world.bb));
    workstreamId = workstreamStore.create("Docs", "Documentation").id;
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
    expect(workstreamStore.assignment(thread.id)).toMatchObject({
      workstreamId: workstreamId,
      provenance: "automatic",
    });
  });

  it("never places a hidden worker thread", async () => {
    let placements = 0;
    world = await fakeWorld({
      complete: ({ prompt }) => {
        if (prompt.includes("You choose the workstream for one agent thread"))
          placements++;
        return JSON.stringify({ title: null, workstreamId: null });
      },
    });
    const workstreamStore = new WorkstreamStore(openDatabase(world.bb));
    workstreamStore.create("Docs", "Documentation");
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
    expect(workstreamStore.assignment(thread.id).provenance).toBeNull();
  });

  it("cancels first-request retries when a newer request arrives", async () => {
    let attempts = 0;
    world = await fakeWorld({
      complete: ({ prompt }) => {
        if (prompt.includes("You choose the workstream for one agent thread")) {
          attempts++;
          throw new TypeError("fetch failed");
        }
        return JSON.stringify({ title: "Write docs", workstreamId: null });
      },
    });
    const workstreamStore = new WorkstreamStore(openDatabase(world.bb));
    workstreamStore.create("Docs", "Documentation");
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
    expect(workstreamStore.assignment(thread.id).provenance).toBeNull();
  });

  it("retries a fetch failure and files the successful answer", async () => {
    const { workstream, workstreamStore, run, apply, log, first, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    run.mockResolvedValueOnce(answer(workstream.id));
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(workstreamStore.assignment(thread.id).provenance).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(
      thread.id,
      answer(workstream.id).value.workstream,
      "first-request",
      "success-trace",
    );
    expect(workstreamStore.assignment(thread.id)).toMatchObject({
      workstreamId: workstream.id,
      provenance: "automatic",
    });
  });

  it("stops after three failed attempts without changing the topic", async () => {
    const { workstreamStore, run, apply, log, first, thread } = await setup();
    run.mockRejectedValue(new TypeError("fetch failed"));
    const pending = first();
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(3);
    expect(apply).not.toHaveBeenCalled();
    expect(workstreamStore.assignment(thread.id).provenance).toBeNull();
  });

  it("does not retry or overwrite a manual correction made during the delay", async () => {
    const { workstream, workstreamStore, run, apply, first, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    workstreamStore.assign(thread.id, workstream.id, { provenance: "manual" });
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(workstreamStore.assignment(thread.id).provenance).toBe("manual");
  });

  it("stops retrying when another analysis settles the thread", async () => {
    const { workstream, workstreamStore, run, apply, first, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    workstreamStore.applyAnalysis(
      thread.id,
      answer(workstream.id).value.workstream,
      "automatic",
      "later",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(workstreamStore.basis(thread.id)).toBe("later");
  });

  it("does not apply an in-flight answer after a manual correction", async () => {
    const { workstream, workstreamStore, run, apply, first, thread } = await setup();
    let resolve!: (value: ReturnType<typeof answer>) => void;
    run.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    workstreamStore.assign(thread.id, workstream.id, { provenance: "manual" });
    resolve(answer(workstream.id));
    await pending;
    expect(apply).not.toHaveBeenCalled();
    expect(workstreamStore.assignment(thread.id).provenance).toBe("manual");
  });

  it("rebuilds the placement question against the current topic tree", async () => {
    const { workstreamStore, run, first, thread } = await setup();
    run.mockRejectedValueOnce(new TypeError("fetch failed"));
    const pending = first();
    await vi.advanceTimersByTimeAsync(0);
    const newWorkstream = workstreamStore.create("More Docs", "More documentation");
    run.mockResolvedValueOnce(answer(newWorkstream.id));
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(run.mock.calls[1]![1].choice.workstreams).toContainEqual(
      expect.objectContaining({ id: newWorkstream.id }),
    );
    expect(workstreamStore.assignment(thread.id).workstreamId).toBe(newWorkstream.id);
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
