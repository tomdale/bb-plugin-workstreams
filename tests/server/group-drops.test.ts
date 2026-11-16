import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeWorld, type FakeCompletion } from "./fake-bb.ts";
import { WorkstreamStore } from "../../src/server/topics.ts";
import { openDatabase } from "../../src/server/db.ts";

let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
});

async function setup(complete: FakeCompletion) {
  world = await fakeWorld({ complete });
  const workstreamStore = new WorkstreamStore(openDatabase(world.bb));
  const old = workstreamStore.create("Personal", "Personal work");
  const group = workstreamStore.create("Workstreams", "The Workstreams plugin");
  const labels = workstreamStore.create(
    "Thread Labels",
    "Thread naming and titles",
    group.id,
  );
  workstreamStore.create("Sidebar", "Sidebar arrangement", group.id);
  world.addThread("root", { title: "Explaining workstream title lifecycles" });
  world.addThread("child", { parentThreadId: "root" });
  world.converse("root", [
    "Explain how Workstreams generates and updates thread titles",
  ]);
  workstreamStore.assign("root", old.id, { provenance: "manual" });
  return { w: world, workstreamStore, old, group, labels };
}

describe("moving into a multi-topic workstream", () => {
  it("chooses a leaf within the destination, overrides the old manual topic, and files its delegates", async () => {
    const { w, workstreamStore, group, labels } = await setup(() =>
      JSON.stringify({
        workstream: "thread-labels",
        propose: null,
        scopeShift: false,
      }),
    );
    const result = await w.harness.behavior.callRpc("threadMoveToGroup", {
      threadId: "root",
      workstreamId: group.id,
    });
    expect(result).toMatchObject({
      assignment: { workstreamId: labels.id, provenance: "manual" },
    });
    expect(workstreamStore.assignment("child")).toMatchObject({
      workstreamId: labels.id,
      inheritedFrom: "root",
    });
    await w.harness.behavior.callRpc("organizeStatus", { action: "rebuild" });
    expect(w.threads.get("root")!.sectionId).not.toBeNull();
    expect(
      w.completions.filter((c) =>
        c.prompt.includes('<group id="workstreams">\nWorkstreams\n</group>'),
      ),
    ).toHaveLength(1);
  });

  it.each([
    '{"workstream":"personal","propose":null}',
    '{"workstream":"workstreams","propose":null}',
    '{"workstream":null,"propose":null}',
    '{"workstream":null,"propose":{"name":"New","parent":"workstreams"}}',
    "not json",
  ])(
    "preserves the old assignment when the model cannot return a valid in-group leaf: %s",
    async (answer) => {
      const { w, workstreamStore, old, group } = await setup(() => answer);
      await expect(
        w.harness.behavior.callRpc("threadMoveToGroup", {
          threadId: "root",
          workstreamId: group.id,
        }),
      ).rejects.toThrow();
      expect(workstreamStore.assignment("root")).toMatchObject({
        workstreamId: old.id,
        provenance: "manual",
      });
    },
  );

  it.each(["assignment", "request", "tree", "archive"])(
    "rejects a stale choice after the %s changes",
    async (change) => {
      let release!: (value: string) => void;
      const pending = new Promise<string>((resolve) => {
        release = resolve;
      });
      const { w, workstreamStore, old, group } = await setup(() => pending);
      const running = w.harness.behavior.callRpc("threadMoveToGroup", {
        threadId: "root",
        workstreamId: group.id,
      });
      const rejected = expect(running).rejects.toThrow("changed");
      await vi.waitFor(() => expect(w.completions).toHaveLength(1));
      if (change === "assignment")
        workstreamStore.assign("root", null, { provenance: "manual" });
      if (change === "request")
        w.threads.set("root", {
          ...w.threads.get("root")!,
          latestAttentionAt: Date.now() + 1,
        });
      if (change === "tree") workstreamStore.create("New Topic", "", group.id);
      if (change === "archive")
        w.threads.set("root", {
          ...w.threads.get("root")!,
          archivedAt: Date.now(),
        });
      release('{"workstream":"thread-labels","propose":null}');
      await rejected;
      expect(workstreamStore.assignment("root").workstreamId).toBe(
        change === "assignment" ? null : old.id,
      );
    },
  );

  it("does not ask a model for a delegate or an unavailable group", async () => {
    const { w, group } = await setup(() => {
      throw new Error("Model should not be called");
    });
    await expect(
      w.harness.behavior.callRpc("threadMoveToGroup", {
        threadId: "child",
        workstreamId: group.id,
      }),
    ).rejects.toThrow("parent");
    await expect(
      w.harness.behavior.callRpc("threadMoveToGroup", {
        threadId: "root",
        workstreamId: "missing",
      }),
    ).rejects.toThrow();
    expect(w.completions).toHaveLength(0);
  });
});
