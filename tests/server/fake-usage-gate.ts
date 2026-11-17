import type { NewUsageEntry, UsageSource } from "../../src/domain/usage.ts";
import { SpendCapError } from "../../src/server/spendGuard.ts";
import type { UsageGate } from "../../src/server/usage.ts";

/**
 * A `UsageGate` for tests of what spends: it keeps the rows it is given and
 * the sources it admitted, and refuses every call while `refusing` is set, as
 * the spend guard does at a reached cap.
 */
export function fakeUsageGate(): UsageGate & {
  rows: NewUsageEntry[];
  admitted: UsageSource[];
  refusing: boolean;
} {
  const rows: NewUsageEntry[] = [];
  const admitted: UsageSource[] = [];
  return {
    rows,
    admitted,
    refusing: false,
    admit(source) {
      if (this.refusing)
        throw new SpendCapError("Workstreams model calls are paused.", {
          level: "capped",
          limits: [],
        });
      admitted.push(source);
    },
    record(entry) {
      rows.push(entry);
    },
  };
}
