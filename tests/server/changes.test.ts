import { afterEach, describe, expect, it } from "vitest";
import { ChangeFeed } from "../../src/server/changes.ts";
import type { ChangedSignal } from "../../src/domain/changes.ts";
import { openDatabase } from "../../src/server/db.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { createTestPluginHost } from "./test-host.ts";
import { fakeWorld } from "./fake-bb.ts";

const worlds: Awaited<ReturnType<typeof fakeWorld>>[] = [];
const hosts: ReturnType<typeof createTestPluginHost>[] = [];
afterEach(async () => {
  await Promise.all(
    [...worlds.splice(0), ...hosts.splice(0)].map((w) =>
      w.harness.lifecycle.dispose(),
    ),
  );
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("change feed", () => {
  it("publishes one signal per tick for any number of writes", async () => {
    const published: ChangedSignal[] = [];
    const feed = new ChangeFeed((signal) => published.push(signal));
    feed.notify({ slices: ["recaps"], threadIds: ["a"] });
    feed.notify({ slices: ["recaps"], threadIds: ["b"] });
    feed.notify({ slices: ["analysis"], threadIds: ["a"] });
    // A read in the same tick already sees the new revisions.
    expect(feed.stamp().revisions).toMatchObject({ recaps: 2, analysis: 1 });
    expect(published).toHaveLength(0);
    await tick();
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      revisions: { recaps: 2, analysis: 1, tree: 0, order: 0 },
      threadIds: ["a", "b"],
    });
  });

  it("marks every slice and thread when a write names no scope", async () => {
    const published: ChangedSignal[] = [];
    const feed = new ChangeFeed((signal) => published.push(signal));
    feed.notify({ slices: ["order"], threadIds: [] });
    feed.notify();
    await tick();
    expect(published).toHaveLength(1);
    expect(published[0]!.threadIds).toBeUndefined();
    expect(Object.values(published[0]!.revisions)).not.toContain(0);
    // The next tick starts with no threads named.
    feed.notify({ slices: ["order"], threadIds: [] });
    await tick();
    expect(published[1]!.threadIds).toEqual([]);
  });

  it("stops publishing once disposed", async () => {
    const published: ChangedSignal[] = [];
    const feed = new ChangeFeed((signal) => published.push(signal));
    feed.notify();
    feed.dispose();
    await tick();
    expect(published).toHaveLength(0);
  });
});

