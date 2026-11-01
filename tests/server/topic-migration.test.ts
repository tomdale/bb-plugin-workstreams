import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { TopicMigration } from "../../src/server/topicMigration.ts";
import { TopicStore } from "../../src/server/topics.ts";
import { Journal } from "../../src/server/journal.ts";
import { getMeta, openDatabase, setMeta } from "../../src/server/db.ts";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
function setup() {
  const host = createFakePluginHost({ pluginId: "migration" });
  hosts.push(host);
  const db = openDatabase(host.bb);
  const topics = new TopicStore(db);
  const product = topics.create("Harbor");
  const feature = topics.create("Code Review", "Review capability", product.id);
  db.prepare(
    "INSERT INTO ws_corpus_entity(id, name, description, parent_id, aliases) VALUES ('old', 'Approvals', 'Approval workflow', ?, '[]')",
  ).run(feature.id);
  db.prepare(
    "INSERT INTO ws_corpus_subject(thread_id, entity_id, source, evidence) VALUES ('deep', 'old', 'manual', 'original evidence')",
  ).run();
  db.prepare(
    "INSERT INTO ws_corpus_subject(thread_id, entity_id, source, evidence) VALUES ('broad', ?, 'inherited', 'original inherited evidence')",
  ).run(product.id);
  db.prepare(
    "INSERT INTO ws_corpus_group(section_id, entity_id) VALUES ('old-section', 'old')",
  ).run();
  const journal = new Journal(db);
  const migration = new TopicMigration({ db, topics, journal });
  const mapping = {
    newTopics: [
      {
        key: "direction",
        name: "Product Direction",
        description: "Product direction and priorities",
        parentId: product.id,
      },
    ],
    choices: [{ threadId: "broad", topicId: "direction" }],
  };
  return { db, topics, product, feature, journal, migration, mapping };
}

