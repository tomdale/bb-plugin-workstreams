/**
 * What acting on a queue item does. Each action takes effect at once and
 * leaves a receipt above the next item, with Undo. Only the latest receipt
 * stays: acting again settles the one before.
 *
 * A message can't be taken back once it reaches the thread, so a send waits
 * {@link SEND_HOLD_MS} behind its receipt ("Sending …"), and goes out at once
 * when the user acts again or leaves the page. Archive, snooze, and a
 * suggestion's decision apply immediately; Undo reverses them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** How long a message waits behind its receipt before it is sent. */
const SEND_HOLD_MS = 5_000;

type ReceiptKind = "sent" | "archived" | "snoozed" | "accepted" | "declined";

export type Receipt = {
  /** The queue item: a thread's id, or a suggestion's key (`suggestionKey`). */
  readonly itemId: string;
  readonly kind: ReceiptKind;
  /** The thread's title or the suggestion's headline, kept for when it leaves the lists. */
  readonly title: string;
  /** The message sent, or when a snooze wakes ("until tomorrow, 9 AM"). */
  readonly detail: string;
  /** A send still waiting behind its receipt. */
  readonly holding: boolean;
  /** Undo is still possible. */
  readonly undoable: boolean;
};

/** A message sent from the page, until the thread's turn after it ends. */
export type Sent = { readonly text: string; readonly at: number };

type Undo = () => Promise<unknown> | void;

type Settled = {
  receipt: Receipt;
  undo: Undo | null;
  /** For a held send: delivers it now. */
  flush?: () => void;
  /** For a held send: drops it unsent. */
  cancel?: () => void;
};

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function useQueueActions() {
  const [current, setCurrent] = useState<Settled | null>(null);
  const currentRef = useRef<Settled | null>(null);
  const [sent, setSent] = useState<ReadonlyMap<string, Sent>>(new Map());
  /** Items acted on this session; they leave the queue. */
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());

  const publish = (next: Settled | null) => {
    currentRef.current = next;
    setCurrent(next);
  };
  const clear = (itemId: string, on: boolean) =>
    setCleared((was) => {
      const next = new Set(was);
      if (on) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  const markSent = (itemId: string, text: string | null) =>
    setSent((was) => {
      const next = new Map(was);
      if (text === null) next.delete(itemId);
      else next.set(itemId, { text, at: Date.now() });
      return next;
    });

  /** Settles the latest receipt: a held send goes out, and Undo ends. */
  const settlePrevious = () => {
    const previous = currentRef.current;
    previous?.flush?.();
  };

  // Leaving the page delivers a held message rather than losing it.
  useEffect(
    () => () => {
      currentRef.current?.flush?.();
    },
    [],
  );

  /** Applies an archive, snooze, or decision at once, with Undo. */
  const apply = useCallback(
    (
      receipt: Omit<Receipt, "holding" | "undoable">,
      run: () => Promise<unknown>,
      undo: Undo,
    ) => {
      settlePrevious();
      clear(receipt.itemId, true);
      const settled: Settled = {
        receipt: { ...receipt, holding: false, undoable: true },
        undo,
      };
      publish(settled);
      run().catch((cause: unknown) => {
        toast.error(message(cause));
        clear(receipt.itemId, false);
        if (currentRef.current === settled) publish(null);
      });
    },
    [],
  );

  /** Sends a message after the hold, unless undone first. */
  const send = useCallback(
    (
      thread: { id: string; title: string },
      text: string,
      deliver: () => Promise<unknown>,
    ) => {
      settlePrevious();
      clear(thread.id, true);
      markSent(thread.id, text);
      let done = false;
      const fail = (cause: unknown) => {
        toast.error(message(cause));
        markSent(thread.id, null);
        clear(thread.id, false);
      };
      const settled: Settled = {
        receipt: {
          itemId: thread.id,
          kind: "sent",
          title: thread.title,
          detail: text,
          holding: true,
          undoable: true,
        },
        undo: null,
      };
      const flush = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (currentRef.current === settled)
          publish({
            ...settled,
            receipt: { ...settled.receipt, holding: false, undoable: false },
            flush: undefined,
            cancel: undefined,
          });
        deliver().catch(fail);
      };
      const cancel = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        markSent(thread.id, null);
        clear(thread.id, false);
      };
      const timer = setTimeout(flush, SEND_HOLD_MS);
      settled.flush = flush;
      settled.cancel = cancel;
      publish(settled);
    },
    [],
  );

  /** Undoes the latest receipt, when it still can be. Returns its item. */
  const undo = useCallback((): string | null => {
    const settled = currentRef.current;
    if (!settled?.receipt.undoable) return null;
    const { itemId } = settled.receipt;
    publish(null);
    if (settled.cancel) {
      settled.cancel();
      return itemId;
    }
    clear(itemId, false);
    void Promise.resolve(settled.undo?.()).catch((cause: unknown) =>
      toast.error(message(cause)),
    );
    return itemId;
  }, []);

  /** A sent thread's turn ended. */
  const finishSent = useCallback((itemId: string) => {
    setSent((was) => {
      if (!was.has(itemId)) return was;
      const next = new Map(was);
      next.delete(itemId);
      return next;
    });
  }, []);

  return {
    receipt: current?.receipt ?? null,
    sent,
    cleared,
    apply,
    send,
    undo,
    finishSent,
  };
}
