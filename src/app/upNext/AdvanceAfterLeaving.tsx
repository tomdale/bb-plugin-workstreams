/**
 * Opens the next Up Next thread when the thread in view leaves the sidebar:
 * when it is snoozed, and when it is archived by anything, since BB and other
 * plugins archive and then leave the user on the composer. Putting a thread
 * away is a decision about what to do next, so the next thing to look at comes
 * with it.
 *
 * Up Next's order is read while the thread is still listed: once it has left,
 * its place in the order is gone with it (see `nextUpNextRowAfterLeaving`). The
 * move waits a beat so whatever the surface that archived it does next lands
 * first, and it stays put when the user has gone somewhere of their own.
 */
import { useEffect, useMemo, useRef } from "react";
import {
  experimental_useSidebarThreadActions,
  useBbContext,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { nextUpNextRowAfterLeaving } from "../../domain/archiveNavigation.ts";
import type { Row } from "../../domain/project.ts";
import { isSnoozed, type ThreadSnooze } from "../../domain/snooze.ts";
import { selectUpNext } from "../../domain/upNext.ts";
import { claimedArchiveNavigation } from "../archive/claims.ts";
import { useWorkstreams } from "../useWorkstreams.ts";

/** How long the surface that archived the thread has to finish its own move. */
const ADVANCE_DELAY_MS = 50;

/** What the last render knew, so a thread that left can still be placed. */
type Seen = {
  /** The thread that was in view. */
  readonly viewed: string | null;
  /** Up Next's order, read while that thread was still in it. */
  readonly rows: readonly Row<PluginSidebarThread>[];
  /** The threads the sidebar listed. */
  readonly listed: ReadonlySet<string>;
  /** Whether `snoozes` holds what the server stored, not the empty default. */
  readonly snoozesLoaded: boolean;
  readonly snoozes: Record<string, ThreadSnooze>;
};

export function AdvanceAfterLeaving(): null {
  const ws = useWorkstreams();
  const actions = experimental_useSidebarThreadActions();
  const { threadId } = useBbContext();
  const prioritized = ws.server.order.prioritized;
  const rows = useMemo(
    () =>
      selectUpNext(ws.projection, {
        ...ws.upNextOptions,
        prioritized: new Set(prioritized),
      }).rows,
    [ws.projection, ws.upNextOptions, prioritized],
  );
  const listed = useMemo(
    () => new Set(ws.threads.map((thread) => thread.id)),
    [ws.threads],
  );
  const snoozes = ws.server.snoozes;
  const snoozesLoaded = ws.server.loaded === true;
  const seen = useRef<Seen | undefined>(undefined);
  const route = useRef(threadId);
  route.current = threadId;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    // A list still loading isn't a thread that left.
    if (ws.status !== "ready") return;
    const previous = seen.current;
    seen.current = {
      viewed: threadId,
      rows,
      listed,
      snoozesLoaded,
      snoozes,
    };
    if (!previous || previous.viewed === null) return;
    const departing = previous.viewed;
    const now = Date.now();
    // Snoozes read before the server's state arrived would look like every
    // snoozed thread waking up and going back to sleep.
    const snoozed =
      snoozesLoaded &&
      previous.snoozesLoaded &&
      !isSnoozed(previous.snoozes[departing], now) &&
      isSnoozed(snoozes[departing], now);
    const leftSidebar =
      previous.listed.has(departing) && !listed.has(departing);
    if (!snoozed && !leftSidebar) return;
    // The app has already taken the user somewhere else; leave them there.
    if (threadId !== null && threadId !== departing) return;
    if (leftSidebar && claimedArchiveNavigation(departing)) return;
    // Nothing that is going away in this same change can be where to go next:
    // a snoozed workstream, or an archive that took threads with it.
    const leaving = new Set<string>([departing]);
    for (const id of previous.listed) if (!listed.has(id)) leaving.add(id);
    if (snoozed)
      for (const [id, snooze] of Object.entries(snoozes))
        if (!isSnoozed(previous.snoozes[id], now) && isSnoozed(snooze, now))
          leaving.add(id);
    const next = nextUpNextRowAfterLeaving(previous.rows, departing, leaving);
    if (!next) return;
    const target = next.thread.id;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const at = route.current;
      if (at === null || at === departing) actions.open(target);
    }, ADVANCE_DELAY_MS);
  }, [ws.status, threadId, rows, listed, snoozesLoaded, snoozes, actions]);

  return null;
}
