import { memo } from "react";
import { cn } from "@/lib/utils";
import {
  LIMIT_KEYS,
  LIMIT_METRIC,
  LIMIT_WINDOW,
  type LimitLevel,
  type LimitState,
  type UsageReport,
} from "../../domain/usage.ts";
import {
  LIMIT_LABEL,
  formatAmount,
  limitText,
  requests,
  usedText,
} from "./text.ts";

/** The bar's fill is the one thing that changes with a limit's level. */
const FILL: Record<LimitLevel, string> = {
  ok: "bg-foreground/55",
  warning: "bg-(--warning)",
  capped: "bg-destructive",
};

/**
 * How far a limit's window has come toward its pause threshold, or toward
 * its warning when it has no cap. A tick marks the warning on the way to a
 * cap.
 */
function LimitBar({ limit }: { limit: LimitState }) {
  const full = limit.cap ?? limit.warn ?? 0;
  const share = full > 0 ? Math.min(1, limit.used / full) : 1;
  const amount = (value: number) => formatAmount(limit.metric, value);
  return (
    <div
      role="meter"
      aria-label={LIMIT_LABEL[limit.key]}
      aria-valuemin={0}
      aria-valuemax={full}
      aria-valuenow={Math.min(limit.used, full)}
      aria-valuetext={`${amount(limit.used)} of ${amount(full)}`}
      className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-border"
    >
      <div
        className={cn("h-full", FILL[limit.level])}
        style={{ width: `${share * 100}%` }}
      />
      {limit.warn !== null && limit.cap !== null && limit.warn < limit.cap ? (
        <div
          className="absolute inset-y-0 w-0.5 bg-background"
          style={{ left: `${(limit.warn / limit.cap) * 100}%` }}
        />
      ) : null}
    </div>
  );
}

/**
 * The current windows against their limits: what each has used, a bar toward
 * its threshold, and where it stands. A window with no limit set shows what
 * it has used. Spend limits count reported cost only, so each spend window
 * names the requests it leaves out, and one whose requests all reported no
 * cost reads "No cost reported".
 */
export const Limits = memo(function Limits({
  state,
  windows,
}: Pick<UsageReport, "state" | "windows">) {
  return (
    <ul className="m-0 grid list-none gap-x-10 gap-y-4 p-0 sm:grid-cols-2">
      {LIMIT_KEYS.map((key) => {
        const limit = state.limits.find((entry) => entry.key === key);
        const totals = windows[LIMIT_WINDOW[key]];
        const metric = LIMIT_METRIC[key];
        const used =
          limit?.used ?? (metric === "spend" ? totals.cost : totals.calls);
        const unmetered = metric === "spend" ? totals.unmetered : 0;
        return (
          <li key={key} className="min-w-0 text-[13px]">
            <div className="flex items-baseline justify-between gap-3">
              <span>{LIMIT_LABEL[key]}</span>
              <span className="tabular-nums">
                {usedText(metric, used, totals)}
              </span>
            </div>
            {limit ? <LimitBar limit={limit} /> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              {limit ? limitText(limit) : "No limit set"}
            </p>
            {unmetered > 0 ? (
              <p className="text-xs text-muted-foreground">
                {requests(unmetered)} reported no cost
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
});
