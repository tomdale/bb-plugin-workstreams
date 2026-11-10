import { afterEach, describe, expect, it } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import type { PrefsPatch } from "../../src/domain/prefs.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

const brief = {
  title: "Debug: Merge Payments into Billing",
  message: "Where it came from.\n\n#### Prompt\n\nYou tidy topics.",
};

/** The world's projects are proj_1, proj_home, proj_other, proj_personal. */
async function setup(prefs?: PrefsPatch) {
  world = await fakeWorld(prefs ? { prefs } : {});
  const w = world;
  const rpc = <T>(method: string, input: unknown = null) =>
    w.harness.behavior.callRpc(method, input) as Promise<T>;
  return { w, rpc };
}

describe("debug threads", () => {
  it("starts a visible thread in the chosen project and names it", async () => {
    const { w, rpc } = await setup({
      advanced: { debugProjectId: "proj_other" },
    });
    const result = await rpc<{ threadId: string }>("debugThread", brief);
    expect(result.threadId).toBe("spawn1");
    expect(w.spawned).toHaveLength(1);
    expect(w.spawned[0]).toMatchObject({
      projectId: "proj_other",
      environment: { type: "project-default" },
      title: brief.title,
      prompt: brief.message,
    });
    // A debug thread is something to read and reply to, not a hidden worker.
    expect(w.spawned[0]!.visibility).toBeUndefined();
    expect(w.threads.get("spawn1")).toBeTruthy();
  });

  it("falls back to the home project when none was chosen for debug threads", async () => {
    const { w, rpc } = await setup({ newWork: { homeProjectId: "proj_home" } });
    await rpc("debugThread", brief);
    expect(w.spawned[0]).toMatchObject({ projectId: "proj_home" });
  });

  it("prefers the chosen project over the home project", async () => {
    const { w, rpc } = await setup({
      newWork: { homeProjectId: "proj_home" },
      advanced: { debugProjectId: "proj_1" },
    });
    await rpc("debugThread", brief);
    expect(w.spawned[0]).toMatchObject({ projectId: "proj_1" });
  });

  it("says what to set when no project can be chosen", async () => {
    // Both settings empty, and the world holds more than one project.
    const { w, rpc } = await setup();
    await expect(rpc("debugThread", brief)).rejects.toThrow(
      /debug threads project/,
    );
    expect(w.spawned).toHaveLength(0);
  });
});
