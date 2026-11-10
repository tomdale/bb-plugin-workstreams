import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { RpcContract } from "../server/contract.ts";
import type { ManualOrder } from "../domain/order.ts";
import {
  DEFAULT_SNOOZE_PREFS,
  applySnoozePrefsPatch,
  parseSnoozePrefs,
  type SnoozePrefsPatch,
  type SnoozeWhen,
} from "../domain/snooze.ts";
import type { ServerState, ReorderChange } from "./useWorkstreams.ts";
import { shareJson } from "./structuralSharing.ts";
import { ThreadRecords, type ThreadRecord } from "./threadRecords.ts";
import {
  STATE_SLICES,
  readChangedSignal,
  staleSlices,
  type ChangeStamp,
  type StateSlice,
} from "../domain/changes.ts";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

function emptyState(): ServerState {
  return {
    analysis: {},
    recaps: {},
    dismissedRecaps: [],
    order: { workstreams: [], threads: {}, prioritized: [] },
    snoozes: {},
    snoozePrefs: DEFAULT_SNOOZE_PREFS,
    catalog: {
      entities: [],
      groups: {},
      assignments: {},
      revision: 1,
    },
  };
}

/** The `state` fields each slice read returns (see domain/changes.ts). */
const SLICE_FIELDS: Record<StateSlice, readonly (keyof ServerState)[]> = {
  analysis: ["analysis"],
  recaps: ["recaps", "dismissedRecaps"],
  order: ["order"],
  snoozes: ["snoozes", "snoozePrefs"],
  catalog: ["catalog"],
  suggestions: ["pendingSuggestions"],
};

class ServerStore {
  private value = emptyState();
  private listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  /** A whole read is due: first load, reconnect, or an unscoped change. */
  private dirtyAll = false;
  /** Slices due a read, when the rest of the snapshot is current. */
  private dirtySlices = new Set<StateSlice>();
  /** The slice revisions the snapshot reflects; null until a whole read. */
  private held: ChangeStamp | null = null;
  private loaded = false;
  private activeMutations = 0;
  private mutationVersion = 0;
  private mutationNeedsReconcile = false;
  private pendingReorders = new Map<number, ReorderChange>();
  private pendingPrefs = new Map<number, SnoozePrefsPatch>();
  private latestReorderResponse = 0;
  private latestPrefsResponse = 0;

  /** Records of the threads the snapshot leaves out, read on demand. */
  readonly records: ThreadRecords;

  constructor(readonly rpc: Rpc) {
    this.records = new ThreadRecords(
      rpc,
      () => this.value.catalog?.revision ?? null,
    );
  }

  snapshot = (): ServerState => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    // A remount reconciles changes missed while nobody was listening. Joining
    // an initial fetch must not invalidate it or queue a fetch per consumer.
    if ((this.listeners.size === 1 || !this.loaded) && !this.pending)
      void this.refresh();
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(value: ServerState): void {
    const shared = shareJson(this.value, value);
    if (Object.is(shared, this.value)) return;
    const revision = this.value.catalog?.revision;
    this.value = shared;
    if (shared.catalog?.revision !== revision) this.records.catalogChanged();
    for (const listener of this.listeners) listener();
  }

  private get dirty(): boolean {
    return this.dirtyAll || this.dirtySlices.size > 0;
  }

  /** Reads the whole snapshot. */
  refresh = (): Promise<void> => {
    this.dirtyAll = true;
    return this.start();
  };

  /**
   * Handles a `changed` signal: reads only the slices whose revision moved,
   * or everything for a signal without revisions or from a restarted server.
   */
  changed = (payload: unknown): void => {
    this.records.changed(payload);
    const signal = readChangedSignal(payload);
    if (!signal) {
      void this.refresh();
      return;
    }
    const stale = staleSlices(this.held, signal);
    if (!this.held || stale.length === STATE_SLICES.length) {
      void this.refresh();
      return;
    }
    if (!stale.length) return;
    for (const slice of stale) this.dirtySlices.add(slice);
    void this.start();
  };

  /** The realtime link came back; signals sent while it was down are lost. */
  reconnected = (): void => {
    this.records.invalidate();
    void this.refresh();
  };

