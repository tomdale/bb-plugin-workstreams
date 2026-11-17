import { createTestPluginHost } from "./test-host.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../src/server/db.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { workstreamAncestors } from "../../src/domain/workstreams.ts";

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
const store = () => {
  const host = createTestPluginHost({ pluginId: `corpus-${hosts.length}` });
  hosts.push(host);
  const db = openDatabase(host.bb);
  return { host, db, workstreamStore: new WorkstreamStore(db) };
};

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

describe("WorkstreamStore", () => {
  it("builds missing local ancestry", () => {
    const { workstreamStore: workstreamStore } = store();
    const direct = workstreamStore.rememberProposal({
      name: "Root Item",
      description: "No ancestors",
      parentId: null,
      ancestors: null,
    });
    expect(direct.parentId).toBeNull();
    const child = workstreamStore.rememberProposal({
      name: "Up Next",
      description: "Upcoming tasks",
      parentId: null,
      ancestors: [{ name: "Lantern", description: "Product" }],
    });
    const product = workstreamStore.resolve("Lantern")!;
    expect(child.parentId).toBe(product.id);
    expect(() => workstreamStore.create("Deeper", "", child.id)).toThrow(
      "at most two levels",
    );
  });
  it("records a proposal that restates existing ancestry under that ancestry", () => {
    const { workstreamStore: workstreamStore } = store();
    const subagents = workstreamStore.create("Subagents", "Background workers");
    const revision = workstreamStore.revision();
    const workforest = workstreamStore.rememberProposal({
      name: "Workforest",
      description: "Checkout integration",
      parentId: subagents.id,
      ancestors: [{ name: "Subagents", description: "Plugin platform" }],
    });
    expect(workforest.parentId).toBe(subagents.id);
    expect(
      workstreamStore
        .list()
        .map((e) => e.name)
        .sort(),
    ).toEqual(["Subagents", "Workforest"]);
    expect(workstreamStore.getById(subagents.id)?.description).toBe(
      "Background workers",
    );
    expect(workstreamStore.revision()).toBeGreaterThan(revision);

    const settled = workstreamStore.revision();
    expect(
      workstreamStore.rememberProposal({
        name: "workforest",
        description: "Other wording",
        parentId: null,
        ancestors: [{ name: "Subagents", description: "" }],
      }),
    ).toEqual(workforest);
    expect(workstreamStore.revision()).toBe(settled);
    expect(() =>
      workstreamStore.rememberProposal({
        name: "Orphan",
        description: "",
        parentId: "missing",
      }),
    ).toThrow(/Unknown group/);
  });
  it("adds its migration without breaking already-migrated storage", () => {
    const { host } = store();
    const migrate = host.bb.storage.migrate.bind(host.bb.storage);
    const spy = vi
      .spyOn(host.bb.storage, "migrate")
      .mockImplementation((db, migrations) => {
        const boundary = migrations.indexOf(
          "ALTER TABLE ws_agent_recap ADD COLUMN waiting_cancelled INTEGER NOT NULL DEFAULT 0",
        );
        return migrate(db, migrations.slice(0, boundary + 1));
      });
    const db = openDatabase(host.bb);
    db.prepare(
      "INSERT INTO ws_section(section_id, created_by) VALUES ('section-a', 'user')",
    ).run();
    spy.mockRestore();
    openDatabase(host.bb);
    expect(
      (
        db.prepare("SELECT section_id FROM ws_section").get() as {
          section_id: string;
        }
      ).section_id,
    ).toBe("section-a");
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'ws_thread_workstream'",
        )
        .get(),
    ).toBeTruthy();
  });

  it("renames the workstream sources of earlier storage", () => {
    // Not `store()`, which would already apply every migration.
    const host = createTestPluginHost({ pluginId: `legacy-${hosts.length}` });
    hosts.push(host);
    const migrate = host.bb.storage.migrate.bind(host.bb.storage);
    const spy = vi
      .spyOn(host.bb.storage, "migrate")
      .mockImplementation((db, migrations) => {
        // Storage as it was before `selected` became `manual`.
        const boundary = migrations.indexOf(
          "UPDATE ws_corpus_subject SET source = 'manual' WHERE source = 'selected'",
        );
        expect(boundary).toBeGreaterThan(0);
        return migrate(db, migrations.slice(0, boundary));
      });
    const db = openDatabase(host.bb);
    const workstream = { id: "alpha" };
    db.prepare(
      "INSERT INTO ws_corpus_entity(id, name, description, parent_id, aliases) VALUES ('alpha', 'Alpha', '', NULL, '[]')",
    ).run();
    const insert = db.prepare(
      "INSERT INTO ws_corpus_subject(thread_id, entity_id, evidence, source) VALUES (?, ?, ?, ?)",
    );
    insert.run("chosen", workstream.id, null, "selected");
    insert.run("cleared", null, null, "selected");
    insert.run("classified", workstream.id, "k", "classified");
    insert.run("quick", workstream.id, null, "quick");
    spy.mockRestore();

    const workstreamStore = new WorkstreamStore(openDatabase(host.bb));
    expect(
      db
        .prepare(
          "SELECT thread_id, source FROM ws_thread_workstream ORDER BY 1",
        )
        .all(),
    ).toEqual([
      { thread_id: "chosen", source: "manual" },
      { thread_id: "classified", source: "automatic" },
      { thread_id: "cleared", source: "manual" },
      { thread_id: "quick", source: "composer" },
    ]);
    expect(workstreamStore.assignment("chosen")).toMatchObject({
      workstreamId: workstream.id,
      provenance: "manual",
    });
    expect(workstreamStore.assignment("cleared").provenance).toBe("manual");
    // Automatic sources keep their priority; only a human choice is promoted.
    expect(workstreamStore.assignment("classified").provenance).toBe(
      "automatic",
    );
    expect(workstreamStore.assignment("quick").provenance).toBe("composer");
    // Analysis can no longer replace the choice.
    expect(
      workstreamStore.applyAnalysis(
        "chosen",
        { workstreamId: null, proposed: null },
        "automatic",
        "k2",
      ),
    ).toBe(false);
    expect(workstreamStore.assignment("chosen").workstreamId).toBe(
      workstream.id,
    );
  });

  it("resolves aliases and scopes matching names by explicit parent", () => {
    const { workstreamStore: workstreamStore } = store();
    const left = workstreamStore.create("Platform", "", null);
    const right = workstreamStore.create("Commerce", "", null);
    const leftFeature = workstreamStore.create("Settings", "left", left.id, [
      "Preferences",
    ]);
    const rightFeature = workstreamStore.create("Settings", "right", right.id);
    expect(workstreamStore.resolve(" preferences ", left.id)?.id).toBe(
      leftFeature.id,
    );
    expect(workstreamStore.resolve("Settings", right.id)?.id).toBe(
      rightFeature.id,
    );
    expect(workstreamStore.resolve("Settings", null)).toBeNull();
  });

  it("rejects unknown parents and invalid cyclic parent updates", () => {
    const { host, workstreamStore: workstreamStore } = store();
    const db = openDatabase(host.bb);
    expect(() => workstreamStore.create("Orphan", "", "missing")).toThrow(
      /Unknown group/,
    );
    const root = workstreamStore.create("Root", "");
    const child = workstreamStore.create("Child", "", root.id);
    db.prepare("UPDATE ws_workstream SET parent_id = ? WHERE id = ?").run(
      child.id,
      root.id,
    );
    expect(() => workstreamStore.create("Nested", "", root.id)).toThrow(
      /inside itself/,
    );
    expect(
      workstreamStore.list().find((item) => item.id === child.id)?.parentId,
    ).toBe(root.id);
  });

  it("rejects an unknown workstream and keeps specific workstreams inside a broad group", () => {
    const { workstreamStore: workstreamStore } = store();
    expect(() => workstreamStore.assign("thread-x", "missing")).toThrow(
      /Unknown workstream/,
    );
    const broad = workstreamStore.create("Engineering", "");
    const specific = workstreamStore.create("Billing migration", "", broad.id);
    workstreamStore.bindGroup("section-engineering", broad.id);
    workstreamStore.assign("thread-x", specific.id);
    expect(workstreamStore.assignment("thread-x").workstreamId).toBe(
      specific.id,
    );
  });

  it("choosing a workstream doesn't move the thread's native section", () => {
    const { host, workstreamStore: workstreamStore } = store();
    const db = openDatabase(host.bb);
    db.prepare(
      "INSERT INTO ws_seen_thread(thread_id, section_id, parent_thread_id, title) VALUES ('t1', 'sec-home', NULL, 'Thread 1')",
    ).run();

    const workstream = workstreamStore.create("Feature", "Feature desc");
    const assignment = workstreamStore.assign("t1", workstream.id);

    expect(assignment.status).toBe("assigned");
    expect(assignment.workstreamId).toBe(workstream.id);

    // Verify the section in ws_seen_thread was not modified
    const seen = db
      .prepare("SELECT section_id FROM ws_seen_thread WHERE thread_id = 't1'")
      .get() as { section_id: string };
    expect(seen.section_id).toBe("sec-home");
  });

  it("moving thread doesn't rewrite task identity", () => {
    const { host, workstreamStore: workstreamStore } = store();
    const db = openDatabase(host.bb);
    db.prepare(
      "INSERT INTO ws_seen_thread(thread_id, section_id, parent_thread_id, title) VALUES ('t1', 'sec-old', NULL, 'Thread 1')",
    ).run();

    const workstream = workstreamStore.create("Feature", "Feature desc");
    workstreamStore.assign("t1", workstream.id);

    // Simulate moving thread native section
    db.prepare(
      "UPDATE ws_seen_thread SET section_id = 'sec-new' WHERE thread_id = 't1'",
    ).run();

    const assignment = workstreamStore.assignment("t1");
    expect(assignment.status).toBe("assigned");
    expect(assignment.workstreamId).toBe(workstream.id);
  });

  it("merges update references across subjects, groups, and children", () => {
    const { workstreamStore: workstreamStore } = store();
    const source = workstreamStore.create(
      "OldAlpha",
      "Old alpha feature",
      null,
      ["LegacyAlpha"],
    );
    const target = workstreamStore.create("NewBeta", "New beta feature");
    const child = workstreamStore.create(
      "ChildFeature",
      "Child of alpha",
      source.id,
    );
    workstreamStore.assign("t-alpha", child.id);
    workstreamStore.bindGroup("sec-alpha", source.id);

    const initialRev = workstreamStore.revision();
    const result = workstreamStore.merge(source.id, target.id);

    expect(result.id).toBe(target.id);
    expect(workstreamStore.revision()).toBeGreaterThan(initialRev);

    // Source is gone
    expect(workstreamStore.getById(source.id)).toBeNull();

    // The child keeps its thread while its parent changes.
    const assignment = workstreamStore.assignment("t-alpha");
    expect(assignment.workstreamId).toBe(child.id);
    expect(assignment.status).toBe("assigned");

    // Child reparented to target
    const updatedChild = workstreamStore.getById(child.id);
    expect(updatedChild?.parentId).toBe(target.id);

    // Group binding updated to target
    expect(workstreamStore.groups().get("sec-alpha")).toBe(target.id);

    // Target absorbed source name and aliases
    const updatedTarget = workstreamStore.getById(target.id);
    expect(updatedTarget?.aliases).toContain("OldAlpha");
    expect(updatedTarget?.aliases).toContain("LegacyAlpha");
  });

  it("rejects cycles on reparenting", () => {
    const { workstreamStore: workstreamStore } = store();
    const root = workstreamStore.create("Root", "Root item");
    const child = workstreamStore.create("Child", "Child item", root.id);
    expect(() =>
      workstreamStore.create("Grandchild", "Grandchild item", child.id),
    ).toThrow("at most two levels");
    const sibling = workstreamStore.create("Sibling", "Sibling item", root.id);

    // Reparent self
    expect(() => workstreamStore.move(child.id, child.id)).toThrow(
      /can't move into itself/,
    );

    // Reparent ancestor under descendant creates cycle
    expect(() => workstreamStore.move(root.id, child.id)).toThrow(/inside/);

    // Valid reparenting succeeds
    const reparented = workstreamStore.move(sibling.id, null);
    expect(reparented.parentId).toBeNull();
  });

  it("keeps manual selections stable across restart and analyses", () => {
    const { host, workstreamStore: workstreamStore } = store();
    const workstream = workstreamStore.create("Billing", "Billing feature");
    workstreamStore.assign("t1", workstream.id, { provenance: "manual" });
    expect(
      workstreamStore.applyAnalysis(
        "t1",
        { workstreamId: null, proposed: null },
        "automatic",
        "basis",
      ),
    ).toBe(false);

    // Reopen store from same db (simulating restart)
    const db = openDatabase(host.bb);
    const reloaded = new WorkstreamStore(db);

    const assignment = reloaded.assignment("t1");
    expect(assignment.status).toBe("assigned");
    expect(assignment.workstreamId).toBe(workstream.id);
    expect(assignment.provenance).toBe("manual");
  });

  it("ensures children inherit the top thread's workstream and changes apply to it", () => {
    const { host, workstreamStore: workstreamStore } = store();
    const db = openDatabase(host.bb);
    db.prepare(
      "INSERT INTO ws_seen_thread(thread_id, section_id, parent_thread_id, title) VALUES ('t-root', NULL, NULL, 'Root')",
    ).run();
    db.prepare(
      "INSERT INTO ws_seen_thread(thread_id, section_id, parent_thread_id, title) VALUES ('t-child', NULL, 't-root', 'Child')",
    ).run();
    db.prepare(
      "INSERT INTO ws_seen_thread(thread_id, section_id, parent_thread_id, title) VALUES ('t-grandchild', NULL, 't-child', 'Grandchild')",
    ).run();

    const workstream1 = workstreamStore.create("Feature 1", "First feature");
    const workstream2 = workstreamStore.create("Feature 2", "Second feature");

    // Move the top-level thread
    workstreamStore.assign("t-root", workstream1.id);

    // Child and grandchild inherit
    const childAssign = workstreamStore.assignment("t-child");
    expect(childAssign.status).toBe("assigned");
    expect(childAssign.workstreamId).toBe(workstream1.id);
    expect(childAssign.inheritedFrom).toBe("t-root");

    const grandAssign = workstreamStore.assignment("t-grandchild");
    expect(grandAssign.status).toBe("assigned");
    expect(grandAssign.workstreamId).toBe(workstream1.id);
    expect(grandAssign.inheritedFrom).toBe("t-root");

    // Changing a child moves the top-level thread
    workstreamStore.assign("t-grandchild", workstream2.id);
    expect(workstreamStore.assignment("t-root").workstreamId).toBe(
      workstream2.id,
    );
    expect(workstreamStore.assignment("t-child").workstreamId).toBe(
      workstream2.id,
    );

    // Clearing a child clears the top-level thread
    workstreamStore.clear("t-child");
    expect(workstreamStore.assignment("t-root").status).toBe("none");
    expect(workstreamStore.assignment("t-grandchild").status).toBe("none");
  });

  it("resolves one thread without reading the workstream tree, and many from one read", () => {
    const { host, workstreamStore: workstreamStore } = store();
    const db = openDatabase(host.bb);
    for (const [id, parent] of [
      ["root", null],
      ["child", "root"],
      ["bare", null],
      ["cleared", null],
    ])
      db.prepare(
        "INSERT INTO ws_seen_thread(thread_id, section_id, parent_thread_id, title) VALUES (?, NULL, ?, ?)",
      ).run(id, parent, id);
    const product = workstreamStore.create("Lantern", "Product");
    const leaf = workstreamStore.create("Up Next", "Upcoming", product.id);
    workstreamStore.assign("root", leaf.id, {
      provenance: "automatic",
      evidence: "basis",
    });
    workstreamStore.assign("cleared", null);
    const ids = ["root", "child", "bare", "cleared", "unseen"];
    const list = vi.spyOn(workstreamStore, "list");

    const single = ids.map((id) => workstreamStore.assignment(id));
    expect(list).not.toHaveBeenCalled();
    expect(single[1]).toMatchObject({
      workstreamId: leaf.id,
      label: "Lantern › Up Next",
      ancestorIds: [leaf.id, product.id],
      evidence: "basis",
      inheritedFrom: "root",
    });
    expect(single[3]).toMatchObject({
      status: "none",
      provenance: "manual",
    });

    const many = workstreamStore.assignmentsOf(ids);
    expect(list).toHaveBeenCalledTimes(1);
    expect(ids.map((id) => many.get(id))).toEqual(single);
    const all = workstreamStore.assignments();
    expect(ids.slice(0, 4).map((id) => all[id])).toEqual(single.slice(0, 4));
  });

  it("validates scoped name and alias collisions on rename and reparent", () => {
    const { workstreamStore: workstreamStore } = store();
    const root = workstreamStore.create("Root", "");
    workstreamStore.create("Alpha", "first", root.id, ["AliasA"]);
    const b = workstreamStore.create("Beta", "second", root.id);

    // Renaming to existing name under same parent fails
    expect(() => workstreamStore.rename(b.id, "Alpha")).toThrow(/already/);

    // Renaming to existing alias under same parent fails
    expect(() => workstreamStore.rename(b.id, "AliasA")).toThrow(/already/);

    // Other parent scope
    const otherRoot = workstreamStore.create("OtherRoot", "");
    const c = workstreamStore.create("Alpha", "third", otherRoot.id);

    // Reparenting to root where "Alpha" already exists fails
    expect(() => workstreamStore.move(c.id, root.id)).toThrow(/already/);
  });

  it("updates metadata with validation and bumps revision", () => {
    const { workstreamStore: workstreamStore } = store();
    const root = workstreamStore.create("Platform", "Base platform");
    const feature = workstreamStore.create("Auth", "Initial auth", root.id, [
      "Login",
    ]);
    const revBefore = workstreamStore.revision();

    // Update description and aliases
    const updated = workstreamStore.updateMetadata(feature.id, {
      description: "Updated authentication system",
      aliases: ["Sign-in", "SSO"],
    });

    expect(updated.description).toBe("Updated authentication system");
    expect(updated.aliases).toEqual(["Sign-in", "SSO"]);
    expect(workstreamStore.revision()).toBeGreaterThan(revBefore);

    // Reject alias matching name
    expect(() =>
      workstreamStore.updateMetadata(feature.id, { aliases: ["Auth"] }),
    ).toThrow(/alias must differ from the name/);

    // Sibling conflict check
    workstreamStore.create("Billing", "Billing feature", root.id, ["Payments"]);
    expect(() =>
      workstreamStore.updateMetadata(feature.id, { aliases: ["Payments"] }),
    ).toThrow(/already names a workstream/);
  });

  it("rejects a duplicate name or a colliding alias on creation", () => {
    const { workstreamStore: workstreamStore } = store();
    workstreamStore.create("Alpha", "Initial alpha");

    // Strict create rejects duplicate name in same scope
    expect(() => workstreamStore.create("Alpha", "Duplicate alpha")).toThrow(
      /already exists/,
    );

    // Strict create rejects alias colliding with existing name
    expect(() =>
      workstreamStore.create("Beta", "Beta", null, ["Alpha"]),
    ).toThrow(/already names/);
  });

  it("atomic updateMetadata validates collisions, supports no-op, and updates revision", () => {
    const { workstreamStore: workstreamStore } = store();
    const e1 = workstreamStore.create("Billing", "Billing engine", null, [
      "Invoice",
    ]);
    const e2 = workstreamStore.create("Payments", "Payments engine");

    const revBefore = workstreamStore.revision();

    // No-op update does not bump revision
    const same = workstreamStore.updateMetadata(e1.id, {
      description: "Billing engine",
      aliases: ["Invoice"],
    });
    expect(same.description).toBe("Billing engine");
    expect(workstreamStore.revision()).toBe(revBefore);

    // Collision with another workstream in scope throws
    expect(() =>
      workstreamStore.updateMetadata(e2.id, { aliases: ["Invoice"] }),
    ).toThrow(/already names/);
    expect(workstreamStore.revision()).toBe(revBefore);

    // Valid update updates metadata and bumps revision
    const updated = workstreamStore.updateMetadata(e1.id, {
      description: "Next billing",
      aliases: ["Invoicing", "Bills"],
    });
    expect(updated.description).toBe("Next billing");
    expect(updated.aliases).toEqual(["Invoicing", "Bills"]);
    expect(workstreamStore.revision()).toBeGreaterThan(revBefore);
  });

  it("merges matching second-level workstreams and preserves leaf references", () => {
    const { workstreamStore: workstreamStore } = store();
    const targetRoot = workstreamStore.create("TargetRoot");
    const targetBackend = workstreamStore.create("Backend", "", targetRoot.id);
    const sourceRoot = workstreamStore.create("SourceRoot");
    const sourceBackend = workstreamStore.create("Backend", "", sourceRoot.id);
    const migrations = workstreamStore.create("Migrations", "", sourceRoot.id);
    const queue = workstreamStore.create("Queue", "", sourceRoot.id);
    workstreamStore.assign("t-backend", sourceBackend.id);
    workstreamStore.assign("t-migrations", migrations.id);
    workstreamStore.assign("t-queue", queue.id);
    workstreamStore.bindGroup("sec-backend", sourceBackend.id);
    workstreamStore.bindGroup("sec-migrations", migrations.id);

    workstreamStore.merge(sourceRoot.id, targetRoot.id);

    expect(workstreamStore.getById(sourceRoot.id)).toBeNull();
    expect(workstreamStore.getById(sourceBackend.id)).toBeNull();
    expect(workstreamStore.getById(migrations.id)?.parentId).toBe(
      targetRoot.id,
    );
    expect(workstreamStore.getById(queue.id)?.parentId).toBe(targetRoot.id);
    expect(workstreamAncestors(migrations.id, workstreamStore.list())).toEqual([
      migrations.id,
      targetRoot.id,
    ]);
    expect(workstreamStore.assignment("t-backend").workstreamId).toBe(
      targetBackend.id,
    );
    expect(workstreamStore.assignment("t-migrations").workstreamId).toBe(
      migrations.id,
    );
    expect(workstreamStore.assignment("t-queue").workstreamId).toBe(queue.id);
    expect(workstreamStore.groups().get("sec-backend")).toBe(targetBackend.id);
    expect(workstreamStore.groups().get("sec-migrations")).toBe(migrations.id);
  });

  it("merge rolls back completely on alias collision with no partial updates", () => {
    const { workstreamStore: workstreamStore } = store();
    const parentA = workstreamStore.create("ParentA");
    const parentB = workstreamStore.create("ParentB");

    // Sibling of target has alias "ConflictAlias" in parentA scope
    workstreamStore.create("Sibling", "Sibling under A", parentA.id, [
      "ConflictAlias",
    ]);
    const target = workstreamStore.create(
      "Target",
      "Target entity",
      parentA.id,
    );

    // Source under parentB has alias "ConflictAlias" (valid in parentB scope)
    const source = workstreamStore.create(
      "Source",
      "Source entity",
      parentB.id,
      ["ConflictAlias"],
    );
    workstreamStore.assign("t-child", source.id);

    const revBefore = workstreamStore.revision();

    // Merge must throw due to alias collision with Sibling in target's parent scope
    expect(() => workstreamStore.merge(source.id, target.id)).toThrow(
      /already/,
    );

    // All workstreams still exist and are untouched (transaction rolled back)
    expect(workstreamStore.getById(source.id)).not.toBeNull();
    expect(workstreamStore.assignment("t-child").workstreamId).toBe(source.id);
    expect(workstreamStore.revision()).toBe(revBefore);
  });

  it("mutation no-ops do not bump revision for identical assign and clear", () => {
    const { workstreamStore: workstreamStore } = store();
    const workstream = workstreamStore.create("Feature", "Feature desc");
    workstreamStore.assign("t1", workstream.id, { provenance: "manual" });
    const rev1 = workstreamStore.revision();

    // Assigning identical workstream, provenance, and evidence is a no-op
    const a2 = workstreamStore.assign("t1", workstream.id, {
      provenance: "manual",
    });
    expect(workstreamStore.revision()).toBe(rev1);
    expect(a2.workstreamId).toBe(workstream.id);

    // Clearing an unassigned thread is a no-op
    workstreamStore.clear("unassigned-thread");
    expect(workstreamStore.revision()).toBe(rev1);

    // Clearing assigned thread bumps revision
    workstreamStore.clear("t1");
    expect(workstreamStore.revision()).toBeGreaterThan(rev1);
  });

  it("applies analyses under the source priority", () => {
    const { workstreamStore: workstreamStore } = store();
    const a = workstreamStore.create("Alpha", "");
    const b = workstreamStore.create("Beta", "");
    const answer = (id: string | null, scopeShift = false) => ({
      workstreamId: id,
      proposed: null,
      scopeShift,
    });
    // Quick fills an empty thread and replaces only its own guess.
    expect(
      workstreamStore.applyAnalysis("t", answer(a.id), "composer", null),
    ).toBe(true);
    expect(
      workstreamStore.applyAnalysis("t", answer(b.id), "composer", null),
    ).toBe(true);
    expect(workstreamStore.assignment("t").provenance).toBe("composer");
    // Full settles over quick, and quick never replaces full.
    expect(
      workstreamStore.applyAnalysis("t", answer(a.id), "automatic", "k1"),
    ).toBe(true);
    expect(
      workstreamStore.applyAnalysis("t", answer(b.id), "composer", null),
    ).toBe(false);
    expect(workstreamStore.assignment("t")).toMatchObject({
      workstreamId: a.id,
      provenance: "automatic",
      evidence: "k1",
    });
    // Inherited changes only on a scope shift from the turn-end analysis.
    workstreamStore.assign("i", a.id, { provenance: "inherited" });
    expect(
      workstreamStore.applyAnalysis("i", answer(b.id), "automatic", "k2"),
    ).toBe(false);
    expect(workstreamStore.basis("i")).toBe("k2");
    expect(
      workstreamStore.applyAnalysis("i", answer(b.id), "composer", null),
    ).toBe(false);
    expect(
      workstreamStore.applyAnalysis("i", answer(b.id, true), "automatic", "k3"),
    ).toBe(true);
    expect(workstreamStore.assignment("i")).toMatchObject({
      workstreamId: b.id,
      provenance: "automatic",
    });
  });

  it("keeps inherited priority when a proposed child still needs a reviewed move plan", () => {
    const { workstreamStore: workstreamStore } = store();
    const product = workstreamStore.create(
      "Product",
      "A multi-capability product",
    );
    workstreamStore.assign("i", product.id, { provenance: "inherited" });
    expect(
      workstreamStore.applyAnalysis(
        "i",
        {
          workstreamId: null,
          proposed: {
            name: "Billing",
            description: "Billing capability",
            parentId: product.id,
          },
          scopeShift: false,
        },
        "automatic",
        "new-request",
      ),
    ).toBe(false);
    expect(workstreamStore.assignment("i")).toMatchObject({
      workstreamId: product.id,
      provenance: "inherited",
      evidence: "new-request",
    });
    expect(workstreamStore.workstreams(product.id)).toBe(0);
    expect(workstreamStore.divisionRequests()[product.id]?.name).toBe(
      "Billing",
    );
  });

  it("lets the turn-end analysis narrow an inherited workstream without a scope shift", () => {
    const { workstreamStore: workstreamStore, db } = store();
    const product = workstreamStore.create("Product", "");
    const other = workstreamStore.create("Other", "");
    const answer = (
      workstreamId: string | null,
      proposed: { name: string; parentId: string | null } | null = null,
    ) => ({
      workstreamId,
      proposed: proposed ? { ...proposed, description: "" } : null,
      scopeShift: false,
    });
    const feature = workstreamStore.create("Feature", "", product.id);
    for (const id of ["i", "j"])
      db.prepare(
        "INSERT INTO ws_thread_workstream(thread_id, workstream_id, source) VALUES (?, ?, 'inherited')",
      ).run(id, product.id);
    // A sibling or the same workstream is no narrowing.
    expect(
      workstreamStore.applyAnalysis("i", answer(other.id), "automatic", "k1"),
    ).toBe(false);
    expect(
      workstreamStore.applyAnalysis("i", answer(product.id), "automatic", "k2"),
    ).toBe(false);
    // An existing descendant narrows it, and the start call never does.
    expect(
      workstreamStore.applyAnalysis("i", answer(feature.id), "composer", null),
    ).toBe(false);
    expect(
      workstreamStore.applyAnalysis("i", answer(feature.id), "automatic", "k3"),
    ).toBe(true);
    expect(workstreamStore.assignment("i")).toMatchObject({
      workstreamId: feature.id,
      provenance: "automatic",
    });
    // Narrowing remains within the two-level identity limit.
    expect(
      workstreamStore.applyAnalysis(
        "j",
        answer(null, { name: "CLI commands", parentId: product.id }),
        "automatic",
        "k4",
      ),
    ).toBe(false);
    expect(workstreamStore.assignment("j").workstreamId).toBe(product.id);
    expect(workstreamStore.divisionRequests()[product.id]?.name).toBe(
      "CLI commands",
    );
  });

  it("inherits a workstream only into a thread with none or a quick guess", () => {
    const { workstreamStore: workstreamStore } = store();
    const a = workstreamStore.create("Alpha", "");
    const b = workstreamStore.create("Beta", "");
    workstreamStore.assign("source", a.id, { provenance: "automatic" });
    expect(workstreamStore.inherit("fork", "source")).toBe(true);
    expect(workstreamStore.assignment("fork")).toMatchObject({
      workstreamId: a.id,
      provenance: "inherited",
    });
    workstreamStore.assign("mine", b.id, { provenance: "manual" });
    expect(workstreamStore.inherit("mine", "source")).toBe(false);
    expect(workstreamStore.inherit("orphan", "nobody")).toBe(false);
  });

  it("keeps a discovered workstream with an associated project until the association is cleared", () => {
    const { workstreamStore: workstreamStore } = store();
    const workstream = workstreamStore.rememberProposal({
      name: "Configured",
      description: "",
    });
    workstreamStore.edit(workstream.id, { projectId: "project" });
    expect(workstreamStore.prune()).toEqual([]);
    workstreamStore.edit(workstream.id, { projectId: null });
    expect(workstreamStore.prune()).toEqual([]);
    workstreamStore.updateMetadata(workstream.id, { projectAutomatic: true });
    expect(workstreamStore.prune().map((workstream) => workstream.id)).toEqual([
      workstream.id,
    ]);
  });

  it("prunes discovered workstreams nothing uses, deepest first, and keeps yours", () => {
    const { workstreamStore: workstreamStore } = store();
    const mine = workstreamStore.create("Mine", "");
    const leaf = workstreamStore.rememberProposal({
      name: "Leaf",
      description: "",
      parentId: null,
      ancestors: [{ name: "Found", description: "" }],
    });
    const used = workstreamStore.rememberProposal({
      name: "Used",
      description: "",
      parentId: null,
    });
    workstreamStore.assign("t", used.id, { provenance: "automatic" });
    const removed = workstreamStore.prune().map((t) => t.name);
    expect(removed).toEqual(["Leaf", "Found"]);
    expect(workstreamStore.getById(leaf.id)).toBeNull();
    expect(workstreamStore.getById(mine.id)).not.toBeNull();
    expect(workstreamStore.getById(used.id)).not.toBeNull();
    workstreamStore.forget("t");
    expect(workstreamStore.prune().map((t) => t.name)).toEqual(["Used"]);
  });
});
