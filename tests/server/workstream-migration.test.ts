import { createTestPluginHost } from "./test-host.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkstreamMigration } from "../../src/server/workstreamMigration.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { Journal } from "../../src/server/journal.ts";
import { getMeta, openDatabase, setMeta } from "../../src/server/db.ts";

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
function setup() {
  const host = createTestPluginHost({ pluginId: "migration" });
  hosts.push(host);
  const db = openDatabase(host.bb);
  const workstreamStore = new WorkstreamStore(db);
  const product = workstreamStore.create("Harbor");
  const feature = workstreamStore.create(
    "Code Review",
    "Review capability",
    product.id,
  );
  db.prepare(
    "INSERT INTO ws_workstream(id, name, description, parent_id, aliases) VALUES ('old', 'Approvals', 'Approval workflow', ?, '[]')",
  ).run(feature.id);
  db.prepare(
    "INSERT INTO ws_thread_workstream(thread_id, workstream_id, source, evidence) VALUES ('deep', 'old', 'manual', 'original evidence')",
  ).run();
  db.prepare(
    "INSERT INTO ws_thread_workstream(thread_id, workstream_id, source, evidence) VALUES ('broad', ?, 'inherited', 'original inherited evidence')",
  ).run(product.id);
  db.prepare(
    "INSERT INTO ws_workstream_section(section_id, workstream_id) VALUES ('old-section', 'old')",
  ).run();
  const journal = new Journal(db);
  const migration = new WorkstreamMigration({ db, workstreamStore, journal });
  const mapping = {
    newWorkstreams: [
      {
        key: "direction",
        name: "Product Direction",
        description: "Product direction and priorities",
        parentId: product.id,
      },
    ],
    choices: [{ threadId: "broad", workstreamId: "direction" }],
  };
  return { db, workstreamStore, product, feature, journal, migration, mapping };
}