describe("reviewed topic migration", () => {
  it("resets only explicit nonmanual classifications and keeps recoverable original filing", () => {
    const { migration, topics } = setup();
    const plan = migration.preview({ resetThreadIds: ["broad"] });
    expect(plan.blockers).toEqual([]);
    expect(plan.resets).toEqual([
      expect.objectContaining({ threadId: "broad", source: "inherited" }),
    ]);
    const result = migration.apply(plan.id);
    expect(result.reset).toBe(1);
    expect(topics.assignment("broad")).toMatchObject({
      entityId: null,
      provenance: null,
      evidence: null,
    });
    expect(topics.assignment("deep")).toMatchObject({
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
    const { migration, mapping, topics } = setup();
    expect(() => migration.preview({ resetThreadIds: ["deep"] })).toThrow(
      "manual",
    );
    expect(() =>
      migration.preview({ resetThreadIds: ["broad", "broad"] }),
    ).toThrow("once");
    expect(() =>
      migration.preview({ ...mapping, resetThreadIds: ["broad"] }),
    ).toThrow("also refile");
    const plan = migration.preview({ resetThreadIds: ["broad"] });
    topics.assign("broad", topics.create("Chosen").id, {
      provenance: "manual",
    });
    expect(() => migration.apply(plan.id)).toThrow("changed");
    expect(topics.assignment("broad").provenance).toBe("manual");
  });
  it("previews deeper paths but blocks parent assignments instead of inventing catch-all topics", () => {
    const { migration, topics, feature, product } = setup();
    const before = topics.state();
    const plan = migration.preview();
    expect(plan.changes).toEqual([
      {
        threadId: "deep",
        from: "Harbor: Code Review: Approvals",
        to: "Harbor: Code Review",
        topicId: feature.id,
        source: "manual",
      },
    ]);
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ threadId: "broad", topicId: product.id }),
    );
    expect(topics.state()).toEqual(before);
    expect(() => migration.apply(plan.id)).toThrow("every migration blocker");
  });
  it("applies explicit destinations atomically, preserving provenance, basis, destination IDs, and recovery data", () => {
    const { migration, mapping, topics, feature, db } = setup();
    const plan = migration.preview(mapping);
    expect(plan.blockers).toEqual([]);
    setMeta(
      db,
      "topic_categories",
      '{"unaffected":{"generation":{"id":"stable","categories":[]},"attempted":"[]","attemptId":"a","error":null}}',
    );
    const result = migration.apply(plan.id);
    expect(result.changed).toBe(2);
    expect(topics.assignment("deep")).toMatchObject({
      entityId: feature.id,
      provenance: "manual",
      evidence: "original evidence",
    });
    expect(topics.assignment("broad")).toMatchObject({
      label: "Harbor: Product Direction",
      provenance: "inherited",
      evidence: "original inherited evidence",
    });
    expect(topics.getById("old")).toBeNull();
    expect(topics.getById(feature.id)?.aliases).toContain(
      "Harbor: Code Review: Approvals",
    );
    expect(topics.groups().has("old-section")).toBe(false);
    const backup = migration.backup(result.backupId) as {
      entities: Array<{ id: string }>;
      subjects: Array<{ thread_id: string; entity_id: string }>;
    };
    expect(backup.entities.some((topic) => topic.id === "old")).toBe(true);
    expect(backup.subjects).toContainEqual(
      expect.objectContaining({ thread_id: "deep", entity_id: "old" }),
    );
    expect(getMeta(db, "topic_categories")).toContain("stable");
    expect(() => migration.apply(plan.id)).toThrow("Preview");
  });
  it("rejects newer filing choices instead of overwriting them", () => {
    const { migration, mapping, topics } = setup();
    const plan = migration.preview(mapping);
    const other = topics.create("Another Product");
    topics.assign("deep", other.id, { provenance: "manual" });
    expect(() => migration.apply(plan.id)).toThrow("changed");
    expect(topics.assignment("deep").entityId).toBe(other.id);
  });
  it("rejects deleted assignments before applying a reviewed plan", () => {
    const { migration, mapping, db, topics } = setup();
    const plan = migration.preview(mapping);
    db.prepare("DELETE FROM ws_corpus_subject WHERE thread_id = 'deep'").run();
    expect(() => migration.apply(plan.id)).toThrow("changed");
    expect(topics.getById("old")).not.toBeNull();
  });

  it("rejects cyclic ancestry without changing filing", () => {
    const { migration, db } = setup();
    db.prepare(
      "UPDATE ws_corpus_entity SET parent_id = 'old' WHERE id = 'old'",
    ).run();
    expect(() => migration.preview()).toThrow("cycle");
    expect(
      db
        .prepare(
          "SELECT entity_id FROM ws_corpus_subject WHERE thread_id = 'deep'",
        )
        .get(),
    ).toEqual({ entity_id: "old" });
  });

  it("requires review of an explicit project association on a removed topic", () => {
    const { migration, mapping, db } = setup();
    db.prepare(
      "UPDATE ws_corpus_entity SET project_id = 'project', project_source = 'manual' WHERE id = 'old'",
    ).run();
    const plan = migration.preview(mapping);
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ topicId: "old", threadId: null }),
    );
    expect(() => migration.apply(plan.id)).toThrow("blocker");
  });
  it("rolls back the migration and its recovery record when logging fails", () => {
    const { migration, mapping, journal, topics, db } = setup();
    const before = topics.state();
    const plan = migration.preview(mapping);
    vi.spyOn(journal, "add").mockImplementation(() => {
      throw new Error("database failure");
    });
    expect(() => migration.apply(plan.id)).toThrow("database failure");
    expect(topics.state()).toEqual(before);
    expect(
      db
        .prepare(
          "SELECT key FROM ws_meta WHERE key LIKE 'topic_migration_backup:%'",
        )
        .all(),
    ).toEqual([]);
  });
  it("rejects new third-level identities and unknown filing choices", () => {
    const { migration, mapping, feature } = setup();
    expect(() =>
      migration.preview({
        newTopics: [{ ...mapping.newTopics[0]!, parentId: feature.id }],
      }),
    ).toThrow("two levels");
    expect(() =>
      migration.preview({
        choices: [{ threadId: "unknown", topicId: feature.id }],
      }),
    ).toThrow("known assignment");
  });
  it("includes archived assignments in the filing guard and reviewed plan", () => {
    const { topics, migration, mapping, feature } = setup();
    expect(topics.heldThreads(feature.id)).toBe(0);
    expect(topics.heldThreads(topics.resolve("Harbor")!.id)).toBe(1);
    const plan = migration.preview(mapping);
    expect(plan.changes.map((change) => change.threadId)).toEqual([
      "broad",
      "deep",
    ]);
  });
});
