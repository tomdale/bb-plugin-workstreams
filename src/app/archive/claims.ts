/**
 * Archives Workstreams starts and lands itself. The recap card's Archive picks
 * its own destination (see `nextUpNextThreadAfterArchive`), so the observer that
 * opens the next thread whenever the thread in view goes away has to know not to
 * fight it (see `upNext/AdvanceAfterLeaving`). A claim is taken when the archive
 * is requested and read when the thread leaves the sidebar.
 */
const claimed = new Map<string, number>();
/** A claim lives only long enough for the archive it belongs to to land. */
const CLAIM_TIMEOUT_MS = 60_000;

/** Claims this archive, returning a release for one that never lands. */
export function claimArchiveNavigation(threadId: string): () => void {
  const now = Date.now();
  for (const [id, at] of claimed)
    if (now - at > CLAIM_TIMEOUT_MS) claimed.delete(id);
  claimed.set(threadId, now);
  return () => claimed.delete(threadId);
}

/**
 * Whether Workstreams is landing the user itself for this thread's archive.
 * Reading a claim consumes it, so a later archive of the same thread is
 * observed on its own.
 */
export function claimedArchiveNavigation(threadId: string): boolean {
  const at = claimed.get(threadId);
  if (at === undefined) return false;
  claimed.delete(threadId);
  return Date.now() - at <= CLAIM_TIMEOUT_MS;
}
