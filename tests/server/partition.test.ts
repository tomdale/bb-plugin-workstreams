import { createTestPluginHost } from "./test-host.ts";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db.ts";
import {
  restoreWorkstreams,
  snapshotWorkstreams,
  workstreamsFingerprint,
  WorkstreamStore,
} from "../../src/server/workstreams.ts";

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
const store = () => {
  const host = createTestPluginHost({ pluginId: `partition-${hosts.length}` });
  hosts.push(host);
  const db = openDatabase(host.bb);
  /** A visible thread with no parent, as the reconciler records it. */
  const see = (...ids: string[]) => {
    for (const id of ids)
      db.prepare(
        "INSERT INTO ws_seen_thread(thread_id, section_id, parent_thread_id) VALUES (?, NULL, NULL)",
      ).run(id);
  };
  return { db, see, workstreamStore: new WorkstreamStore(db) };
};

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

describe("a workstream holds threads and a group holds workstreams", () => {
  it("refuses a thread in a group", () => {
    const { workstreamStore } = store();
    const product = workstreamStore.create("Automations");
    workstreamStore.create("Triggers", "", product.id);
    expect(() => workstreamStore.assign("t1", product.id)).toThrow(
      /Automations is a group/,
    );
  });

  it("refuses a workstream beneath one that holds visible threads", () => {
    const { workstreamStore, see } = store();
    const product = workstreamStore.create("Automations");
    const other = workstreamStore.create("Code Review");
    see("t1");
    workstreamStore.assign("t1", product.id);
    expect(() => workstreamStore.create("Triggers", "", product.id)).toThrow(
      /Automations holds a thread/,
    );
    expect(() => workstreamStore.move(other.id, product.id)).toThrow(
      /holds a thread/,
    );
  });

  it("refuses a merge that would put threads beside workstreams", () => {
    const { workstreamStore, see } = store();
    const a = workstreamStore.create("Alpha");
    const b = workstreamStore.create("Beta");
    workstreamStore.create("Child", "", b.id);
    see("t1");
    workstreamStore.assign("t1", a.id);
    expect(() => workstreamStore.merge(a.id, b.id)).toThrow(
      /beside workstreams/,
    );
    expect(() => workstreamStore.merge(b.id, a.id)).toThrow(
      /beside workstreams/,
    );
  });

  it("moves a proposal beneath a workstream with threads into that workstream", () => {
    const { workstreamStore, see } = store();
    const product = workstreamStore.create("Automations");
    see("t1");
    workstreamStore.assign("t1", product.id);
    const filed = workstreamStore.rememberProposal({
      name: "Triggers",
      description: "",
      parentId: product.id,
    });
    expect(filed.id).toBe(product.id);
    expect(workstreamStore.workstreams(product.id)).toBe(0);
  });

  it("ignores an analysis answer that names a group", () => {
    const { workstreamStore } = store();
    const product = workstreamStore.create("Automations");
    workstreamStore.create("Triggers", "", product.id);
    expect(
      workstreamStore.applyAnalysis(
        "t1",
        { workstreamId: product.id, proposed: null },
        "automatic",
        "k",
      ),
    ).toBe(false);
    expect(workstreamStore.assignment("t1").workstreamId).toBeNull();
    expect(workstreamStore.assignment("t1").provenance).toBe("automatic");
  });

  it("keeps the workstream, but settles the basis, when the workstream choice names one that can't hold it", () => {
    const { workstreamStore } = store();
    const product = workstreamStore.create("Automations");
    workstreamStore.create("Triggers", "", product.id);
    expect(
      workstreamStore.applyAnalysis(
        "t1",
        { workstreamId: product.id, proposed: null },
        "automatic",
        "k",
      ),
    ).toBe(false);
    // Settled as No workstream from these requests, so it isn't asked again.
    expect(workstreamStore.assignment("t1")).toMatchObject({
      workstreamId: null,
      provenance: "automatic",
    });
    expect(workstreamStore.basis("t1")).toBe("k");
    expect(
      workstreamStore.applyAnalysis(
        "t2",
        { workstreamId: "gone", proposed: null },
        "automatic",
        "k",
      ),
    ).toBe(false);
    expect(workstreamStore.basis("t2")).toBe("k");
  });

  it("doesn't inherit a group", () => {
    const { workstreamStore } = store();
    const product = workstreamStore.create("Automations");
    workstreamStore.create("Triggers", "", product.id);
    expect(workstreamStore.inheritWorkstream("t1", product.id)).toBe(false);
  });
});

describe("merging a lone workstream into its group", () => {
  it("leaves the parent holding the threads", () => {
    const { workstreamStore, see } = store();
    const parent = workstreamStore.create("Automations");
    const only = workstreamStore.create("Planning", "", parent.id);
    see("t1");
    workstreamStore.assign("t1", only.id);
    workstreamStore.merge(only.id, parent.id);
    expect(workstreamStore.assignment("t1").workstreamId).toBe(parent.id);
    expect(workstreamStore.workstreams(parent.id)).toBe(0);
  });
});

