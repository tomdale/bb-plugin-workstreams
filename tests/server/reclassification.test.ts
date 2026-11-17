import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import type { RepairPreview } from "../../src/server/contract.ts";
import { Repair } from "../../src/server/reclassification.ts";
let world: Awaited<ReturnType<typeof fakeWorld>> | undefined;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
});
async function setup(answer?: (fallback: string) => string | Promise<string>) {
  let next = "";
  world = await fakeWorld({
    complete: () => {
      const fallback = JSON.stringify({
        recap: "Working",
        state: "needs-input",
        title: "Unrelated title candidate",
        workstreamId: next,
      });
      return answer ? answer(fallback) : fallback;
    },
  });
  const w = world;
  const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
  const a = workstreamStore.create("Alpha", "Product");
  const b = workstreamStore.create("Beta", "Product");
  next = b.id;
  w.addThread("t", { title: "Stable task title", status: "idle" });
  w.converse("t", ["Fix the Beta pipeline"]);
  workstreamStore.assign("t", a.id, { provenance: "automatic" });
  await w.harness.behavior.callRpc("refresh", null);
  const preview = () =>
    w.harness.behavior.callRpc("repairPreview", {
      threadIds: ["t"],
    }) as Promise<RepairPreview>;
  const apply = (id: string) =>
    w.harness.behavior.callRpc("repairApply", { planId: id });
  return { w, workstreamStore, a, b, preview, apply };
}
describe("reviewable workstream repairs", () => {
  it("does not offer an apply command when a preview contains no automatic repairs", async () => {
    const { w, workstreamStore, a } = await setup();
    workstreamStore.assign("t", a.id);
    const result = await w.harness.behavior.runCli(["preview", "t"]);
    expect(result.stdout).toContain("nothing to apply");
    expect(result.stdout).not.toContain("Apply with");
  });
  it("does not reconcile or journal outside moves while previewing from the CLI", async () => {
    const { w } = await setup();
    const before = await w.harness.behavior.callRpc("journal", {});
    w.threads.set("t", {
      ...w.threads.get("t")!,
      sectionId: w.addSection("Outside").id,
    });
    const result = await w.harness.behavior.runCli(["preview", "t", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(await w.harness.behavior.callRpc("journal", {})).toEqual(before);
  });
  it("persists workstream-changing repairs before a notification failure and resumes remaining rows", async () => {
    const { w, workstreamStore, a } = await setup((fallback) =>
      JSON.stringify({
        ...JSON.parse(fallback),
        workstreamId: null,
        proposed: {
          name: "Pipeline",
          description: "Pipeline product",
          parentId: null,
          ancestors: [],
        },
      }),
    );
    w.addThread("u", { status: "idle" });
    w.converse("u", ["Fix the Pipeline product"]);
    workstreamStore.assign("u", a.id, { provenance: "automatic" });
    const plan = (await w.harness.behavior.callRpc("repairPreview", {
      threadIds: ["t", "u"],
    })) as RepairPreview;
    let fail = true;
    const repairs = new Repair({
      db: openDatabase(w.bb),
      sdk: () => w.bb.sdk,
      workstreamStore,
      analyzer: {} as never,
      onChange: () => {
        if (fail) throw new Error("notification failed");
      },
    });
    await expect(repairs.apply(plan.id)).rejects.toThrow("notification failed");
    expect(workstreamStore.assignment("t").label).toBe("Pipeline");
    fail = false;
    expect(await repairs.apply(plan.id)).toEqual({ changed: 1, skipped: 0 });
    expect(workstreamStore.assignment("u").label).toBe("Pipeline");
  });
  it("does not let a preview already in flight replace an applying plan", async () => {
    let calls = 0;
    let releasePreview!: () => void;
    const { w, preview, apply } = await setup((fallback) =>
      ++calls === 1
        ? fallback
        : new Promise((resolve) => {
            releasePreview = () => resolve(fallback);
          }),
    );
    const first = await preview();
    const pendingPreview = preview();
    await vi.waitFor(() => expect(calls).toBe(2));
    let releaseApply: (() => void) | undefined;
    w.harness.inspection.sdk.stub(
      "threads.get",
      (args: { threadId: string }) =>
        new Promise((resolve) => {
          releaseApply = () => resolve(w.threads.get(args.threadId)!);
        }),
    );
    const applying = apply(first.id);
    await vi.waitFor(() => expect(releaseApply).toBeTypeOf("function"));
    releasePreview();
    await expect(pendingPreview).rejects.toThrow("being applied");
    releaseApply!();
    expect(await applying).toEqual({ changed: 1, skipped: 0 });
  });
  it("applies an explicitly reviewed correction to an inherited workstream", async () => {
    const { workstreamStore, a, b, preview, apply } = await setup();
    workstreamStore.assign("t", a.id, { provenance: "inherited" });
    const plan = await preview();
    expect(plan.rows[0]?.answer?.scopeShift).toBe(false);
    expect(await apply(plan.id)).toEqual({ changed: 1, skipped: 0 });
    expect(workstreamStore.assignment("t")).toMatchObject({
      workstreamId: b.id,
      provenance: "automatic",
    });
  });
  it("keeps control characters out of human CLI rows while preserving JSON titles", async () => {
    const { w } = await setup();
    const title = "Pipeline\n\u001b[31m\u202eAudit\u202c";
    w.threads.set("t", { ...w.threads.get("t")!, title });
    const human = await w.harness.behavior.runCli(["preview", "t"]);
    expect(human.stdout).toContain("Pipeline Audit:");
    expect(human.stdout).not.toMatch(/[\u001b\u202a-\u202e]/);
    const json = await w.harness.behavior.runCli(["preview", "t", "--json"]);
    expect(JSON.parse(json.stdout).rows[0].title).toBe(title);
  });

  it("uses the thread title on preview error rows instead of a raw id", async () => {
    const { w } = await setup();
    w.addThread("child", {
      title: "Delegate follow-up",
      parentThreadId: "t",
      status: "idle",
    });
    await w.harness.behavior.callRpc("refresh", null);
    const human = await w.harness.behavior.runCli(["preview", "child"]);
    expect(human.stdout).toContain("Delegate follow-up:");
    expect(human.stdout).not.toContain("child:");

    const json = await w.harness.behavior.runCli([
      "preview",
      "child",
      "--json",
    ]);
    expect(JSON.parse(json.stdout).rows[0]).toMatchObject({
      threadId: "child",
      title: "Delegate follow-up",
      error: "A child thread goes wherever its parent goes.",
    });
  });
  it("retains a plan after a transient SDK failure so the reviewed result can be retried", async () => {
    const { w, workstreamStore, b, preview, apply } = await setup();
    const plan = await preview();
    let fail = true;
    w.harness.inspection.sdk.stub(
      "threads.get",
      async (args: { threadId: string }) => {
        if (fail) throw new Error("temporary read failure");
        return w.threads.get(args.threadId)!;
      },
    );
    await expect(apply(plan.id)).rejects.toThrow("retry the same preview");
    fail = false;
    expect(await apply(plan.id)).toEqual({ changed: 1, skipped: 0 });
    expect(workstreamStore.assignment("t").workstreamId).toBe(b.id);
  });
  it("resumes after a partial apply without replaying the applied prefix", async () => {
    const { w, workstreamStore, a, b, apply } = await setup();
    w.addThread("u", { status: "idle" });
    w.converse("u", ["Fix the Beta pipeline"]);
    workstreamStore.assign("u", a.id, { provenance: "automatic" });
    const plan = (await w.harness.behavior.callRpc("repairPreview", {
      threadIds: ["t", "u"],
    })) as RepairPreview;
    let fail = true;
    w.harness.inspection.sdk.stub(
      "threads.get",
      async (args: { threadId: string }) => {
        if (args.threadId === "u" && fail)
          throw new Error("temporary read failure");
        return w.threads.get(args.threadId)!;
      },
    );
    await expect(apply(plan.id)).rejects.toThrow("after 1 moves");
    expect(workstreamStore.assignment("t").workstreamId).toBe(b.id);
    fail = false;
    expect(await apply(plan.id)).toEqual({ changed: 1, skipped: 0 });
    expect(workstreamStore.assignment("u").workstreamId).toBe(b.id);
    const journal = (await w.harness.behavior.callRpc("journal", {})) as {
      entries: { rationale: string }[];
    };
    expect(
      journal.entries.filter(
        (e) => e.rationale === "Applied a preview of automatic moves",
      ),
    ).toHaveLength(2);
  });
  it("skips a project move without consuming a model result for the old project", async () => {
    const { w, workstreamStore, a, preview, apply } = await setup();
    const plan = await preview();
    w.threads.set("t", { ...w.threads.get("t")!, projectId: "proj_other" });
    expect(await apply(plan.id)).toEqual({ changed: 0, skipped: 1 });
    expect(workstreamStore.assignment("t").workstreamId).toBe(a.id);
  });
  it("previews without changing facts, applies a fresh plan once, and leaves titles alone", async () => {
    const { w, workstreamStore, a, b, preview, apply } = await setup();
    const plan = await preview();
    expect(plan.rows[0]).toMatchObject({
      from: "Alpha",
      to: "Beta",
      error: null,
    });
    expect(workstreamStore.assignment("t").workstreamId).toBe(a.id);
    expect(w.threads.get("t")?.title).toBe("Stable task title");
    expect(await apply(plan.id)).toEqual({ changed: 1, skipped: 0 });
    expect(workstreamStore.assignment("t").workstreamId).toBe(b.id);
    expect(w.threads.get("t")?.title).toBe("Stable task title");
    await expect(apply(plan.id)).rejects.toThrow("unavailable");
  });
  it("preserves a manual correction after preview", async () => {
    const { workstreamStore, a, preview, apply } = await setup();
    const plan = await preview();
    workstreamStore.assign("t", a.id);
    expect(await apply(plan.id)).toEqual({ changed: 0, skipped: 1 });
    expect(workstreamStore.assignment("t").provenance).toBe("manual");
  });
  it("rejects a plan when workstream definitions change", async () => {
    const { workstreamStore, a, preview, apply } = await setup();
    const plan = await preview();
    workstreamStore.updateMetadata(a.id, { description: "Updated scope" });
    await expect(apply(plan.id)).rejects.toThrow("catalog changed");
  });
  it("skips a new turn and does not ask a model about manually chosen workstreams", async () => {
    const { w, workstreamStore, a, preview, apply } = await setup();
    const plan = await preview();
    w.threads.set("t", { ...w.threads.get("t")!, status: "active" });
    expect(await apply(plan.id)).toEqual({ changed: 0, skipped: 1 });
    workstreamStore.assign("t", a.id);
    const calls = w.completions.length;
    expect(await preview()).toMatchObject({ rows: [], excludedManual: 1 });
    expect(w.completions).toHaveLength(calls);
  });
});
