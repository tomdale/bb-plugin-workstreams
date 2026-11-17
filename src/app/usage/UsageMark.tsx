import { cn } from "@/lib/utils";
import type { UsageIndicator } from "../../domain/usage.ts";
import { formatCount } from "./format.ts";

/** What the mark says, most pressing first, or null when nothing needs a look. */
function markOf(
  indicator: UsageIndicator | null,
): { text: string; tone: string } | null {
  if (!indicator) return null;
  if (indicator.level === "capped")
    return { text: "Paused", tone: "text-destructive" };
  if (indicator.level === "warning")
    return { text: "Warning", tone: "text-(--warning-text)" };
  if (indicator.flags > 0)
    return {
      text: `${formatCount(indicator.flags)} ${indicator.flags === 1 ? "flag" : "flags"}`,
      tone: "text-(--warning-text)",
    };
  return null;
}

/**
 * The quiet mark on the Page menu's Usage item: a word at the item's far edge
 * while model calls are paused, a warning is reached, or flags are raised.
 */
export function UsageMark({ indicator }: { indicator: UsageIndicator | null }) {
  const mark = markOf(indicator);
  return mark ? (
    <span className={cn("ml-auto pl-4 text-xs", mark.tone)}>{mark.text}</span>
  ) : null;
}
