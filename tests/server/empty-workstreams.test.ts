import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_WORKSTREAM_GRACE_MS as grace } from "../../src/domain/empty-workstreams.ts";
import { getMeta, setMeta, openDatabase } from "../../src/server/db.ts";
import { WorkstreamService } from "../../src/server/service.ts";
import { Journal } from "../../src/server/journal.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { fakeWorld } from "./fake-bb.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | undefined;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const state = async (w: World) =>
  (await w.harness.behavior.callRpc("state", null)) as {
    lastPopulatedAt: Record<string, number>;
  };

it("does not retain an obsolete automatic section after its topic binding is removed", async () => {
  world = await fakeWorld();
  const db = openDatabase(world.bb),
    topics = new TopicStore(db);
  const topic = topics.create("Product");
  const section = world.addSection("Removed scope"),
    manual = world.addSection("User section");
  db.prepare(
    "INSERT INTO ws_workstream(section_id, created_by) VALUES (?, 'workstreams')",
  ).run(section.id);
  db.prepare(
    "INSERT INTO ws_workstream(section_id, created_by) VALUES (?, 'user')",
  ).run(manual.id);
  topics.bindGroup(section.id, topic.id);
  const archived = world.addThread("archive", {
    sectionId: section.id,
    archivedAt: Date.now(),
  });
  setMeta(
    db,
    "last-populated-workstreams",
    JSON.stringify({ [section.id]: Date.now(), [manual.id]: Date.now() }),
  );
  expect((await state(world)).lastPopulatedAt[section.id]).toBeDefined();
  topics.unbindGroup(section.id);
  expect((await state(world)).lastPopulatedAt[section.id]).toBeUndefined();
  expect((await state(world)).lastPopulatedAt[manual.id]).toBeDefined();
  await world.harness.behavior.callRpc("refresh", null);
  expect(
    JSON.parse(getMeta(db, "last-populated-workstreams")!)[section.id],
  ).toBeUndefined();
  expect(world.threads.get(archived.id)?.sectionId).toBe(section.id);
});

it("records visible population and expires archived empties without renewing them on reads", async () => {
  let now = 100 * grace;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  world = await fakeWorld();
  const section = world.addSection("Product");
  const root = world.addThread("root", {
    sectionId: section.id,
    latestAttentionAt: now - 20 * grace,
  });
  await world.harness.behavior.callRpc("refresh", null);
  expect((await state(world)).lastPopulatedAt[section.id]).toBe(now);
  root.archivedAt = now;
  now += grace - 1;
  await world.harness.behavior.callRpc("refresh", null);
  expect((await state(world)).lastPopulatedAt[section.id]).toBe(100 * grace);
  now += 1;
  await world.harness.behavior.callRpc("refresh", null);
  expect((await state(world)).lastPopulatedAt[section.id]).toBeUndefined();
  expect(world.threads.has("root")).toBe(true);
});

it("snoozing records a populated workstream once, and polling does not extend its grace", async () => {
  let now = 100 * grace;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  world = await fakeWorld();
  const section = world.addSection("Product");
  world.addThread("root", { sectionId: section.id });
  await world.harness.behavior.callRpc("snooze", {
    threadIds: ["root"],
    until: null,
  });
  expect((await state(world)).lastPopulatedAt[section.id]).toBe(now);
  now += grace;
  await world.harness.behavior.callRpc("refresh", null);
  expect((await state(world)).lastPopulatedAt[section.id]).toBeUndefined();
  await world.harness.behavior.callRpc("unsnooze", { threadIds: ["root"] });
  await world.harness.behavior.callRpc("refresh", null);
  expect((await state(world)).lastPopulatedAt[section.id]).toBe(now);
});

it("preserves recent population in storage across service instances, without reviving old sections", async () => {
  const now = 100 * grace;
  vi.spyOn(Date, "now").mockReturnValue(now);
  world = await fakeWorld();
  const fresh = world.addSection("Fresh");
  const old = world.addSection("Old");
  world.addThread("root", { sectionId: fresh.id });
  world.addThread("archived", {
    sectionId: old.id,
    archivedAt: now - 20 * grace,
  });
  await world.harness.behavior.callRpc("refresh", null);
  const db = openDatabase(world.bb);
  const service = new WorkstreamService(
    () => world!.bb.sdk,
    db,
    new Journal(db),
    () => {},
    () => now,
  );
  expect(service.lastPopulatedAt()).toEqual({ [fresh.id]: now });
});

it("cleans up a retained section after expiry without another lifecycle event or forced rebuild", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100 * grace);
  const starting = fakeWorld();
  await vi.advanceTimersByTimeAsync(10);
  world = await starting;
  const topics = new TopicStore(openDatabase(world.bb));
  const topic = topics.create("Product", "Product");
  const root = world.addThread("root");
  await world.harness.behavior.callRpc("taskAssign", {
    threadId: root.id,
    entityId: topic.id,
  });
  await world.harness.behavior.callRpc("organization", { action: "rebuild" });
  const section = world.sections.find((s) => s.name === "Product")!;
  const archived = world.threads.get(root.id)!;
  archived.archivedAt = Date.now();
  await world.harness.behavior.emitThreadEvent("thread.archived", {
    thread: archived,
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(world.sections.some((s) => s.id === section.id)).toBe(true);
  await vi.advanceTimersByTimeAsync(grace);
  expect(world.sections.some((s) => s.id === section.id)).toBe(false);
  expect(world.threads.has(root.id)).toBe(true);
});
