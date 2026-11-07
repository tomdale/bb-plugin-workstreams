import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";

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