describe("reviewed topic migration", () => {
  it("resets only explicit nonmanual classifications and keeps recoverable original filing", () => {
    const { migration, workstreamStore } = setup();
    const plan = migration.preview({ resetThreadIds: ["broad"] });
    expect(plan.blockers).toEqual([]);
    expect(plan.resets).toEqual([
      expect.objectContaining({ threadId: "broad", source: "inherited" }),
    ]);
    const result = migration.apply(plan.id);
    expect(result.reset).toBe(1);
    expect(workstreamStore.assignment("broad")).toMatchObject({
      workstreamId: null,
      provenance: null,
      evidence: null,
    });
    expect(workstreamStore.assignment("deep")).toMatchObject({
      provenance: "manual",
      evidence: "original evidence",
    });
    const backup = migration.backup(result.backupId) as {
      subjects: Array<{ thread_id: string }>;
    };
    expect(
      backup.subjects.some((subject) => subject.thread_id === "broad"),
    ).toBe(true);
  });

  it("refuses manual, duplicate, overlapping, and stale reset choices", () => {
    const { migration, mapping, workstreamStore } = setup();
    expect(() => migration.preview({ resetThreadIds: ["deep"] })).toThrow(
      "a move you made",
    );
    expect(() =>
      migration.preview({ resetThreadIds: ["broad", "broad"] }),
    ).toThrow("once");
    expect(() =>
      migration.preview({ ...mapping, resetThreadIds: ["broad"] }),
    ).toThrow("also move");
    const plan = migration.preview({ resetThreadIds: ["broad"] });
    workstreamStore.assign("broad", workstreamStore.create("Chosen").id, {
      provenance: "manual",
    });
    expect(() => migration.apply(plan.id)).toThrow("changed");
    expect(workstreamStore.assignment("broad").provenance).toBe("manual");
  });
  it("previews deeper paths but blocks parent assignments instead of inventing catch-all topics", () => {
    const { migration, workstreamStore, feature, product } = setup();
    const before = workstreamStore.state();
    const plan = migration.preview();
    expect(plan.changes).toEqual([
      {
        threadId: "deep",
        from: "Harbor › Code Review › Approvals",
        to: "Harbor › Code Review",
        workstreamId: feature.id,
        source: "manual",
      },
    ]);
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ threadId: "broad", workstreamId: product.id }),
    );
    expect(workstreamStore.state()).toEqual(before);
    expect(() => migration.apply(plan.id)).toThrow("every migration blocker");
  });
  it("applies explicit destinations atomically, preserving provenance, basis, destination IDs, and recovery data", () => {
    const { migration, mapping, workstreamStore, feature, db } = setup();
    const plan = migration.preview(mapping);
    expect(plan.blockers).toEqual([]);
    setMeta(
      db,
      "workstream_categories",
      '{"unaffected":{"generation":{"id":"stable","categories":[]},"attempted":"[]","attemptId":"a","error":null}}',
    );
    const result = migration.apply(plan.id);
    expect(result.changed).toBe(2);
    expect(workstreamStore.assignment("deep")).toMatchObject({
      workstreamId: feature.id,
      provenance: "manual",
      evidence: "original evidence",
    });
    expect(workstreamStore.assignment("broad")).toMatchObject({
      label: "Harbor › Product Direction",
      provenance: "inherited",
      evidence: "original inherited evidence",
    });
    expect(workstreamStore.getById("old")).toBeNull();
    expect(workstreamStore.getById(feature.id)?.aliases).toContain(
      "Harbor › Code Review › Approvals",
    );
    expect(workstreamStore.groups().has("old-section")).toBe(false);
    const backup = migration.backup(result.backupId) as {
      workstreams: Array<{ id: string }>;
      subjects: Array<{ thread_id: string; workstream_id: string }>;
    };
    expect(
      backup.workstreams.some((workstream) => workstream.id === "old"),
    ).toBe(true);
    expect(backup.subjects).toContainEqual(
      expect.objectContaining({ thread_id: "deep", workstream_id: "old" }),
    );
    expect(getMeta(db, "workstream_categories")).toContain("stable");
    expect(() => migration.apply(plan.id)).toThrow("Preview");
  });
  it("rejects newer filing choices instead of overwriting them", () => {
    const { migration, mapping, workstreamStore } = setup();
    const plan = migration.preview(mapping);
    const other = workstreamStore.create("Another Product");
    workstreamStore.assign("deep", other.id, { provenance: "manual" });
    expect(() => migration.apply(plan.id)).toThrow("changed");
    expect(workstreamStore.assignment("deep").workstreamId).toBe(other.id);
  });
  it("rejects deleted assignments before applying a reviewed plan", () => {
    const { migration, mapping, db, workstreamStore } = setup();
    const plan = migration.preview(mapping);
    db.prepare(
      "DELETE FROM ws_thread_workstream WHERE thread_id = 'deep'",
    ).run();
    expect(() => migration.apply(plan.id)).toThrow("changed");
    expect(workstreamStore.getById("old")).not.toBeNull();
  });

  it("rejects cyclic ancestry without changing filing", () => {
    const { migration, db } = setup();
    db.prepare(
      "UPDATE ws_workstream SET parent_id = 'old' WHERE id = 'old'",
    ).run();
    expect(() => migration.preview()).toThrow("inside itself");
    expect(
      db
        .prepare(
          "SELECT workstream_id FROM ws_thread_workstream WHERE thread_id = 'deep'",
        )
        .get(),
    ).toEqual({ workstream_id: "old" });
  });

  it("requires review of an explicit project association on a removed topic", () => {
    const { migration, mapping, db } = setup();
    db.prepare(
      "UPDATE ws_workstream SET project_id = 'project', project_source = 'manual' WHERE id = 'old'",
    ).run();
    const plan = migration.preview(mapping);
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ workstreamId: "old", threadId: null }),
    );
    expect(() => migration.apply(plan.id)).toThrow("blocker");
  });
  it("rolls back the migration and its recovery record when logging fails", () => {
    const { migration, mapping, journal, workstreamStore, db } = setup();
    const before = workstreamStore.state();
    const plan = migration.preview(mapping);
    vi.spyOn(journal, "add").mockImplementation(() => {
      throw new Error("database failure");
    });
    expect(() => migration.apply(plan.id)).toThrow("database failure");
    expect(workstreamStore.state()).toEqual(before);
    expect(
      db
        .prepare("SELECT key FROM ws_meta WHERE key LIKE 'migration_backup:%'")
        .all(),
    ).toEqual([]);
  });
  it("rejects new third-level identities and unknown filing choices", () => {
    const { migration, mapping, feature } = setup();
    expect(() =>
      migration.preview({
        newWorkstreams: [
          { ...mapping.newWorkstreams[0]!, parentId: feature.id },
        ],
      }),
    ).toThrow("two levels");
    expect(() =>
      migration.preview({
        choices: [{ threadId: "unknown", workstreamId: feature.id }],
      }),
    ).toThrow("known assignment");
  });
  it("includes archived assignments in the filing guard and reviewed plan", () => {
    const { workstreamStore, migration, mapping, feature } = setup();
    expect(workstreamStore.heldThreads(feature.id)).toBe(0);
    expect(
      workstreamStore.heldThreads(workstreamStore.resolve("Harbor")!.id),
    ).toBe(1);
    const plan = migration.preview(mapping);
    expect(plan.changes.map((change) => change.threadId)).toEqual([
      "broad",
      "deep",
    ]);
  });
});
