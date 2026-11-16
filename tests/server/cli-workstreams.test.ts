import { afterEach, describe, expect, it } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

async function setup(options: { onPrompt?: (prompt: string) => void } = {}) {
  let shelvesId = "";
  world = await fakeWorld({
    prefs: { advanced: { debugRecord: true } },
    complete: ({ prompt }) => {
      options.onPrompt?.(prompt);
      return JSON.stringify({
        recap: "Working on it",
        state: "needs-input",
        title: "Root shelves task",
        workstreamId: shelvesId,
        proposed: null,
      });
    },
  });
  const w = world;
  const section = w.addSection("Storage");
  const workstreamStore = new WorkstreamStore(openDatabase(w.bb));
  const storage = workstreamStore.create("Storage", "Storage product", null, [
    "Warehouse",
  ]);
  const shelves = workstreamStore.create(
    "Shelves",
    "Shelves feature",
    storage.id,
    ["Racks"],
  );
  shelvesId = shelves.id;
  workstreamStore.bindGroup(section.id, storage.id);
  const thread = w.addThread("t_root", {
    sectionId: section.id,
    title: "Root shelves task",
  });
  const childThread = w.addThread("t_child", {
    parentThreadId: thread.id,
    title: "Child review subtask",
  });
  workstreamStore.assign(thread.id, shelves.id, {
    provenance: "automatic",
    evidence: "ev_1",
  });
  await w.harness.behavior.callRpc("refresh", null);
  return {
    w,
    section,
    workstreamStore: workstreamStore,
    storage,
    shelves,
    rootThread: thread,
    childThread,
  };
}

