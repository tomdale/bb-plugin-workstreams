/**
 * What looks wrong in recent usage: spikes, loops, and spend nobody can see.
 * Pure, over ledger rows, so the same findings come from the server, a test,
 * and a fixture.
 *
 * SKELETON: the lead fixed this signature so the monitor and the Usage page
 * can be built in parallel. Keep it; fill in the body.
 */
import type { UsageEntry, UsageFlag } from "./usage.ts";

/**
 * Flags for `entries` (rows from at least the last 8 days, oldest first) at
 * `now`. Newest evidence first within a severity, critical before warning.
 */
export function detectUsageFlags(
  _entries: readonly UsageEntry[],
  _now: number,
): UsageFlag[] {
  throw new Error("detectUsageFlags is not implemented.");
}
