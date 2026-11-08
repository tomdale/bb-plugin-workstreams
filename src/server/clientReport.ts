/**
 * The last client's report of what its bb draws, stored so the reply contract
 * survives a plugin reload. bb calls a client's report whenever its realtime
 * link connects, so a bb that can't draw reply blocks corrects a stored `true`
 * as soon as it connects; no stored report reads as `false`, which keeps
 * agents on the recap tool.
 */
import { z } from "zod";
import { getMeta, setMeta, type Database } from "./db.ts";

const KEY = "clientReport";
const reportSchema = z.object({ messageBlocks: z.boolean() }).strict();

export type ClientReport = z.infer<typeof reportSchema>;

export function loadClientReport(db: Database): ClientReport {
  const raw = getMeta(db, KEY);
  if (raw === null) return { messageBlocks: false };
  try {
    const parsed = reportSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { messageBlocks: false };
  } catch {
    return { messageBlocks: false };
  }
}

/** Stores a report, so the next load starts from what this client drew. */
export function saveClientReport(db: Database, report: ClientReport): void {
  const stored = loadClientReport(db);
  if (stored.messageBlocks === report.messageBlocks) return;
  setMeta(db, KEY, JSON.stringify(report));
}
