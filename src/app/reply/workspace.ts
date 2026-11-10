import { useCallback, useSyncExternalStore } from "react";
import {
  useSdk,
  type PluginBrowserBbSdk,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { RecapFiles } from "../../domain/recap.ts";
import { useSidebarThread } from "../useStableSidebarThreads.ts";
import type { ReplyDocument } from "./Evidence.tsx";

/** Where a thread's reply links resolve: its environment's checkout. */
export type ReplyWorkspace = {
  document: NonNullable<ReplyDocument>;
  files: RecapFiles;
};

/**
 * A thread's workspace as the store knows it: `undefined` until its first
 * lookup settles, `null` when the thread has no usable environment (or the
 * lookup failed), otherwise the workspace.
 */
export type WorkspaceSnapshot = ReplyWorkspace | null | undefined;

type Entry = {
  value: WorkspaceSnapshot;
  /** The environment the last lookup reported, so its own events revalidate. */
  environmentId: string | null;
  listeners: Set<() => void>;
  reading: Promise<void> | null;
  /** A revalidation was requested; the read loop runs again until clear. */
  dirty: boolean;
  /** The value may be out of date: revalidate when a reader next arrives. */
  stale: boolean;
};

/** How long a thread's replies wait for its first workspace lookup. */
const FIRST_LOOKUP_WAIT_MS = 2000;

/** Environment changes that cannot move a checkout or change its host. */
const ROUTINE_ENVIRONMENT_CHANGES = new Set([
  "git-refs-changed",
  "work-status-changed",
  "thread-storage-changed",
]);

/** The workspace for a thread in an environment with a known checkout. */
function workspaceOf(
  threadId: string,
  environment: { id: string; path: string; hostId: string | null },
): ReplyWorkspace {
  return {
    files: {
      environmentId: environment.id,
      root: environment.path,
      hostId: environment.hostId,
    },
    document: {
      threadId,
      rootPath: environment.path,
      target: {
        kind: "workspace",
        environmentId: environment.id,
        path: "__reply__.md",
      },
    },
  };
}

function sameWorkspace(a: ReplyWorkspace, b: ReplyWorkspace): boolean {
  return (
    a.document.threadId === b.document.threadId &&
    a.files.environmentId === b.files.environmentId &&
    a.files.root === b.files.root &&
    a.files.hostId === b.files.hostId
  );
}

/**
 * Every thread's workspace for one plugin client, read once per window.
 *
 * A thread's environment almost never changes, yet every reply block and
 * subagent delivery card needs it, and BB's Markdown renderer changes element
 * type when its document appears, remounting the block's whole body. One
 * lookup per thread serves every block; BB's realtime events for the thread or
 * its environment revalidate it, and an unchanged result keeps its identity so
 * no block re-renders or remounts its Markdown.
 */
class WorkspaceStore {
  private entries = new Map<string, Entry>();
  private realtime = false;

  constructor(private readonly sdk: PluginBrowserBbSdk) {}

  snapshot(threadId: string): WorkspaceSnapshot {
    return this.entries.get(threadId)?.value;
  }

  subscribe(threadId: string, listener: () => void): () => void {
    const entry = this.entry(threadId);
    entry.listeners.add(listener);
    this.ensure(entry, threadId);
    return () => entry.listeners.delete(listener);
  }

  /**
   * Takes a thread's workspace from what the sidebar already lists, so its
   * replies draw at once instead of waiting for a lookup. Only fills a thread
   * the store knows nothing about; realtime events revalidate it like any
   * other.
   */
  seed(threadId: string, workspace: ReplyWorkspace): void {
    const entry = this.entry(threadId);
    if (entry.value !== undefined || entry.reading) return;
    entry.value = workspace;
    entry.environmentId = workspace.files.environmentId;
  }

  /** Settles once the thread's workspace is known, starting a lookup if needed. */
  async load(threadId: string): Promise<WorkspaceSnapshot> {
    const entry = this.entry(threadId);
    this.ensure(entry, threadId);
    if (entry.value === undefined) {
      await new Promise<void>((resolve) => {
        const settled = () => {
          entry.listeners.delete(settled);
          resolve();
        };
        entry.listeners.add(settled);
      });
    }
    return entry.value;
  }

  private entry(threadId: string): Entry {
    this.listen();
    let entry = this.entries.get(threadId);
    if (!entry) {
      entry = {
        value: undefined,
        environmentId: null,
        listeners: new Set(),
        reading: null,
        dirty: false,
        stale: false,
      };
      this.entries.set(threadId, entry);
    }
    return entry;
  }

  /** Look the thread up unless its value is current or already on its way. */
  private ensure(entry: Entry, threadId: string): void {
    if (entry.reading || (entry.value !== undefined && !entry.stale)) return;
    this.read(entry, threadId);
  }

  /** Revalidate now if anyone is reading; otherwise when a reader returns. */
  private invalidate(entry: Entry, threadId: string): void {
    entry.stale = true;
    if (entry.listeners.size > 0) this.read(entry, threadId);
  }

  /** Read the thread, again after any read in flight, which may predate it. */
  private read(entry: Entry, threadId: string): void {
    entry.dirty = true;
    entry.stale = false;
    if (entry.reading) return;
    entry.reading = this.fetch(entry, threadId).finally(() => {
      entry.reading = null;
    });
    if (entry.value !== undefined) return;
    // Replies wait for the first lookup. One that never answers must not hide
    // them, so they draw without a workspace and take it if it arrives.
    setTimeout(() => {
      if (entry.value !== undefined) return;
      entry.value = null;
      entry.stale = true;
      for (const listener of [...entry.listeners]) listener();
    }, FIRST_LOOKUP_WAIT_MS);
  }

  private async fetch(entry: Entry, threadId: string): Promise<void> {
    while (entry.dirty) {
      entry.dirty = false;
      let next: ReplyWorkspace | null;
      try {
        const thread = await this.sdk.threads.get({
          threadId,
          include: "environment",
        });
        const environment = "environment" in thread ? thread.environment : null;
        entry.environmentId = environment?.id ?? null;
        next =
          environment && typeof environment.path === "string"
            ? workspaceOf(threadId, {
                id: environment.id,
                path: environment.path,
                hostId: environment.hostId ?? null,
              })
            : null;
      } catch {
        // Keep a known workspace through a failed revalidation. A first lookup
        // that fails settles without one, so blocks still render, and the next
        // reader retries.
        entry.stale = true;
        if (entry.value !== undefined) continue;
        next = null;
      }
      if (entry.dirty) continue;
      const current = entry.value;
      if (current && next && sameWorkspace(current, next)) continue;
      if (current === next) continue;
      entry.value = next;
      for (const listener of [...entry.listeners]) listener();
    }
  }

  /** One realtime subscription per client covers every cached thread. */
  private listen(): void {
    if (this.realtime) return;
    this.realtime = true;
    try {
      this.sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          if (!event.changes.includes("environment-changed")) return;
          for (const [threadId, entry] of this.entries) {
            if (event.id === undefined || event.id === threadId)
              this.invalidate(entry, threadId);
          }
        },
      });
      this.sdk.subscribe({
        event: "environment:changed",
        callback: (event) => {
          if (
            event.changes.every((change) =>
              ROUTINE_ENVIRONMENT_CHANGES.has(change),
            )
          )
            return;
          for (const [threadId, entry] of this.entries) {
            if (
              event.id === undefined ||
              (entry.environmentId !== null && entry.environmentId === event.id)
            )
              this.invalidate(entry, threadId);
          }
        },
      });
      // Events missed while disconnected may include an environment change.
      this.sdk.subscribe({
        event: "realtime:connection",
        callback: (event) => {
          if (!event.reconnected) return;
          for (const [threadId, entry] of this.entries)
            this.invalidate(entry, threadId);
        },
      });
    } catch {
      // A host without realtime still serves the first lookup of each thread.
    }
  }
}

