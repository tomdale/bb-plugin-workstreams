import { randomUUID } from "node:crypto";
import {
  STATE_SLICES,
  type ChangeScope,
  type ChangeStamp,
  type ChangedSignal,
  type StateSlice,
} from "../domain/changes.ts";

/**
 * Counts writes per `state` slice and publishes one `changed` signal per tick
 * for any number of writes (see domain/changes.ts). A write bumps its slices'
 * revisions as it reports itself, so a `state` read that follows it in the
 * same tick already carries the new revision.
 */
export class ChangeFeed {
  private readonly epoch = randomUUID();
  private readonly revisions = Object.fromEntries(
    STATE_SLICES.map((slice) => [slice, 0]),
  ) as Record<StateSlice, number>;
  /** Threads named this tick; null once any write didn't name its threads. */
  private threads: Set<string> | null = new Set();
  private queued = false;
  private disposed = false;

  constructor(private readonly publish: (signal: ChangedSignal) => void) {}

  /** Records a write; omitting a scope field means it may have changed all. */
  notify = (scope: ChangeScope = {}): void => {
    for (const slice of scope.slices ?? STATE_SLICES)
      this.revisions[slice] += 1;
    if (!scope.threadIds) this.threads = null;
    else for (const id of scope.threadIds) this.threads?.add(id);
    if (this.queued || this.disposed) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.disposed) return;
      const threads = this.threads;
      this.threads = new Set();
      this.publish({
        ...this.stamp(),
        ...(threads ? { threadIds: [...threads] } : {}),
      });
    });
  };

  /** The revisions a `state` read taken now reflects. */
  stamp(): ChangeStamp {
    return { epoch: this.epoch, revisions: { ...this.revisions } };
  }

  dispose(): void {
    this.disposed = true;
  }
}
