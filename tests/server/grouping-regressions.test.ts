import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { openDatabase } from "../../src/server/db.ts";
let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
});
const rebuild = (w: NonNullable<typeof world>) =>
  w.harness.behavior.callRpc("organizeStatus", {
    action: "rebuild",
  }) as Promise<any>;
const DONE = JSON.stringify({
  revision: 10,
  state: "complete",
  recap: "Done",
  title: null,
  ask: null,
  at: 10,
  model: "test",
});
describe("grouping regressions", () => {
  it.each([1, 4])(
    "keeps workstreams stable with %i done threads as population changes",
    async (doneCount) => {
      world = await fakeWorld();
      const w = world;
      const db = openDatabase(w.bb);
      const workstreamStore = new WorkstreamStore(db);
      const p = workstreamStore.create("Product", "Product");
      const a = workstreamStore.create("Planning", "Planning", p.id);
      const b = workstreamStore.create("Triggers", "Triggers", p.id);
      for (let i = 0; i < 6; i++) {
        w.addThread(`t${i}`, {
          status: "idle",
          latestAttentionAt: 10,
          archivedAt: i === 5 ? 20 : null,
        });
        workstreamStore.assign(`t${i}`, i % 2 === 0 ? a.id : b.id);
        if (i >= 6 - doneCount)
          db.prepare(
            "INSERT INTO ws_analysis(thread_id, revision, at, result) VALUES (?,10,10,?)",
          ).run(`t${i}`, DONE);
      }
      const atThreshold = (await rebuild(w)).state;
      expect(atThreshold.counts.totalThreads).toBe(5);
      expect(atThreshold.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Product › Planning",
            totalCount: 3,
          }),
          expect.objectContaining({
            name: "Product › Triggers",
            totalCount: 2,
          }),
        ]),
      );

      // Completion and population leave workstream section identities
      // unchanged.
      w.threads.get("t5")!.archivedAt = null;
      const split = (await rebuild(w)).state;
      expect(split.groups.map((g: { name: string }) => g.name).sort()).toEqual([
        "Product › Planning",
        "Product › Triggers",
      ]);
      expect(split.counts).toMatchObject({
        totalThreads: 6,
        activeThreads: 6 - doneCount,
        completedThreads: doneCount,
      });

      // Small populations still keep the same two workstream sections.
      w.threads.get("t0")!.archivedAt = 20;
      w.threads.get("t1")!.archivedAt = 20;
      expect((await rebuild(w)).state.groups).toHaveLength(2);
      w.threads.get("t2")!.archivedAt = 20;
      const merged = (await rebuild(w)).state;
      expect(merged.counts.totalThreads).toBe(3);
      expect(merged.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Product › Planning",
            totalCount: 1,
          }),
          expect.objectContaining({
            name: "Product › Triggers",
            totalCount: 2,
          }),
        ]),
      );
    },
  );
  it("replans when completion changes while projection is fetching a live thread", async () => {
    world = await fakeWorld();
    const w = world;
    const db = openDatabase(w.bb);
    const workstreamStore = new WorkstreamStore(db);
    const p = workstreamStore.create("Product", "Product");
    const a = workstreamStore.create("Planning", "Planning", p.id);
    const b = workstreamStore.create("Triggers", "Triggers", p.id);
    for (let i = 0; i < 6; i++) {
      w.addThread(`t${i}`, { status: "idle", latestAttentionAt: 10 });
      workstreamStore.assign(`t${i}`, i < 3 ? a.id : b.id);
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
        "organizeStatus",
        null,
      )) as any;
      expect(state.groups).toHaveLength(2);
      expect(state.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Product › Planning",
            completedCount: 3,
            activeCount: 0,
          }),
          expect.objectContaining({
            name: "Product › Triggers",
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
      const name = i < 3 ? "Product › Planning" : "Product › Triggers";
      expect(w.threads.get(`t${i}`)?.sectionId).toBe(
        w.sections.find((s) => s.name === name)!.id,
      );
    }
  });
  it("counts completed threads in each workstream of a split group", async () => {
    world = await fakeWorld();
    const w = world;
    const db = openDatabase(w.bb);
    const workstreamStore = new WorkstreamStore(db);
    const p = workstreamStore.create("Product", "Product");
    const a = workstreamStore.create("Planning", "Planning", p.id);
    const f = workstreamStore.create("Feature", "Feature", p.id);
    workstreamStore.bindSection(w.addSection("Product › Planning").id, a.id);
    workstreamStore.bindSection(w.addSection("Product › Feature").id, f.id);
    for (let i = 0; i < 8; i++) {
      w.addThread(`t${i}`, { status: "idle", latestAttentionAt: 10 });
      workstreamStore.assign(`t${i}`, i === 0 ? a.id : f.id);
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
          name: "Product › Planning",
          activeCount: 0,
          completedCount: 1,
          totalCount: 1,
        }),
        expect.objectContaining({
          name: "Product › Feature",
          activeCount: 4,
          completedCount: 3,
          totalCount: 7,
        }),
      ]),
    );
  });
  it("replans rather than applying a workstream that changed while fetching a live thread", async () => {
    world = await fakeWorld();
    const w = world;
    const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
    const a = workstreamStore.create("Alpha", "Product");
    const b = workstreamStore.create("Beta", "Product");
    w.addThread("t");
    workstreamStore.assign("t", a.id);
    let changed = false;
    w.harness.inspection.sdk.stub(
      "threads.get",
      async (args: { threadId: string }) => {
        if (args.threadId === "t" && !changed) {
          changed = true;
          workstreamStore.assign("t", b.id);
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
