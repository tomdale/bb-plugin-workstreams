import { existsSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { openDatabase, getMeta, setMeta } from "../../src/server/db.ts";
import {
  createInitializedTestPluginHost,
  createTestPluginHost,
} from "./test-host.ts";

const hosts: ReturnType<typeof createTestPluginHost>[] = [];
afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});
const fresh = () => {
  const host = createTestPluginHost();
  hosts.push(host);
  return host;
};
const initialized = async () => {
  const host = await createInitializedTestPluginHost();
  hosts.push(host);
  return host;
};

it("keeps fresh databases empty for migration and storage-boundary tests", () => {
  const host = fresh();
  const db = host.bb.storage.database();
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
  ).toEqual([]);
  expect(db.pragma("synchronous", { simple: true })).toBe(0);
  openDatabase(host.bb);
  expect(
    db.prepare("SELECT COUNT(*) AS count FROM _bb_migrations").get(),
  ).toMatchObject({ count: expect.any(Number) });
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE name='ws_meta'").get(),
  ).toEqual({ name: "ws_meta" });
});

it("clones the exact current schema and migration hashes produced from scratch", async () => {
  const source = openDatabase(fresh().bb);
  const clone = openDatabase((await initialized()).bb);
  const schema = (db: typeof source) =>
    db
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name",
      )
      .all();
  const migrations = (db: typeof source) =>
    db
      .prepare("SELECT id, statement_hash FROM _bb_migrations ORDER BY id")
      .all();
  expect(schema(clone)).toEqual(schema(source));
  expect(migrations(clone)).toEqual(migrations(source));
  expect(migrations(clone).length).toBeGreaterThan(0);
});

it("isolates concurrent hosts, rolls back transactions, and persists on reopen", async () => {
  const [a, b] = await Promise.all([initialized(), initialized()]);
  const dbA = openDatabase(a.bb);
  const dbB = openDatabase(b.bb);
  expect(dbA.name).not.toBe(dbB.name);
  setMeta(dbA, "isolated", "A");
  expect(getMeta(dbB, "isolated")).toBeNull();
  expect(() =>
    dbA.transaction(() => {
      setMeta(dbA, "isolated", "rolled back");
      throw new Error("rollback");
    })(),
  ).toThrow("rollback");
  expect(getMeta(dbA, "isolated")).toBe("A");
  dbA.close();
  expect(getMeta(openDatabase(a.bb), "isolated")).toBe("A");
  const c = await initialized();
  expect(getMeta(openDatabase(c.bb), "isolated")).toBeNull();
  const path = dbB.name;
  await b.harness.lifecycle.dispose();
  expect(existsSync(path)).toBe(false);
  expect(getMeta(openDatabase(a.bb), "isolated")).toBe("A");
});

it("still verifies migration history when the plugin opens an initialized host", async () => {
  const host = await initialized();
  host.bb.storage
    .database()
    .prepare(
      "UPDATE _bb_migrations SET statement_hash='wrong' WHERE id=(SELECT MIN(id) FROM _bb_migrations)",
    )
    .run();
  expect(() => openDatabase(host.bb)).toThrow(
    /does not match the recorded statement/,
  );
});
