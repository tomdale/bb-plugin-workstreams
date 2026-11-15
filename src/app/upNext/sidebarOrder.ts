/**
 * Up Next's order as the Workstreams sidebar last drew it: the open thread
 * held in place, and Show more's rows when it is open (see
 * `sidebar/upNextState.ts`). Navigation reads it so "the next Up Next thread"
 * is the row the user sees below the one they're on, whichever surface asks
 * (see `domain/upNextNavigation.ts`). Null while no Workstreams sidebar is
 * drawn, as on a phone or with BB's own thread list; navigation then ranks Up
 * Next itself.
 */
let order: readonly string[] | null = null;
const listeners = new Set<() => void>();

/** The sidebar's drawn Up Next ids, or null when no sidebar is drawing. */
export function readSidebarUpNext(): readonly string[] | null {
  return order;
}

/** Records the drawn order; the sidebar passes null when it unmounts. */
export function publishSidebarUpNext(ids: readonly string[] | null): void {
  if (ids === order) return;
  if (
    ids &&
    order &&
    ids.length === order.length &&
    ids.every((id, i) => id === order![i])
  )
    return;
  order = ids;
  for (const listener of [...listeners]) listener();
}

export function subscribeSidebarUpNext(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
