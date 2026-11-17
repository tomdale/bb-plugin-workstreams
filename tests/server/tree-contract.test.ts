import { afterEach, describe, expect, it } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import type {
  WorkstreamAssignment,
  WorkstreamState,
} from "../../src/domain/workstreams.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;

afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

describe("workstream tree and thread workstream RPC contract", () => {
  it("creates workstreams without creating sidebar sections", async () => {
    world = await fakeWorld({
      complete: () =>
        JSON.stringify({
          workstreams: [],
          assignments: [],
        }),
    });
    const w = world;

    // Create a workstream in the tree
    const { workstream } = (await w.harness.behavior.callRpc(
      "workstreamCreate",
      {
        name: "Core Platform",
        description: "Platform work",
      },
    )) as { workstream: { id: string } };

    // Verify the tree RPC returns state
    const cat = (await w.harness.behavior.callRpc(
      "tree",
      null,
    )) as WorkstreamState;
    expect(cat.revision).toBeGreaterThanOrEqual(1);
    expect(cat.workstreams.some((e) => e.id === workstream.id)).toBe(true);
    expect(cat.colors?.[workstream.id]).toBeUndefined();

    // Creating a workstream no thread has creates no sidebar section.
    expect(w.sections).toHaveLength(0);
  });

  it("threadMove sets a workstream yourself, which moves the thread into it", async () => {
    world = await fakeWorld({
      complete: () => JSON.stringify({ recap: "r", state: "complete" }),
    });
    const w = world;
    const alpha = w.addSection("Alpha");
    const thread = w.addThread("t-task", {
      sectionId: alpha.id,
      title: "My Task",
    });
    const { workstream: eng } = (await w.harness.behavior.callRpc(
      "workstreamCreate",
      {
        name: "Engineering",
        description: "Eng",
      },
    )) as { workstream: { id: string } };

    const assignResult = (await w.harness.behavior.callRpc("threadMove", {
      threadId: thread.id,
      workstreamId: eng.id,
    })) as { assignment: WorkstreamAssignment };
    expect(assignResult.assignment).toMatchObject({
      status: "assigned",
      workstreamId: eng.id,
      provenance: "manual",
    });
    await w.harness.behavior.callRpc("organizeStatus", { action: "rebuild" });
    const engineering = w.sections.find((s) => s.name === "Engineering")!;
    expect(w.threads.get("t-task")?.sectionId).toBe(engineering.id);
    const tree = (await w.harness.behavior.callRpc(
      "tree",
      null,
    )) as WorkstreamState;
    const state = (await w.harness.behavior.callRpc("state", null)) as {
      tree: WorkstreamState;
    };
    expect(tree.colors?.[eng.id]).toBeDefined();
    expect(state.tree.colors?.[eng.id]).toEqual(tree.colors?.[eng.id]);
    expect(state.tree.groups[engineering.id]).toBe(eng.id);

    // No workstream, set yourself, leaves it in No workstream.
    const cleared = (await w.harness.behavior.callRpc("threadMove", {
      threadId: thread.id,
      workstreamId: null,
    })) as { assignment: WorkstreamAssignment };
    expect(cleared.assignment).toMatchObject({
      status: "none",
      provenance: "manual",
    });
    await w.harness.behavior.callRpc("organizeStatus", { action: "rebuild" });
    expect(w.threads.get("t-task")?.sectionId).toBeNull();
  });

  it("workstreamRename, workstreamMove, and workstreamMerge maintain referential integrity", async () => {
    world = await fakeWorld({
      complete: () => JSON.stringify({ recap: "r", state: "complete" }),
    });
    const w = world;

    const { workstream: alpha } = (await w.harness.behavior.callRpc(
      "workstreamCreate",
      {
        name: "AlphaFeature",
        description: "Alpha",
      },
    )) as { workstream: { id: string } };
    const { workstream: beta } = (await w.harness.behavior.callRpc(
      "workstreamCreate",
      {
        name: "BetaFeature",
        description: "Beta",
      },
    )) as { workstream: { id: string } };

    // Rename
    const renameRes = (await w.harness.behavior.callRpc("workstreamRename", {
      workstreamId: alpha.id,
      name: "AlphaRenamed",
    })) as { workstream: { name: string } };
    expect(renameRes.workstream.name).toBe("AlphaRenamed");

    // Reparent Alpha under Beta
    const reparentRes = (await w.harness.behavior.callRpc("workstreamMove", {
      workstreamId: alpha.id,
      parentId: beta.id,
    })) as { workstream: { parentId: string | null } };
    expect(reparentRes.workstream.parentId).toBe(beta.id);

    // Reparenting Beta under Alpha is rejected as a cycle
    await expect(
      w.harness.behavior.callRpc("workstreamMove", {
        workstreamId: beta.id,
        parentId: alpha.id,
      }),
    ).rejects.toThrow(/inside/);

    // Move Alpha back out, so Beta holds no workstreams and can take threads
    await w.harness.behavior.callRpc("workstreamMove", {
      workstreamId: alpha.id,
      parentId: null,
    });

    // Assign thread to Alpha
    const thread = w.addThread("t-target");
    await w.harness.behavior.callRpc("threadMove", {
      threadId: thread.id,
      workstreamId: alpha.id,
    });

    // Merge Alpha into Beta
    const mergeRes = (await w.harness.behavior.callRpc("workstreamMerge", {
      sourceWorkstreamId: alpha.id,
      targetWorkstreamId: beta.id,
    })) as { target: { name: string; aliases: string[] } };

    expect(mergeRes.target.aliases).toContain("AlphaRenamed");

    // Thread is now assigned to Beta
    const afterMerge = (await w.harness.behavior.callRpc(
      "tree",
      null,
    )) as WorkstreamState;
    expect(afterMerge.assignments[thread.id]?.workstreamId).toBe(beta.id);

    // Update metadata (description and aliases)
    const updateRes = (await w.harness.behavior.callRpc("workstreamUpdate", {
      workstreamId: beta.id,
      description: "New beta description",
      aliases: ["BetaAlias1", "BetaAlias2"],
    })) as { workstream: { description: string; aliases: string[] } };
    expect(updateRes.workstream.description).toBe("New beta description");
    expect(updateRes.workstream.aliases).toContain("BetaAlias1");
  });

  it("tree and state reads are pure and do not increment the tree revision", async () => {
    world = await fakeWorld({
      complete: () => JSON.stringify({ recap: "r", state: "complete" }),
    });
    const w = world;

    await w.harness.behavior.callRpc("workstreamCreate", {
      name: "Infra",
      description: "Infrastructure",
    });

    const initial = (await w.harness.behavior.callRpc(
      "tree",
      null,
    )) as WorkstreamState;
    const initialRev = initial.revision;

    for (let i = 0; i < 5; i++) {
      const readTree = (await w.harness.behavior.callRpc(
        "tree",
        null,
      )) as WorkstreamState;
      expect(readTree.revision).toBe(initialRev);

      await w.harness.behavior.callRpc("state", null);
    }
  });

  it("workstreamUpdate updates metadata atomically and handles no-ops and collisions", async () => {
    world = await fakeWorld({
      complete: () => JSON.stringify({ recap: "r", state: "complete" }),
    });
    const w = world;

    const { workstream: alpha } = (await w.harness.behavior.callRpc(
      "workstreamCreate",
      {
        name: "AlphaService",
        description: "Initial description",
        aliases: ["Alpha1"],
      },
    )) as { workstream: { id: string } };

    const { workstream: beta } = (await w.harness.behavior.callRpc(
      "workstreamCreate",
      {
        name: "BetaService",
        description: "Beta description",
      },
    )) as { workstream: { id: string } };

    // Update metadata on AlphaService
    const updated = (await w.harness.behavior.callRpc("workstreamUpdate", {
      workstreamId: alpha.id,
      description: "Updated description",
      aliases: ["AlphaAlias"],
    })) as { workstream: { description: string; aliases: string[] } };

    expect(updated.workstream.description).toBe("Updated description");
    expect(updated.workstream.aliases).toEqual(["AlphaAlias"]);

    // Colliding alias with existing workstream name in parent scope fails
    await expect(
      w.harness.behavior.callRpc("workstreamUpdate", {
        workstreamId: beta.id,
        aliases: ["AlphaService"],
      }),
    ).rejects.toThrow();

    // No-op does not bump revision
    const catBefore = (await w.harness.behavior.callRpc(
      "tree",
      null,
    )) as WorkstreamState;
    await w.harness.behavior.callRpc("workstreamUpdate", {
      workstreamId: alpha.id,
      description: "Updated description",
      aliases: ["AlphaAlias"],
    });
    const catAfter = (await w.harness.behavior.callRpc(
      "tree",
      null,
    )) as WorkstreamState;
    expect(catAfter.revision).toBe(catBefore.revision);
  });

  it("persists, validates, preserves, and clears a workstream's optional project", async () => {
    world = await fakeWorld({
      complete: () => JSON.stringify({ recap: "r", state: "complete" }),
    });
    const { workstream } = (await world.harness.behavior.callRpc(
      "workstreamCreate",
      {
        name: "Project work",
      },
    )) as { workstream: { id: string } };
    const update = (patch: Record<string, unknown>) =>
      world!.harness.behavior.callRpc("workstreamUpdate", {
        workstreamId: workstream.id,
        ...patch,
      });
    await update({ projectId: "proj_other" });
    const read = async () =>
      (
        (await world!.harness.behavior.callRpc("tree", null)) as WorkstreamState
      ).workstreams.find((workstream) => workstream.id === workstream.id)!;
    expect((await read()).projectId).toBe("proj_other");
    await update({ description: "Updated" });
    expect((await read()).projectId).toBe("proj_other");
    await expect(
      update({ projectId: "missing", description: "Must not persist" }),
    ).rejects.toThrow(/existing BB project/);
    expect(await read()).toMatchObject({
      projectId: "proj_other",
      description: "Updated",
    });
    await update({ projectId: null });
    expect((await read()).projectId).toBeNull();
  });

  it("threadMove on a child sets its parent thread's workstream", async () => {
    world = await fakeWorld({
      complete: () => JSON.stringify({ recap: "r", state: "complete" }),
    });
    const w = world;
    const thread = w.addThread("t-root", { title: "Root Thread" });
    const childThread = w.addThread("t-child", {
      parentThreadId: thread.id,
      title: "Child Thread",
    });
    const { workstream: feature } = (await w.harness.behavior.callRpc(
      "workstreamCreate",
      { name: "FeatureX", description: "Desc" },
    )) as { workstream: { id: string } };
    const assignRes = (await w.harness.behavior.callRpc("threadMove", {
      threadId: childThread.id,
      workstreamId: feature.id,
    })) as { assignment: WorkstreamAssignment };
    expect(assignRes.assignment.workstreamId).toBe(feature.id);
    expect(assignRes.assignment.inheritedFrom).toBe(thread.id);
    const tree = (await w.harness.behavior.callRpc(
      "tree",
      null,
    )) as WorkstreamState;
    expect(tree.assignments[thread.id]?.workstreamId).toBe(feature.id);
  });

  it("threadAutomatic hands the workstream back and settles the parent thread with the turn-end analysis", async () => {
    let capturedPrompt = "";
    let workstreamId = "";
    world = await fakeWorld({
      complete: (call) => {
        capturedPrompt = call.prompt;
        return JSON.stringify({
          recap: "Designing the invoice engine",
          state: "needs-input",
          title: "Billing invoice engine",
          workstreamId: workstreamId,
          proposed: null,
        });
      },
    });
    const w = world;
    const { workstream: billing } = (await w.harness.behavior.callRpc(
      "workstreamCreate",
      { name: "Billing", description: "Billing invoices" },
    )) as { workstream: { id: string } };
    workstreamId = billing.id;
    const thread = w.addThread("t-root", {
      title: "Root Billing Work",
      status: "idle",
    });
    const childThread = w.addThread("t-child", {
      parentThreadId: thread.id,
      title: "Child Typo Fix",
    });
    w.converse("t-root", ["Please design billing invoice engine"]);
    w.converse("t-child", ["Fix minor typo in css"]);
    await w.harness.behavior.callRpc("threadMove", {
      threadId: thread.id,
      workstreamId: null,
    });

    const reclassRes = (await w.harness.behavior.callRpc("threadAutomatic", {
      threadId: childThread.id,
    })) as { assignment: WorkstreamAssignment };
    expect(reclassRes.assignment).toMatchObject({
      status: "assigned",
      workstreamId: billing.id,
      inheritedFrom: thread.id,
      provenance: "automatic",
    });
    expect(capturedPrompt).toContain("Please design billing invoice engine");
    expect(capturedPrompt).not.toContain("Fix minor typo in css");
  });
});
