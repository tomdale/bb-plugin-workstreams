/*
 * The recap and topic of threads the `state` snapshot leaves out: archived
 * and hidden threads. Their records change only through recap writes, whose
 * `changed` signal names the thread, and topic writes, which move the
 * catalog revision, so a record is read once and again only after one of
 * those, a reconnect, or a server restart.
 */
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../server/contract.ts";
import type { Recap } from "../domain/recap.ts";
import type { TopicAssignment } from "../domain/topics.ts";
import { readChangedSignal } from "../domain/changes.ts";
import { shareJson } from "./structuralSharing.ts";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

export type ThreadRecord = {
  recap: Recap | null;
  dismissed: boolean;
  assignment: TopicAssignment;
};

type Entry = {
  threadId: string;
  value: ThreadRecord | undefined;
  listeners: Set<() => void>;
  /** The catalog revision of the latest read, finished or not. */
  revision: number | null;
  stale: boolean;
  reading: boolean;
};

/** Records kept for threads no view shows, newest last. */
const RETAINED = 100;

export class ThreadRecords {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly rpc: Rpc,
    private readonly catalogRevision: () => number | null,
  ) {}

  /** The thread's record; undefined until its first read finishes. */
  snapshot(threadId: string): ThreadRecord | undefined {
    return this.entries.get(threadId)?.value;
  }

  subscribe(threadId: string, listener: () => void): () => void {
    let entry = this.entries.get(threadId);
    if (!entry) {
      entry = {
        threadId,
        value: undefined,
        listeners: new Set(),
        revision: null,
        stale: true,
        reading: false,
      };
      this.entries.set(threadId, entry);
    }
    entry.listeners.add(listener);
    this.evict();
    if (entry.revision !== this.catalogRevision()) entry.stale = true;
    this.read(entry);
    return () => {
      entry.listeners.delete(listener);
      this.evict();
    };
  }

  /** A `changed` signal: re-reads the records of the threads it names. */
  changed(payload: unknown): void {
    const threadIds = readChangedSignal(payload)?.threadIds;
    for (const threadId of threadIds ?? []) {
      const entry = this.entries.get(threadId);
      if (entry) this.stale(entry);
    }
  }

  /** The snapshot's catalog revision moved: assignments may have changed. */
  catalogChanged(): void {
    const revision = this.catalogRevision();
    for (const entry of this.entries.values())
      if (entry.revision !== revision) this.stale(entry);
  }

  /** Signals may have been missed: every record needs a fresh read. */
  invalidate(): void {
    for (const entry of this.entries.values()) this.stale(entry);
  }

  private stale(entry: Entry): void {
    entry.stale = true;
    this.read(entry);
  }

  private read(entry: Entry): void {
    if (!entry.stale || entry.reading || entry.listeners.size === 0) return;
    entry.stale = false;
    entry.reading = true;
    entry.revision = this.catalogRevision();
    void this.rpc
      .call("recap_get", { threadId: entry.threadId })
      .then(({ recap, dismissed, assignment }) => {
        const value = shareJson(entry.value, { recap, dismissed, assignment });
        if (value === entry.value) return;
        entry.value = value;
        for (const listener of entry.listeners) listener();
      })
      .catch(() => {
        // The next subscription, signal, or reconnect reads it again.
        entry.revision = null;
      })
      .finally(() => {
        entry.reading = false;
        this.read(entry);
      });
  }

  private evict(): void {
    let unused = [...this.entries].filter(
      ([, entry]) => entry.listeners.size === 0,
    ).length;
    for (const [threadId, entry] of this.entries) {
      if (unused <= RETAINED) break;
      if (entry.listeners.size > 0) continue;
      this.entries.delete(threadId);
      unused -= 1;
    }
  }
}
