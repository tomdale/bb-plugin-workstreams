import { expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../../src/server/db.ts";
import { createTestPluginHost } from "./test-host.ts";

/**
 * Opens storage as it stood before the terminology renames, lets `seed`
 * write rows in the old shapes, then applies the remaining migrations.
 */
async function upgraded(
  pluginId: string,
  seed: (db: Database) => void,
  check: (db: Database) => void,
) {
  const host = createTestPluginHost({ pluginId });
  try {
    const migrate = host.bb.storage.migrate.bind(host.bb.storage);
    const spy = vi
      .spyOn(host.bb.storage, "migrate")
      .mockImplementation((db, migrations) => {
        const boundary = migrations.findIndex((sql) =>
          sql.includes("WHEN 'needs_decision' THEN 'needs-input'"),
        );
        expect(boundary).toBeGreaterThan(0);
        return migrate(db, migrations.slice(0, boundary));
      });
    const db = openDatabase(host.bb);
    seed(db);
    spy.mockRestore();
    openDatabase(host.bb);
    check(db);
  } finally {
    await host.harness.lifecycle.dispose();
  }
}

const meta = (db: Database, key: string) =>
  JSON.parse(
    (
      db.prepare("SELECT value FROM ws_meta WHERE key = ?").get(key) as {
        value: string;
      }
    ).value,
  );

it("renames stored statuses, titles, goals, and asks", async () => {
  const analysis = (result: object) => JSON.stringify(result);
  await upgraded(
    "terminology-analysis",
    (db) => {
      const insert = db.prepare(
        "INSERT INTO ws_analysis(thread_id, revision, at, result) VALUES (?, 1, 1, ?)",
      );
      insert.run(
        "ask",
        analysis({
          state: "needs-input",
          ask: "OIDC or SAML?",
          goal: "Adding SSO",
          threadGoal: "Let users sign in with their company account.",
        }),
      );
      insert.run(
        "progress",
        analysis({ state: "in_progress", ask: null, goal: null }),
      );
      insert.run(
        "waiting",
        analysis({ state: "in_progress", reported: true, goal: "Porting" }),
      );
      insert.run(
        "done",
        analysis({ state: "complete", goal: "Fixing", threadGoal: null }),
      );
      insert.run("blocked", analysis({ state: "blocked" }));
    },
    (db) => {
      const rows = Object.fromEntries(
        (
          db.prepare("SELECT thread_id, result FROM ws_analysis").all() as {
            thread_id: string;
            result: string;
          }[]
        ).map((row) => [row.thread_id, JSON.parse(row.result)]),
      );
      expect(rows.ask).toEqual({
        state: "needs-input",
        ask: "OIDC or SAML?",
        title: "Adding SSO",
        goal: "Let users sign in with their company account.",
      });
      expect(rows.progress).toEqual({
        state: "needs-input",
        ask: null,
        title: null,
      });
      expect(rows.waiting).toEqual({
        state: "waiting",
        reported: true,
        title: "Porting",
      });
      expect(rows.done).toEqual({
        state: "complete",
        title: "Fixing",
        goal: null,
      });
      expect(rows.blocked).toEqual({ state: "blocked" });
    },
  );
});

it("renames a stored recap's goal to its headline", async () => {
  await upgraded(
    "terminology-recap",
    (db) =>
      db
        .prepare("INSERT INTO ws_agent_recap(thread_id, recap) VALUES (?, ?)")
        .run("t", JSON.stringify({ state: "complete", goal: "Fixed it" })),
    (db) => {
      const row = db
        .prepare("SELECT recap FROM ws_agent_recap WHERE thread_id = 't'")
        .get() as { recap: string };
      expect(JSON.parse(row.recap)).toEqual({
        state: "complete",
        headline: "Fixed it",
      });
    },
  );
});

it("renames preference keys and wake events, keeping their values", async () => {
  await upgraded(
    "terminology-prefs",
    (db) => {
      const insert = db.prepare(
        "INSERT INTO ws_meta(key, value) VALUES (?, ?)",
      );
      insert.run(
        "prefs",
        JSON.stringify({
          sidebar: { needsYouCount: "always" },
          colors: {
            needsYou: { kind: "custom", color: "#ff00ff" },
            failure: { kind: "theme", color: "warning" },
          },
        }),
      );
      insert.run(
        "snooze-prefs",
        JSON.stringify({
          events: {
            "needs-you": false,
            done: true,
            error: false,
            "delegate-needs-you": false,
            "delegate-stalled": true,
            review: false,
          },
        }),
      );
    },
    (db) => {
      expect(meta(db, "prefs")).toEqual({
        sidebar: { needsYouCount: "always" },
        colors: {
          needsInput: { kind: "custom", color: "#ff00ff" },
          failed: { kind: "theme", color: "warning" },
        },
      });
      expect(meta(db, "snooze-prefs")).toEqual({
        events: {
          "needs-input": false,
          blocked: false,
          complete: true,
          failed: false,
          "child-needs-input": false,
          "child-stalled": true,
          review: false,
        },
      });
    },
  );
});