describe("CLI topics commands", () => {
  it("topics list prints sorted lexical complete list and supports --json", async () => {
    const { w, storage, shelves } = await setup();

    // Human output
    const listRes = await w.harness.behavior.runCli(["tree"]);
    expect(listRes.exitCode).toBe(0);
    expect(listRes.stdout).toContain("Storage");
    expect(listRes.stdout).toContain("Storage › Shelves");
    expect(listRes.stdout).toContain(storage.id);
    expect(listRes.stdout).toContain(shelves.id);
    expect(listRes.stdout).toContain("[aliases: Warehouse]");
    expect(listRes.stdout).toContain("[aliases: Racks]");

    // JSON output
    const jsonRes = await w.harness.behavior.runCli(["tree", "--json"]);
    expect(jsonRes.exitCode).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed.workstreams).toHaveLength(2);
    expect(
      parsed.workstreams.map((e: { name: string }) => e.name).sort(),
    ).toEqual(["Shelves", "Storage"]);
  });

  it("topics show displays full details by name, alias, or ID and supports --json", async () => {
    const { w, storage, shelves, rootThread: thread } = await setup();

    // Show by exact name
    const showName = await w.harness.behavior.runCli(["describe", "Shelves"]);
    expect(showName.exitCode).toBe(0);
    expect(showName.stdout).toContain("Workstream: Storage › Shelves");
    expect(showName.stdout).toContain(`ID:              ${shelves.id}`);
    expect(showName.stdout).toContain("Aliases:         Racks");
    expect(showName.stdout).toContain("Threads:         2");

    // Show by alias
    const showAlias = await w.harness.behavior.runCli([
      "describe",
      "Warehouse",
    ]);
    expect(showAlias.exitCode).toBe(0);
    expect(showAlias.stdout).toContain(`ID:              ${storage.id}`);

    // Show by ID with --json
    const showJson = await w.harness.behavior.runCli([
      "describe",
      shelves.id,
      "--json",
    ]);
    expect(showJson.exitCode).toBe(0);
    const parsed = JSON.parse(showJson.stdout);
    expect(parsed.workstream.id).toBe(shelves.id);
    expect(parsed.path).toBe("Storage › Shelves");
    expect(parsed.threads).toContain(thread.id);

    // Unknown entity throws clean error
    const showUnknown = await w.harness.behavior.runCli([
      "describe",
      "NonExistent",
    ]);
    expect(showUnknown.exitCode).not.toBe(0);
  });

  it("topics create creates a new product or feature with parent and aliases", async () => {
    const { w, workstreamStore: workstreamStore } = await setup();

    const createRes = await w.harness.behavior.runCli([
      "create",
      "Bins",
      "--description",
      "Storage bins",
      "--group",
      "Storage",
      "--aliases",
      "Containers,Tubs",
    ]);
    expect(createRes.exitCode).toBe(0);
    expect(createRes.stdout).toContain('Created workstream "Bins"');

    const created = workstreamStore.list().find((e) => e.name === "Bins")!;
    expect(created).toBeDefined();
    expect(created.description).toBe("Storage bins");
    expect(created.aliases.sort()).toEqual(["Containers", "Tubs"]);
    const storage = workstreamStore.list().find((e) => e.name === "Storage")!;
    expect(created.parentId).toBe(storage.id);
  });

  it("topics edit updates name, description, and aliases atomically", async () => {
    const { w, workstreamStore: workstreamStore, shelves } = await setup();

    const editRes = await w.harness.behavior.runCli([
      "edit",
      shelves.id,
      "--name",
      "Custom Shelving",
      "--description",
      "Heavy duty shelving",
      "--aliases",
      "Industrial Racks",
    ]);
    expect(editRes.exitCode).toBe(0);

    const updated = workstreamStore.getById(shelves.id)!;
    expect(updated.name).toBe("Custom Shelving");
    expect(updated.description).toBe("Heavy duty shelving");
    expect(updated.aliases).toEqual(["Industrial Racks"]);
  });

  it("topics reparent moves an entity under a new parent or to root", async () => {
    const { w, workstreamStore: workstreamStore, shelves } = await setup();

    // Reparent shelves to root
    const toRoot = await w.harness.behavior.runCli([
      "move",
      shelves.id,
      "--to",
      "top",
    ]);
    expect(toRoot.exitCode).toBe(0);
    expect(workstreamStore.getById(shelves.id)!.parentId).toBeNull();

    // Reparent back to Storage by name
    const toStorage = await w.harness.behavior.runCli([
      "move",
      shelves.id,
      "--to",
      "Storage",
    ]);
    expect(toStorage.exitCode).toBe(0);
    const storage = workstreamStore.list().find((e) => e.name === "Storage")!;
    expect(workstreamStore.getById(shelves.id)!.parentId).toBe(storage.id);
  });

  it("topics merge merges source into target and preserves assignments", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      shelves,
      rootThread: thread,
    } = await setup();
    const other = workstreamStore.create("Legacy Shelves", "Old", null, [
      "OldRacks",
    ]);

    const mergeRes = await w.harness.behavior.runCli([
      "merge",
      other.id,
      shelves.id,
    ]);
    expect(mergeRes.exitCode).toBe(0);
    expect(mergeRes.stdout).toContain('Merged "Legacy Shelves" into "Shelves"');

    expect(workstreamStore.getById(other.id)).toBeNull();
    expect(workstreamStore.getById(shelves.id)!.aliases).toContain("OldRacks");
    expect(workstreamStore.assignment(thread.id).workstreamId).toBe(shelves.id);
  });

  it("topics edit failure on alias conflict is atomic and rolls back name changes", async () => {
    const { w, workstreamStore: workstreamStore, shelves } = await setup();

    // Storage already has alias "Warehouse" in root scope.
    // Shelves is a child of Storage. Let's create an entity with an alias in Shelves' scope.
    workstreamStore.create("Drawers", "Drawers feature", shelves.parentId, [
      "Cabinets",
    ]);

    // Attempting to edit Shelves with a name change AND a conflicting alias with Drawers ("Cabinets")
    const failRes = await w.harness.behavior.runCli([
      "edit",
      shelves.id,
      "--name",
      "Modular Shelving",
      "--aliases",
      "Cabinets",
    ]);
    expect(failRes.exitCode).not.toBe(0);

    // Assert atomic rollback: Shelves must NOT have been renamed to "Modular Shelving"!
    const current = workstreamStore.getById(shelves.id)!;
    expect(current.name).toBe("Shelves");
    expect(current.aliases).toEqual(["Racks"]);
  });

  it("topics mutations notify realtime views", async () => {
    const { w, shelves, storage } = await setup();

    const count0 = w.harness.inspection.realtimeSignals.length;

    // catalog create
    const createRes = await w.harness.behavior.runCli([
      "create",
      "Pallets",
      "--description",
      "Wood pallets",
    ]);
    expect(createRes.exitCode).toBe(0);
    expect(w.harness.inspection.realtimeSignals.length).toBeGreaterThan(count0);
    expect(w.harness.inspection.realtimeSignals.at(-1)?.channel).toBe(
      "changed",
    );

    const count1 = w.harness.inspection.realtimeSignals.length;

    // catalog edit
    const editRes = await w.harness.behavior.runCli([
      "edit",
      shelves.id,
      "--description",
      "Updated description",
    ]);
    expect(editRes.exitCode).toBe(0);
    expect(w.harness.inspection.realtimeSignals.length).toBeGreaterThan(count1);
    expect(w.harness.inspection.realtimeSignals.at(-1)?.channel).toBe(
      "changed",
    );

    const count2 = w.harness.inspection.realtimeSignals.length;

    // catalog reparent
    const reparentRes = await w.harness.behavior.runCli([
      "move",
      shelves.id,
      "--to",
      "top",
    ]);
    expect(reparentRes.exitCode).toBe(0);
    expect(w.harness.inspection.realtimeSignals.length).toBeGreaterThan(count2);
    expect(w.harness.inspection.realtimeSignals.at(-1)?.channel).toBe(
      "changed",
    );

    const count3 = w.harness.inspection.realtimeSignals.length;

    // catalog merge
    const mergeRes = await w.harness.behavior.runCli([
      "merge",
      shelves.id,
      storage.id,
    ]);
    expect(mergeRes.exitCode).toBe(0);
    expect(w.harness.inspection.realtimeSignals.length).toBeGreaterThan(count3);
    expect(w.harness.inspection.realtimeSignals.at(-1)?.channel).toBe(
      "changed",
    );
  });
});

