import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import type { InteractionPayload } from "../../server/questions/contracts.ts";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;
type PendingQuestion = {
  threadId: string;
  id: string;
  recoverable: boolean;
  payload: InteractionPayload;
};

/** Owns one mounted read/poll lifetime for a thread within an RPC client. */
class PendingQuestionStore {
  private value: PendingQuestion | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private reading: Promise<void> | null = null;
  private scheduled = false;
  private dirty = false;
  private lifetime = 0;

  constructor(
    private readonly rpc: Rpc,
    private readonly threadId: string,
    private readonly threads: Map<string, PendingQuestionStore>,
  ) {}

  snapshot = (): PendingQuestion | null => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.lifetime += 1;
      this.threads.set(this.threadId, this);
      this.refresh();
      // Polling catches a stopped waiter even when no realtime event arrives.
      this.timer = setInterval(this.refresh, 2000);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      this.lifetime += 1;
      this.value = null;
      this.dirty = false;
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      if (this.threads.get(this.threadId) === this)
        this.threads.delete(this.threadId);
    };
  };

  refresh = (): void => {
    if (this.listeners.size === 0) return;
    this.dirty = true;
    if (this.reading || this.scheduled) return;
    this.scheduled = true;
    // All consumers receive the same host event. Start its read after that
    // delivery instead of turning the remaining callbacks into another read.
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.listeners.size === 0 || this.reading || !this.dirty) return;
      this.reading = this.fetch().finally(() => {
        this.reading = null;
      });
    });
  };

  private async fetch(): Promise<void> {
    while (this.dirty && this.listeners.size > 0) {
      this.dirty = false;
      const lifetime = this.lifetime;
      try {
        const value = await this.rpc.call("question_pending", {
          threadId: this.threadId,
        });
        // A realtime event during the read requires its newer answer. A new
        // subscription lifetime also invalidates the old lifetime's result.
        if (
          lifetime === this.lifetime &&
          this.listeners.size > 0 &&
          !this.dirty
        ) {
          this.publish(value ? { threadId: this.threadId, ...value } : null);
        }
      } catch {
        // Keep the last snapshot; the next event or poll retries the read.
      }
    }
  }

  private publish(value: PendingQuestion | null): void {
    // Durable question payloads are immutable. Keep the snapshot while identity
    // and recoverability are unchanged so polls do not rerender every consumer.
    if (
      this.value === value ||
      (this.value &&
        value &&
        this.value.id === value.id &&
        this.value.recoverable === value.recoverable)
    )
      return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }
}

const clients = new WeakMap<object, Rpc>();
const stores = new WeakMap<Rpc, Map<string, PendingQuestionStore>>();

function useStore(threadId: string | null): PendingQuestionStore | null {
  const candidate = useRpc<RpcContract>();
  const sdk = useSdk();
  if (!threadId) return null;
  // useRpc memoizes per hook, while useSdk is shared across this plugin's
  // slots in one client; key every thread store on one RPC client in that scope.
  let rpc = clients.get(sdk);
  if (!rpc) {
    rpc = candidate;
    clients.set(sdk, rpc);
  }
  let threads = stores.get(rpc);
  if (!threads) {
    threads = new Map();
    stores.set(rpc, threads);
  }
  let store = threads.get(threadId);
  if (!store) {
    store = new PendingQuestionStore(rpc, threadId, threads);
    threads.set(threadId, store);
  }
  return store;
}

const emptySnapshot = (): PendingQuestion | null => null;
const emptySubscribe = (): (() => void) => () => {};

/** The pending question shared by all consumers of this thread in one client. */
export function usePendingQuestion(threadId: string | null) {
  const store = useStore(threadId);
  const pending = useSyncExternalStore(
    store?.subscribe ?? emptySubscribe,
    store?.snapshot ?? emptySnapshot,
    emptySnapshot,
  );
  useRealtime("changed", store?.refresh ?? (() => {}));
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    const was = previous.current;
    previous.current = connection;
    if (store && connection === "connected" && was !== "connected")
      store.refresh();
  }, [connection, store]);
  return pending;
}
