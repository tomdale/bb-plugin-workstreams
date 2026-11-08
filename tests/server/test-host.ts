import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { writeFileSync } from "node:fs";
import { openDatabase } from "../../src/server/db.ts";

/**
 * A disposable SDK host with a real, disk-backed SQLite database. Disabling
 * fsync preserves SQL, migrations, transactions, and reopen behavior; these
 * tests do not simulate power loss or verify crash durability.
 */
export const createTestPluginHost: typeof createFakePluginHost = (...args) => {
  const host = createFakePluginHost(...args);
  host.bb.storage.database().pragma("synchronous = OFF");
  return host;
};

let schema: Promise<Buffer> | undefined;

async function migratedSchema(): Promise<Buffer> {
  const source = createTestPluginHost();
  try {
    return openDatabase(source.bb).serialize();
  } finally {
    await source.harness.lifecycle.dispose();
  }
}

/**
 * An independent disk-backed host starting from the current empty schema.
 * Only the schema bytes are shared, once per test module; plugin installation,
 * connections, transactions, rows, and host registrations remain independent.
 * Migration tests use createTestPluginHost to start with an empty database.
 */
export async function createInitializedTestPluginHost(
  ...args: Parameters<typeof createFakePluginHost>
): Promise<ReturnType<typeof createFakePluginHost>> {
  const image = await (schema ??= migratedSchema());
  const host = createTestPluginHost(...args);
  try {
    const db = host.bb.storage.database();
    const path = db.name;
    db.close();
    writeFileSync(path, image);
    host.bb.storage.database().pragma("synchronous = OFF");
    return host;
  } catch (error) {
    await host.harness.lifecycle.dispose();
    throw error;
  }
}
