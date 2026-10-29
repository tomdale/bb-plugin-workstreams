import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openDatabase } from "../../src/server/db.ts";
import {
  restoreTopics,
  snapshotTopics,
  topicsFingerprint,
  TopicStore,
} from "../../src/server/topics.ts";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
const store = () => {
  const host = createFakePluginHost({ pluginId: `partition-${hosts.length}` });
  hosts.push(host);
  const db = openDatabase(host.bb);
  /** A visible root, as the reconciler records it. */
  const see = (...ids: string[]) => {
    for (const id of ids)
      db.prepare(
        "INSERT INTO ws_seen_thread(thread_id, section_id, parent_thread_id) VALUES (?, NULL, NULL)",
      ).run(id);
  };
  return { db, see, topics: new TopicStore(db) };
};

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

describe("a topic holds threads or subtopics, never both", () => {
  it("refuses a thread in a topic with subtopics", () => {
    const { topics } = store();
    const product = topics.create("Automations");
    topics.create("Triggers", "", product.id);
    expect(() => topics.assign("t1", product.id)).toThrow(
      /Automations has subtopics/,
    );
  });

  it("refuses a subtopic beneath a topic that holds visible threads", () => {
    const { topics, see } = store();
    const product = topics.create("Automations");
    const other = topics.create("Code Review");
    see("t1");
    topics.assign("t1", product.id);
    expect(() => topics.create("Triggers", "", product.id)).toThrow(
      /Automations holds a thread/,
    );
    expect(() => topics.reparent(other.id, product.id)).toThrow(
      /holds a thread/,
    );
  });

  it("refuses a merge that would put threads beside subtopics", () => {
    const { topics, see } = store();
    const a = topics.create("Alpha");
    const b = topics.create("Beta");
    topics.create("Child", "", b.id);
    see("t1");
    topics.assign("t1", a.id);
    expect(() => topics.merge(a.id, b.id)).toThrow(/beside subtopics/);
    expect(() => topics.merge(b.id, a.id)).toThrow(/beside subtopics/);
  });

  it("files a proposal beneath a topic that holds threads in that topic", () => {
    const { topics, see } = store();
    const product = topics.create("Automations");
    see("t1");
    topics.assign("t1", product.id);
    const filed = topics.rememberProposal({
      name: "Triggers",
      description: "",
      parentId: product.id,
    });
    expect(filed.id).toBe(product.id);
    expect(topics.subtopics(product.id)).toBe(0);
  });

  it("ignores an analysis answer that names a topic with subtopics", () => {
    const { topics } = store();
    const product = topics.create("Automations");
    topics.create("Triggers", "", product.id);
    expect(
      topics.applyAnalysis(
        "t1",
        { subjectId: product.id, proposed: null },
        "full",
        "k",
      ),
    ).toBe(false);
    expect(topics.assignment("t1").entityId).toBeNull();
    expect(topics.assignment("t1").provenance).toBe("full");
  });

  it("keeps the topic, but settles the basis, when placement names a topic that can't hold it", () => {
    const { topics } = store();
    const product = topics.create("Automations");
    topics.create("Triggers", "", product.id);
    expect(
      topics.applyAnalysis(
        "t1",
        { subjectId: product.id, proposed: null },
        "full",
        "k",
      ),
    ).toBe(false);
    // Settled as Unfiled from these requests, so it isn't asked again.
    expect(topics.assignment("t1")).toMatchObject({
      entityId: null,
      provenance: "full",
    });
    expect(topics.basis("t1")).toBe("k");
    expect(
      topics.applyAnalysis(
        "t2",
        { subjectId: "gone", proposed: null },
        "full",
        "k",
      ),
    ).toBe(false);
    expect(topics.basis("t2")).toBe("k");
  });

  it("doesn't inherit a topic with subtopics", () => {
    const { topics } = store();
    const product = topics.create("Automations");
    topics.create("Triggers", "", product.id);
    expect(topics.inheritTopic("t1", product.id)).toBe(false);
  });
});

describe("merging a lone subtopic into its parent", () => {
  it("leaves the parent holding the threads", () => {
    const { topics, see } = store();
    const parent = topics.create("Automations");
    const only = topics.create("Planning", "", parent.id);
    see("t1");
    topics.assign("t1", only.id);
    topics.merge(only.id, parent.id);
    expect(topics.assignment("t1").entityId).toBe(parent.id);
    expect(topics.subtopics(parent.id)).toBe(0);
  });
});

