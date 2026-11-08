/**
 * The single client-side model for the sidebar and the page: BB's
 * live sidebar threads plus the plugin's own state, run through the shared
 * domain projection.
 */
import { useEffect, useMemo, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useStableSidebarThreads } from "./useStableSidebarThreads.ts";
import { projectWorkstreams, type Projection } from "../domain/project.ts";
import type { Recap } from "../domain/recap.ts";
import { needsAttention, upNextKind, workView } from "../domain/status.ts";
import { nextUpNextDeadline } from "../domain/upNext.ts";
import type { ManualOrder } from "../domain/order.ts";
import { RECENT_LIMIT } from "../domain/prefs.ts";
import type { StoredAnalysis } from "../server/analyzer.ts";
import type { TopicState } from "../domain/topics.ts";
import type { WorkstreamTopics } from "../domain/groups.ts";
import {
  isSnoozed,
  type SnoozePrefs,
  type ThreadSnooze,
} from "../domain/snooze.ts";
import { useSharedServerState } from "./serverState.ts";
import { usePrefs } from "./prefs.ts";

export type ServerState = {
  /**
   * The first read of plugin state has finished, whether or not it succeeded.
   * Until then every other field is its empty default, which is not what the
   * server holds; surfaces that would draw a wrong first frame wait for it.
   */
  ready?: boolean;
  /**
   * A read of plugin state has succeeded, so the fields hold what the server
   * stored rather than empty defaults. Editors that save whole values, such
   * as the snooze preset list, wait for it so a default can't replace them.
   */
  loaded?: boolean;
  analysis: Record<string, StoredAnalysis>;
  /** Agent recaps for each thread's latest turn. */
  recaps: Record<string, Recap>;
  /** Ids of the recaps above whose docked card is dismissed. */
  dismissedRecaps?: string[];
  order: ManualOrder;
  snoozes: Record<string, ThreadSnooze>;
  snoozePrefs: SnoozePrefs;
  catalog?: TopicState;
  /** Organizing suggestions waiting for your decision. */
  pendingSuggestions?: number;
};

export type ReorderChange =
  | { kind: "workstreams"; ids: string[] }
  | { kind: "prioritized"; ids: string[] }
  | { kind: "threads"; groupId: string; ids: string[] };

/** Shared plugin state and optimistic actions for every UI consumer. */
export function useServerState() {
  return useSharedServerState();
}

export type { WorkView } from "../domain/status.ts";

/** Refreshes ages on an interval, or only at a visibility deadline. */
export function useNow(
  intervalMs: number | null = 60_000,
  deadline?: number,
): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let delay = intervalMs;
    if (
      deadline !== undefined &&
      (intervalMs === null || deadline > Date.now())
    )
      delay = Math.max(
        0,
        Math.min(intervalMs ?? Number.POSITIVE_INFINITY, deadline - Date.now()),
      );
    if (delay === null) return;
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [intervalMs, deadline, now]);
  return now;
}

export function useWorkstreams() {
  const { status, threads, sections, projects } = useStableSidebarThreads();
  const { prefs } = usePrefs();
  const { rpc, server, refresh, reorder, setSnoozes } = useServerState();

  const { analysis, recaps, order, snoozes, catalog } = server;
  const sampledAt = Date.now();
  const deadline = Math.min(
    ...Object.values(snoozes)
      .map((snooze) => snooze.until)
      .filter((until): until is number => until !== null && until > sampledAt),
    nextDormancyDeadline(threads, sections, {
      now: sampledAt,
      needsYou: (thread) => {
        const work = workView(thread, analysis[thread.id], recaps[thread.id]);
        return needsAttention(thread, work);
      },
      order,
      snoozedUntil: (thread) => {
        const snooze = snoozes[thread.id];
        return isSnoozed(snooze, sampledAt) ? snooze!.until : undefined;
      },
    }) ?? Number.POSITIVE_INFINITY,
    nextUpNextDeadline(threads, {
      kindOf: (thread) =>
        upNextKind(
          thread,
          workView(thread, analysis[thread.id], recaps[thread.id]),
        ),
      now: sampledAt,
      snoozedUntil: (thread) => {
        const snooze = snoozes[thread.id];
        return isSnoozed(snooze, sampledAt) ? snooze!.until : undefined;
      },
    }) ?? Number.POSITIVE_INFINITY,
  );
  const displayNow = useNow();
  const clock = useNow(null, Number.isFinite(deadline) ? deadline : undefined);
  // Parent rerenders keep the projection's clock stable. A timer deadline or
  // new projection input samples the current time for time-sensitive updates.
  const now = useMemo(
    () => Math.max(clock, Date.now()),
    [clock, threads, sections, analysis, recaps, order, snoozes, deadline],
  );
  /** What nests the workstreams (see `nestGroups`). */
  const topics: WorkstreamTopics | undefined = useMemo(
    () =>
      catalog
        ? {
            entities: catalog.entities,
            bindings: catalog.groups,
            layout: catalog.layout,
            categories: catalog.categories,
          }
        : undefined,
    [catalog],
  );
  const projection: Projection<PluginSidebarThread> = useMemo(
    () =>
      projectWorkstreams(threads, sections, {
        now,
        needsYou: (thread) => {
          const work = workView(thread, analysis[thread.id], recaps[thread.id]);
          return needsAttention(thread, work);
        },
        order,
        snoozedUntil: (thread) => {
          const snooze = snoozes[thread.id];
          return isSnoozed(snooze, now) ? snooze!.until : undefined;
        },
      }),
    [threads, sections, now, analysis, recaps, order, snoozes],
  );
  /**
   * What Up Next ranks threads by (see `selectUpNext`), less the focused
   * workstreams, which each surface resolves for itself.
   */
  const upNextOptions = useMemo(
    () => ({
      kindOf: (thread: PluginSidebarThread) =>
        upNextKind(
          thread,
          workView(thread, analysis[thread.id], recaps[thread.id]),
        ),
      now,
    }),
    [analysis, recaps, now],
  );
  return {
    status,
    projection,
    topics,
    threads,
    sections,
    projects,
    server,
    work: (thread: PluginSidebarThread) =>
      workView(thread, analysis[thread.id], recaps[thread.id]),
    upNextOptions,
    now,
    displayNow,
    rpc,
    refresh,
    reorder,
    setSnoozes,
    snoozeOf: (thread: PluginSidebarThread) => {
      const snooze = snoozes[thread.id];
      return isSnoozed(snooze, now) ? snooze : undefined;
    },
    snoozePrefs: server.snoozePrefs,
    showForYou: prefs?.sidebar.showForYou ?? true,
    showRecent: prefs?.sidebar.showRecent ?? true,
    recentLimit: prefs?.sidebar.recentLimit ?? RECENT_LIMIT.fallback,
    showSnoozed: prefs?.sidebar.showSnoozed ?? true,
    showArchived: prefs?.sidebar.showArchived ?? true,
    showParentThreadLink: prefs?.threads.showParentLink ?? false,
  };
}
