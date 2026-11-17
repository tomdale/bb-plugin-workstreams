/**
 * Tracked pull requests in the plugin database: the latest snapshot of each,
 * with the polling state beside it. A pull request is one row per workstream;
 * the row's workstream is the one it was linked in and does not follow threads.
 */
import { randomUUID } from "node:crypto";
import {
  trackedPullRequestSchema,
  type TrackedPullRequest,
} from "../../domain/pullRequests.ts";
import type { Database } from "../db.ts";

export type StoredPullRequest = {
  item: TrackedPullRequest;
  /** When the next read is due; null once the pull request ended. */
  nextPollAt: number | null;
  /** Reads in a row that failed. */
  failures: number;
};

type Row = {
  /** The workstream's source of truth: a merge updates this column and leaves the snapshot's copy behind. */
  workstream_id: string;
  data: string;
  next_poll_at: number | null;
  failures: number;
};

function decode(row: Row): StoredPullRequest | null {
  try {
    const parsed = trackedPullRequestSchema.safeParse(JSON.parse(row.data));
    return parsed.success
      ? {
          item: { ...parsed.data, workstreamId: row.workstream_id },
          nextPollAt: row.next_poll_at,
          failures: row.failures,
        }
      : null;
  } catch {
    return null;
  }
}

export class PullRequestStore {
  constructor(private readonly db: Database) {}

  /** Every stored row; one that no longer parses is dropped. */
  all(): StoredPullRequest[] {
    const rows = this.db
      .prepare(
        "SELECT id, workstream_id, data, next_poll_at, failures FROM ws_pull_request ORDER BY created_at, id",
      )
      .all() as (Row & { id: string })[];
    const out: StoredPullRequest[] = [];
    for (const row of rows) {
      const stored = decode(row);
      if (stored) out.push(stored);
      else this.remove(row.id);
    }
    return out;
  }

  get(id: string): StoredPullRequest | null {
    const row = this.db
      .prepare(
        "SELECT workstream_id, data, next_poll_at, failures FROM ws_pull_request WHERE id = ?",
      )
      .get(id) as Row | undefined;
    return row ? decode(row) : null;
  }

  find(workstreamId: string, url: string): StoredPullRequest | null {
    const row = this.db
      .prepare(
        "SELECT workstream_id, data, next_poll_at, failures FROM ws_pull_request WHERE workstream_id = ? AND url = ?",
      )
      .get(workstreamId, url) as Row | undefined;
    return row ? decode(row) : null;
  }

  /** A new id for a row that does not exist yet. */
  newId(): string {
    return `pr_${randomUUID()}`;
  }

  /** Writes a row, replacing the one with its id. */
  put(stored: StoredPullRequest, now: number): void {
    const { item } = stored;
    this.db
      .prepare(
        `INSERT INTO ws_pull_request
           (id, workstream_id, url, host_id, data, next_poll_at, failures, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workstream_id = excluded.workstream_id, url = excluded.url,
           host_id = excluded.host_id, data = excluded.data,
           next_poll_at = excluded.next_poll_at, failures = excluded.failures,
           expires_at = excluded.expires_at`,
      )
      .run(
        item.id,
        item.workstreamId,
        item.url,
        item.hostId,
        JSON.stringify(item),
        stored.nextPollAt,
        stored.failures,
        item.expiresAt,
        now,
      );
  }

  remove(id: string): boolean {
    return (
      this.db.prepare("DELETE FROM ws_pull_request WHERE id = ?").run(id)
        .changes > 0
    );
  }

  /** Drops ended pull requests whose hour is up; returns how many. */
  pruneExpired(now: number): number {
    return this.db
      .prepare(
        "DELETE FROM ws_pull_request WHERE expires_at IS NOT NULL AND expires_at <= ?",
      )
      .run(now).changes;
  }

  /** Drops rows of workstreams that no longer exist; returns how many. */
  pruneOrphans(): number {
    return this.db
      .prepare(
        "DELETE FROM ws_pull_request WHERE workstream_id NOT IN (SELECT id FROM ws_workstream)",
      )
      .run().changes;
  }

  /** The soonest expiry among ended pull requests, if any. */
  nextExpiry(): number | null {
    const row = this.db
      .prepare(
        "SELECT MIN(expires_at) AS at FROM ws_pull_request WHERE expires_at IS NOT NULL",
      )
      .get() as { at: number | null } | undefined;
    return row?.at ?? null;
  }
}
