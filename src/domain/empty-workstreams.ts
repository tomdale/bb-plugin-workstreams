/** A short-lived place to start the next thread, never a permanent empty row. */
export const EMPTY_WORKSTREAM_GRACE_MS = 10 * 60_000;
export const EMPTY_WORKSTREAM_LIMIT = 3;

/** Last time a workstream had a visible, non-archived, unsnoozed thread. */
export type LastPopulatedAt = Readonly<Record<string, number>>;

/** Newest empty workstreams win the shared budget, regardless of focus or nesting. */
export function retainedEmptyWorkstreams(
  emptyIds: readonly string[],
  lastPopulatedAt: LastPopulatedAt,
  now: number,
): Set<string> {
  return new Set(
    emptyIds
      .filter((id) => {
        const at = lastPopulatedAt[id];
        return (
          at !== undefined &&
          Number.isFinite(at) &&
          at <= now &&
          now - at < EMPTY_WORKSTREAM_GRACE_MS
        );
      })
      .sort(
        (a, b) =>
          lastPopulatedAt[b]! - lastPopulatedAt[a]! || a.localeCompare(b),
      )
      .slice(0, EMPTY_WORKSTREAM_LIMIT),
  );
}
