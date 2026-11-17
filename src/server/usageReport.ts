/**
 * The usage report: the ledger's aggregates for a range, the current limit
 * windows, the spend guard's state, and the flags, read at one moment. The
 * Usage page (the `usage` RPC) and `bb workstreams usage` show the same one.
 */
import type { UsageRange, UsageReport } from "../domain/usage.ts";
import type { SpendGuard } from "./spendGuard.ts";
import type { UsageLedger } from "./usage.ts";
import type { UsageMonitor } from "./usageMonitor.ts";

export type UsageReportDeps = {
  ledger: Pick<UsageLedger, "summary" | "totals">;
  guard: Pick<SpendGuard, "status" | "resume">;
  monitor: Pick<UsageMonitor, "flags">;
  /**
   * A lookup naming the workstream each thread belongs to now (`null` for
   * none). Called once per report, so one report reads the workstreams once.
   */
  workstreamOfThread: () => (
    threadId: string,
  ) => { key: string; label: string } | null;
};

export function buildUsageReport(
  deps: UsageReportDeps,
  range: UsageRange,
  now: number,
): UsageReport {
  return {
    ...deps.ledger.summary(range, {
      now,
      groupOfThread: deps.workstreamOfThread(),
    }),
    now,
    windows: deps.ledger.totals(now),
    state: deps.guard.status(),
    flags: deps.monitor.flags(),
  };
}
