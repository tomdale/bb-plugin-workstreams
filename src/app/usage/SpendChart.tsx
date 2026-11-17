import { memo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { UsageBucket } from "../../domain/usage.ts";
import { Hint } from "../Hint.tsx";
import { formatMoney } from "./format.ts";
import { axisStart, bucketText, bucketWhen, spendLines } from "./text.ts";

/** Past this many bars the gaps between them narrow to a pixel. */
const DENSE = 40;

/**
 * Reported cost per bucket, as bars scaled to the costliest bucket. A bucket
 * whose requests reported no cost has no height to draw, so it shows a stub
 * on the baseline: requests were made there, at a cost nobody reported.
 *
 * Each bar's time, cost, and requests are its hint and its accessible name.
 * The chart is one tab stop; the arrow keys, Home, and End move between bars.
 */
export const SpendChart = memo(function SpendChart({
  buckets,
  bucketMs,
  label,
}: {
  buckets: readonly UsageBucket[];
  bucketMs: number;
  /** The chart's accessible name. */
  label: string;
}) {
  const bars = useRef<(HTMLElement | null)[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  // The newest bucket takes the tab stop until a bar has been focused.
  const active = Math.min(chosen ?? buckets.length - 1, buckets.length - 1);
  const peak = buckets.reduce((most, bucket) => Math.max(most, bucket.cost), 0);

  const onKeyDown = (event: KeyboardEvent) => {
    const to =
      event.key === "ArrowLeft"
        ? active - 1
        : event.key === "ArrowRight"
          ? active + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buckets.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    bars.current[Math.max(0, Math.min(buckets.length - 1, to))]?.focus();
  };

  const first = buckets[0];
  return (
    <div>
      <div className="h-4 text-[11px] leading-4 tabular-nums text-muted-foreground">
        {peak > 0 ? formatMoney(peak) : null}
      </div>
      <ol
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn(
          "m-0 flex h-28 list-none items-stretch border-b border-t border-border p-0",
          buckets.length > DENSE ? "gap-px" : "gap-0.5",
        )}
      >
        {buckets.map((bucket, index) => (
          <li key={bucket.start} className="flex min-w-0 flex-1">
            <Hint
              delay={80}
              label={
                <>
                  <span className="block text-muted-foreground">
                    {bucketWhen(bucket.start, bucketMs)}
                  </span>
                  {spendLines(bucket).map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </>
              }
            >
              <span
                ref={(node) => {
                  bars.current[index] = node;
                }}
                role="img"
                aria-label={bucketText(bucket, bucketMs)}
                tabIndex={index === active ? 0 : -1}
                onFocus={() => setChosen(index)}
                className="group/bar flex w-full items-end rounded-t-sm hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-2 focus-visible:outline-ring"
              >
                {bucket.cost > 0 ? (
                  <span
                    className="w-full rounded-t-[1px] bg-foreground/55 group-hover/bar:bg-foreground group-focus-visible/bar:bg-foreground"
                    style={{
                      height: `max(2px, ${(bucket.cost / peak) * 100}%)`,
                    }}
                  />
                ) : bucket.calls > 0 ? (
                  <span className="h-0.5 w-full bg-muted-foreground/50" />
                ) : null}
              </span>
            </Hint>
          </li>
        ))}
      </ol>
      <div className="mt-1 flex justify-between text-[11px] leading-4 text-muted-foreground">
        <span>{first ? axisStart(first.start, bucketMs) : null}</span>
        <span>Now</span>
      </div>
    </div>
  );
});
