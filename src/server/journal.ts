/**
 * The journal records every change Workstreams makes or observes.
 * It backs undo and the Activity log, so each change appears once.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./db.ts";

export const sourceSchema = z.enum([
  "user",
  "external",
  "router",
  "handoff",
  "auto",
  "proposal",
  "bootstrap",
]);
export type Source = z.infer<typeof sourceSchema>;

export const actionSchema = z.enum([
  "move",
  "create-workstream",
  "rename-workstream",
  "delete-workstream",
  "undo",
  /** Several changes applied and undone together (bootstrap, proposals). */
  "batch",
  /** A retained workstream proposal entry from an earlier plugin version. */
  "proposal",
  "edit-workstream",
  "project-association",
  /** A thread started from the New thread composer. */
  "route",
  /** A thread's title kept current by analysis. */
  "retitle",
  /** Discovered topics that nothing used any more were removed. */
  "remove-topic",
  /** An organizing suggestion you accepted changed the topic tree. */
  "suggestion",
]);

export const statusSchema = z.enum([
  "applied",
  "partial",
  "undone",
  "failed",
  "pending",
  "dismissed",
]);

const projectAssociationSchema = z.object({
  projectId: z.string().nullable(),
  source: z.enum(["manual", "learned", "disabled"]).nullable(),
});

const stepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project-association"),
    entityId: z.string(),
    from: projectAssociationSchema,
    to: projectAssociationSchema.extend({ revision: z.number() }),
    disableLearning: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("restore-section"),
    sectionId: z.string(),
    name: z.string(),
    archivedThreads: z.array(
      z.object({ id: z.string(), archivedAt: z.number() }),
    ),
    metadata: z.object({
      description: z.string().nullable(),
      aliases: z.array(z.string()),
      source: z.enum(["user", "generated"]),
      createdBy: z.enum(["user", "workstreams"]),
    }),
  }),
  z.object({
    kind: z.literal("metadata"),
    sectionId: z.string(),
    from: z.object({
      description: z.string().nullable(),
      aliases: z.array(z.string()),
      source: z.enum(["user", "generated"]),
    }),
    to: z.object({
      description: z.string().nullable(),
      aliases: z.array(z.string()),
      source: z.enum(["user", "generated"]),
      revision: z.number(),
    }),
  }),
  z.object({
    kind: z.literal("move"),
    moves: z.array(
      z.object({
        threadId: z.string(),
        from: z.string().nullable(),
        to: z.string().nullable(),
      }),
    ),
  }),
  z.object({
    kind: z.literal("delete-section"),
    sectionId: z.string(),
    /**
     * Set inside a batch: an undo that finds the section still in use skips
     * it instead of failing the whole batch.
     */
    inBatch: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("retitle"),
    threadId: z.string(),
    /** The thread's own title before; null when it was untitled. */
    from: z.string().nullable(),
    to: z.string(),
  }),
  z.object({
    kind: z.literal("rename-section"),
    sectionId: z.string(),
    from: z.string(),
    to: z.string(),
  }),
  z.object({
    /** Puts the topic tree back as a snapshot recorded it. */
    kind: z.literal("restore-topics"),
    snapshotId: z.string(),
    /**
     * The topic tree and assignments the change left (see
     * `topicsFingerprint`); any later change to them blocks undo.
     */
    fingerprint: z.string(),
  }),
]);
export type UndoStep = z.infer<typeof stepSchema>;

const undoSchema = z.union([
  stepSchema,
  /** Undone in reverse order as one change. */
  z.object({ kind: z.literal("batch"), steps: z.array(stepSchema) }),
]);

const refSchema = z.object({ id: z.string(), name: z.string() });

export const entrySchema = z.object({
  id: z.string(),
  at: z.number(),
  action: actionSchema,
  source: sourceSchema,
  status: statusSchema,
  rationale: z.string(),
  threads: z.array(refSchema),
  workstreams: z.array(refSchema),
  undo: undoSchema.nullable(),
  detail: z.string().nullable(),
});
export type JournalEntry = z.infer<typeof entrySchema>;

