/**
 * Reads recent ledger rows and runs the detectors (`detectUsageFlags`) when
 * the `detectors` preference is on. The Usage page, the Page menu's mark, and
 * `bb workstreams usage` read its flags.
 *
 * SKELETON: the lead fixed these signatures so the report and the Usage page
 * can be built in parallel. Keep them; fill in the bodies.
 */
import type { Prefs } from "../domain/prefs.ts";
import type { UsageFlag } from "../domain/usage.ts";
import type { UsageReader } from "./usage.ts";

export class UsageMonitor {
  constructor(
    private readonly deps: {
      ledger: UsageReader;
      prefs: () => Prefs["usage"];
      now?: () => number;
    },
  ) {
    void this.deps;
  }

  /** Current flags; empty while detectors are off. Cheap to call often. */
  flags(): UsageFlag[] {
    throw new Error("UsageMonitor.flags is not implemented.");
  }
}
