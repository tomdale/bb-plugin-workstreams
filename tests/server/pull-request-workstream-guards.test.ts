import { createTestPluginHost } from "./test-host.ts";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db.ts";
import {
  restoreWorkstreams,
  snapshotWorkstreams,
  workstreamsFingerprint,
  WorkstreamStore,
} from "../../src/server/workstreams.ts";
import { WorkstreamMigration } from "../../src/server/workstreamMigration.ts";
import { Journal } from "../../src/server/journal.ts";
import { PullRequestStore } from "../../src/server/pullRequests/store.ts";
import { trackedFromRead } from "../../src/domain/pullRequests.ts";

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

function setup() {
  const host = createTestPluginHost({ pluginId: `pr-guards-${hosts.length}` });
  hosts.push(host);
  const db = openDatabase(host.bb);
  const workstreams = new WorkstreamStore(db);
  const pullRequests = new PullRequestStore(db);
  let count = 0;
  /** Tracks one pull request in the workstream; returns its row id. */
  const track = (workstreamId: string) => {
    count += 1;
    const url = `https://github.com/acme/shelves/pull/${count}`;
    const item = trackedFromRead(
      {
        id: pullRequests.newId(),
        url,
        hostname: "github.com",
        repository: "acme/shelves",
        number: count,
        workstreamId,
        threadId: "t_a",
        hostId: "host_a",
      },
      {
        number: count,
        title: "Add shelf labels",
        body: "",
        state: "OPEN",
        isDraft: false,
        baseRefName: "main",
        headRefName: "labels",
        headRefOid: "aaa",
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        mergedAt: null,
        closedAt: null,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        reviewDecision: null,
        checks: [],
      },
      Date.now(),
    );
    pullRequests.put({ item, nextPollAt: null, failures: 0 }, Date.now());
    return item.id;
  };
  return { db, workstreams, pullRequests, track };
}

describe("a workstream that tracks pull requests", () => {
  it("does not become a group, until they are untracked", () => {
    const { workstreams, pullRequests, track } = setup();
    const shelves = workstreams.create("Shelves");
    const id = track(shelves.id);
    expect(() => workstreams.create("Labels", "", shelves.id)).toThrow(
      /tracks a pull request.*pr untrack/,
    );
    expect(workstreams.workstreams(shelves.id)).toBe(0);
    expect(pullRequests.all()).toHaveLength(1);
    pullRequests.remove(id);
    expect(workstreams.create("Labels", "", shelves.id).parentId).toBe(
      shelves.id,
    );
  });

  it("does not take a workstream moved under it", () => {
    const { workstreams, track } = setup();
    const shelves = workstreams.create("Shelves");
    const racks = workstreams.create("Racks");
    track(shelves.id);
    expect(() => workstreams.move(racks.id, shelves.id)).toThrow(
      /tracks a pull request/,
    );
  });

  it("keeps a proposed child out and requests no division", () => {
    const { workstreams, pullRequests, track } = setup();
    const shelves = workstreams.create("Shelves");
    workstreams.assign("t_a", shelves.id, {
      provenance: "manual",
      evidence: null,
    });
    track(shelves.id);
    const result = workstreams.rememberProposal({
      name: "Labels",
      description: "Label printing",
      parentId: shelves.id,
      ancestors: null,
    });
    expect(result.id).toBe(shelves.id);
    expect(workstreams.workstreams(shelves.id)).toBe(0);
    expect(workstreams.divisionRequests()[shelves.id]).toBeUndefined();
    expect(pullRequests.all()).toHaveLength(1);
  });

  it("is not split into a group, until they are untracked", () => {
    const { workstreams, pullRequests, track } = setup();
    const shelves = workstreams.create("Shelves");
    workstreams.assign("t_a", shelves.id, {
      provenance: "manual",
      evidence: null,
    });
    const id = track(shelves.id);
    const division = [{ name: "Labels", description: "", threadIds: ["t_a"] }];
    expect(() => workstreams.split(shelves.id, division)).toThrow(
      /tracks a pull request.*pr untrack/,
    );
    expect(workstreams.workstreams(shelves.id)).toBe(0);
    expect(workstreams.assignment("t_a").workstreamId).toBe(shelves.id);
    expect(pullRequests.all()).toHaveLength(1);

    pullRequests.remove(id);
    workstreams.split(shelves.id, division);
    expect(workstreams.workstreams(shelves.id)).toBe(1);
  });

  it("is not merged into a group's workstreams", () => {
    const { workstreams, track } = setup();
    const group = workstreams.create("Warehouse");
    workstreams.create("Racks", "", group.id);
    const loose = workstreams.create("Loose");
    track(loose.id);
    // The merged result would hold a workstream's pull request beside workstreams.
    expect(() => workstreams.merge(loose.id, group.id)).toThrow(
      /tracked pull requests beside workstreams/,
    );
  });

  it("still merges into a workstream, taking its pull requests along and saying so", () => {
    const { workstreams, pullRequests, track } = setup();
    const a = workstreams.create("Alpha");
    const b = workstreams.create("Beta");
    let moved = 0;
    workstreams.onPullRequestsMoved = () => void moved++;
    track(a.id);
    workstreams.merge(a.id, b.id);
    expect(pullRequests.all().map((r) => r.item.workstreamId)).toEqual([b.id]);
    expect(moved).toBe(1);
  });

  it("is not deleted by undoing the workstream's creation, or turned into a group by undo", () => {
    const { db, workstreams, pullRequests, track } = setup();
    const alpha = workstreams.create("Alpha");
    const snapshot = snapshotWorkstreams(db, 1);
    const gamma = workstreams.create("Gamma");
    const id = track(gamma.id);
    const fingerprint = workstreamsFingerprint(db);
    expect(restoreWorkstreams(db, snapshot, fingerprint)).toBe(false);
    expect(workstreams.getById(gamma.id)).not.toBeNull();
    expect(pullRequests.get(id)).not.toBeNull();

    // Without the pull request, the same undo goes through.
    pullRequests.remove(id);
    expect(restoreWorkstreams(db, snapshot, workstreamsFingerprint(db))).toBe(
      true,
    );
    expect(workstreams.getById(gamma.id)).toBeNull();
    expect(workstreams.getById(alpha.id)).not.toBeNull();
  });
});

