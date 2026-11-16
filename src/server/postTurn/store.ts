/**
 * Accepted enhanced documents, one per assistant message. A row is written
 * once, after the document passed validation, and is read back unchanged on
 * every later view, so a reload or a scroll never calls a model again. Rows
 * leave with their thread.
 */
import { validateDocument } from "../../domain/postTurn/document.ts";
import {
  documentTopicSchema,
  type DocumentTopic,
  type StoredPresentation,
} from "../../domain/postTurn/message.ts";
import type { Database } from "../db.ts";

type Row = {
  message_id: string;
  thread_id: string;
  turn_id: string;
  topic: string | null;
  document: string;
  created_at: number;
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
        `INSERT INTO ws_post_turn_document (message_id, thread_id, turn_id, topic, document, created_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`,
      )
      .run(
        entry.messageId,
        entry.threadId,
        entry.turnId,
        entry.topic ? JSON.stringify(entry.topic) : null,
        JSON.stringify(entry.document),
        entry.createdAt,
      );
    return result.changes > 0;
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
      let raw: unknown;
      let topic: DocumentTopic | null = null;
      try {
        raw = JSON.parse(row.document);
        if (row.topic) {
          const parsed = documentTopicSchema.safeParse(JSON.parse(row.topic));
          topic = parsed.success ? parsed.data : null;
        }
      } catch {
        return [];
      }
      const valid = validateDocument(raw);
      if (!valid.ok) return [];
      return [
        {
          messageId: row.message_id,
          threadId: row.thread_id,
          turnId: row.turn_id,
          topic,
          document: valid.document,
          createdAt: row.created_at,
        },
      ];
    });
  }

  /** Removes a thread's documents; the number removed. */
  forget(threadId: string): number {
    return this.db
      .prepare("DELETE FROM ws_post_turn_document WHERE thread_id = ?")
      .run(threadId).changes;
  }
}
