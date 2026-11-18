/**
 * Accepted enhanced documents, one per assistant message. A row is written
 * once, after the document passed validation, and is read back unchanged on
 * every later view, so a reload or a scroll never calls a model again. A plan
 * document's outcome is kept beside it. Rows leave with their thread.
 */
import { validateDocument } from "../../domain/postTurn/document.ts";
import {
  documentWorkstreamSchema,
  planOutcomeSchema,
  type DocumentWorkstream,
  type PlanOutcome,
  type StoredPresentation,
} from "../../domain/postTurn/message.ts";
import type { Database } from "../db.ts";

type Row = {
  message_id: string;
  thread_id: string;
  turn_id: string;
  workstream: string | null;
  document: string;
  created_at: number;
};

type OutcomeRow = {
  message_id: string;
  kind: string;
  message: string | null;
};

const outcomeOf = (row: OutcomeRow): PlanOutcome | null => {
  const parsed = planOutcomeSchema.safeParse(
    row.kind === "replied"
      ? { kind: row.kind, message: row.message }
      : { kind: row.kind },
  );
  return parsed.success ? parsed.data : null;
};

/** At most this many documents are read for one thread view. */
const THREAD_LIMIT = 200;

export class PresentationStore {
  constructor(private readonly db: Database) {}

  has(messageId: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM ws_post_turn_document WHERE message_id = ?")
      .get(messageId);
  }

  /** Stores a document unless one is already stored; true when this call stored it. */
  save(entry: StoredPresentation): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO ws_post_turn_document (message_id, thread_id, turn_id, workstream, document, created_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`,
      )
      .run(
        entry.messageId,
        entry.threadId,
        entry.turnId,
        entry.workstream ? JSON.stringify(entry.workstream) : null,
        JSON.stringify(entry.document),
        entry.createdAt,
      );
    return result.changes > 0;
  }

  /** One message's document, validated like `list`. */
  get(messageId: string): StoredPresentation | null {
    const row = this.db
      .prepare("SELECT * FROM ws_post_turn_document WHERE message_id = ?")
      .get(messageId) as Row | undefined;
    return row ? (this.parse(row) ?? null) : null;
  }

  /**
   * A thread's documents. Each is validated again on the way out, so a row
   * written by an older or newer schema is skipped instead of drawn.
   */
  list(threadId: string): StoredPresentation[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM ws_post_turn_document WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(threadId, THREAD_LIMIT) as Row[];
    return rows.flatMap((row) => {
      const entry = this.parse(row);
      return entry ? [entry] : [];
    });
  }

  /** A thread's plan outcomes by message id. */
  outcomes(threadId: string): Map<string, PlanOutcome> {
    const rows = this.db
      .prepare(
        "SELECT message_id, kind, message FROM ws_plan_outcome WHERE thread_id = ?",
      )
      .all(threadId) as OutcomeRow[];
    const out = new Map<string, PlanOutcome>();
    for (const row of rows) {
      const outcome = outcomeOf(row);
      if (outcome) out.set(row.message_id, outcome);
    }
    return out;
  }

  /**
   * Records a plan's outcome unless it has one; true when this call recorded
   * it, so two clicks or two windows can never both send.
   */
  settle(threadId: string, messageId: string, outcome: PlanOutcome): boolean {
    return (
      this.db
        .prepare(
          `INSERT INTO ws_plan_outcome (message_id, thread_id, kind, message, created_at)
           VALUES (?, ?, ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`,
        )
        .run(
          messageId,
          threadId,
          outcome.kind,
          outcome.kind === "replied" ? outcome.message : null,
          Date.now(),
        ).changes > 0
    );
  }

  /** Reopens a plan whose answer could not be sent. */
  unsettle(messageId: string): void {
    this.db
      .prepare("DELETE FROM ws_plan_outcome WHERE message_id = ?")
      .run(messageId);
  }

  /** The thread's plans that have no outcome yet, with the turn each ended. */
  openPlans(threadId: string): { messageId: string; turnId: string }[] {
    return (
      this.db
        .prepare(
          `SELECT d.message_id, d.turn_id FROM ws_post_turn_document d
           LEFT JOIN ws_plan_outcome o ON o.message_id = d.message_id
           WHERE d.thread_id = ? AND o.message_id IS NULL
             AND json_type(d.document, '$.plan') = 'object'`,
        )
        .all(threadId) as { message_id: string; turn_id: string }[]
    ).map((row) => ({ messageId: row.message_id, turnId: row.turn_id }));
  }

  private parse(row: Row): StoredPresentation | null {
    let raw: unknown;
    let workstream: DocumentWorkstream | null = null;
    try {
      raw = JSON.parse(row.document);
      if (row.workstream) {
        const parsed = documentWorkstreamSchema.safeParse(
          JSON.parse(row.workstream),
        );
        workstream = parsed.success ? parsed.data : null;
      }
    } catch {
      return null;
    }
    const valid = validateDocument(raw);
    if (!valid.ok) return null;
    return {
      messageId: row.message_id,
      threadId: row.thread_id,
      turnId: row.turn_id,
      workstream,
      document: valid.document,
      createdAt: row.created_at,
    };
  }

  /** Removes a thread's documents and plan outcomes; the documents removed. */
  forget(threadId: string): number {
    this.db
      .prepare("DELETE FROM ws_plan_outcome WHERE thread_id = ?")
      .run(threadId);
    return this.db
      .prepare("DELETE FROM ws_post_turn_document WHERE thread_id = ?")
      .run(threadId).changes;
  }
}
