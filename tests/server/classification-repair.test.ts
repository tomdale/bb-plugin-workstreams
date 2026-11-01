import { afterEach, describe, expect, it } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { openDatabase } from "../../src/server/db.ts";
let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
});
/** The composer's preview, where Quick analysis chooses a topic. */
const preview = (w: NonNullable<typeof world>) =>
  w.harness.behavior.callRpc("preview", {
    prompt: "Audit the release pipeline",
  }) as Promise<{ goal: string | null; subjectId?: string | null }>;
describe("bounded classification repair", () => {
  it("repairs an invalid topic ID without losing the independently valid title", async () => {
    let topicId = "";
    let n = 0;
    world = await fakeWorld({
      complete: () =>
        JSON.stringify(
          n++ === 0
            ? {
                goal: "Release pipeline audit",
                subjectId: "Product / Pipelines",
              }
            : { goal: null, subjectId: topicId },
        ),
    });
    const w = world;
    const topics = new TopicStore(openDatabase(w.bb));
    topicId = topics.create("Pipeline", "Release pipeline").id;
    expect(await preview(w)).toMatchObject({
      goal: "Release pipeline audit",
      subjectId: topicId,
    });
    expect(w.completions).toHaveLength(2);
    expect(w.completions[1]!.prompt).toContain(
      "subjectId must be exactly an ID in square brackets in <topic_tree>",
    );
  });
  it("keeps a usable title and leaves topic unresolved after two invalid responses", async () => {
    world = await fakeWorld({
      complete: () =>
        JSON.stringify({
          goal: "Release pipeline audit",
          subjectId: "Not an ID",
        }),
    });
    const w = world;
    new TopicStore(openDatabase(w.bb)).create("Pipeline", "Release pipeline");
    expect(await preview(w)).toMatchObject({
      goal: "Release pipeline audit",
      subjectId: null,
    });
    expect(w.completions).toHaveLength(2);
  });
  it("retains valid Full status and title without clearing the topic on invalid output", async () => {
    world = await fakeWorld({
      complete: () =>
        JSON.stringify({
          goal: "Release pipeline audit",
          recap: "Review ready",
          state: "review",
          subjectId: "Not an ID",
        }),
    });
    const w = world;
    const topics = new TopicStore(openDatabase(w.bb));
    const p = topics.create("Pipeline", "Release pipeline");
    w.addThread("t", { status: "idle" });
    w.converse("t", ["Audit the release pipeline"]);
    topics.assign("t", p.id, { provenance: "full" });
    await w.harness.behavior.runCli(["analyze", "t"]);
    expect(topics.assignment("t").entityId).toBe(p.id);
    const state = (await w.harness.behavior.callRpc("state", null)) as any;
    expect(state.analysis.t).toMatchObject({
      state: "review",
      goal: "Release pipeline audit",
      topicError: expect.any(String),
    });
  });
});
