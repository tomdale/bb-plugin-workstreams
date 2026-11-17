/**
 * The usage ledger: one `ws_usage` row for every attempt that may have spent
 * provider money (see `domain/usage.ts`). It is the one place totals, limits,
 * and flags read from, and it is separate from model traces so that trace
 * retention, **Delete model traces…**, and turning the debug record off never
 * change what Workstreams knows it spent.
 *
 * SKELETON: the lead fixed these signatures so the guard, the monitor, the
 * report, and the instrumentation can be built in parallel. Keep them; fill in
 * the bodies.
 */
import type {
  NewUsageEntry,
  UsageEntry,
  UsageRange,
  UsageSource,
  UsageSummary,
  UsageTotalsByWindow,
} from "../domain/usage.ts";
import type { Database } from "./db.ts";

/** What the guard and the monitor read; the ledger implements it. */
export interface UsageReader {
  /** The hour, day, and month windows' totals at `now`. */
  totals(now?: number): UsageTotalsByWindow;
  /** Rows that started at or after `since`, oldest first, at most `limit`. */
  recent(since: number, limit?: number): UsageEntry[];
}

/**
 * How everything that can spend provider money reports to the ledger and
 * asks the spend guard first. Callers hold this, never the ledger or guard.
 */
export interface UsageGate {
  /** Throws `SpendCapError` when a hard cap pauses calls. Call before spending. */
  admit(source: UsageSource): void;
  /** Records one attempt, after it ended (any status). Never throws. */
  record(entry: NewUsageEntry): void;
}

export class UsageLedger implements UsageReader {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  record(_entry: NewUsageEntry): UsageEntry {
    void this.db;
    void this.now;
    throw new Error("UsageLedger.record is not implemented.");
  }

  totals(_now?: number): UsageTotalsByWindow {
    throw new Error("UsageLedger.totals is not implemented.");
  }

  recent(_since: number, _limit?: number): UsageEntry[] {
    throw new Error("UsageLedger.recent is not implemented.");
  }

  /**
   * The Usage page's aggregates for `range`. `groupOfThread` names the
   * workstream a thread belongs to now (`null` for none), so `byWorkstream`
   * reflects current membership.
   */
  summary(
    _range: UsageRange,
    _options: {
      now?: number;
      groupOfThread?: (
        threadId: string,
      ) => { key: string; label: string } | null;
    } = {},
  ): UsageSummary {
    throw new Error("UsageLedger.summary is not implemented.");
  }

  /** Applies retention (90 days, 250,000 rows). Cheap to call after every record. */
  prune(_options: { force?: boolean } = {}): void {
    // Skeleton: nothing is stored yet, so there is nothing to prune.
  }
}
