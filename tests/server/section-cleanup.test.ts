import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "../../src/server/db.ts";
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

it("deletes an emptied workstream's section on the next pass and keeps its archived thread", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
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
  expect(section).toBeDefined();
  const archived = world.threads.get(root.id)!;
  archived.archivedAt = Date.now();
  await world.harness.behavior.emitThreadEvent("thread.archived", {
    thread: archived,
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(world.sections.some((s) => s.id === section.id)).toBe(false);
  expect(world.threads.has(root.id)).toBe(true);
});
