/**
 * The projection every surface of one plugin client shares. The sidebar,
 * phone Home, the page, the recap card's Archive, and the next-Up-Next
 * command all draw the same threads and server state (one shared store
 * each), so they derive one projection from them: the first reader after a
 * change computes it, and every other reader gets the same object. Up Next
 * therefore ranks from the same projection, at the same clock reading,
 * wherever it is drawn.
 *
 * The clock is part of the derivation. A projection holds until its
 * deadline, the next moment the passage of time alone would change it (a
 * snooze ending, a workstream going dormant, a review going stale). Any read
 * at or past the deadline derives again, so a render after a late timer, or
 * an action that reads without subscribing, still sees the current state.
 * One timer per store renders the subscribers at the deadline, and runs only
 * while someone subscribes.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  nextDormancyDeadline,
  projectWorkstreams,
  type Projection,
  type Section,
} from "../domain/project.ts";
import type { Recap } from "../domain/recap.ts";
import { needsAttention, upNextKind, workView } from "../domain/status.ts";
import {
  nextUpNextDeadline,
  UP_NEXT_FRESH_WINDOWS,
  type UpNextOptions,
} from "../domain/upNext.ts";
import type { ManualOrder } from "../domain/order.ts";
import { UP_NEXT_SHOWN, type Prefs } from "../domain/prefs.ts";
import { isSnoozed, type ThreadSnooze } from "../domain/snooze.ts";
import type { StoredAnalysis } from "../server/analyzer.ts";

/** What the projection derives from, each a shared store's current value. */
export type ProjectionInputs = {
  readonly threads: readonly PluginSidebarThread[];
  readonly sections: readonly Section[];
  readonly analysis: Readonly<Record<string, StoredAnalysis>>;
  readonly recaps: Readonly<Record<string, Recap>>;
  readonly order: ManualOrder;
  readonly snoozes: Readonly<Record<string, ThreadSnooze>>;
};

export type SharedProjection = {
  readonly projection: Projection<PluginSidebarThread>;
  /** The clock reading the projection was derived at. */
  readonly now: number;
  /** When time alone next changes the projection; undefined for never. */
  readonly deadline: number | undefined;
};

type UpNextPrefs = Prefs["upNext"] | undefined;

const sameInputs = (a: ProjectionInputs, b: ProjectionInputs) =>
  a.threads === b.threads &&
  a.sections === b.sections &&
  a.analysis === b.analysis &&
  a.recaps === b.recaps &&
  a.order === b.order &&
  a.snoozes === b.snoozes;

function derive(
  inputs: ProjectionInputs,
  now: number,
  previous: Projection<PluginSidebarThread> | undefined,
): SharedProjection {
  const { threads, sections, analysis, recaps, order, snoozes } = inputs;
  const workOf = (thread: PluginSidebarThread) =>
    workView(thread, analysis[thread.id], recaps[thread.id]);
  const snoozedUntil = (thread: PluginSidebarThread) => {
    const snooze = snoozes[thread.id];
    return isSnoozed(snooze, now) ? snooze!.until : undefined;
  };
  const needsYou = (thread: PluginSidebarThread) =>
    needsAttention(thread, workOf(thread));
  const projection = projectWorkstreams(threads, sections, {
    now,
    needsYou,
    order,
    snoozedUntil,
    previous,
  });
  const deadline = Math.min(
    ...Object.values(snoozes)
      .map((snooze) => snooze.until)
      .filter((until): until is number => until !== null && until > now),
    nextDormancyDeadline(threads, sections, {
      now,
      needsYou,
      order,
      snoozedUntil,
    }) ?? Number.POSITIVE_INFINITY,
    nextUpNextDeadline(threads, {
      kindOf: (thread) => upNextKind(thread, workOf(thread)),
      now,
      snoozedUntil,
    }) ?? Number.POSITIVE_INFINITY,
  );
  return {
    projection,
    now,
    deadline: Number.isFinite(deadline) ? deadline : undefined,
  };
}

export class ProjectionStore {
  private inputs: ProjectionInputs | null = null;
  private value: SharedProjection | null = null;
  /** Advances each time the timer reaches a deadline. */
  private tick = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt: number | undefined;
  private listeners = new Set<() => void>();
  private upNext: {
    analysis: ProjectionInputs["analysis"];
    recaps: ProjectionInputs["recaps"];
    now: number;
    prefs: UpNextPrefs;
    value: UpNextOptions<PluginSidebarThread>;
  } | null = null;

  /**
   * The projection of `inputs` at the current clock reading. Readers with the
   * same inputs, by identity, share one result until its deadline.
   */
  read(inputs: ProjectionInputs): SharedProjection {
    const value = this.value;
    if (
      value !== null &&
      this.inputs !== null &&
      sameInputs(this.inputs, inputs) &&
      (value.deadline === undefined || Date.now() < value.deadline)
    )
      return value;
    this.value = derive(inputs, Date.now(), value?.projection);
    this.inputs = inputs;
    this.arm();
    return this.value;
  }

  /**
   * What Up Next ranks threads by (see `selectUpNext`), less the focused
   * workstreams, which each surface resolves for itself.
   */
  upNextOptions(
    { analysis, recaps }: Pick<ProjectionInputs, "analysis" | "recaps">,
    now: number,
    prefs: UpNextPrefs,
  ): UpNextOptions<PluginSidebarThread> {
    const cached = this.upNext;
    if (
      cached !== null &&
      cached.analysis === analysis &&
      cached.recaps === recaps &&
      cached.now === now &&
      cached.prefs === prefs
    )
      return cached.value;
    const value: UpNextOptions<PluginSidebarThread> = {
      kindOf: (thread) =>
        upNextKind(
          thread,
          workView(thread, analysis[thread.id], recaps[thread.id]),
        ),
      now,
      shown: prefs?.shown ?? UP_NEXT_SHOWN.fallback,
      unreadFirst: prefs?.unreadFirst ?? true,
      fill: prefs?.fill ?? true,
      freshWithinMs: UP_NEXT_FRESH_WINDOWS[prefs?.freshWindow ?? "off"],
    };
    this.upNext = { analysis, recaps, now, prefs, value };
    return value;
  }

  /** The clock, as the deadlines move it; subscribers render when it does. */
  clock = (): number => this.tick;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.arm();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.disarm();
    };
  };

  private advance = (): void => {
    this.timer = null;
    this.timerAt = undefined;
    this.tick++;
    for (const listener of [...this.listeners]) listener();
  };

  private arm(): void {
    const deadline = this.value?.deadline;
    if (this.listeners.size === 0 || deadline === undefined)
      return this.disarm();
    if (this.timerAt === deadline) return;
    this.disarm();
    this.timerAt = deadline;
    this.timer = setTimeout(this.advance, Math.max(0, deadline - Date.now()));
  }

  private disarm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = undefined;
  }
}

const stores = new WeakMap<object, ProjectionStore>();

/** The projection store for one plugin client, keyed like its other stores. */
export function projectionStoreFor(sdk: object): ProjectionStore {
  let store = stores.get(sdk);
  if (!store) {
    store = new ProjectionStore();
    stores.set(sdk, store);
  }
  return store;
}
