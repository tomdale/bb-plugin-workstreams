import { describe, expect, it } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import {
  loadClientReport,
  saveClientReport,
} from "../../src/server/clientReport.ts";

async function database() {
  const w = await fakeWorld();
  return { w, db: w.bb.storage.database() };
}

describe("client report", () => {
  it("reads as no report before a client connects", async () => {
    const { w, db } = await database();
    expect(loadClientReport(db)).toEqual({ messageBlocks: false });
    await w.harness.lifecycle.dispose();
  });

  it("round-trips what a client draws", async () => {
    const { w, db } = await database();
    saveClientReport(db, { messageBlocks: true });
    expect(loadClientReport(db)).toEqual({ messageBlocks: true });
    saveClientReport(db, { messageBlocks: false });
    expect(loadClientReport(db)).toEqual({ messageBlocks: false });
    await w.harness.lifecycle.dispose();
  });

  it("falls back to no report when the stored value is unusable", async () => {
    const { w, db } = await database();
    for (const stored of [
      "not json",
      JSON.stringify({ messageBlocks: "yes" }),
      "{}",
    ]) {
      db.prepare(
        "INSERT INTO ws_meta (key, value) VALUES ('clientReport', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(stored);
      expect(loadClientReport(db)).toEqual({ messageBlocks: false });
    }
    await w.harness.lifecycle.dispose();
  });
});
