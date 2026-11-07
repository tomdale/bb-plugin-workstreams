import { createTestPluginHost } from "./test-host.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Categories } from "../../src/server/categories.ts";
import { openDatabase } from "../../src/server/db.ts";
import type {
  CategoryCollection,
  CategoryDecision,
  CategoryInput,
} from "../../src/domain/categories.ts";

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
const engines: Categories[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) engine.dispose();
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
const collection = (n = 6): CategoryCollection => ({
  topicId: "topic-a",
  label: "Vertex",
  roots: Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Work ${i}`,
    work: "Purpose",
    workKey: "request-1",
  })),
});
const decision = (input: CategoryInput): CategoryDecision => ({
  keep: false,
  reason: "Separates the two areas of current work.",
  categories: [
    {
      id: input.current?.categories[0]?.id ?? null,
      name: "One area",
      threadIds: input.roots.slice(0, 3).map((root) => root.id),
    },
    {
      id: input.current?.categories[1]?.id ?? null,
      name: "Another area",
      threadIds: input.roots.slice(3).map((root) => root.id),
    },
  ],
});
function setup() {
  const host = createTestPluginHost({ pluginId: "categories-test" });
  hosts.push(host);
  const db = openDatabase(host.bb);
  const state = { collections: [collection()] };
  const classify = vi.fn(async (input: CategoryInput) => decision(input));
  const changed = vi.fn();
  const log = vi.fn();
  const create = () => {
    const engine = new Categories({
      db,
      collections: () => state.collections,
      classify,
      changed,
      log,
    });
    engines.push(engine);
    return engine;
  };
  return { state, classify, changed, log, create, engine: create() };
}

describe("persisted collection categories", () => {
  it("categorizes a one-level collection at six roots and does not call again for unchanged facts", async () => {
    const { engine, classify } = setup();
    await engine.reconcile();
    await engine.reconcile();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(engine.generations()["topic-a"]?.categories).toHaveLength(2);
  });
  it("restores IDs and memberships after restart without another call", async () => {
    const { engine, classify, create } = setup();
    await engine.reconcile();
    const before = engine.generations();
    engine.dispose();
    const restarted = create();
    await restarted.reconcile();
    expect(restarted.generations()).toEqual(before);
    expect(classify).toHaveBeenCalledTimes(1);
  });
  it("resumes an interrupted classification after restart without replacing its result with a late response", async () => {
    const { engine, classify, create } = setup();
    let resolve!: (value: CategoryDecision) => void;
    classify.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const interrupted = engine.reconcile();
    engine.dispose();
    const restarted = create();
    await restarted.reconcile();
    const restored = restarted.generations();
    resolve(decision({ ...collection(), current: null }));
    await interrupted;
    expect(restarted.generations()).toEqual(restored);
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it("reconsiders the whole collection on arrival, departure, and changed work without a cooldown", async () => {
    const { engine, state, classify } = setup();
    await engine.reconcile();
    state.collections = [collection(7)];
    await engine.reconcile();
    expect(classify.mock.calls.at(-1)?.[0].roots).toHaveLength(7);
    state.collections = [collection(5)];
    await engine.reconcile();
    expect(classify.mock.calls.at(-1)?.[0].roots).toHaveLength(5);
    state.collections[0]!.roots[0]!.workKey = "new substantive request";
    await engine.reconcile();
    expect(classify).toHaveBeenCalledTimes(4);
    expect(classify.mock.calls.at(-1)?.[0].roots).toHaveLength(5);
  });
  it("assesses a dispatched substantive request without waiting for analysis and deduplicates drains", async () => {
    const { engine, classify, create } = setup();
    await engine.reconcile();
    await engine.requestChanged(
      "t0",
      "Investigate access control instead of billing",
    );
    expect(classify).toHaveBeenCalledTimes(2);
    expect(engine.pendingRequest("t0", "request-1")).toBe(
      "Investigate access control instead of billing",
    );
    await engine.requestChanged(
      "t0",
      "Investigate access control instead of billing",
    );
    await engine.requestChanged("t0", "continue");
    await engine.requestChanged("delegate", "Change the delegated task");
    expect(classify).toHaveBeenCalledTimes(2);
    engine.dispose();
    await create().reconcile();
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it("rechecks updated analyzed work after a dispatched request and releases its temporary text", async () => {
    const { engine, classify, state } = setup();
    await engine.reconcile();
    await engine.requestChanged("t0", "Investigate permissions");
    state.collections[0]!.roots[0]!.workKey = "analyzed-request-2";
    await engine.reconcile();
    expect(classify).toHaveBeenCalledTimes(3);
    expect(engine.pendingRequest("t0", "request-1")).toBeUndefined();
  });

  it("does not recategorize for title-only updates", async () => {
    const { engine, state, classify } = setup();
    await engine.reconcile();
    state.collections[0]!.roots[0]!.title = "New generated title";
    await engine.reconcile();
    expect(classify).toHaveBeenCalledTimes(1);
  });
  it("discards at three and creates fresh category and generation IDs on recrossing six", async () => {
    const { engine, state, classify } = setup();
    await engine.reconcile();
    const before = engine.generations()["topic-a"]!;
    state.collections = [collection(3)];
    await engine.reconcile();
    expect(engine.generations()).toEqual({});
    expect(classify).toHaveBeenCalledTimes(1);
    state.collections = [collection(5)];
    await engine.reconcile();
    expect(classify).toHaveBeenCalledTimes(1);
    state.collections = [collection(6)];
    await engine.reconcile();
    const after = engine.generations()["topic-a"]!;
    expect(after.id).not.toBe(before.id);
    expect(after.categories.map((category) => category.id)).not.toEqual(
      before.categories.map((category) => category.id),
    );
    expect(classify.mock.calls.at(-1)?.[0].current).toBeNull();
  });
  it("keeps valid state on failure and does not retry on unrelated events or restart", async () => {
    const { engine, state, classify, create, log } = setup();
    await engine.reconcile();
    const before = engine.generations();
    classify.mockRejectedValue(new Error("Invalid classifier response"));
    state.collections = [collection(7)];
    await engine.reconcile();
    expect(engine.generations()).toEqual(before);
    await engine.reconcile();
    engine.dispose();
    await create().reconcile();
    expect(classify).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledOnce();
  });
  it("retries a failed collection on an explicit rebuild but leaves successful collections alone", async () => {
    const { engine, state, classify } = setup();
    await engine.reconcile();
    await engine.reconcile(true);
    expect(classify).toHaveBeenCalledTimes(1);
    state.collections = [collection(7)];
    classify.mockRejectedValueOnce(new Error("Temporary failure"));
    await engine.reconcile();
    await engine.reconcile(true);
    expect(classify).toHaveBeenCalledTimes(3);
  });

  it("can create categories after a failed attempt drops below creation and crosses it again", async () => {
    const { engine, state, classify } = setup();
    classify.mockRejectedValueOnce(new Error("Temporary failure"));
    await engine.reconcile();
    state.collections = [collection(5)];
    await engine.reconcile();
    state.collections = [collection(6)];
    await engine.reconcile();
    expect(classify).toHaveBeenCalledTimes(2);
    expect(engine.generations()["topic-a"]?.categories).toHaveLength(2);
  });

  it("removes departed memberships and collapses immediately during a classifier call", async () => {
    const { engine, state, classify } = setup();
    await engine.reconcile();
    let resolve!: (value: CategoryDecision) => void;
    classify.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    state.collections = [collection(7)];
    const run = engine.reconcile();
    state.collections = [collection(3)];
    const collapsed = engine.reconcile();
    expect(engine.generations()).toEqual({});
    resolve(decision({ ...collection(7), current: null }));
    await Promise.all([run, collapsed]);
    expect(engine.generations()).toEqual({});
  });
  it("rejects a pre-collapse response even if the identical roots return before it resolves", async () => {
    const { engine, state, classify } = setup();
    let resolve!: (value: CategoryDecision) => void;
    classify.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const run = engine.reconcile();
    state.collections = [collection(3)];
    void engine.reconcile();
    state.collections = [collection(6)];
    void engine.reconcile();
    resolve({
      ...decision({ ...collection(), current: null }),
      reason: "Superseded",
      categories: [
        { id: null, name: "Stale", threadIds: ["t0", "t1", "t2"] },
        { id: null, name: "Old", threadIds: ["t3", "t4", "t5"] },
      ],
    });
    await run;
    expect(classify).toHaveBeenCalledTimes(2);
    expect(engine.generations()["topic-a"]!.categories[0]!.name).toBe(
      "One area",
    );
  });
  it("rejects an old snapshot when a member leaves and rejoins before inference settles", async () => {
    const { engine, state, classify } = setup();
    classify.mockResolvedValueOnce({
      keep: false,
      reason: "Two distinct areas.",
      categories: [
        { id: null, name: "Focused", threadIds: ["t0"] },
        {
          id: null,
          name: "Storage",
          threadIds: ["t1", "t2", "t3", "t4", "t5"],
        },
      ],
    });
    await engine.reconcile();
    const removedCategoryId =
      engine.generations()["topic-a"]!.categories[0]!.id;
    let resolve!: (value: CategoryDecision) => void;
    classify.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    state.collections[0]!.roots[1]!.workKey = "request-2";
    const latest = structuredClone(state.collections);
    const run = engine.reconcile();
    state.collections[0]!.roots = state.collections[0]!.roots.filter(
      (root) => root.id !== "t0",
    );
    void engine.reconcile();
    state.collections = latest;
    void engine.reconcile();
    resolve({ keep: true, reason: "Keep the old snapshot", categories: [] });
    await run;
    expect(classify).toHaveBeenCalledTimes(3);
    expect(
      engine
        .generations()
        ["topic-a"]!.categories.map((category) => category.id),
    ).not.toContain(removedCategoryId);
  });

  it("drops categories when the topic becomes a container or disappears", async () => {
    const { engine, state, classify } = setup();
    await engine.reconcile();
    state.collections = [];
    await engine.reconcile();
    expect(engine.generations()).toEqual({});
    expect(classify).toHaveBeenCalledTimes(1);
  });
  it("keeps the previous generation when recording its change fails", async () => {
    const { engine, state, changed, log } = setup();
    await engine.reconcile();
    const before = engine.generations();
    state.collections = [collection(7)];
    changed.mockImplementationOnce(() => {
      throw new Error("Journal write failed");
    });
    await engine.reconcile();
    expect(engine.generations()).toEqual(before);
    expect(log).toHaveBeenCalledOnce();
  });

  it("supports a keep decision without rewriting category IDs", async () => {
    const { engine, state, classify } = setup();
    await engine.reconcile();
    state.collections[0]!.roots[0]!.workKey = "request-2";
    const before = engine.generations();
    classify.mockResolvedValueOnce({
      keep: true,
      reason: "The current arrangement remains useful.",
      categories: [],
    });
    await engine.reconcile();
    expect(engine.generations()).toEqual(before);
  });
});
