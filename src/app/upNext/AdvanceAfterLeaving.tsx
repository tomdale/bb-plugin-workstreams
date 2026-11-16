/**
 * Opens the next thread when the thread in view leaves the sidebar: when it is
 * snoozed, and when it is archived by anything (the recap card, the sidebar,
 * the header, BB's shortcut, another plugin), since BB archives and then
 * leaves the user on the composer. Putting a thread away is a decision about
 * what to do next, so the next thing to look at comes with it, and it is the
 * thread the next Up Next command would have opened (see
 * `domain/upNextNavigation.ts`).
 *
 * Up Next's order is read while the thread is still listed: once it has left,
 * its place in the order is gone with it. The move waits a beat so whatever
 * the surface that archived it does next lands first, and it stays put when
 * the user has gone somewhere of their own. A toast says what left and offers
 * to go back, since the archive or snooze may not have been the user's (see
 * `moveNotice.ts`).
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  experimental_useSidebarThreadActions,
  useBbContext,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { Projection } from "../../domain/project.ts";
import { isSnoozed, type ThreadSnooze } from "../../domain/snooze.ts";
import {
  nextThreadAfterLeaving,
  upNextOrder,
} from "../../domain/upNextNavigation.ts";
import { useWorkstreams } from "../useWorkstreams.ts";
import { wasSnoozedHere } from "../snooze/actions.ts";
import { announceMove } from "./moveNotice.ts";
import { readSidebarUpNext, subscribeSidebarUpNext } from "./sidebarOrder.ts";

/** How long the surface that archived the thread has to finish its own move. */
const ADVANCE_DELAY_MS = 50;

/** What the last render knew, so a thread that left can still be placed. */
type Seen = {
  /** The thread that was in view. */
  readonly viewed: string | null;
  /** The projection while that thread was still in it. */
  readonly projection: Projection<PluginSidebarThread>;
  /** Up Next's order then, derived only when a thread leaves. */
  readonly order: () => readonly string[];
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
  // Renders when the sidebar draws a new order, so the order a departure
  // reads is the one the user last saw.
  const sidebarOrder = useSyncExternalStore(
    subscribeSidebarUpNext,
    readSidebarUpNext,
  );
  const { projection, upNextOptions, topics } = ws;
  const order = useMemo(() => {
    if (sidebarOrder) return () => sidebarOrder;
    let ranked: readonly string[] | undefined;
    return () =>
      (ranked ??= upNextOrder(projection, upNextOptions, {
        prioritized,
        topics,
      }));
  }, [sidebarOrder, projection, upNextOptions, prioritized, topics]);
  const listed = useMemo(
    () => new Set(ws.threads.map((thread) => thread.id)),
    [ws.threads],
  );
  const snoozes = ws.server.snoozes;
  const snoozesLoaded = ws.server.loaded === true;
  const seen = useRef<Seen | undefined>(undefined);
  const route = useRef(threadId);
  route.current = threadId;
  /** What the sidebar lists now, for a move still waiting out its delay. */
  const currentList = useRef(listed);
  currentList.current = listed;
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
      projection,
      order,
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
    // Whatever the last departure asked for, this one decides again.
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    // The app has already taken the user somewhere else; leave them there.
    if (threadId !== null && threadId !== departing) return;
    // Nothing that is going away in this same change can be where to go next:
    // a snoozed workstream, or an archive that took threads with it.
    const leaving = new Set<string>([departing]);
    for (const id of previous.listed) if (!listed.has(id)) leaving.add(id);
    if (snoozed)
      for (const [id, snooze] of Object.entries(snoozes))
        if (!isSnoozed(previous.snoozes[id], now) && isSnoozed(snooze, now))
          leaving.add(id);
    const target = nextThreadAfterLeaving(
      previous.projection,
      previous.order(),
      departing,
      leaving,
    );
    if (!target) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const at = route.current;
      // A thread that left before the delay was up is no place to go, and a
      // route the user chose is theirs.
      if (!currentList.current.has(target)) return;
      if (at !== null && at !== departing) return;
      actions.open(target);
      if (snoozed && wasSnoozedHere(departing)) return;
      announceMove({
        reason: snoozed ? "snoozed" : "archived",
        leftTitle: titleOf(previous.projection, departing),
        openedTitle: titleOf(previous.projection, target),
        goBack: () => actions.open(departing),
      });
    }, ADVANCE_DELAY_MS);
  }, [
    ws.status,
    threadId,
    projection,
    order,
    listed,
    snoozesLoaded,
    snoozes,
    actions,
  ]);

  return null;
}

const titleOf = (projection: Projection<PluginSidebarThread>, id: string) =>
  projection.rowOf.get(id)?.thread.displayTitle ?? "Untitled thread";
