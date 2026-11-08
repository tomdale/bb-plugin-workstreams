import { experimental_useSidebarThreads, useSdk } from "@get-bb/plugin-sdk/app";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { shareJson } from "./structuralSharing.ts";

type SidebarThreads = ReturnType<typeof experimental_useSidebarThreads>;
type Options = Parameters<typeof experimental_useSidebarThreads>[0];
type Sdk = ReturnType<typeof useSdk>;

/** One structurally shared snapshot for every consumer of an SDK sidebar view. */
class SidebarThreadsStore {
  private input: SidebarThreads | null = null;
  private value: SidebarThreads | null = null;
  private dirty = false;
  private sourceCount = 0;
  private sources = new Set<number>();
  private publisher: number | null = null;
  private listeners = new Set<() => void>();

  get hasWideConsumer(): boolean {
    return this.sources.size > 0;
  }

  claimWideConsumer(): number {
    const source = ++this.sourceCount;
    this.sources.add(source);
    this.publisher ??= source;
    return source;
  }

  releaseWideConsumer(source: number): void {
    this.sources.delete(source);
    if (this.publisher !== source) return;
    this.publisher = this.sources.values().next().value ?? null;
    // Let the next publisher refresh the shared value from its current host
    // snapshot instead of leaving the old publisher's value indefinitely.
    this.dirty = true;
    queueMicrotask(this.settle);
  }

  publish(source: number, next: SidebarThreads): void {
    // Only the lease holder publishes. Another surface's older host snapshot
    // must not roll back a newer snapshot supplied by the current lease.
    if (source !== this.publisher) return;
    // Consumers under the same host provider see the same snapshot object.
    // Avoid walking its full thread array once for every ReplyBlock.
    if (Object.is(this.input, next)) return;
    this.input = next;
    const shared = this.value === null ? next : shareJson(this.value, next);
    if (Object.is(shared, this.value)) return;
    this.value = shared;
    this.dirty = true;
  }

  /** Notify only after the render that supplied the snapshot has committed. */
  settle = (): void => {
    if (!this.dirty) return;
    this.dirty = false;
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): SidebarThreads => {
    if (!this.value) throw new Error("Sidebar snapshot is not initialized");
    return this.value;
  };
}

const stores = new WeakMap<Sdk, Map<string, SidebarThreadsStore>>();

function storeFor(sdk: Sdk, options?: Options): SidebarThreadsStore {
  let views = stores.get(sdk);
  if (!views) {
    views = new Map();
    stores.set(sdk, views);
  }
  const key = JSON.stringify(options?.experimental_lifecycles ?? []);
  let store = views.get(key);
  if (!store) {
    store = new SidebarThreadsStore();
    views.set(key, store);
  }
  return store;
}

function useSidebarThreadsSource(
  store: SidebarThreadsStore,
  source: number,
  options?: Options,
): void {
  const snapshot = experimental_useSidebarThreads(options);
  store.publish(source, snapshot);
  useLayoutEffect(() => store.settle(), [store, snapshot]);
  useLayoutEffect(
    () => () => store.releaseWideConsumer(source),
    [store, source],
  );
}

export function useStableSidebarThreads(options?: Options): SidebarThreads {
  const sdk = useSdk();
  const store = storeFor(sdk, options);
  const [source] = useState(() => store.claimWideConsumer());
  useSidebarThreadsSource(store, source, options);
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

/** Select a stable slice without rerendering for unrelated sidebar changes. */
export function useSidebarThreadsSelector<T>(
  selector: (snapshot: SidebarThreads) => T,
  options?: Options,
): T {
  const sdk = useSdk();
  // A narrow consumer reads the shared store without subscribing to the wide
  // SDK hook itself. Standalone mounts elect one wide fallback; ordinary app
  // surfaces already have a sidebar or workstreams producer.
  const [selection] = useState(() => {
    const store = storeFor(sdk, options);
    const wide = !store.hasWideConsumer;
    const source = wide ? store.claimWideConsumer() : null;
    return { store, wide, source };
  });
  const store = selection.store;
  if (selection.wide)
    useSidebarThreadsSource(store, selection.source!, options);
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cache = useRef<{
    snapshot: SidebarThreads;
    selector: (snapshot: SidebarThreads) => T;
    value: T;
  } | null>(null);
  const snapshot = useCallback(() => {
    const current = store.snapshot();
    const selector = selectorRef.current;
    const previous = cache.current;
    if (
      previous &&
      previous.snapshot === current &&
      previous.selector === selector
    )
      return previous.value;
    const value = previous
      ? shareJson(previous.value, selector(current))
      : selector(current);
    cache.current = { snapshot: current, selector, value };
    return value;
  }, [store]);
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}
