import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "../../src/server/db.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
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
  const workstreamStore = new WorkstreamStore(openDatabase(world.bb));
  const workstream = workstreamStore.create("Product", "Product");
  const thread = world.addThread("thread");
  await world.harness.behavior.callRpc("threadMove", {
    threadId: thread.id,
    workstreamId: workstream.id,
  });
  await world.harness.behavior.callRpc("organizeStatus", { action: "rebuild" });
  const section = world.sections.find((s) => s.name === "Product")!;
  expect(section).toBeDefined();
  const archived = world.threads.get(thread.id)!;
  archived.archivedAt = Date.now();
  await world.harness.behavior.emitThreadEvent("thread.archived", {
    thread: archived,
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(world.sections.some((s) => s.id === section.id)).toBe(false);
  expect(world.threads.has(thread.id)).toBe(true);
});
