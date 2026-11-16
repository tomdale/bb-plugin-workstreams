import { afterEach, describe, expect, it } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { openDatabase } from "../../src/server/db.ts";
let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
});
/** The composer's preview, which asks the start call for a title and topic. */
const preview = (w: NonNullable<typeof world>) =>
  w.harness.behavior.callRpc("preview", {
    prompt: "Audit the release pipeline",
  }) as Promise<{ title: string | null; workstreamId?: string | null }>;
describe("bounded classification repair", () => {
  it("repairs an invalid topic ID without losing the independently valid title", async () => {
    let workstreamId = "";
    let n = 0;
    world = await fakeWorld({
      complete: () =>
        JSON.stringify(
          n++ === 0
            ? {
                title: { verb: "Auditing", subject: "release pipeline" },
                workstream: "Product / Pipelines",
                propose: null,
                scopeShift: false,
              }
            : {
                title: null,
                workstream: "pipeline",
                propose: null,
                scopeShift: false,
              },
        ),
    });
    const w = world;
    const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
    workstreamId = workstreamStore.create("Pipeline", "Release pipeline").id;
    expect(await preview(w)).toMatchObject({
      title: "Auditing release pipeline",
      workstreamId: workstreamId,
    });
    expect(w.completions).toHaveLength(2);
    expect(w.completions[1]!.prompt).toContain(
      "workstream must be exactly an ID in square brackets in <workstream_tree>",
    );
  });
  it("keeps a usable title and leaves topic unresolved after two invalid responses", async () => {
    world = await fakeWorld({
      complete: () =>
        JSON.stringify({
          title: "Release pipeline audit",
          workstreamId: "Not an ID",
        }),
    });
    const w = world;
    new WorkstreamStore(openDatabase(w.bb)).create(
      "Pipeline",
      "Release pipeline",
    );
    expect(await preview(w)).toMatchObject({
      title: "Release pipeline audit",
      workstreamId: null,
    });
    expect(w.completions).toHaveLength(2);
  });
  it("preserves the stored assignment and catalog when automatic Placement returns a topic and proposal", async () => {
    world = await fakeWorld({
      complete: () =>
        JSON.stringify({
          title: null,
          recap: "Review ready",
          state: "review",
          workstream: "docs",
          propose: {
            name: "Archive",
            description: "Archived work",
            parent: null,
          },
          scopeShift: true,
        }),
    });
    const w = world;
    const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
    const current = workstreamStore.create("Parser", "Parser work");
    workstreamStore.create("Docs", "Documentation work");
    w.addThread("t", { status: "idle" });
    w.converse("t", ["Write the parser documentation"]);
    workstreamStore.assign("t", current.id, { provenance: "automatic" });
    await w.harness.behavior.callRpc("threadAutomatic", { threadId: "t" });
    expect(workstreamStore.assignment("t").workstreamId).toBe(current.id);
    expect(
      workstreamStore
        .list()
        .map((workstream) => workstream.name)
        .sort(),
    ).toEqual(["Docs", "Parser"]);
    const state = (await w.harness.behavior.callRpc("state", null)) as {
      analysis: Record<string, { workstreamError?: string }>;
    };
    expect(state.analysis.t?.workstreamError).toContain("never both");
  });

  it("retains valid Full status and title without clearing the topic on invalid output", async () => {
    world = await fakeWorld({
      complete: () =>
        JSON.stringify({
          title: "Release pipeline audit",
          recap: "Review ready",
          state: "review",
          workstreamId: "Not an ID",
        }),
    });
    const w = world;
    const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
    const p = workstreamStore.create("Pipeline", "Release pipeline");
    w.addThread("t", { status: "idle" });
    w.converse("t", ["Audit the release pipeline"]);
    workstreamStore.assign("t", p.id, { provenance: "automatic" });
    await w.harness.behavior.runCli(["analyze", "t"]);
    expect(workstreamStore.assignment("t").workstreamId).toBe(p.id);
    const state = (await w.harness.behavior.callRpc("state", null)) as any;
    expect(state.analysis.t).toMatchObject({
      state: "review",
      title: "Release pipeline audit",
      workstreamError: expect.any(String),
    });
  });
});
