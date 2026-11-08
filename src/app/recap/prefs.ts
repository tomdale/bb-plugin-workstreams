import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import { parseRecapPrefs, type RecapPrefs } from "../../domain/recapPrefs.ts";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

const PREF_KEYS = [
  "required",
  "corrections",
  "layout",
  "replies",
  "hashDigits",
  "hashLetters",
] as const;

function equalPrefs(a: RecapPrefs | null, b: RecapPrefs | null): boolean {
  return a === b || (!!a && !!b && PREF_KEYS.every((key) => a[key] === b[key]));
}

function applyPatches(
  prefs: RecapPrefs,
  patches: Iterable<Partial<RecapPrefs>>,
): RecapPrefs {
  let value = prefs;
  for (const patch of patches) value = { ...value, ...patch };
  return value;
}

/** Shares the snapshot and serializes stale-read rejection for one RPC client. */
class RecapPrefsStore {
  private value: RecapPrefs | null = null;
  private base: RecapPrefs | null = null;
  private listeners = new Set<() => void>();
  private patches = new Map<number, Partial<RecapPrefs>>();
  private pendingVersions = new Set<number>();
  private loading: Promise<void> | null = null;
  private scheduled = false;
  private dirty = false;
  private loaded = false;
  private activeMutations = 0;
  private mutationVersion = 0;
  private latestResponse = 0;
  private broadcastVersion = 0;
  private needsReconcile = false;

  constructor(private readonly rpc: Rpc) {}

  snapshot = (): RecapPrefs | null => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    // Realtime subscriptions end with the last consumer, so a later mounted
    // lifetime reconciles broadcasts that could have arrived in between.
    if (this.listeners.size === 1 && this.loaded) this.refresh();
    return () => this.listeners.delete(listener);
  };

  load = (): void => {
    if (!this.loaded) this.refresh();
  };

  refresh = (): void => {
    if (this.activeMutations > 0) this.needsReconcile = true;
    this.dirty = true;
    if (this.loading || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.loading || !this.dirty) return;
      this.loading = this.fetch().finally(() => {
        this.loading = null;
      });
    });
  };

  private async fetch(): Promise<void> {
    do {
      this.dirty = false;
      const mutations = this.mutationVersion;
      const writing = this.activeMutations > 0;
      const broadcasts = this.broadcastVersion;
      try {
        const { prefs } = await this.rpc.call("recapPrefs", null);
        // A broadcast or save since this read began has a newer snapshot.
        if (
          !writing &&
          broadcasts === this.broadcastVersion &&
          mutations === this.mutationVersion
        ) {
          this.base = parseRecapPrefs(prefs);
          this.loaded = true;
          // This read acknowledges writes that had settled before it began.
          if (this.activeMutations === 0) this.patches.clear();
          this.publish();
        }
      } catch {
        // Keep the current snapshot; a later reader or reconnect retries.
      }
    } while (this.dirty);
  }

  broadcast = (payload: unknown): void => {
    this.broadcastVersion += 1;
    this.base = parseRecapPrefs((payload as { prefs?: unknown })?.prefs);
    this.loaded = true;
    if (this.activeMutations === 0) {
      this.patches.clear();
    } else {
      // This broadcast is newer than settled overlays, but a write still in
      // flight needs its optimistic value until the post-save reconciliation.
      for (const version of this.patches.keys())
        if (!this.pendingVersions.has(version)) this.patches.delete(version);
      this.needsReconcile = true;
    }
    this.publish();
  };

  save = async (patch: Partial<RecapPrefs>): Promise<void> => {
    const version = ++this.mutationVersion;
    const broadcasts = this.broadcastVersion;
    if (this.activeMutations > 0 || this.loading || this.scheduled)
      this.needsReconcile = true;
    this.activeMutations += 1;
    this.pendingVersions.add(version);
    this.patches.set(version, patch);
    this.publish();
    try {
      const { prefs } = await this.rpc.call("setRecapPrefs", { patch });
      // A newer response or broadcast already supplies a better base. Every
      // local patch stays overlaid either way, so an older response cannot
      // erase a disjoint or newer concurrent write.
      if (
        version >= this.latestResponse &&
        broadcasts === this.broadcastVersion
      ) {
        this.latestResponse = version;
        this.base = parseRecapPrefs(prefs);
        this.loaded = true;
      }
      this.publish();
    } catch (error) {
      // Remove only the failed write; other optimistic writes remain intact.
      this.patches.delete(version);
      this.publish();
      throw error;
    } finally {
      this.pendingVersions.delete(version);
      this.activeMutations -= 1;
      if (this.activeMutations === 0) {
        if (this.needsReconcile) {
          this.needsReconcile = false;
          this.refresh();
        } else {
          // Keep one bounded overlay until a broadcast or reconnect supplies a
          // complete server snapshot. A single save response is authoritative.
          const combined: Partial<RecapPrefs> = {};
          for (const saved of this.patches.values())
            Object.assign(combined, saved);
          this.patches.clear();
          this.patches.set(0, combined);
        }
      }
    }
  };

  private publish(): void {
    const next = this.base
      ? applyPatches(this.base, this.patches.values())
      : null;
    if (equalPrefs(this.value, next)) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  }
}

const clients = new WeakMap<object, Rpc>();
const stores = new WeakMap<Rpc, RecapPrefsStore>();

function useStore(): RecapPrefsStore {
  const candidate = useRpc<RpcContract>();
  const sdk = useSdk();
  // useRpc memoizes per hook, while useSdk is shared across this plugin's
  // slots in one client; key the store on one RPC client within that scope.
  let rpc = clients.get(sdk);
  if (!rpc) {
    rpc = candidate;
    clients.set(sdk, rpc);
  }
  let store = stores.get(rpc);
  if (!store) {
    store = new RecapPrefsStore(rpc);
    stores.set(rpc, store);
  }
  return store;
}

/**
 * The stored recap preferences, kept current across windows by the
 * `recapPrefs` realtime broadcast. `save` applies the change locally first so
 * controls respond immediately, and reverts if the server rejects it.
 */
export function useRecapPrefs() {
  const store = useStore();
  const prefs = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  useEffect(store.load, [store]);
  useRealtime("recapPrefs", store.broadcast);
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    const was = previous.current;
    previous.current = connection;
    if (connection === "connected" && was !== "connected") store.refresh();
  }, [connection, store]);
  return { prefs, save: store.save };
}
