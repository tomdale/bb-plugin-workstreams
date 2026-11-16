import { toast } from "sonner";
import {
  describeWake,
  type SnoozeWhen,
  type ThreadSnooze,
} from "../../domain/snooze.ts";

type SnoozeTarget = { id: string; latestAttentionAt?: number };

/**
 * `useServerState().setSnoozes`: snooze threads together until `when`, or
 * wake them.
 */
type SetSnoozes = (
  threads: readonly SnoozeTarget[],
  when: SnoozeWhen | "wake",
) => Promise<void>;

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Threads this app snoozed in the last minute, with when. The snooze toast
 * already tells the user what happened, so the toast for moving on from a
 * snoozed thread (see `upNext/moveNotice.ts`) is left to snoozes made
 * elsewhere.
 */
const snoozedHere = new Map<string, number>();
const SNOOZED_HERE_MS = 60_000;

/** Whether this app snoozed `threadId` within the last minute. */
export function wasSnoozedHere(threadId: string, now = Date.now()): boolean {
  for (const [id, at] of snoozedHere)
    if (now - at > SNOOZED_HERE_MS) snoozedHere.delete(id);
  return snoozedHere.has(threadId);
}

/**
 * Snoozes threads and confirms it in a toast with Undo, because their rows
 * leave view at once. Undo gives each thread back the snooze `previous`
 * reported for it before this one, or wakes it; `previous` is read before
 * the snooze is applied. `subject` names what was snoozed in the toast
 * ("4 threads in Alpha"); without it the toast reads "Snoozed until …".
 */
export function snoozeThreads<T extends SnoozeTarget>(
  setSnoozes: SetSnoozes,
  threads: readonly T[],
  when: SnoozeWhen,
  {
    previous,
    subject,
  }: {
    previous?: (thread: T) => ThreadSnooze | undefined;
    subject?: string;
  } = {},
): void {
  const earlier = new Map<
    string,
    { restore: SnoozeWhen | "wake"; group: SnoozeTarget[] }
  >();
  for (const thread of threads) {
    const snooze = previous?.(thread);
    const restore: SnoozeWhen | "wake" = snooze
      ? { until: snooze.until, events: snooze.events === true }
      : "wake";
    const key = JSON.stringify(restore);
    const entry = earlier.get(key) ?? { restore, group: [] };
    entry.group.push(thread);
    earlier.set(key, entry);
  }
  const undo = () => {
    for (const { restore, group } of earlier.values())
      setSnoozes(group, restore).catch((cause: unknown) =>
        toast.error(message(cause)),
      );
  };
  const at = Date.now();
  for (const thread of threads) snoozedHere.set(thread.id, at);
  setSnoozes(threads, when).then(
    () =>
      toast(
        `Snoozed ${subject ? `${subject} ` : ""}${describeWake(when.until, Date.now(), when.events)}`,
        { action: { label: "Undo", onClick: undo } },
      ),
    (cause: unknown) => toast.error(message(cause)),
  );
}

export function wakeThreads(
  setSnoozes: SetSnoozes,
  threads: readonly SnoozeTarget[],
): void {
  setSnoozes(threads, "wake").catch((cause: unknown) =>
    toast.error(message(cause)),
  );
}