describe("client snapshot scope", () => {
  it("lists visible assignments exactly as the full read lists them", () => {
    const host = createTestPluginHost({ pluginId: "visible-assignments" });
    hosts.push(host);
    const db = openDatabase(host.bb);
    const workstreamStore = new WorkstreamStore(db);
    const workstream = workstreamStore.create("Billing", "Invoices");
    const seen = db.prepare(
      "INSERT INTO ws_seen_thread(thread_id, section_id, parent_thread_id, title) VALUES (?, NULL, ?, ?)",
    );
    seen.run("root", null, "Root");
    seen.run("child", "root", "Child");
    // A child whose archived parent is no longer seen inherits its workstream.
    seen.run("orphan", "archived-parent", "Orphan");
    seen.run("other", null, "Other");
    workstreamStore.assign("root", workstream.id, { provenance: "manual" });
    workstreamStore.assign("archived-parent", workstream.id, {
      provenance: "automatic",
    });
    workstreamStore.assign("archived", workstream.id, {
      provenance: "composer",
    });
    const all = workstreamStore.assignments();
    const visible = workstreamStore.visibleAssignments();
    expect(Object.keys(visible).sort()).toEqual([
      "child",
      "orphan",
      "other",
      "root",
    ]);
    for (const [id, assignment] of Object.entries(visible))
      expect(assignment).toEqual(all[id]);
    expect(visible.orphan).toMatchObject({
      workstreamId: workstream.id,
      inheritedFrom: "archived-parent",
    });
  });

  it("reads one slice without the others, with the revisions it reflects", async () => {
    const w = await fakeWorld();
    worlds.push(w);
    const full = (await w.harness.behavior.callRpc("state", null)) as Record<
      string,
      unknown
    >;
    expect(full).not.toHaveProperty("organizeStatus");
    expect(full.changes).toMatchObject({ epoch: expect.any(String) });
    const slice = (await w.harness.behavior.callRpc("stateSlices", {
      slices: ["snoozes", "suggestions"],
    })) as Record<string, unknown>;
    expect(Object.keys(slice).sort()).toEqual([
      "changes",
      "pendingSuggestions",
      "snoozePrefs",
      "snoozes",
    ]);
  });

  it("names the slice and thread a snooze or recap write changed", async () => {
    const w = await fakeWorld();
    worlds.push(w);
    w.addThread("t1", { status: "idle" });
    await w.harness.behavior.callRpc("refresh", null);
    await tick();
    const before = w.harness.inspection.realtimeSignals.length;
    await w.harness.behavior.callRpc("snooze", {
      threadIds: ["t1"],
      until: Date.now() + 60_000,
    });
    await tick();
    const signals = w.harness.inspection.realtimeSignals
      .slice(before)
      .filter((signal) => signal.channel === "changed");
    expect(signals).toHaveLength(1);
    expect(signals[0]!.payload).toMatchObject({ threadIds: [] });
  });

  it("signals when a thread leaves the snapshot, though nothing was journaled", async () => {
    const w = await fakeWorld();
    worlds.push(w);
    w.addThread("t1", { status: "idle" });
    await w.harness.behavior.callRpc("refresh", null);
    await tick();
    const before = (await w.harness.behavior.callRpc("state", null)) as {
      changes: { revisions: Record<string, number> };
      tree: { assignments: Record<string, unknown> };
    };
    expect(before.tree.assignments.t1).toBeDefined();
    w.threads.set("t1", { ...w.threads.get("t1")!, archivedAt: Date.now() });
    const { changed } = (await w.harness.behavior.callRpc("refresh", null)) as {
      changed: boolean;
    };
    expect(changed).toBe(false);
    const after = (await w.harness.behavior.callRpc("state", null)) as {
      changes: { revisions: Record<string, number> };
      tree: { assignments: Record<string, unknown> };
    };
    expect(after.tree.assignments.t1).toBeUndefined();
    expect(after.changes.revisions.tree).toBeGreaterThan(
      before.changes.revisions.tree!,
    );
  });

  it("ignores hidden threads' lifecycle events, which never reach the snapshot", async () => {
    const w = await fakeWorld();
    worlds.push(w);
    w.addThread("t1", { status: "idle" });
    await w.harness.behavior.callRpc("refresh", null);
    await tick();
    const before = w.harness.inspection.realtimeSignals.length;
    const worker = w.addThread("worker", { visibility: "hidden" });
    for (const event of ["thread.created", "thread.archived"] as const)
      await w.harness.behavior.emitThreadEvent(event, {
        thread: { ...worker, archivedAt: Date.now() },
      } as never);
    await tick();
    expect(
      w.harness.inspection.realtimeSignals
        .slice(before)
        .filter((signal) => signal.channel === "changed"),
    ).toEqual([]);
  });

  it("names only the slices a visible thread's archive can change", async () => {
    const w = await fakeWorld();
    worlds.push(w);
    w.addThread("t1", { status: "idle" });
    await w.harness.behavior.callRpc("refresh", null);
    await tick();
    const read = async () =>
      (
        (await w.harness.behavior.callRpc("state", null)) as {
          changes: { revisions: Record<string, number> };
        }
      ).changes.revisions;
    const before = await read();
    const signals = w.harness.inspection.realtimeSignals.length;
    await w.harness.behavior.emitThreadEvent("thread.archived", {
      thread: { ...w.threads.get("t1")!, archivedAt: Date.now() },
    } as never);
    await tick();
    const after = await read();
    for (const slice of ["analysis", "recaps", "tree"])
      expect(after[slice]).toBeGreaterThan(before[slice]!);
    for (const slice of ["order", "snoozes", "suggestions"])
      expect(after[slice]).toBe(before[slice]);
    const changed = w.harness.inspection.realtimeSignals
      .slice(signals)
      .filter((signal) => signal.channel === "changed");
    expect(changed[0]?.payload).toMatchObject({ threadIds: ["t1"] });
  });
});
