import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRealtime, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../server/contract.ts";
import { shareJson } from "./structuralSharing.ts";
import {
  mergePrefs,
  parsePrefs,
  type Prefs,
  type PrefsPatch,
} from "../domain/prefs.ts";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

/**
 * One copy of the preferences per plugin client, shared by every component
 * that reads them (inspect buttons render one per row), so the first reader
 * loads them once and the rest subscribe.
 */
class PrefsStore {
  private value: Prefs | null = null;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private realtimeReaders = new Set<object>();
  private lifetime = 0;
  private revision = 0;

  constructor(private readonly rpc: Rpc) {}

  snapshot = () => this.value;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.lifetime += 1;
      this.loading = null;
      this.load();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.lifetime += 1;
        this.loading = null;
      }
    };
  };

  set = (next: Prefs | null) => {
    this.revision += 1;
    const shared = shareJson(this.value, next);
    if (shared === this.value) return;
    this.value = shared;
    for (const listener of this.listeners) listener();
  };

  joinRealtime = (reader: object) => {
    this.realtimeReaders.add(reader);
    return () => {
      this.realtimeReaders.delete(reader);
    };
  };

  receiveRealtime = (reader: object, payload: unknown) => {
    // Hooks register individually; the oldest reader publishes for the store.
    if (this.realtimeReaders.values().next().value !== reader) return;
    this.set(parsePrefs((payload as { prefs?: unknown })?.prefs));
  };

  load = () => {
    if (this.loading) return;
    const lifetime = this.lifetime;
    const revision = this.revision;
    this.loading = this.rpc
      .call("prefs", null)
      .then(({ prefs }) => {
        if (this.lifetime === lifetime && this.revision === revision)
          this.set(parsePrefs(prefs));
      })
      .catch(() => {
        // A later reader retries.
        if (this.lifetime === lifetime) this.loading = null;
      });
  };

  save = async (patch: PrefsPatch) => {
    const before = this.value;
    if (before) this.set(mergePrefs(before, patch));
    try {
      const { prefs } = await this.rpc.call("setPrefs", { patch });
      this.set(parsePrefs(prefs));
    } catch (error) {
      this.set(before);
      throw error;
    }
  };
}

const clients = new WeakMap<object, Rpc>();
const stores = new WeakMap<Rpc, PrefsStore>();

function useStore(): PrefsStore {
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
    store = new PrefsStore(rpc);
    stores.set(rpc, store);
  }
  return store;
}

/**
 * Workstreams' preferences, kept current across windows by the `prefs`
 * realtime broadcast. Null until the first load. `save` applies the patch
 * locally first so controls respond immediately, and reverts if the server
 * rejects it.
 */
export function usePrefs() {
  const store = useStore();
  const prefs = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  useEffect(store.load, [store]);
  const reader = useRef({}).current;
  useEffect(() => store.joinRealtime(reader), [store, reader]);
  useRealtime("prefs", (payload) => store.receiveRealtime(reader, payload));
  return { prefs, save: store.save };
}
