/**
 * The tracked pull requests, read once per plugin client and shared by the
 * sidebar and the page. The server broadcasts `pull-requests-changed` only when
 * something about a pull request actually changed, and the store re-reads then.
 * A read that returns the same pull requests leaves the snapshot, and so every
 * reader, untouched; a changed one replaces only the pull requests that moved,
 * so a list re-renders for its own rows, not for the whole sidebar.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
} from "@get-bb/plugin-sdk/app";
import type { TrackedPullRequest } from "../../domain/pullRequests.ts";
import { shareJson } from "../structuralSharing.ts";
import { useSharedRpc } from "../serverState.ts";

type Rpc = ReturnType<typeof useSharedRpc>;

export type PullRequestsState = {
  /** `loading` until the first read finishes; `error` while none has succeeded. */
  readonly status: "loading" | "ready" | "error";
  readonly items: readonly TrackedPullRequest[];
};

const INITIAL: PullRequestsState = { status: "loading", items: [] };

class PullRequestStore {
  private value: PullRequestsState = INITIAL;
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  private again = false;
  private refreshing = new Map<string, Promise<void>>();

  constructor(private readonly rpc: Rpc) {}

  snapshot = (): PullRequestsState => this.value;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && this.value.status !== "ready")
      void this.refresh();
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(next: PullRequestsState) {
    const shared = shareJson(this.value, next);
    if (Object.is(shared, this.value)) return;
    this.value = shared;
    for (const listener of this.listeners) listener();
  }

  /** Reads the list; a request during a read runs one more read after it. */
  refresh = (): Promise<void> => {
    if (this.pending) {
      this.again = true;
      return this.pending;
    }
    this.pending = (async () => {
      do {
        this.again = false;
        try {
          const { items } = await this.rpc.call("trackedPullRequests", {});
          this.publish({ status: "ready", items });
        } catch {
          // Keep the last list: a failed read says nothing about the pull requests.
          if (this.value.status === "loading")
            this.publish({ status: "error", items: [] });
        }
      } while (this.again);
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  };

  /** Asks the server to read one pull request now; its broadcast updates the list. */
  refreshOne = (id: string): Promise<void> => {
    const running = this.refreshing.get(id);
    if (running) return running;
    const request = this.rpc
      .call("refreshTrackedPullRequest", { id })
      .then(({ item }) => {
        // One item is no list before the first full read succeeds, and a full
        // read still in flight may return older data than this item: read the
        // whole list again instead of merging.
        if (!item || this.value.status !== "ready" || this.pending)
          return this.refresh();
        const known = this.value.items.some((other) => other.id === item.id);
        this.publish({
          status: "ready",
          items: known
            ? this.value.items.map((other) =>
                other.id === item.id ? item : other,
              )
            : [...this.value.items, item],
        });
      })
      .catch(() => undefined)
      .finally(() => {
        this.refreshing.delete(id);
      });
    this.refreshing.set(id, request);
    return request;
  };
}

const stores = new WeakMap<Rpc, PullRequestStore>();

function useStore(): PullRequestStore {
  const rpc = useSharedRpc();
  let store = stores.get(rpc);
  if (!store) {
    store = new PullRequestStore(rpc);
    stores.set(rpc, store);
  }
  return store;
}

/**
 * Selects from the pull requests without rendering for changes the selection
 * ignores: the result keeps its identity while it is deeply equal. `inputs`
 * names everything besides the pull requests that the selector reads, as a
 * string: a new one selects again from the same state.
 */
export function usePullRequestSelector<T>(
  select: (state: PullRequestsState) => T,
  inputs = "",
): T {
  const store = useStore();
  const selectRef = useRef(select);
  selectRef.current = select;
  const last = useRef<{
    state: PullRequestsState;
    inputs: string;
    value: T;
  } | null>(null);
  const snapshot = useCallback(() => {
    const state = store.snapshot();
    const previous = last.current;
    if (previous && previous.state === state && previous.inputs === inputs)
      return previous.value;
    const next = selectRef.current(state);
    const value = previous ? shareJson(previous.value, next) : next;
    last.current = { state, inputs, value };
    return value;
  }, [store, inputs]);
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

/** One pull request by id, or undefined when none is tracked. */
export const usePullRequest = (id: string) =>
  usePullRequestSelector((state) => state.items.find((pr) => pr.id === id), id);

/** The actions a reader may take: ask the server to re-read one pull request. */
export function usePullRequestRefresh(): (id: string) => Promise<void> {
  return useStore().refreshOne;
}

/**
 * BB mounts this once per app window. The server's broadcasts are not
 * replayed after a dropped link, so the store re-reads on reconnect.
 */
export function PullRequestsRealtime(): null {
  const store = useStore();
  useRealtime("pull-requests-changed", () => void store.refresh());
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    const was = previous.current;
    previous.current = connection;
    if (connection === "connected" && was !== "connected") void store.refresh();
  }, [connection, store]);
  return null;
}
