import { expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openDatabase } from "../../src/server/db.ts";
it("upgrades populated storage while preserving workstreams and activity", async () => {
  const host = createFakePluginHost({ pluginId: "storage-upgrade" });
  try {
    const migrate = host.bb.storage.migrate.bind(host.bb.storage);
    const spy = vi
      .spyOn(host.bb.storage, "migrate")
      .mockImplementation((db, migrations) => {
        const boundary = migrations.indexOf(
          "DROP TABLE IF EXISTS ws_notebook_run_dependency",
        );
        return migrate(db, migrations.slice(0, boundary));
      });
    const db = openDatabase(host.bb);
    db.prepare(
      "INSERT INTO ws_snooze(key,evidence_count,at) VALUES ('proposal-key',1,1)",
    ).run();
    db.prepare(
      "INSERT INTO ws_notebook(thread_id,title,text,updated_at) VALUES ('t','Task','Private learned material',1)",
    ).run();
    db.prepare(
      "INSERT INTO ws_workstream(section_id,created_by,created_at,updated_at) VALUES ('s','user',1,1)",
    ).run();
    db.prepare(
      "INSERT INTO ws_meta(key,value) VALUES ('thread-snoozes','{}')",
    ).run();
    spy.mockRestore();
    openDatabase(host.bb);
    expect(db.prepare("SELECT section_id FROM ws_workstream").all()).toEqual([
      { section_id: "s" },
    ]);
    expect(
      db.prepare("SELECT value FROM ws_meta WHERE key='thread-snoozes'").get(),
    ).toEqual({ value: "{}" });
    expect(() => db.prepare("SELECT * FROM ws_notebook").all()).toThrow();
    expect(() => db.prepare("SELECT * FROM ws_snooze").all()).toThrow();
  } finally {
    await host.harness.lifecycle.dispose();
  }
});
it("installs with current storage and no retired state or banner tables", async () => {
  const host = createFakePluginHost({ pluginId: "storage-retirement" });
  try {
    const db = openDatabase(host.bb);
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(names).not.toContain("state");
    expect(names).not.toContain("banners");
    expect(names).not.toContain("ws_understanding_observation");
    expect(names.some((n) => n.startsWith("ws_notebook"))).toBe(false);
    expect(names).not.toContain("ws_proposal");
    expect(names).not.toContain("ws_snooze");
    expect(names).not.toContain("ws_recap");
    expect(names).not.toContain("ws_name_observation");
    expect(names).not.toContain("ws_archive_dismissed");
    expect(names).toContain("ws_agent_recap");
    expect(names).toContain("ws_journal");
  } finally {
    await host.harness.lifecycle.dispose();
  }
});
it("removes populated name observations while preserving analysis and topics", async () => {
  const host = createFakePluginHost({ pluginId: "name-retirement" });
  try {
    const migrate = host.bb.storage.migrate.bind(host.bb.storage);
    const spy = vi
      .spyOn(host.bb.storage, "migrate")
      .mockImplementation((db, migrations) => {
        const boundary = migrations.indexOf(
          "DROP TABLE IF EXISTS ws_name_observation",
        );
        expect(boundary).toBeGreaterThan(0);
        return migrate(db, migrations.slice(0, boundary));
      });
    const db = openDatabase(host.bb);
    db.prepare(
      "INSERT INTO ws_name_observation(thread_id, revision, at, names) VALUES ('t', 1, 2, ?)",
    ).run(JSON.stringify({ products: ["Lumen"], features: [] }));
    db.prepare(
      "INSERT INTO ws_analysis(thread_id, revision, at, result) VALUES ('t', 1, 2, ?)",
    ).run(JSON.stringify({ goal: "Fixing Lumen" }));
    db.prepare(
      "INSERT INTO ws_corpus_subject(thread_id, entity_id, source) VALUES ('t', NULL, 'manual')",
    ).run();
    spy.mockRestore();
    openDatabase(host.bb);
    expect(() =>
      db.prepare("SELECT * FROM ws_name_observation").all(),
    ).toThrow();
    expect(
      db
        .prepare(
          "SELECT revision, result FROM ws_analysis WHERE thread_id = 't'",
        )
        .get(),
    ).toEqual({
      revision: 1,
      result: JSON.stringify({ goal: "Fixing Lumen" }),
    });
    expect(
      db
        .prepare("SELECT source FROM ws_corpus_subject WHERE thread_id = 't'")
        .get(),
    ).toEqual({ source: "manual" });
    openDatabase(host.bb);
  } finally {
    await host.harness.lifecycle.dispose();
  }
});
it("keeps title ownership when the columns nothing reads are dropped", async () => {
  const host = createFakePluginHost({ pluginId: "storage-titles" });
  try {
    const migrate = host.bb.storage.migrate.bind(host.bb.storage);
    const spy = vi
      .spyOn(host.bb.storage, "migrate")
      .mockImplementation((db, migrations) => {
        // Storage as it was while titles recorded when and how they were written.
        const boundary = migrations.indexOf(
          "ALTER TABLE ws_title DROP COLUMN provisional",
        );
        expect(boundary).toBeGreaterThan(0);
        return migrate(db, migrations.slice(0, boundary));
      });
    const db = openDatabase(host.bb);
    db.prepare(
      "INSERT INTO ws_title(thread_id,observed,written,locked,retitled_at,provisional) VALUES ('t1','Ours','Ours',0,5,1),('t2','Mine',NULL,1,NULL,0)",
    ).run();
    spy.mockRestore();
    openDatabase(host.bb);
    expect(
      db.prepare("SELECT * FROM ws_title ORDER BY thread_id").all(),
    ).toEqual([
      { thread_id: "t1", observed: "Ours", written: "Ours", locked: 0 },
      { thread_id: "t2", observed: "Mine", written: null, locked: 1 },
    ]);
  } finally {
    await host.harness.lifecycle.dispose();
  }
});
it("rewrites stored review steps and drops the retired recap title", async () => {
  const host = createFakePluginHost({ pluginId: "recap-item-shape" });
  try {
    const migrate = host.bb.storage.migrate.bind(host.bb.storage);
    const spy = vi
      .spyOn(host.bb.storage, "migrate")
      .mockImplementation((db, migrations) => {
        // Recaps as they were while an item could be `{ step, expect }` and a
        // Waiting title could be stored as `task`.
        const boundary = migrations.findIndex(
          (migration) =>
            typeof migration === "string" &&
            migration.includes("json_group_array"),
        );
        expect(boundary).toBeGreaterThan(0);
        return migrate(db, migrations.slice(0, boundary));
      });
    const db = openDatabase(host.bb);
    const insert = db.prepare(
      "INSERT INTO ws_agent_recap(thread_id, recap) VALUES (?, ?)",
    );
    insert.run(
      "t1",
      JSON.stringify({
        id: "r1",
        turnId: "turn-1",
        at: 1,
        state: "review",
        goal: "One",
        latest: [],
        review: [
          { step: "Open settings", expect: "The panel opens" },
          "Read it",
        ],
        links: [],
      }),
    );
    insert.run(
      "t2",
      JSON.stringify({
        id: "r2",
        turnId: "turn-2",
        at: 2,
        state: "waiting",
        goal: "Waiting for tests",
        task: "Retired title",
        tasks: ["Retired list"],
        review: [],
        links: [],
      }),
    );
    spy.mockRestore();
    openDatabase(host.bb);
    const stored = (threadId: string) =>
      JSON.parse(
        (
          db
            .prepare("SELECT recap FROM ws_agent_recap WHERE thread_id = ?")
            .get(threadId) as { recap: string }
        ).recap,
      );
    expect(stored("t1").review).toEqual([
      { text: "Open settings", detail: "The panel opens" },
      "Read it",
    ]);
    expect(stored("t2")).not.toHaveProperty("task");
    expect(stored("t2")).not.toHaveProperty("tasks");
    expect(stored("t2").goal).toBe("Waiting for tests");
  } finally {
    await host.harness.lifecycle.dispose();
  }
});
