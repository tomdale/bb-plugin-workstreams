import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { UsageFlag } from "../../domain/usage.ts";
import { UsageThreadLink } from "./ThreadLink.tsx";
import { formatAt } from "./text.ts";

const SEVERITY: Record<UsageFlag["severity"], { label: string; tone: string }> =
  {
    warning: { label: "Warning", tone: "text-(--warning-text)" },
    critical: { label: "Critical", tone: "text-destructive" },
  };

/**
 * What the detectors found wrong in the recent ledger, critical flags first
 * and the newest evidence first within a severity: each flag's severity,
 * title, evidence, and the thread behind it when it has one.
 */
export const Flags = memo(function Flags({
  flags,
  now,
}: {
  flags: readonly UsageFlag[];
  now: number;
}) {
  const ordered = useMemo(
    () =>
      [...flags].sort(
        (a, b) =>
          Number(b.severity === "critical") -
            Number(a.severity === "critical") || b.at - a.at,
      ),
    [flags],
  );
  return (
    <ul className="m-0 -mt-1.5 list-none p-0">
      {ordered.map((flag) => {
        const severity = SEVERITY[flag.severity];
        return (
          <li
            key={flag.id}
            className="-mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-md px-2 py-2 text-[13px] focus-within:bg-state-hover/50 hover:bg-state-hover/50"
          >
            <div className="min-w-0 break-words">
              <span className={cn("mr-1.5 text-xs", severity.tone)}>
                {severity.label}
              </span>
              <span>{flag.title}</span>
              <p className="m-0 text-xs text-muted-foreground">{flag.detail}</p>
              {flag.threadId ? (
                <p className="m-0 mt-0.5 text-xs">
                  <UsageThreadLink threadId={flag.threadId} />
                </p>
              ) : null}
            </div>
            <time
              dateTime={new Date(flag.at).toISOString()}
              className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
            >
              {formatAt(flag.at, now)}
            </time>
          </li>
        );
      })}
    </ul>
  );
});