  private start(): Promise<void> {
    if (!this.pending)
      this.pending = this.fetch().finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  private async fetch(): Promise<void> {
    do {
      const whole = this.dirtyAll || !this.held;
      const slices = [...this.dirtySlices];
      this.dirtyAll = false;
      this.dirtySlices.clear();
      try {
        const state = whole
          ? await this.rpc.call("state", null)
          : await this.rpc.call("stateSlices", { slices });
        // A change arriving during the request needs a fresh read. Publishing
        // that older response would briefly undo a shared optimistic update.
        if (this.activeMutations > 0) {
          this.mutationNeedsReconcile = true;
          continue;
        }
        if (this.dirty) {
          // The next pass reads these slices again with the newer ones.
          if (whole) this.dirtyAll = true;
          for (const slice of slices) this.dirtySlices.add(slice);
          continue;
        }
        const { changes, ...fields } = state;
        if (!whole) {
          // A restart between reads leaves every other slice stale, and a
          // slice that moved without its signal reaching this client still
          // needs reading.
          const missed = staleSlices(this.held, changes).filter(
            (slice) => !slices.includes(slice),
          );
          if (changes.epoch !== this.held!.epoch) {
            this.dirtyAll = true;
            continue;
          }
          for (const slice of missed) this.dirtySlices.add(slice);
        }
        if (whole && this.held && this.held.epoch !== changes.epoch)
          this.records.invalidate();
        this.loaded = true;
        this.held = whole
          ? changes
          : {
              epoch: changes.epoch,
              revisions: {
                ...this.held!.revisions,
                ...Object.fromEntries(
                  slices.map((slice) => [slice, changes.revisions[slice]]),
                ),
              },
            };
        // This read is the acknowledgement boundary. Publish its result
        // without overlays so failed writes roll back and server-side
        // normalization is visible; responses keep overlays only while a
        // newer write is still pending.
        const base = whole ? { ...emptyState(), ready: true } : this.value;
        const next: ServerState = { ...base, loaded: true };
        const read: readonly StateSlice[] = whole ? STATE_SLICES : slices;
        for (const slice of read)
          for (const field of SLICE_FIELDS[slice])
            if (field in fields)
              (next as Record<string, unknown>)[field] =
                fields[field as keyof typeof fields];
        if (read.includes("order")) next.order = normalizeOrder(next.order);
        if (read.includes("snoozes"))
          next.snoozePrefs = parseSnoozePrefs(next.snoozePrefs);
        this.publish(next);
        if (read.includes("order")) this.pendingReorders.clear();
        if (read.includes("snoozes")) this.pendingPrefs.clear();
      } catch {
        // Live BB data still renders; retain the last plugin snapshot. A
        // surface waiting for the first read stops waiting.
        if (!this.value.ready) this.publish({ ...this.value, ready: true });
      }
    } while (this.dirty);
  }

  private beginMutation(): number {
    this.activeMutations += 1;
    this.mutationVersion += 1;
    // A read already in flight, or a refresh requested before this write,
    // needs to be repeated after the write settles. Reads that begin during
    // the mutation mark this flag when their response is suppressed.
    // Every write needs an authoritative read before its overlay is retired.
    this.mutationNeedsReconcile = true;
    this.dirtyAll = true;
    return this.mutationVersion;
  }

  private endMutation(): void {
    this.activeMutations -= 1;
    if (this.activeMutations === 0 && this.mutationNeedsReconcile) {
      this.mutationNeedsReconcile = false;
      void this.refresh();
    }
  }

  /** Applies manual order to every consumer before the round trip. */
  reorder = async (change: ReorderChange): Promise<void> => {
    const mutationVersion = this.beginMutation();
    this.pendingReorders.set(mutationVersion, change);
    this.publish({
      ...this.value,
      order: applyChange(this.value.order, change),
    });
    try {
      const { order } = await this.rpc.call("reorder", change);
      if (mutationVersion >= this.latestReorderResponse) {
        this.latestReorderResponse = mutationVersion;
        this.publish({
          ...this.value,
          order: this.overlayReorders(normalizeOrder(order), mutationVersion),
        });
        this.pendingReorders.delete(mutationVersion);
      }
    } catch (cause) {
      this.pendingReorders.delete(mutationVersion);
      this.mutationNeedsReconcile = true;
      throw cause;
    } finally {
      this.endMutation();
    }
  };

  private overlayReorders(
    order: ManualOrder,
    responseVersion = 0,
  ): ManualOrder {
    let next = order;
    const response = this.pendingReorders.get(responseVersion);
    for (const [version, change] of this.pendingReorders) {
      if (version === responseVersion) continue;
      const sameGroup =
        response &&
        change.kind === response.kind &&
        (change.kind !== "threads" ||
          (response.kind === "threads" && change.groupId === response.groupId));
      if (!sameGroup || version > responseVersion)
        next = applyChange(next, change);
    }
    return next;
  }

  /**
   * Snoozes these threads together until `when`, or wakes them (`wake`
   * removes their snoozes at once).
   */
  setSnoozes = async (
    threads: readonly { id: string; latestAttentionAt?: number }[],
    when: SnoozeWhen | "wake",
  ): Promise<void> => {
    if (!threads.length) return;
    this.beginMutation();
    const snoozes = { ...this.value.snoozes };
    for (const thread of threads)
      if (when === "wake") delete snoozes[thread.id];
      else
        snoozes[thread.id] = {
          until: when.until,
          ...(when.until !== null && when.events ? { events: true } : {}),
          attentionAt: thread.latestAttentionAt ?? Date.now(),
          at: Date.now(),
        };
    this.publish({ ...this.value, snoozes });
    const threadIds = threads.map((thread) => thread.id);
    try {
      if (when === "wake") await this.rpc.call("unsnooze", { threadIds });
      else
        await this.rpc.call("snooze", {
          threadIds,
          until: when.until,
          events: when.events,
        });
    } catch (cause) {
      this.mutationNeedsReconcile = true;
      throw cause;
    } finally {
      this.endMutation();
    }
  };

  /** Saves Snooze settings for every consumer with immediate local feedback. */
  saveSnoozePrefs = async (patch: SnoozePrefsPatch): Promise<void> => {
    const mutationVersion = this.beginMutation();
    this.pendingPrefs.set(mutationVersion, patch);
    this.publish({
      ...this.value,
      snoozePrefs: applySnoozePrefsPatch(this.value.snoozePrefs, patch),
    });
    try {
      const { prefs } = await this.rpc.call("setSnoozePrefs", { patch });
      if (mutationVersion >= this.latestPrefsResponse) {
        this.latestPrefsResponse = mutationVersion;
        let merged = prefs;
        for (const [version, pending] of this.pendingPrefs) {
          if (version === mutationVersion) continue;
          // A whole-settings response may predate another pending field.
          // Preserve it, but never let an older edit replace this write's keys.
          const overlay = Object.fromEntries(
            Object.entries(pending).filter(
              ([key]) =>
                version > mutationVersion || !Object.hasOwn(patch, key),
            ),
          );
          merged = applySnoozePrefsPatch(merged, overlay);
        }
        this.publish({ ...this.value, snoozePrefs: merged });
      }
    } catch (cause) {
      this.pendingPrefs.delete(mutationVersion);
      this.mutationNeedsReconcile = true;
      throw cause;
    } finally {
      this.endMutation();
    }
  };
}

/** Fills fields a server from before they existed leaves out. */
function normalizeOrder(order: Partial<ManualOrder> | undefined): ManualOrder {
  return { ...emptyState().order, ...order };
}

function applyChange(order: ManualOrder, change: ReorderChange): ManualOrder {
  if (change.kind === "workstreams")
    return { ...order, workstreams: change.ids };
  if (change.kind === "prioritized")
    return { ...order, prioritized: change.ids };
  return {
    ...order,
    threads: { ...order.threads, [change.groupId]: change.ids },
  };
}

const clients = new WeakMap<object, Rpc>();
const stores = new WeakMap<Rpc, ServerStore>();

function useStore(): ServerStore {
  const candidate = useRpc<RpcContract>();
  const sdk = useSdk();
  // useRpc memoizes per hook, while useSdk is shared across this plugin's
  // slots in one client. Select one RPC client within that stable scope.
  let rpc = clients.get(sdk);
  if (!rpc) {
    rpc = candidate;
    clients.set(sdk, rpc);
  }
  let store = stores.get(rpc);
  if (!store) {
    store = new ServerStore(rpc);
    stores.set(rpc, store);
  }
  return store;
}

/** Selects a stable value without rerendering for unrelated state changes. */
export function useSharedServerStateSelector<T>(
  selector: (server: ServerState) => T,
): T {
  const store = useStore();
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cache = useRef<{
    server: ServerState;
    selector: (server: ServerState) => T;
    value: T;
  } | null>(null);
  const snapshot = useCallback(() => {
    const server = store.snapshot();
    const selector = selectorRef.current;
    const previous = cache.current;
    if (
      previous &&
      previous.server === server &&
      previous.selector === selector
    )
      return previous.value;
    const value = selector(server);
    cache.current = { server, selector, value };
    return previous && Object.is(previous.value, value)
      ? previous.value
      : value;
  }, [store]);
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

/**
 * Reads plugin state on demand without rendering for its changes. The store
 * stays live, refreshing on `changed`, while the caller is mounted.
 */
export function useServerStateReader(): () => ServerState {
  const store = useStore();
  useEffect(() => store.subscribe(() => {}), [store]);
  return store.snapshot;
}

export function useSharedServerActions() {
  const store = useStore();
  return {
    rpc: store.rpc,
    refresh: store.refresh,
    reorder: store.reorder,
    setSnoozes: store.setSnoozes,
    saveSnoozePrefs: store.saveSnoozePrefs,
  };
}

/** One snapshot and shared optimistic actions for this plugin's RPC client. */
export function useSharedServerState() {
  const store = useStore();
  const server = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  return {
    rpc: store.rpc,
    server,
    refresh: store.refresh,
    reorder: store.reorder,
    setSnoozes: store.setSnoozes,
    saveSnoozePrefs: store.saveSnoozePrefs,
  };
}

/**
 * BB mounts this once per app window and disposes its subscription on unload.
 * Broadcasts sent while the realtime link is down are not replayed, so the
 * store re-reads each time the link comes back.
 */
export function ServerStateRealtime(): null {
  const store = useStore();
  useRealtime("changed", store.changed);
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    const was = previous.current;
    previous.current = connection;
    if (connection === "connected" && was !== "connected") store.reconnected();
  }, [connection, store]);
  return null;
}

