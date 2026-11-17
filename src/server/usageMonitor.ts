/**
 * Reads recent ledger rows and runs the detectors (`detectUsageFlags`) when
 * the `detectors` preference is on. The Usage page, the Page menu's mark, and
 * `bb workstreams usage` read its flags.
 */
import type { Prefs } from "../domain/prefs.ts";
import type { UsageFlag } from "../domain/usage.ts";
import { detectUsageFlags } from "../domain/usageAlerts.ts";
import type { UsageReader } from "./usage.ts";

/** The detectors' reach: a 24-hour window and the 7 days before it. */
const LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000;
/** Far above eight days of this plugin's calls; bounds one read. */
const ROW_LIMIT = 60_000;
/** How long one reading is served, so a status poll does not rescan the ledger. */
const CACHE_MS = 15_000;

export class UsageMonitor {
  private cached: { at: number; flags: UsageFlag[] } | null = null;

  constructor(
    private readonly deps: {
      ledger: UsageReader;
      prefs: () => Prefs["usage"];
      now?: () => number;
    },
  ) {}

  /** Current flags; empty while detectors are off. Cheap to call often. */
  flags(): UsageFlag[] {
    if (!this.deps.prefs().detectors) {
      this.cached = null;
      return [];
    }
    const now = (this.deps.now ?? Date.now)();
    const age = this.cached ? now - this.cached.at : Infinity;
    if (this.cached && age >= 0 && age < CACHE_MS) return this.cached.flags;
    const flags = detectUsageFlags(
      this.deps.ledger.recent(now - LOOKBACK_MS, ROW_LIMIT),
      now,
    );
    this.cached = { at: now, flags };
    return flags;
  }
}