export type NewEntry = Omit<JournalEntry, "id" | "at" | "detail" | "status"> &
  Partial<Pick<JournalEntry, "detail" | "status">>;

const RATIONALE_MAX = 120;
const RETAIN_MS = 90 * 24 * 60 * 60 * 1000;
const RETAIN_ENTRIES = 2000;

type Row = {
  id: string;
  at: number;
  action: string;
  source: string;
  status: string;
  rationale: string;
  subject: string;
  undo: string | null;
  detail: string | null;
};

function fromRow(row: Row): JournalEntry {
  const subject = JSON.parse(row.subject) as {
    threads: { id: string; name: string }[];
    workstreams: { id: string; name: string }[];
  };
  return entrySchema.parse({
    id: row.id,
    at: row.at,
    action: row.action,
    source: row.source,
    status: row.status,
    rationale: row.rationale,
    threads: subject.threads,
    workstreams: subject.workstreams,
    undo: row.undo ? JSON.parse(row.undo) : null,
    detail: row.detail,
  });
}

export class Journal {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  add(entry: NewEntry): JournalEntry {
    const full: JournalEntry = {
      status: "applied",
      detail: null,
      ...entry,
      id: randomUUID(),
      at: this.now(),
      rationale: clip(entry.rationale),
    };
    this.db
      .prepare(
        `INSERT INTO ws_journal (id, at, action, source, status, rationale, subject, undo, detail)
         VALUES (@id, @at, @action, @source, @status, @rationale, @subject, @undo, @detail)`,
      )
      .run({
        id: full.id,
        at: full.at,
        action: full.action,
        source: full.source,
        status: full.status,
        rationale: full.rationale,
        subject: JSON.stringify({
          threads: full.threads,
          workstreams: full.workstreams,
        }),
        undo: full.undo ? JSON.stringify(full.undo) : null,
        detail: full.detail,
      });
    this.prune();
    return full;
  }

  get(id: string): JournalEntry | null {
    const row = this.db
      .prepare("SELECT * FROM ws_journal WHERE id = ?")
      .get(id) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  list(
    options: {
      limit?: number;
      before?: number;
      external?: boolean;
      since?: number;
    } = {},
  ): JournalEntry[] {
    return this.window(options).entries;
  }

  window(
    options: {
      limit?: number;
      before?: number;
      external?: boolean;
      since?: number;
    } = {},
  ): { entries: JournalEntry[]; hasMore: boolean; limit: number } {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const rows = this.db
      .prepare(
        `SELECT * FROM ws_journal
         WHERE at < @before AND at >= @since
           AND (@external = 1 OR source <> 'external')
         ORDER BY at DESC, rowid DESC LIMIT @limitPlusOne`,
      )
      .all({
        before: options.before ?? Number.MAX_SAFE_INTEGER,
        since: options.since ?? 0,
        external: options.external ? 1 : 0,
        limitPlusOne: limit + 1,
      }) as Row[];
    const hasMore = rows.length > limit;
    return {
      entries: rows.slice(0, limit).map(fromRow),
      hasMore,
      limit,
    };
  }

  markUndone(id: string): void {
    this.db
      .prepare("UPDATE ws_journal SET status = 'undone' WHERE id = ?")
      .run(id);
  }

  private prune(): void {
    this.db
      .prepare(
        `DELETE FROM ws_journal WHERE at < @cutoff OR id NOT IN (
           SELECT id FROM ws_journal ORDER BY at DESC, rowid DESC LIMIT @keep)`,
      )
      .run({ cutoff: this.now() - RETAIN_MS, keep: RETAIN_ENTRIES });
  }
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= RATIONALE_MAX
    ? flat
    : `${flat.slice(0, RATIONALE_MAX - 1)}…`;
}
