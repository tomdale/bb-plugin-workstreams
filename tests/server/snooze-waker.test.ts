import { afterEach, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { WorkState } from "../../src/domain/analysis.ts";
import {
  DEFAULT_SNOOZE_PREFS,
  type ThreadSnooze,
} from "../../src/domain/snooze.ts";
import { STALL_GRACE_MS, type WakeEvent } from "../../src/domain/wake.ts";
import { openDatabase, type Database } from "../../src/server/db.ts";
import type { InventoryThread } from "../../src/server/inventory.ts";
import { ThreadSnoozes } from "../../src/server/snooze.ts";
import {
  PR_POLL_MS,
  SnoozeWaker,
  type SetSnooze,
} from "../../src/server/snoozeWake.ts";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(() => {
  hosts.splice(0);
});

const thread = (
  id: string,
  overrides: Partial<InventoryThread> = {},
): InventoryThread => ({
  id,
  title: id,
  ownTitle: id,
  projectId: "p",
  status: "idle",
  isUnread: false,
  sourceThreadId: null,
  parentThreadId: null,
  sectionId: null,
  isHidden: false,
  isArchived: false,
  isPinned: false,
  hasPendingInteraction: false,
  latestAttentionAt: 0,
  createdAt: 0,
  environmentId: null,
  runtimeStatus: "idle",
  queuedWork: "none",
  busy: false,
  ...overrides,
});

/** A waker over a world the test steps through: inventory reads, clock, analysis. */
function setup(db?: Database) {
  const host = createFakePluginHost({ pluginId: `waker-${hosts.length}` });
  hosts.push(host);
  const world = {
    db: db ?? openDatabase(host.bb),
    now: 1_000,
    inventoryAt: null as number | null,
    threads: [] as InventoryThread[],
    work: new Map<string, WorkState>(),
    pr: new Map<string, string | null>(),
    prLookups: 0,
    woken: [] as { set: SetSnooze[]; event: WakeEvent }[],
  };
  const snoozes = new ThreadSnoozes(world.db);
  const make = () =>
    new SnoozeWaker({
      db: world.db,
      snoozes,
      prefs: () => DEFAULT_SNOOZE_PREFS,
      threads: () => world.threads,
      inventoryAt: () => world.inventoryAt,
      workOf: () => (t) => world.work.get(t.id) ?? null,
      pullRequest: async (env) => {
        world.prLookups++;
        return world.pr.get(env) ?? null;
      },
      wake: async (set, event) => {
        world.woken.push({ set, event });
        snoozes.clearSet(set);
      },
      now: () => world.now,
    });
  /** BB's inventory is read now, with these threads. */
  const read = (threads: InventoryThread[]) => {
    world.threads = threads;
    world.inventoryAt = world.now;
  };
  const snooze = (id: string, extra: Partial<ThreadSnooze> = {}) =>
    snoozes.set({
      [id]: { until: null, attentionAt: 0, at: world.now, ...extra },
    });
  return { world, snoozes, make, read, snooze };
}

it("does nothing before BB's inventory is read, then counts what it first shows as old", async () => {
  const { world, make, read, snooze } = setup();
  const waker = make();
  snooze("t1");
  await waker.check();
  expect(world.woken).toEqual([]);
  world.now = 2_000;
  read([thread("t1", { queuedWork: "failed" })]);
  await waker.check();
  expect(world.woken).toEqual([]);
});

it("dates a lasting condition by the read before it showed, so a stale inventory can't make an old failure new", async () => {
  const { world, make, read, snooze } = setup();
  const waker = make();
  world.now = 100;
  read([thread("t1")]);
  await waker.check();
  // The send failed at 120; the user saw it and snoozed at 150.
  world.now = 150;
  snooze("t1");
  world.now = 200;
  read([thread("t1", { queuedWork: "failed" })]);
  await waker.check();
  expect(world.woken).toEqual([]);

  // It clears, then fails again after the snooze.
  world.now = 300;
  read([thread("t1")]);
  await waker.check();
  world.now = 400;
  read([thread("t1", { queuedWork: "failed" })]);
  await waker.check();
  expect(world.woken).toEqual([
    { set: [{ id: "t1", at: 150 }], event: "send-failed" },
  ]);
});

it("keeps condition dates across a restart", async () => {
  const first = setup();
  const waker = first.make();
  first.world.now = 100;
  first.read([thread("t1")]);
  await waker.check();
  first.world.now = 150;
  first.snooze("t1");
  first.world.now = 200;
  first.read([thread("t1", { runtimeStatus: "waiting-for-host" })]);
  await waker.check();
  // The server restarts; the wait it already dated stays old.
  const restarted = first.make();
  first.world.now = 200 + STALL_GRACE_MS;
  first.read([thread("t1", { runtimeStatus: "waiting-for-host" })]);
  await restarted.check();
  expect(first.world.woken).toEqual([]);
});

it("doesn't let an older machine wait hide a newer one", async () => {
  const { world, make, read, snooze } = setup();
  const waker = make();
  const waiting = { runtimeStatus: "waiting-for-host" };
  world.now = 100;
  read([thread("t1", waiting), thread("d1", { parentThreadId: "t1" })]);
  await waker.check();
  world.now = 150;
  snooze("t1");
  world.now = 200;
  read([thread("t1", waiting), thread("d1", { parentThreadId: "t1" })]);
  await waker.check();
  world.now = 300;
  read([
    thread("t1", waiting),
    thread("d1", { parentThreadId: "t1", ...waiting }),
  ]);
  await waker.check();
  world.now = 300 + STALL_GRACE_MS;
  read([
    thread("t1", waiting),
    thread("d1", { parentThreadId: "t1", ...waiting }),
  ]);
  await waker.check();
  expect(world.woken.map((w) => w.event)).toEqual(["host-stalled"]);
});

it("wakes on a question a delegate raised after the snooze, without the event", async () => {
  const { world, make, read, snooze } = setup();
  const waker = make();
  read([thread("t1"), thread("d1", { parentThreadId: "t1" })]);
  await waker.check();
  world.now = 1_500;
  snooze("t1");
  world.now = 2_000;
  read([thread("t1"), thread("d1", { parentThreadId: "t1" })]);
  await waker.check();
  world.now = 3_000;
  read([
    thread("t1"),
    thread("d1", { parentThreadId: "t1", hasPendingInteraction: true }),
  ]);
  await waker.check();
  expect(world.woken.map((w) => w.event)).toEqual(["delegate-needs-you"]);
});

it("reads a turn's outcome as first known, so re-analysis stays quiet", async () => {
  const { world, make, read, snooze } = setup();
  const waker = make();
  snooze("t1");
  world.now = 2_000;
  world.work.set("t1", "in_progress");
  read([thread("t1", { latestAttentionAt: 1_500 })]);
  await waker.check();
  world.work.set("t1", "done");
  await waker.check();
  expect(world.woken).toEqual([]);
  // A later turn that ends done wakes it.
  world.now = 3_000;
  read([thread("t1", { latestAttentionAt: 2_500 })]);
  await waker.check();
  expect(world.woken.map((w) => w.event)).toEqual(["done"]);
});

it("wakes when a delegate's failure leaves the work stuck", async () => {
  const { world, make, read, snooze } = setup();
  const waker = make();
  snooze("t1");
  world.work.set("t1", "in_progress");
  world.now = 2_000;
  const stuck = [
    thread("t1", { latestAttentionAt: 900 }),
    thread("d1", {
      parentThreadId: "t1",
      status: "error",
      latestAttentionAt: 1_500,
    }),
  ];
  read(stuck);
  await waker.check();
  expect(world.woken).toEqual([]);
  world.now = 2_000 + STALL_GRACE_MS;
  read(stuck);
  await waker.check();
  expect(world.woken.map((w) => w.event)).toEqual(["delegate-stalled"]);
});

it("leaves a time-only snooze alone through a question", async () => {
  const { world, make, read, snooze } = setup();
  const waker = make();
  read([thread("t1")]);
  snooze("t1", { until: 999_999 });
  await waker.onInteraction({ id: "t1", parentThreadId: null });
  world.now = 2_000;
  read([thread("t1", { hasPendingInteraction: true })]);
  await waker.check();
  expect(world.woken).toEqual([]);
});

it("takes a fresh pull request baseline when a thread is snoozed again", async () => {
  const { world, make, read, snooze, snoozes } = setup();
  const waker = make();
  read([thread("t1", { environmentId: "env" })]);
  world.pr.set("env", "checks_pending");
  snooze("t1");
  await waker.check();
  expect(snoozes.get("t1")?.pr).toBe("checks_pending");
  // Snoozed again a minute later, inside the polling interval.
  world.now += 60_000;
  world.pr.set("env", "checks_failed");
  snooze("t1");
  await waker.check();
  expect(snoozes.get("t1")?.pr).toBe("checks_failed");
  expect(world.woken).toEqual([]);
  world.now += PR_POLL_MS;
  world.pr.set("env", "ready_to_merge");
  await waker.check();
  expect(world.woken.map((w) => w.event)).toEqual(["ready-to-merge"]);
});

it("runs a check requested during one once it finishes", async () => {
  const { world, make, read, snooze } = setup();
  const waker = make();
  read([thread("t1", { environmentId: "env" })]);
  snooze("t1");
  const first = waker.check();
  world.work.set("t1", "review");
  world.now = 2_000;
  read([thread("t1", { environmentId: "env", latestAttentionAt: 1_500 })]);
  await Promise.all([first, waker.check()]);
  expect(world.woken.map((w) => w.event)).toEqual(["review"]);
});

it("doesn't end a snooze set again since the check began", () => {
  const { world, snoozes, snooze } = setup();
  snooze("t1");
  const old = { id: "t1", at: world.now };
  world.now += 1;
  snooze("t1");
  expect(snoozes.clearSet([old])).toEqual([]);
  expect(snoozes.get("t1")?.at).toBe(world.now);
});
