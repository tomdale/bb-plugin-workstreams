/*
 * Categories when a spend cap refuses their model call: the call counts as
 * never asked, and the same work is due on the next look.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestPluginHost } from "./test-host.ts";
import { Categories } from "../../src/server/categories.ts";
import { getMeta, openDatabase } from "../../src/server/db.ts";
import { SpendCapError } from "../../src/server/spendGuard.ts";
import type {
  CategoryCollection,
  CategoryDecision,
  CategoryFit,
  CategoryFitInput,
  CategoryInput,
} from "../../src/domain/categories.ts";

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
const engines: Categories[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) engine.dispose();
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});

const refusal = () =>
  new SpendCapError("Workstreams is paused.", { level: "capped", limits: [] });

const collection = (n = 6): CategoryCollection => ({
  workstreamId: "workstream-a",
  label: "Vertex",
  threads: Array.from({ length: n }, (_, i) => ({
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
      threadIds: input.threads.slice(0, 3).map((thread) => thread.id),
    },
    {
      id: input.current?.categories[1]?.id ?? null,
      name: "Another area",
      threadIds: input.threads.slice(3).map((thread) => thread.id),
    },
  ],
});

function setup() {
  const host = createTestPluginHost({ pluginId: "categories-pause-test" });
  hosts.push(host);
  const db = openDatabase(host.bb);
  const state = { collections: [collection()], paused: false };
  const classify = vi.fn(async (input: CategoryInput) => {
    if (state.paused) throw refusal();
    return decision(input);
  });
  const fit = vi.fn(async (input: CategoryFitInput): Promise<CategoryFit> => {
    if (state.paused) throw refusal();
    return Object.fromEntries(input.changed.map((id) => [id, null]));
  });
  const changed = vi.fn();
  const log = vi.fn();
  const engine = new Categories({
    db,
    collections: () => state.collections,
    classify,
    fit,
    changed,
    log,
  });
  engines.push(engine);
  return { db, state, classify, fit, changed, log, engine };
}

describe("categories during a pause", () => {
  it("asks once per look, records no failure, and arranges when the pause lifts", async () => {
    const { db, state, classify, changed, log, engine } = setup();
    state.paused = true;
    await engine.reconcile();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(engine.generations()).toEqual({});
    expect(log).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    const record = JSON.parse(getMeta(db, "workstream_categories")!)[
      "workstream-a"
    ];
    expect(record).toMatchObject({ status: "pending", error: null });

    // Unchanged collections are still due: the refusal settled nothing.
    await engine.reconcile();
    expect(classify).toHaveBeenCalledTimes(2);

    state.paused = false;
    await engine.reconcile();
    expect(classify).toHaveBeenCalledTimes(3);
    expect(
      engine.generations()["workstream-a"]?.categories.map((c) => c.name),
    ).toEqual(["One area", "Another area"]);
    await engine.reconcile();
    expect(classify).toHaveBeenCalledTimes(3);
  });

  it("rearranges nothing when the fit check is refused", async () => {
    const { state, classify, fit, changed, log, engine } = setup();
    await engine.reconcile();
    const arranged = engine.generations()["workstream-a"];
    changed.mockClear();
    // A thread arrives, which is checked against the current categories.
    state.collections = [
      {
        ...collection(),
        threads: [
          ...collection().threads,
          { id: "t6", title: "Work 6", work: "Purpose", workKey: "request-1" },
        ],
      },
    ];
    state.paused = true;
    await engine.reconcile();
    expect(fit).toHaveBeenCalledTimes(1);
    // A failed check asks for a rearrangement; a refused one does not.
    expect(classify).toHaveBeenCalledTimes(1);
    expect(engine.generations()["workstream-a"]).toEqual(arranged);
    expect(changed).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();

    state.paused = false;
    fit.mockImplementationOnce(async () => ({
      t6: arranged!.categories[0]!.id,
    }));
    await engine.reconcile();
    expect(fit).toHaveBeenCalledTimes(2);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(
      engine.generations()["workstream-a"]?.categories[0]?.threadIds,
    ).toContain("t6");
  });
});