describe("split", () => {
  it("files every visible thread in a subgroup and marks the topic partitioned", () => {
    const { topics, see } = store();
    const product = topics.create("Automations");
    see("a", "b", "c");
    topics.assign("a", product.id);
    topics.assign("b", product.id, { provenance: "full" });
    topics.assign("c", product.id);
    const before = topics.revision();
    const [planning, triggers] = topics.split(product.id, [
      { name: "Planning", description: "Design", threadIds: ["a"] },
      { name: "Triggers", description: "Events", threadIds: ["b", "c"] },
    ]);
    expect(topics.getById(product.id)?.partitioned).toBe(true);
    expect(topics.assignment("a").entityId).toBe(planning!.id);
    expect(topics.assignment("b")).toMatchObject({
      entityId: triggers!.id,
      provenance: "full",
    });
    expect(topics.assignment("c").label).toBe("Automations: Triggers");
    expect(topics.heldThreads(product.id)).toBe(0);
    expect(topics.revision()).toBeGreaterThan(before);
  });

  it("reuses a subtopic a legacy topic already has", () => {
    const { topics, see, db } = store();
    const product = topics.create("Automations");
    const triggers = topics.create("Triggers", "", product.id);
    see("a");
    db.prepare(
      "INSERT INTO ws_corpus_subject(thread_id, entity_id, source) VALUES ('a', ?, 'full')",
    ).run(product.id);
    const [into] = topics.split(product.id, [
      { name: "triggers", description: "", threadIds: ["a"] },
    ]);
    expect(into!.id).toBe(triggers.id);
  });

  it("refuses a split that leaves a thread out or lists one twice", () => {
    const { topics, see } = store();
    const product = topics.create("Automations");
    see("a", "b");
    topics.assign("a", product.id);
    topics.assign("b", product.id);
    expect(() =>
      topics.split(product.id, [
        { name: "Planning", description: "", threadIds: ["a"] },
      ]),
    ).toThrow(/exactly one subgroup/);
    expect(() =>
      topics.split(product.id, [
        { name: "Planning", description: "", threadIds: ["a", "b"] },
        { name: "Triggers", description: "", threadIds: ["b"] },
      ]),
    ).toThrow(/exactly one subgroup/);
    expect(topics.subtopics(product.id)).toBe(0);
  });
});

describe("restoreTopics", () => {
  it("puts the tree back with foreign keys enforced and workstreams bound", () => {
    const { db, see, topics } = store();
    db.prepare("PRAGMA foreign_keys = ON").run();
    const alpha = topics.create("Alpha");
    const beta = topics.create("Beta");
    const child = topics.create("Child", "", beta.id);
    see("t1", "t2");
    topics.assign("t1", alpha.id);
    topics.assign("t2", child.id);
    topics.bindGroup("sec_a", alpha.id);
    topics.bindGroup("sec_c", child.id);
    const snapshot = snapshotTopics(db, 1);
    topics.merge(alpha.id, child.id);
    topics.rename(beta.id, "Alpha");
    topics.create("Gamma", "", null);
    const after = topicsFingerprint(db);
    // The organizer binds and unbinds workstreams on its own afterwards.
    topics.bindGroup("sec_g", topics.resolve("Gamma")!.id);
    expect(restoreTopics(db, snapshot, after)).toBe(true);
    expect(
      topics
        .list()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["Alpha", "Beta", "Child"]);
    expect(topics.assignment("t1").entityId).toBe(alpha.id);
    expect(topics.getById(child.id)?.parentId).toBe(beta.id);
    expect(topics.groups().get("sec_c")).toBe(child.id);
  });

  it("restores nothing once the catalog changed again", () => {
    const { db, topics } = store();
    const alpha = topics.create("Alpha");
    const snapshot = snapshotTopics(db, 1);
    topics.rename(alpha.id, "Beta");
    const after = topicsFingerprint(db);
    topics.create("Gamma");
    expect(restoreTopics(db, snapshot, after)).toBe(false);
    expect(topics.getById(alpha.id)?.name).toBe("Beta");
  });
});
