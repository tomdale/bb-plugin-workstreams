import { afterEach, expect, it, vi } from "vitest";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { fakeWorld } from "./fake-bb.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { openDatabase } from "../../src/server/db.ts";
import type { TopicState } from "../../src/domain/topics.ts";

const worlds: Awaited<ReturnType<typeof fakeWorld>>[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.harness.lifecycle.dispose();
});

it("exposes persisted categories without changing assignments or native sections; snoozing updates the collection", async () => {
  const calls: string[] = [];
  const world = await fakeWorld({
    complete: ({ prompt }) => {
      if (!prompt.includes("Organize the current collection")) return "{}";
      calls.push(prompt);
      const ids = [...prompt.matchAll(/^- \[(r\d+)\]/gm)].map(
        (match) => match[1]!,
      );
      return JSON.stringify({
        keep: false,
        reason: "Separates interface work and storage work.",
        categories: [
          { id: null, name: "Interface", threadIds: ids.slice(0, 3) },
          { id: null, name: "Storage", threadIds: ids.slice(3) },
        ],
      });
    },
  });
  worlds.push(world);
  const topics = new TopicStore(openDatabase(world.bb));
  const topic = topics.create("Vertex");
  for (let i = 0; i < 6; i++) {
    world.addThread(`t${i}`, { title: `Vertex work ${i}` });
    topics.assign(`t${i}`, topic.id, { provenance: "manual" });
  }
  world.converse("t0", [
    "Build Vertex billing exports",
    "continue",
    "Investigate storage indexes instead of billing exports",
  ]);
  const state = async () =>
    (await world.harness.behavior.callRpc("state", null)) as {
      catalog: TopicState;
    };
  await world.harness.behavior.callRpc("organization", { action: "rebuild" });
  await vi.waitFor(async () => {
    expect(
      (await state()).catalog.categories?.[topic.id]?.categories,
    ).toHaveLength(2);
  });
  expect(calls[0]).toContain(
    "Latest request: Investigate storage indexes instead of billing exports",
  );
  expect(calls[0]).toContain("Earlier request: Build Vertex billing exports");
  const sections = [...world.threads.values()].map(
    (thread) => thread.sectionId,
  );
  expect(new Set(sections).size).toBe(1);
  for (let i = 0; i < 6; i++)
    expect(topics.assignment(`t${i}`)).toMatchObject({
      entityId: topic.id,
      provenance: "manual",
    });
  const dispatch = world.harness.registrations.hooks["message.dispatch"]!;
  await dispatch(
    makeMessageDispatchHookContext({
      thread: world.threads.get("t0")!,
      origin: null,
      input: {
        text: "Now investigate permission inheritance instead of storage indexes",
      },
    }),
  );
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1]).toContain(
    "Latest request: Now investigate permission inheritance instead of storage indexes",
  );

  await world.harness.behavior.callRpc("snooze", {
    threadIds: ["t5"],
    until: null,
  });
  await world.harness.behavior.callRpc("organization", { action: "rebuild" });
  await vi.waitFor(() => expect(calls).toHaveLength(3));
  expect(calls[2]).not.toContain("Vertex work 5");
  await world.harness.behavior.callRpc("snooze", {
    threadIds: ["t3", "t4"],
    until: null,
  });
  await world.harness.behavior.callRpc("organization", { action: "rebuild" });
  await vi.waitFor(async () =>
    expect((await state()).catalog.categories?.[topic.id]).toBeUndefined(),
  );
  expect(calls).toHaveLength(3);
  expect([...world.threads.values()].map((thread) => thread.sectionId)).toEqual(
    sections,
  );
});
