import {
  experimental_useSidebarThreads,
  useSdk,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { shareJson } from "./structuralSharing.ts";

type SidebarThreads = ReturnType<typeof experimental_useSidebarThreads>;
type Options = Parameters<typeof experimental_useSidebarThreads>[0];
type Sdk = ReturnType<typeof useSdk>;

/**
 * Each field of a host snapshot as it was published, one level deep: arrays
 * and plain objects are copied, so a host that mutates them in place still
 * reads as changed.
 */
type HostFields = Map<string, unknown>;

function hostFieldsOf(snapshot: SidebarThreads): HostFields {
  const fields: HostFields = new Map();
  for (const [key, value] of Object.entries(snapshot))
    fields.set(
      key,
      Array.isArray(value)
        ? [...value]
        : isPlainObject(value)
          ? { ...value }
          : value,
    );
  return fields;
}

/** Whether `snapshot` holds the same values, by identity, as `fields`. */
function sameHostFields(fields: HostFields, snapshot: SidebarThreads): boolean {
  const entries = Object.entries(snapshot);
  if (entries.length !== fields.size) return false;
  for (const [key, value] of entries) {
    if (!fields.has(key)) return false;
    const before = fields.get(key);
    if (Array.isArray(value)) {
      if (!Array.isArray(before) || before.length !== value.length)
        return false;
      for (let index = 0; index < value.length; index++)
        if (!Object.is(before[index], value[index])) return false;
    } else if (isPlainObject(value)) {
      if (!isPlainObject(before)) return false;
      const keys = Object.keys(value);
      if (keys.length !== Object.keys(before).length) return false;
      for (const name of keys)
        if (
          !Object.hasOwn(before, name) ||
          !Object.is(before[name], value[name])
        )
          return false;
    } else if (!Object.is(before, value)) return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * One structurally shared snapshot for every consumer of an SDK sidebar view.
 *
 * Wide consumers call the SDK hook and hold a lease; one of them, the
 * publisher, feeds the store. When the publisher unmounts the next lease
 * holder takes over, so the store stays live while any wide consumer is
 * mounted. Narrow consumers (`useSidebarThreadsSelector`) read the store
 * without calling the SDK hook, and rely on that: a narrow consumer that
 * outlives every wide consumer keeps the last snapshot. The app keeps one
 * wide consumer of the default view mounted for its whole life (see
 * `NextUpCommandBridge`), so in the app only a standalone mount can be left
 * without a publisher, and a standalone narrow consumer that mounts with no
 * wide consumer present becomes one itself.
 */
class SidebarThreadsStore {
  private value: SidebarThreads | null = null;
  /** The publisher's last host snapshot, for skipping repeat publishes. */
  private host: HostFields | null = null;
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
    this.host = null;
    // Let the next publisher refresh the shared value from its current host
    // snapshot instead of leaving the old publisher's value indefinitely.
    this.dirty = true;
    queueMicrotask(this.settle);
  }

  publish(source: number, next: SidebarThreads): void {
    // Only the lease holder publishes. Another surface's older host snapshot
    // must not roll back a newer snapshot supplied by the current lease.
    if (source !== this.publisher) return;
    // The publisher renders far more often than the host snapshot changes.
    // The host keeps each unchanged thread's identity (see the SDK's
    // `experimental_useSidebarThreads`), so a snapshot whose fields and
    // elements are all the ones last published needs no sharing walk. That
    // matters for a thread the walk replaced with an equal earlier copy: the
    // host's object then never becomes the stored one, and without this check
    // every render would compare the two field by field.
    if (this.host !== null && sameHostFields(this.host, next)) return;
    this.host = hostFieldsOf(next);
    // Never retain the host's object: a host (or test double) that mutates
    // its snapshot in place would corrupt the shared value. Share against
    // our own copy; an unchanged snapshot collapses to it by identity per
    // key.
    const shared =
      this.value === null ? { ...next } : shareJson(this.value, next);
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

/**
 * The store for a view, by the lifecycles it selects. BB reads no selection,
 * an empty one, and `["active"]` alike, so they share the default view's
 * store.
 */
function viewKey(options?: Options): string {
  const lifecycles = new Set(options?.experimental_lifecycles ?? []);
  if (lifecycles.size === 0) lifecycles.add("active");
  return [...lifecycles].sort().join(",");
}

function storeFor(sdk: Sdk, options?: Options): SidebarThreadsStore {
  let views = stores.get(sdk);
  if (!views) {
    views = new Map();
    stores.set(sdk, views);
  }
  const key = viewKey(options);
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

/**
 * A lease on the store for `options`, claimed again when the options select
 * another view. The old view's lease is released when the new one commits.
 */
function useWideLease(store: SidebarThreadsStore): number {
  const lease = useRef<{ store: SidebarThreadsStore; source: number } | null>(
    null,
  );
  if (lease.current?.store !== store)
    lease.current = { store, source: store.claimWideConsumer() };
  return lease.current.source;
}

export function useStableSidebarThreads(options?: Options): SidebarThreads {
  const sdk = useSdk();
  const store = storeFor(sdk, options);
  const source = useWideLease(store);
  useSidebarThreadsSource(store, source, options);
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

/**
 * Keeps the view for `options` fed from the SDK without rendering for its
 * changes: a wide consumer for a surface that reads the store only on
 * demand.
 */
export function useSidebarThreadsPublisher(options?: Options): void {
  const sdk = useSdk();
  const store = storeFor(sdk, options);
  const source = useWideLease(store);
  useSidebarThreadsSource(store, source, options);
}

/**
 * Reads the shared snapshot for `options` on demand, without rendering for
 * its changes. Something else on screen must feed the view: a wide consumer,
 * or a narrow one that elected itself (see `useSidebarThreadsSelector`).
 */
export function useSidebarThreadsReader(
  options?: Options,
): () => SidebarThreads {
  return storeFor(useSdk(), options).snapshot;
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

/** Each thread of a snapshot by id, built once per snapshot. */
const indexes = new WeakMap<
  readonly PluginSidebarThread[],
  ReadonlyMap<string, PluginSidebarThread>
>();

export function threadIndex(
  threads: readonly PluginSidebarThread[],
): ReadonlyMap<string, PluginSidebarThread> {
  let index = indexes.get(threads);
  if (!index) {
    index = new Map(threads.map((thread) => [thread.id, thread]));
    indexes.set(threads, index);
  }
  return index;
}

/**
 * One thread of the sidebar's active view, or undefined when the view does
 * not list it (hidden from the sidebar, archived, or gone). Renders only when
 * that thread changes, however many lookups a page holds.
 */
export function useSidebarThread(
  threadId: string | null | undefined,
): PluginSidebarThread | undefined {
  return useSidebarThreadsSelector(
    useCallback(
      ({ threads }) =>
        threadId ? threadIndex(threads).get(threadId) : undefined,
      [threadId],
    ),
  );
}

/** The listed threads among `threadIds`, by id; renders only when one changes. */
export function useSidebarThreadsById(
  threadIds: readonly string[],
): ReadonlyMap<string, PluginSidebarThread> {
  const key = threadIds.join(" ");
  const listed = useSidebarThreadsSelector(
    useCallback(
      ({ threads }) => {
        const index = threadIndex(threads);
        return key ? key.split(" ").flatMap((id) => index.get(id) ?? []) : [];
      },
      [key],
    ),
  );
  return useMemo(
    () => new Map(listed.map((thread) => [thread.id, thread])),
    [listed],
  );
}