describe("split", () => {
  it("moves each stored thread into a reviewed child workstream", () => {
    const { workstreamStore, see } = store();
    const product = workstreamStore.create("Automations");
    see("a", "b", "c");
    workstreamStore.assign("a", product.id);
    workstreamStore.assign("b", product.id, { provenance: "automatic" });
    workstreamStore.assign("c", product.id);
    const before = workstreamStore.revision();
    const [planning, triggers] = workstreamStore.split(product.id, [
      { name: "Planning", description: "Design", threadIds: ["a"] },
      { name: "Triggers", description: "Events", threadIds: ["b", "c"] },
    ]);
    expect(workstreamStore.workstreams(product.id)).toBe(2);
    expect(workstreamStore.assignment("a").workstreamId).toBe(planning!.id);
    expect(workstreamStore.assignment("b")).toMatchObject({
      workstreamId: triggers!.id,
      provenance: "automatic",
    });
    expect(workstreamStore.assignment("c").label).toBe(
      "Automations › Triggers",
    );
    expect(workstreamStore.heldThreads(product.id)).toBe(0);
    expect(workstreamStore.revision()).toBeGreaterThan(before);
  });

  it("reuses a workstream a legacy group already has", () => {
    const { workstreamStore, see, db } = store();
    const product = workstreamStore.create("Automations");
    const triggers = workstreamStore.create("Triggers", "", product.id);
    see("a");
    db.prepare(
      "INSERT INTO ws_thread_workstream(thread_id, workstream_id, source) VALUES ('a', ?, 'full')",
    ).run(product.id);
    const [into] = workstreamStore.split(product.id, [
      { name: "triggers", description: "", threadIds: ["a"] },
    ]);
    expect(into!.id).toBe(triggers.id);
  });

  it("refuses a split that leaves a thread out or lists one twice", () => {
    const { workstreamStore, see } = store();
    const product = workstreamStore.create("Automations");
    see("a", "b");
    workstreamStore.assign("a", product.id);
    workstreamStore.assign("b", product.id);
    expect(() =>
      workstreamStore.split(product.id, [
        { name: "Planning", description: "", threadIds: ["a"] },
      ]),
    ).toThrow(/exactly one workstream/);
    expect(() =>
      workstreamStore.split(product.id, [
        { name: "Planning", description: "", threadIds: ["a", "b"] },
        { name: "Triggers", description: "", threadIds: ["b"] },
      ]),
    ).toThrow(/exactly one workstream/);
    expect(workstreamStore.workstreams(product.id)).toBe(0);
  });
});

describe("restoreWorkstreams", () => {
  it("puts the tree back with foreign keys enforced and workstreams bound", () => {
    const { db, see, workstreamStore } = store();
    db.prepare("PRAGMA foreign_keys = ON").run();
    const alpha = workstreamStore.create("Alpha");
    const beta = workstreamStore.create("Beta");
    const child = workstreamStore.create("Child", "", beta.id);
    see("t1", "t2");
    workstreamStore.assign("t1", alpha.id);
    workstreamStore.assign("t2", child.id);
    workstreamStore.bindGroup("sec_a", alpha.id);
    workstreamStore.bindGroup("sec_c", child.id);
    const snapshot = snapshotWorkstreams(db, 1);
    workstreamStore.merge(alpha.id, child.id);
    workstreamStore.rename(beta.id, "Alpha");
    workstreamStore.create("Gamma", "", null);
    const after = workstreamsFingerprint(db);
    // The organizer binds and unbinds workstreams on its own afterwards.
    workstreamStore.bindGroup("sec_g", workstreamStore.resolve("Gamma")!.id);
    expect(restoreWorkstreams(db, snapshot, after)).toBe(true);
    expect(
      workstreamStore
        .list()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["Alpha", "Beta", "Child"]);
    expect(workstreamStore.assignment("t1").workstreamId).toBe(alpha.id);
    expect(workstreamStore.getById(child.id)?.parentId).toBe(beta.id);
    expect(workstreamStore.groups().get("sec_c")).toBe(child.id);
  });

  it("keeps later learned projects while undoing a tree edit, but guards manual project changes", () => {
    const { db, workstreamStore } = store();
    const workstream = workstreamStore.create("Alpha");
    const snapshot = snapshotWorkstreams(db, 1);
    workstreamStore.rename(workstream.id, "Beta");
    const fingerprint = workstreamsFingerprint(db);
    workstreamStore.edit(workstream.id, {
      projectId: "project",
      projectSource: "learned",
    });
    expect(workstreamsFingerprint(db)).toBe(fingerprint);
    expect(restoreWorkstreams(db, snapshot, fingerprint)).toBe(true);
    expect(workstreamStore.getById(workstream.id)).toMatchObject({
      name: "Alpha",
      projectId: "project",
      projectSource: "learned",
    });
    const nextSnapshot = snapshotWorkstreams(db, 2);
    workstreamStore.rename(workstream.id, "Beta");
    const nextFingerprint = workstreamsFingerprint(db);
    workstreamStore.updateMetadata(workstream.id, { projectId: "project" });
    expect(restoreWorkstreams(db, nextSnapshot, nextFingerprint)).toBe(false);
  });

  it("restores nothing once the workstreams changed again", () => {
    const { db, workstreamStore } = store();
    const alpha = workstreamStore.create("Alpha");
    const snapshot = snapshotWorkstreams(db, 1);
    workstreamStore.rename(alpha.id, "Beta");
    const after = workstreamsFingerprint(db);
    workstreamStore.create("Gamma");
    expect(restoreWorkstreams(db, snapshot, after)).toBe(false);
    expect(workstreamStore.getById(alpha.id)?.name).toBe("Beta");
  });
});
