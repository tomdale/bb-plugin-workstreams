/*
 * The `changed` signal. The server publishes it at most once per tick, after
 * any write a client might show. It carries the revision of each slice of
 * the `state` read, so a client re-reads only the slices whose revision moved
 * since its last read. Revisions count from server start: a new `epoch` means
 * the server restarted and every slice needs a fresh read. Signals are not
 * replayed, so comparing whole revision maps, rather than trusting which
 * slices one signal names, also heals a signal the client missed.
 *
 * `threadIds`, when present, lists every thread whose per-thread records
 * (recap, durable question) changed in that tick; an empty list means none
 * did. A signal without it may have changed any thread's records.
 */
import { z } from "zod";

export const STATE_SLICES = [
  "analysis",
  "recaps",
  "order",
  "snoozes",
  "catalog",
  "suggestions",
] as const;

export type StateSlice = (typeof STATE_SLICES)[number];

export const stateSliceSchema = z.enum(STATE_SLICES);

export const changeStampSchema = z.object({
  epoch: z.string(),
  revisions: z.object(
    Object.fromEntries(STATE_SLICES.map((slice) => [slice, z.number()])) as {
      [slice in StateSlice]: z.ZodNumber;
    },
  ),
});

/** Which slice revisions a `state` read reflects. */
export type ChangeStamp = z.infer<typeof changeStampSchema>;

const changedSignalSchema = changeStampSchema.extend({
  threadIds: z.array(z.string()).optional(),
});

export type ChangedSignal = z.infer<typeof changedSignalSchema>;

/** What a write changed; omitted fields mean "possibly everything". */
export type ChangeScope = {
  slices?: readonly StateSlice[];
  threadIds?: readonly string[];
};

/** The signal's stamp, or null for a payload that carries none. */
export function readChangedSignal(payload: unknown): ChangedSignal | null {
  const parsed = changedSignalSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/** Whether a `changed` payload may have changed this thread's records. */
export function touchesThread(payload: unknown, threadId: string): boolean {
  const threadIds = readChangedSignal(payload)?.threadIds;
  return !threadIds || threadIds.includes(threadId);
}

/**
 * The slices whose revision in `next` differs from `held`; every slice when
 * the server restarted between them.
 */
export function staleSlices(
  held: ChangeStamp | null,
  next: ChangeStamp,
): StateSlice[] {
  if (!held || held.epoch !== next.epoch) return [...STATE_SLICES];
  return STATE_SLICES.filter(
    (slice) => held.revisions[slice] !== next.revisions[slice],
  );
}

/**
 * Whether every write behind a `changed` payload named its scope. Such writes
 * change only `state` slices and the named threads' records, so a view of
 * anything else (suggestions, the organizer) has nothing new to read.
 */
export function isScopedChange(payload: unknown): boolean {
  return readChangedSignal(payload)?.threadIds !== undefined;
}
