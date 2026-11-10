import { useEffect, useState } from "react";
import { experimental_useSidebarThreadActions } from "@get-bb/plugin-sdk/app";
import type { Recap } from "../../domain/recap.ts";
import {
  nextThreadAfterArchive,
  nextUpNextThreadAfterArchive,
} from "../../domain/archiveNavigation.ts";
import { useSharedServerActions } from "../serverState.ts";
import { useSidebarThread } from "../useStableSidebarThreads.ts";
import { useUpNextReader } from "../useWorkstreams.ts";
import { claimArchiveNavigation } from "./claims.ts";

/**
 * Recaps whose Archive the user passed up by continuing the thread. Clearing
 * the draft doesn't bring the button back; the next recap can offer it again.
 */
const declined = new Set<string>();

/**
 * Archive on the recap card: offered once the server confirms the thread has no outstanding work, and hidden while the
 * user continues the thread.
 */
export function useArchiveSuggestion(
  threadId: string | null,
  recap: Recap | null,
  continuing = false,
) {
  const { rpc, refresh } = useSharedServerActions();
  const readUpNext = useUpNextReader();
  const actions = experimental_useSidebarThreadActions();
  // The threads the projection lists: hidden and archived ones are not.
  const listed = useSidebarThread(threadId);
  const thread =
    listed && !listed.isHidden && !listed.isArchived ? listed : undefined;
  const recapId = recap?.id ?? null;
  const [eligible, setEligible] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeWork =
    thread !== undefined &&
    (thread.status !== "idle" ||
      thread.runtimeStatus !== "idle" ||
      thread.queuedWork !== "none" ||
      thread.hasPendingInteraction ||
      Object.values(thread.activity).some((count) => count > 0));
  if (recapId && continuing && !busy) declined.add(recapId);
  const offered =
    threadId !== null &&
    recapId !== null &&
    !declined.has(recapId) &&
    !continuing &&
    !activeWork;

  useEffect(() => {
    let canceled = false;
    setEligible(null);
    if (!offered) return;
    void rpc
      .call("archiveStatus", { threadId })
      .then((status) => {
        if (!canceled) setEligible(status.recapId);
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [
    offered,
    threadId,
    recapId,
    rpc,
    thread?.latestAttentionAt,
    thread?.isArchived,
  ]);
  useEffect(() => setError(null), [recapId]);

  const visible = offered && eligible === recapId;
  const archive = async () => {
    if (!visible || !threadId || !recapId || busy) return;
    setBusy(true);
    setError(null);
    const { projection, upNext } = readUpNext();
    const nextThreadId =
      nextUpNextThreadAfterArchive(projection, threadId, upNext) ??
      nextThreadAfterArchive(projection, threadId);
    try {
      // The recap card picks its own destination, so the observer that opens
      // the next Up Next thread leaves this archive to it.
      const release = claimArchiveNavigation(threadId);
      try {
        await rpc.call("archive", { threadId, recapId });
      } catch (cause) {
        release();
        throw cause;
      }
      if (nextThreadId) actions.open(nextThreadId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return { visible, busy, error, archive };
}