/**
 * The thread's record when the snapshot leaves it out (archived and hidden
 * threads), read on demand and shared by every view of it; undefined while it
 * loads, and for a thread the snapshot covers.
 */
function useOutsideRecord(
  threadId: string | null,
  outside: boolean,
): ThreadRecord | undefined {
  const store = useStore();
  const id = outside ? threadId : null;
  const subscribe = useCallback(
    (listener: () => void) =>
      id ? store.records.subscribe(id, listener) : () => {},
    [store, id],
  );
  const snapshot = useCallback(
    () => (id ? store.records.snapshot(id) : undefined),
    [store, id],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Whether the snapshot carries this thread's recap and topic. It covers
 * visible, non-archived threads, each of which has an assignment there.
 */
export function inSnapshot(server: ServerState, threadId: string): boolean {
  return (
    Object.hasOwn(server.catalog?.assignments ?? {}, threadId) ||
    Object.hasOwn(server.recaps, threadId)
  );
}

const LOADING = Symbol("loading");
const OUTSIDE = Symbol("outside");

/**
 * Selects from the thread's record: the snapshot's for a thread it covers,
 * otherwise one read on demand. Undefined while either loads; a thread that
 * leaves the snapshot keeps its last value until its own record arrives.
 */
export function useThreadRecordSelector<T>(
  threadId: string | null,
  select: (record: ThreadRecord) => T,
): T | undefined {
  const selectRef = useRef(select);
  selectRef.current = select;
  const covered = useSharedServerStateSelector((server) => {
    if (!threadId) return LOADING;
    if (!server.ready) return LOADING;
    if (!inSnapshot(server, threadId)) return OUTSIDE;
    return selectRef.current({
      recap: server.recaps[threadId] ?? null,
      dismissed: (server.dismissedRecaps ?? []).includes(
        server.recaps[threadId]?.id ?? "",
      ),
      assignment: server.catalog?.assignments[threadId] ?? {
        threadId,
        entityId: null,
        status: "unresolved",
        provenance: null,
        label: null,
        ancestorIds: [],
        evidence: null,
        inheritedFrom: null,
      },
    });
  });
  const record = useOutsideRecord(threadId, covered === OUTSIDE);
  const value =
    covered === LOADING
      ? undefined
      : covered === OUTSIDE
        ? record && select(record)
        : covered;
  const last = useRef<{ threadId: string | null; value: T } | null>(null);
  if (value !== undefined) {
    last.current = { threadId, value: value as T };
    return value as T;
  }
  return covered === OUTSIDE && last.current?.threadId === threadId
    ? last.current.value
    : undefined;
}
