import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Splits "<Owner>: <Area>" into its parts; null for a plain name. */
export function splitWorkstreamName(
  name: string,
): { owner: string; area: string } | null {
  const at = name.indexOf(":");
  if (at <= 0) return null;
  const owner = name.slice(0, at).trim();
  const area = name.slice(at + 1).trim();
  return owner && area ? { owner, area } : null;
}

/**
 * A workstream's name. An area of a larger product ("Workstreams: Recaps")
 * shows the owner subdued before the area, without the colon; the colon is
 * kept in the accessible text so screen readers hear the full name.
 *
 * `mark` is drawn between the owner and the area, and leads the name when
 * there is no owner (see `WorkstreamTile`).
 */
export function WorkstreamName({
  name,
  className,
  muted = false,
  mark,
}: {
  name: string;
  className?: string;
  muted?: boolean;
  /** Drawn after the first-tier prefix, or before the name when there is none. */
  mark?: ReactNode;
}) {
  const parts = splitWorkstreamName(name);
  if (mark)
    return (
      <span className={cn("flex min-w-0 items-center gap-1", className)}>
        {parts ? (
          <>
            <span className="min-w-0 truncate font-normal text-muted-foreground/60">
              {parts.owner}
              <span className="sr-only">:</span>
            </span>{" "}
          </>
        ) : null}
        {mark}{" "}
        <span
          className={cn(
            "min-w-0 truncate",
            muted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {parts?.area ?? name}
        </span>
      </span>
    );
  if (!parts)
    return (
      <span
        className={cn(
          "truncate",
          muted ? "text-muted-foreground" : "text-foreground",
          className,
        )}
      >
        {name}
      </span>
    );
  return (
    <span className={cn("truncate", className)}>
      <span className="font-normal text-muted-foreground/60">
        {parts.owner}
      </span>
      <span className="sr-only">:</span>{" "}
      <span className={muted ? "text-muted-foreground" : "text-foreground"}>
        {parts.area}
      </span>
    </span>
  );
}
