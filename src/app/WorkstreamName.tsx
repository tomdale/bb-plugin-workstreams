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
 * The owner keeps its single muted color from `.ws-text-prefix` under `accent`
 * too, so one parent reads alike beneath every area, rather than taking a
 * tint of whichever area's hue the name sits in.
 *
 * Its weight and line height are defaults that the caller's `className`
 * replaces, and the parts inherit the result, so Home and the archived
 * groups set their own type. A sidebar header passes `ws-text-workstream`.
 */
export function WorkstreamName({
  name,
  className,
  muted = false,
  accent = false,
}: {
  name: string;
  className?: string;
  muted?: boolean;
  accent?: boolean;
}) {
  const parts = splitWorkstreamName(name);
  if (!parts)
    return (
      <span
        className={cn(
          "truncate font-semibold leading-[1.2]",
          accent
            ? "ws-workstream-name"
            : muted
              ? "text-muted-foreground"
              : "text-foreground",
          className,
        )}
      >
        {name}
      </span>
    );
  return (
    <span className={cn("truncate font-[450] leading-[1.2]", className)}>
      <span className="ws-text-prefix">{parts.owner}</span>
      <span className="sr-only">:</span>{" "}
      <span
        className={cn(
          "ws-text-inline-workstream",
          accent
            ? "ws-workstream-name"
            : muted
              ? "text-muted-foreground"
              : "text-foreground",
        )}
      >
        {parts.area}
      </span>
    </span>
  );
}