const stores = new WeakMap<PluginBrowserBbSdk, WorkspaceStore>();

/** The workspace store shared by this plugin's slots in one client. */
export function workspaceStore(sdk: PluginBrowserBbSdk): WorkspaceStore {
  let store = stores.get(sdk);
  if (!store) {
    store = new WorkspaceStore(sdk);
    stores.set(sdk, store);
  }
  return store;
}

/**
 * A listed thread's workspace, when the sidebar names its checkout and host.
 * A thread without either is left to the lookup, which can resolve both.
 */
function listedWorkspace(
  threadId: string,
  thread: PluginSidebarThread | undefined,
): ReplyWorkspace | null {
  const environment = thread?.environment;
  if (!thread?.host || !environment?.id || !environment.path) return null;
  return workspaceOf(threadId, {
    id: environment.id,
    path: environment.path,
    hostId: thread.host.id,
  });
}

const unknownThread = (): WorkspaceSnapshot => null;
const noSubscription = () => () => {};

/**
 * The workspace a thread's reply links resolve in. `undefined` while the first
 * lookup for the thread is in flight; `null` when there is none.
 */
export function useReplyWorkspace(threadId: string | null): WorkspaceSnapshot {
  const store = workspaceStore(useSdk());
  const listed = useSidebarThread(threadId);
  if (threadId && store.snapshot(threadId) === undefined) {
    const seed = listedWorkspace(threadId, listed);
    if (seed) store.seed(threadId, seed);
  }
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(threadId!, listener),
    [store, threadId],
  );
  const snapshot = useCallback(
    () => store.snapshot(threadId!),
    [store, threadId],
  );
  return useSyncExternalStore(
    threadId ? subscribe : noSubscription,
    threadId ? snapshot : unknownThread,
    threadId ? snapshot : unknownThread,
  );
}
