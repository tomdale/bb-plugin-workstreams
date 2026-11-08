/**
 * The working indicator's style, shared by every mark in the app. Each SDK
 * client gets one store and RPC client, so dozens of rows cost one fetch;
 * the server pushes changes on the `spinner` realtime channel. A change made
 * in settings shows at once and is saved after a short pause, so dragging
 * through a color picker sends one write rather than dozens.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRealtime, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import {
  DEFAULT_SPINNER,
  parseSpinner,
  sameSpinner,
  type SpinnerStyle,
} from "../domain/spinner.ts";
import type { RpcContract } from "../server/contract.ts";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

const SAVE_DELAY_MS = 250;

type Store = {
  rpc: Rpc;
  value: SpinnerStyle;
  /** The last style the server confirmed; a failed save returns to it. */
  saved: SpinnerStyle;
  loading: boolean;
  loaded: boolean;
  /** A local change is waiting to be saved or is being saved. */
  changing: boolean;
  generation: number;
  confirmedGeneration: number;
  realtimeGeneration: number;
  realtimeDirty: boolean;
  lifetime: number;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<() => void>;
  realtimeReaders: Set<object>;
};

const clients = new WeakMap<object, Rpc>();
const stores = new WeakMap<object, Store>();

function useStore(): Store {
  const candidate = useRpc<RpcContract>();
  const sdk = useSdk();
  let rpc = clients.get(sdk);
  if (!rpc) {
    rpc = candidate;
    clients.set(sdk, rpc);
  }
  let store = stores.get(sdk);
  if (!store) {
    store = {
      rpc,
      value: DEFAULT_SPINNER,
      saved: DEFAULT_SPINNER,
      loading: false,
      loaded: false,
      changing: false,
      generation: 0,
      confirmedGeneration: -1,
      realtimeGeneration: 0,
      realtimeDirty: false,
      lifetime: 0,
      timer: null,
      listeners: new Set(),
      realtimeReaders: new Set(),
    };
    stores.set(sdk, store);
  }
  return store;
}

function publish(store: Store, value: SpinnerStyle): void {
  if (sameSpinner(store.value, value)) return;
  store.value = value;
  for (const listener of store.listeners) listener();
}

function joinRealtime(store: Store, reader: object): () => void {
  store.realtimeReaders.add(reader);
  return () => {
    store.realtimeReaders.delete(reader);
  };
}

function receiveRealtime(store: Store, reader: object, payload: unknown): void {
  // Hooks register individually; the oldest reader publishes for the store.
  if (store.realtimeReaders.values().next().value !== reader) return;
  store.realtimeGeneration += 1;
  // A pending local change wins over an older broadcast, but the final save
  // must re-read so a newer broadcast is not lost behind its RPC response.
  if (store.changing) {
    store.realtimeDirty = true;
    return;
  }
  store.realtimeDirty = false;
  store.loaded = true;
  store.saved = parseSpinner((payload as { spinner?: unknown })?.spinner);
  store.confirmedGeneration = store.generation;
  publish(store, store.saved);
}

function reconcile(store: Store): void {
  if (store.realtimeDirty && !store.changing && store.listeners.size > 0)
    read(store);
}

function read(store: Store): void {
  if (store.loading) return;
  store.loading = true;
  const generation = store.generation;
  const lifetime = store.lifetime;
  const confirmedGeneration = store.confirmedGeneration;
  const realtimeGeneration = store.realtimeGeneration;
  store.rpc.call("spinner", null).then(
    ({ spinner }) => {
      store.loading = false;
      // Realtime events supersede reads. A read that raced a local edit can
      // still advance the canonical snapshot, but newer edits stay overlaid.
      if (
        store.lifetime === lifetime &&
        store.realtimeGeneration === realtimeGeneration &&
        store.confirmedGeneration === confirmedGeneration &&
        generation >= store.confirmedGeneration
      ) {
        store.loaded = true;
        store.saved = parseSpinner(spinner);
        if (store.generation === generation) store.realtimeDirty = false;
        if (!store.changing) publish(store, store.saved);
      }
      reconcile(store);
    },
    () => {
      // Keep the last style; a later mount or save can try again.
      store.loading = false;
      if (store.lifetime !== lifetime) reconcile(store);
    },
  );
}

/** The chosen style; BB's own until the stored choice loads. */
export function useSpinner(): SpinnerStyle {
  const store = useStore();
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      if (store.listeners.size === 1) {
        store.lifetime += 1;
        store.realtimeDirty = true;
        read(store);
      }
      return () => {
        store.listeners.delete(listener);
        if (store.listeners.size === 0) {
          store.lifetime += 1;
          store.realtimeDirty = true;
        }
      };
    },
    [store],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => store.value,
    () => store.value,
  );
  useEffect(() => {
    if (!store.loaded) read(store);
  }, [store]);
  const reader = useRef({}).current;
  useEffect(() => joinRealtime(store, reader), [store, reader]);
  useRealtime("spinner", (payload) => receiveRealtime(store, reader, payload));
  return value;
}

/**
 * Changes part of the style: shown at once, saved after a short pause, and
 * reverted to the last saved style if the server refuses it (`onError` then
 * runs). Changes merge into the latest style, not the caller's last render,
 * so quick successive picks all stick.
 */
export function useSetSpinner(
  onError: (cause: unknown) => void,
): (patch: Partial<SpinnerStyle>) => void {
  const store = useStore();
  return useCallback(
    (patch: Partial<SpinnerStyle>) => {
      publish(store, { ...store.value, ...patch });
      store.changing = true;
      store.generation += 1;
      const generation = store.generation;
      if (store.timer) clearTimeout(store.timer);
      store.timer = setTimeout(() => {
        store.timer = null;
        const pending = store.value;
        store.rpc.call("setSpinner", { spinner: pending }).then(
          ({ spinner }) => {
            // Saves can finish in either order. Advance the canonical style
            // only for a newer confirmation, and keep newer edits overlaid.
            if (generation > store.confirmedGeneration) {
              store.saved = parseSpinner(spinner);
              store.confirmedGeneration = generation;
              store.loaded = true;
            }
            const latest = generation === store.generation && !store.timer;
            if (latest) store.changing = false;
            if (generation === store.confirmedGeneration && !store.changing) {
              publish(store, store.saved);
            }
            if (latest) reconcile(store);
          },
          (cause: unknown) => {
            if (generation === store.generation && !store.timer) {
              store.changing = false;
              publish(store, store.saved);
              reconcile(store);
            }
            onError(cause);
          },
        );
      }, SAVE_DELAY_MS);
    },
    [store, onError],
  );
}