describe("a migration", () => {
  function migrationSetup() {
    const s = setup();
    const product = s.workstreams.create("Harbor");
    const feature = s.workstreams.create(
      "Code Review",
      "Review capability",
      product.id,
    );
    s.db
      .prepare(
        "INSERT INTO ws_workstream(id, name, description, parent_id, aliases) VALUES ('old', 'Approvals', 'Approval workflow', ?, '[]')",
      )
      .run(feature.id);
    const solo = s.workstreams.create("Solo", "A leaf");
    const migration = new WorkstreamMigration({
      db: s.db,
      workstreamStore: s.workstreams,
      journal: new Journal(s.db),
    });
    return { ...s, product, feature, solo, migration };
  }

  it("does not remove a workstream that tracks pull requests", () => {
    const { migration, track, pullRequests } = migrationSetup();
    const row = track("old");
    const plan = migration.preview();
    expect(plan.removed.map((w) => w.id)).toEqual(["old"]);
    expect(plan.blockers).toContainEqual({
      threadId: null,
      workstreamId: "old",
      reason: expect.stringContaining("pr untrack"),
    });
    expect(() => migration.apply(plan.id)).toThrow(/blocker/);
    expect(pullRequests.get(row)?.item.workstreamId).toBe("old");
  });

  it("removes it once they are untracked", () => {
    const { migration, track, pullRequests, workstreams } = migrationSetup();
    pullRequests.remove(track("old"));
    const plan = migration.preview();
    expect(plan.blockers).toEqual([]);
    migration.apply(plan.id);
    expect(workstreams.getById("old")).toBeNull();
  });

  it("does not make a workstream that tracks pull requests a group", () => {
    const { migration, track, solo, product, pullRequests } = migrationSetup();
    track(solo.id);
    const plan = migration.preview({
      newWorkstreams: [
        {
          key: "extra",
          name: "Extra",
          description: "Beneath Solo",
          parentId: solo.id,
        },
        {
          key: "other",
          name: "Other",
          description: "Beneath Harbor",
          parentId: product.id,
        },
      ],
    });
    expect(plan.blockers).toEqual([
      {
        threadId: null,
        workstreamId: solo.id,
        reason: expect.stringContaining("can't become a group"),
      },
    ]);
    expect(() => migration.apply(plan.id)).toThrow(/blocker/);
    expect(pullRequests.all()).toHaveLength(1);
  });

  it("refuses to apply a preview when a pull request was tracked after it", () => {
    const { migration, track, workstreams } = migrationSetup();
    const plan = migration.preview();
    expect(plan.blockers).toEqual([]);
    track("old");
    expect(() => migration.apply(plan.id)).toThrow(
      "Tracked pull requests changed",
    );
    expect(workstreams.getById("old")).not.toBeNull();
  });
});
