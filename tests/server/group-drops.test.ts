import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeWorld, type FakeCompletion } from "./fake-bb.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { openDatabase } from "../../src/server/db.ts";

let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
});

async function setup(complete: FakeCompletion) {
  world = await fakeWorld({ complete });
  const topics = new TopicStore(openDatabase(world.bb));
  const old = topics.create("Personal", "Personal work");
  const group = topics.create("Workstreams", "The Workstreams plugin");
  const labels = topics.create(
    "Thread Labels",
    "Thread naming and titles",
    group.id,
  );
  topics.create("Sidebar", "Sidebar arrangement", group.id);
  world.addThread("root", { title: "Explaining workstream title lifecycles" });
  world.addThread("delegate", { parentThreadId: "root" });
  world.converse("root", [
    "Explain how Workstreams generates and updates thread titles",
  ]);
  topics.assign("root", old.id, { provenance: "manual" });
  return { w: world, topics, old, group, labels };
}

describe("moving into a multi-topic workstream", () => {
  it("chooses a leaf within the destination, overrides the old manual topic, and files its delegates", async () => {
    const { w, topics, group, labels } = await setup(() =>
      JSON.stringify({
        topic: "thread-labels",
        propose: null,
        scopeShift: false,
      }),
    );
    const result = await w.harness.behavior.callRpc("taskMove", {
      threadId: "root",
      entityId: group.id,
    });
    expect(result).toMatchObject({
      assignment: { entityId: labels.id, provenance: "manual" },
    });
    expect(topics.assignment("delegate")).toMatchObject({
      entityId: labels.id,
      inheritedFrom: "root",
    });
    await w.harness.behavior.callRpc("organization", { action: "rebuild" });
    expect(w.threads.get("root")!.sectionId).not.toBeNull();
    expect(
      w.completions.filter((c) =>
        c.prompt.includes('<group id="workstreams">\nWorkstreams\n</group>'),
      ),
    ).toHaveLength(1);
  });

  it.each([
    '{"topic":"personal","propose":null}',
    '{"topic":"workstreams","propose":null}',
    '{"topic":null,"propose":null}',
    '{"topic":null,"propose":{"name":"New","parent":"workstreams"}}',
    "not json",
  ])(
    "preserves the old assignment when the model cannot return a valid in-group leaf: %s",
    async (answer) => {
      const { w, topics, old, group } = await setup(() => answer);
      await expect(
        w.harness.behavior.callRpc("taskMove", {
          threadId: "root",
          entityId: group.id,
        }),
      ).rejects.toThrow();
      expect(topics.assignment("root")).toMatchObject({
        entityId: old.id,
        provenance: "manual",
      });
    },
  );

  it.each(["assignment", "request", "catalog", "archive"])(
    "rejects a stale choice after the %s changes",
    async (change) => {
      let release!: (value: string) => void;
      const pending = new Promise<string>((resolve) => {
        release = resolve;
      });
      const { w, topics, old, group } = await setup(() => pending);
      const running = w.harness.behavior.callRpc("taskMove", {
        threadId: "root",
        entityId: group.id,
      });
      const rejected = expect(running).rejects.toThrow("changed");
      await vi.waitFor(() => expect(w.completions).toHaveLength(1));
      if (change === "assignment")
        topics.assign("root", null, { provenance: "manual" });
      if (change === "request")
        w.threads.set("root", {
          ...w.threads.get("root")!,
          latestAttentionAt: Date.now() + 1,
        });
      if (change === "catalog") topics.create("New Topic", "", group.id);
      if (change === "archive")
        w.threads.set("root", {
          ...w.threads.get("root")!,
          archivedAt: Date.now(),
        });
      release('{"topic":"thread-labels","propose":null}');
      await rejected;
      expect(topics.assignment("root").entityId).toBe(
        change === "assignment" ? null : old.id,
      );
    },
  );

  it("does not ask a model for a delegate or an unavailable group", async () => {
    const { w, group } = await setup(() => {
      throw new Error("Model should not be called");
    });
    await expect(
      w.harness.behavior.callRpc("taskMove", {
        threadId: "delegate",
        entityId: group.id,
      }),
    ).rejects.toThrow("root");
    await expect(
      w.harness.behavior.callRpc("taskMove", {
        threadId: "root",
        entityId: "missing",
      }),
    ).rejects.toThrow();
    expect(w.completions).toHaveLength(0);
  });
});