describe("CLI thread topic commands", () => {
  it("thread show displays thread assignment, status, provenance, and root inheritance", async () => {
    const { w, rootThread, childThread, shelves } = await setup();

    // Root thread show
    const rootRes = await w.harness.behavior.runCli([
      "thread",
      "show",
      rootThread.id,
    ]);
    expect(rootRes.exitCode).toBe(0);
    expect(rootRes.stdout).toContain(
      `Thread:          Root shelves task (@thread:${rootThread.id})`,
    );
    expect(rootRes.stdout).toContain("Listed in:       Storage");
    expect(rootRes.stdout).toContain("Workstream:      Storage › Shelves");
    expect(rootRes.stdout).toContain(
      "Source:          chosen automatically from its requests",
    );

    // Child thread inherits root
    const childRes = await w.harness.behavior.runCli([
      "thread",
      "show",
      childThread.id,
    ]);
    expect(childRes.exitCode).toBe(0);
    expect(childRes.stdout).toContain(
      "Source:          follows its parent thread's workstream",
    );
    expect(childRes.stdout).toContain(
      "Parent source:   chosen automatically from its requests",
    );
    expect(childRes.stdout).toContain(
      `Follows parent:  @thread:${rootThread.id}`,
    );

    // JSON format
    const jsonRes = await w.harness.behavior.runCli([
      "thread",
      "show",
      rootThread.id,
      "--json",
    ]);
    expect(jsonRes.exitCode).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed.threadId).toBe(rootThread.id);
    expect(parsed.assignment.workstreamId).toBe(shelves.id);
  });

  it("thread assign manually sets identity and updates root for child threads", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      childThread,
      rootThread,
      storage,
    } = await setup();
    const docks = workstreamStore.create("Docks", "Docks feature", storage.id);

    // Assign via child thread -> must mutate root task!
    const assignRes = await w.harness.behavior.runCli([
      "thread",
      "move",
      childThread.id,
      docks.id,
    ]);
    expect(assignRes.exitCode).toBe(0);
    expect(assignRes.stdout).toContain(
      `Moved @thread:${childThread.id} to "Docks" (Storage › Docks).`,
    );

    const threadAssignment = workstreamStore.assignment(rootThread.id);
    expect(threadAssignment.workstreamId).toBe(docks.id);
    expect(threadAssignment.provenance).toBe("manual");

    const childAssign = workstreamStore.assignment(childThread.id);
    expect(childAssign.workstreamId).toBe(docks.id);
    expect(childAssign.inheritedFrom).toBe(rootThread.id);
  });

  it("thread clear clears thread assignment to unresolved and mutates root", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      childThread,
      rootThread,
    } = await setup();

    const clearRes = await w.harness.behavior.runCli([
      "thread",
      "move",
      childThread.id,
      "none",
    ]);
    expect(clearRes.exitCode).toBe(0);
    expect(clearRes.stdout).toContain("to No workstream");

    const threadAssignment = workstreamStore.assignment(rootThread.id);
    expect(threadAssignment.status).toBe("none");
    expect(threadAssignment.workstreamId).toBeNull();
  });

  it("thread reclassify re-runs classification against the Catalog", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      rootThread,
      shelves,
    } = await setup();
    workstreamStore.clear(rootThread.id);

    const reclassifyRes = await w.harness.behavior.runCli([
      "thread",
      "automatic",
      rootThread.id,
    ]);
    expect(reclassifyRes.exitCode).toBe(0);
    expect(reclassifyRes.stdout).toContain(
      `@thread:${rootThread.id} is now in`,
    );

    const assignment = workstreamStore.assignment(rootThread.id);
    expect(assignment.status).toBe("assigned");
    expect(assignment.workstreamId).toBe(shelves.id);
    expect(assignment.provenance).toBe("automatic");
  });

  it("thread mutations notify realtime views", async () => {
    const {
      w,
      workstreamStore: workstreamStore,
      rootThread,
      storage,
    } = await setup();
    const docks = workstreamStore.create("Docks", "Docks feature", storage.id);

    const count0 = w.harness.inspection.realtimeSignals.length;

    // task assign
    const assignRes = await w.harness.behavior.runCli([
      "thread",
      "move",
      rootThread.id,
      docks.id,
    ]);
    expect(assignRes.exitCode).toBe(0);
    expect(w.harness.inspection.realtimeSignals.length).toBeGreaterThan(count0);
    expect(w.harness.inspection.realtimeSignals.at(-1)?.channel).toBe(
      "changed",
    );

    const count1 = w.harness.inspection.realtimeSignals.length;

    // task clear
    const clearRes = await w.harness.behavior.runCli([
      "thread",
      "move",
      rootThread.id,
      "none",
    ]);
    expect(clearRes.exitCode).toBe(0);
    expect(w.harness.inspection.realtimeSignals.length).toBeGreaterThan(count1);
    expect(w.harness.inspection.realtimeSignals.at(-1)?.channel).toBe(
      "changed",
    );

    const count2 = w.harness.inspection.realtimeSignals.length;

    // task reclassify
    const reclassRes = await w.harness.behavior.runCli([
      "thread",
      "automatic",
      rootThread.id,
    ]);
    expect(reclassRes.exitCode).toBe(0);
    expect(w.harness.inspection.realtimeSignals.length).toBeGreaterThan(count2);
    expect(w.harness.inspection.realtimeSignals.at(-1)?.channel).toBe(
      "changed",
    );
  });

  it("thread reclassify on a child settles its root at once, and organizing asks nothing more", async () => {
    const prompts: string[] = [];
    const {
      w,
      workstreamStore: workstreamStore,
      rootThread,
      childThread,
      shelves,
    } = await setup({
      onPrompt: (p) => prompts.push(p),
    });
    w.converse(rootThread.id, ["Design warehouse shelves distribution"]);
    w.converse(childThread.id, ["Fix minor child button styling"]);

    const reclassRes = await w.harness.behavior.runCli([
      "thread",
      "automatic",
      childThread.id,
    ]);
    expect(reclassRes.exitCode).toBe(0);

    const analysis = prompts.find((p) =>
      p.includes("You describe one agent thread"),
    )!;
    expect(analysis).toContain("Design warehouse shelves distribution");
    expect(analysis).not.toContain("Fix minor child button styling");
    const childAssign = workstreamStore.assignment(childThread.id);
    expect(childAssign.workstreamId).toBe(shelves.id);
    expect(childAssign.inheritedFrom).toBe(rootThread.id);

    const before = prompts.length;
    await w.harness.behavior.callRpc("organizeStatus", { action: "rebuild" });
    expect(prompts.length).toBe(before);
  });

  it("reads and retries organization via CLI and rejects removed manual placement commands", async () => {
    const { w } = await setup();

    // 1. organization read
    const readRes = await w.harness.behavior.runCli(["organize", "--json"]);
    expect(readRes.exitCode).toBe(0);
    const readState = JSON.parse(readRes.stdout);
    expect(readState).toHaveProperty("status");
    expect(readState).toHaveProperty("counts");

    // 2. organization rebuild
    const retryRes = await w.harness.behavior.runCli([
      "organize",
      "--rebuild",
      "--json",
    ]);
    expect(retryRes.exitCode).toBe(0);
    const retryState = JSON.parse(retryRes.stdout);
    expect(retryState.status).toBe("idle");

    // 3. Removed manual placement commands are not recognized
    for (const cmd of [
      "file",
      "new",
      "prioritize",
      "edit",
      "handoff",
      "rebuild",
    ]) {
      const res = await w.harness.behavior.runCli([cmd]);
      expect(res.exitCode).not.toBe(0);
    }
  });

  it("reply inspects raw agent output and diagnoses malformed reply blocks by thread, mention, or URL", async () => {
    const { w, rootThread } = await setup();
    w.turn(rootThread.id);
    w.say(rootThread.id, ":::reply\n# Valid first reply\n:::\n");
    w.turn(rootThread.id);
    const broken = [
      ":::reply",
      "**Draft approval required.**",
      "",
      '```workstreams\n{"type":"context","topic":"PR approval"}\n```',
      "",
      "Closing paragraph.",
      ":::reply",
    ].join("\n");
    w.say(rootThread.id, broken);

    const textRes = await w.harness.behavior.runCli([
      "reply",
      `http://127.0.0.1:38886/projects/proj_1/threads/${rootThread.id}#msg=21`,
    ]);
    expect(textRes.exitCode).toBe(0);
    expect(textRes.stdout).toContain(`@thread:${rootThread.id}#msg=21`);
    expect(textRes.stdout).toContain("Status:   unclosed");
    expect(textRes.stdout).toContain(
      'Line 9: Closing line is ":::reply" — close ":::reply" with ":::" alone on a line, not ":::reply".',
    );
    expect(textRes.stdout).toContain(broken);

    const jsonRes = await w.harness.behavior.runCli([
      "reply",
      `@thread:${rootThread.id}#msg=11`,
      "--json",
    ]);
    expect(jsonRes.exitCode).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed).toMatchObject({
      threadId: rootThread.id,
      messageSeq: 11,
      status: "valid",
      issues: [],
      reply: { headline: "Valid first reply" },
    });
  });
});
