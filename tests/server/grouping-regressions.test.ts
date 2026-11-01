import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { openDatabase } from "../../src/server/db.ts";
let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
});
const rebuild = (w: NonNullable<typeof world>) =>
  w.harness.behavior.callRpc("organization", {
    action: "rebuild",
  }) as Promise<any>;
const DONE = JSON.stringify({
  revision: 10,
  state: "done",
  recap: "Done",
  goal: null,
  needsYou: null,
  at: 10,
  model: "test",
});
describe("grouping regressions", () => {
  it.each([1, 4])(
    "keeps topic workstreams stable with %i done roots as population changes",
    async (doneCount) => {
      world = await fakeWorld();
      const w = world;
      const db = openDatabase(w.bb);
      const topics = new TopicStore(db);
      const p = topics.create("Product", "Product");
      const a = topics.create("Planning", "Planning", p.id);
      const b = topics.create("Triggers", "Triggers", p.id);
      for (let i = 0; i < 6; i++) {
        w.addThread(`t${i}`, {
          status: "idle",
          latestAttentionAt: 10,
          archivedAt: i === 5 ? 20 : null,
        });
        topics.assign(`t${i}`, i % 2 === 0 ? a.id : b.id);
        if (i >= 6 - doneCount)
          db.prepare(
            "INSERT INTO ws_analysis(thread_id, revision, at, result) VALUES (?,10,10,?)",
          ).run(`t${i}`, DONE);
      }
      const atThreshold = (await rebuild(w)).state;
      expect(atThreshold.counts.totalRoots).toBe(5);
      expect(atThreshold.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Product: Planning", totalCount: 3 }),
          expect.objectContaining({ name: "Product: Triggers", totalCount: 2 }),
        ]),
      );

      // Completion and population leave topic section identities unchanged.
      w.threads.get("t5")!.archivedAt = null;
      const split = (await rebuild(w)).state;
      expect(split.groups.map((g: { name: string }) => g.name).sort()).toEqual([
        "Product: Planning",
        "Product: Triggers",
      ]);
      expect(split.counts).toMatchObject({
        totalRoots: 6,
        activeRoots: 6 - doneCount,
        completedRoots: doneCount,
      });

      // Small populations still keep the same two topic-backed sections.
      w.threads.get("t0")!.archivedAt = 20;
      w.threads.get("t1")!.archivedAt = 20;
      expect((await rebuild(w)).state.groups).toHaveLength(2);
      w.threads.get("t2")!.archivedAt = 20;
      const merged = (await rebuild(w)).state;
      expect(merged.counts.totalRoots).toBe(3);
      expect(merged.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Product: Planning", totalCount: 1 }),
          expect.objectContaining({ name: "Product: Triggers", totalCount: 2 }),
        ]),
      );
    },
  );
  it("replans when completion changes while projection is fetching a live root", async () => {
    world = await fakeWorld();
    const w = world;
    const db = openDatabase(w.bb);
    const topics = new TopicStore(db);
    const p = topics.create("Product", "Product");
    const a = topics.create("Planning", "Planning", p.id);
    const b = topics.create("Triggers", "Triggers", p.id);
    for (let i = 0; i < 6; i++) {
      w.addThread(`t${i}`, { status: "idle", latestAttentionAt: 10 });
      topics.assign(`t${i}`, i < 3 ? a.id : b.id);
    }
    let completed = false;
    w.harness.inspection.sdk.stub(
      "threads.get",
      async (args: { threadId: string }) => {
        if (!completed) {
          completed = true;
          for (let i = 0; i < 6; i++)
            db.prepare(
              "INSERT INTO ws_analysis(thread_id, revision, at, result) VALUES (?,10,10,?)",
            ).run(`t${i}`, DONE);
        }
        return w.threads.get(args.threadId)!;
      },
    );
    await rebuild(w);
    await vi.waitFor(async () => {
      const { state } = (await w.harness.behavior.callRpc(
        "organization",
        null,
      )) as any;
      expect(state.groups).toHaveLength(2);
      expect(state.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Product: Planning",
            completedCount: 3,
            activeCount: 0,
          }),
          expect.objectContaining({
            name: "Product: Triggers",
            completedCount: 3,
            activeCount: 0,
          }),
        ]),
      );
    });
    const writes = w.harness.inspection.sdk
      .callsTo("threads.update")
      .map((args) => (args[0] as { sectionId?: string }).sectionId);
    expect(writes).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const name = i < 3 ? "Product: Planning" : "Product: Triggers";
      expect(w.threads.get(`t${i}`)?.sectionId).toBe(
        w.sections.find((s) => s.name === name)!.id,
      );
    }
  });
  it("counts completed roots in each workstream of a split group", async () => {
    world = await fakeWorld();
    const w = world;
    const db = openDatabase(w.bb);
    const topics = new TopicStore(db);
    const p = topics.create("Product", "Product");
    const a = topics.create("Planning", "Planning", p.id);
    const f = topics.create("Feature", "Feature", p.id);
    topics.bindGroup(w.addSection("Product: Planning").id, a.id);
    topics.bindGroup(w.addSection("Product: Feature").id, f.id);
    for (let i = 0; i < 8; i++) {
      w.addThread(`t${i}`, { status: "idle", latestAttentionAt: 10 });
      topics.assign(`t${i}`, i === 0 ? a.id : f.id);
      if (i === 0 || i > 4)
        db.prepare(
          "INSERT INTO ws_analysis(thread_id, revision, at, result) VALUES (?,10,10,?)",
        ).run(`t${i}`, DONE);
    }
    const { state } = await rebuild(w);
    expect(state.groups).toHaveLength(2);
    expect(state.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Product: Planning",
          activeCount: 0,
          completedCount: 1,
          totalCount: 1,
        }),
        expect.objectContaining({
          name: "Product: Feature",
          activeCount: 4,
          completedCount: 3,
          totalCount: 7,
        }),
      ]),
    );
  });
  it("replans rather than applying a topic that changed while fetching a live root", async () => {
    world = await fakeWorld();
    const w = world;
    const topics = new TopicStore(openDatabase(w.bb));
    const a = topics.create("Alpha", "Product");
    const b = topics.create("Beta", "Product");
    w.addThread("t");
    topics.assign("t", a.id);
    let changed = false;
    w.harness.inspection.sdk.stub(
      "threads.get",
      async (args: { threadId: string }) => {
        if (args.threadId === "t" && !changed) {
          changed = true;
          topics.assign("t", b.id);
        }
        return w.threads.get(args.threadId)!;
      },
    );
    await rebuild(w);
    await vi.waitFor(() =>
      expect(
        w.sections.find((s) => s.id === w.threads.get("t")?.sectionId)?.name,
      ).toBe("Beta"),
    );
    const writes = w.harness.inspection.sdk
      .callsTo("threads.update")
      .map((args) => (args[0] as { sectionId?: string }).sectionId);
    expect(writes).toEqual([w.sections.find((s) => s.name === "Beta")!.id]);
  });
});
