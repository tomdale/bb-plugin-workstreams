import { afterEach, expect, it } from "vitest";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { fakeWorld } from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";

let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = undefined;
});

it.each(["independent", "workstreams"] as const)(
  "records %s project provenance from native submit metadata",
  async (source) => {
    world = await fakeWorld();
    const thread = world.addThread("submitted", { createdAt: Date.now() });
    const hook = world.harness.registrations.hooks["message.dispatch"]!;
    await hook(
      makeMessageDispatchHookContext({
        thread,
        origin: "app",
        experimental_submission: {
          pluginId: "workstreams",
          data: {
            draftKey: "draft",
            projectChoice: { projectId: thread.projectId, source },
          },
        },
      }),
    );
    const db = openDatabase(world.bb);
    expect(
      db
        .prepare("SELECT source FROM ws_project_thread WHERE thread_id = ?")
        .get(thread.id),
    ).toEqual({ source });
  },
);

it("records a late plain-Enter draft report even when analysis chose no topic", async () => {
  world = await fakeWorld();
  const thread = world.addThread("late", { createdAt: Date.now() });
  await world.harness.registrations.hooks["message.dispatch"]!(
    makeMessageDispatchHookContext({
      thread,
      origin: "app",
      input: { text: "Unclassified new work" },
    }),
  );
  await world.harness.behavior.callRpc("draftIdentity", {
    draftKey: "draft",
    text: "Unclassified new work",
    identity: null,
    projectChoice: { projectId: thread.projectId, source: "independent" },
  });
  const db = openDatabase(world.bb);
  expect(
    db
      .prepare("SELECT source FROM ws_project_thread WHERE thread_id = ?")
      .get(thread.id),
  ).toEqual({ source: "independent" });
});
