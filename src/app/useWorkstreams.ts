/**
 * The single client-side model for the sidebar and the page: BB's
 * live sidebar threads plus the plugin's own state, run through the shared
 * domain projection (see `sharedProjection.ts`).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  useSidebarThreadsReader,
  useStableSidebarThreads,
} from "./useStableSidebarThreads.ts";
import type { Projection } from "../domain/project.ts";
import type { Recap } from "../domain/recap.ts";
import { workView } from "../domain/status.ts";
import type { UpNextOptions } from "../domain/upNext.ts";
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
import { useServerStateReader, useSharedServerState } from "./serverState.ts";
import { usePrefsRealtime, usePrefs, usePrefsSelector } from "./prefs.ts";
import { projectionStoreFor } from "./sharedProjection.ts";

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
  const shared = projectionStoreFor(useSdk());
  // Renders when a deadline passes; the read below then takes a new reading.
  useSyncExternalStore(shared.subscribe, shared.clock, shared.clock);

  const { analysis, recaps, order, snoozes, catalog } = server;
  const { projection, now } = shared.read({
    threads,
    sections,
    analysis,
    recaps,
    order,
    snoozes,
  });
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
    // A filing changes the catalog's assignments, which nesting never reads.
    [catalog?.entities, catalog?.groups, catalog?.layout, catalog?.categories],
  );
  const upNextOptions = shared.upNextOptions(
    { analysis, recaps },
    now,
    prefs?.upNext,
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

/** The projection and Up Next's options, as an action reads them when it runs. */
export type UpNextReading = {
  readonly projection: Projection<PluginSidebarThread>;
  /** Up Next's options, focused on the stored focused workstreams. */
  readonly upNext: UpNextOptions<PluginSidebarThread>;
};

/**
 * Reads the shared projection on demand, for an action that needs it only
 * when it runs, such as the next-Up-Next command or the recap card's
 * Archive. The surface keeps the server state and preferences live but does
 * not render for their changes, and derives nothing until it reads; the
 * read shares the projection every rendered surface already derived.
 *
 * The sidebar's default view must be fed by a wide consumer (see
 * `useSidebarThreadsPublisher`) or by a single-thread lookup on the same
 * surface (see `useSidebarThread`).
 */
export function useUpNextReader(): () => UpNextReading {
  const shared = projectionStoreFor(useSdk());
  const readThreads = useSidebarThreadsReader();
  const readServer = useServerStateReader();
  usePrefsRealtime();
  const upNextPrefs = usePrefsSelector((prefs) => prefs?.upNext);
  return useCallback(() => {
    const { threads, sections } = readThreads();
    const { analysis, recaps, order, snoozes } = readServer();
    const { projection, now } = shared.read({
      threads,
      sections,
      analysis,
      recaps,
      order,
      snoozes,
    });
    return {
      projection,
      upNext: {
        ...shared.upNextOptions({ analysis, recaps }, now, upNextPrefs),
        prioritized: new Set(order.prioritized),
      },
    };
  }, [shared, readThreads, readServer, upNextPrefs]);
}
