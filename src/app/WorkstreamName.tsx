import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  workstreamColorStyle,
  type TopicColor,
} from "../domain/workstreamColor.ts";

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
 * The owner's color variables. A caller that knows the container's topic
 * passes its color, so the parent tier keeps one color under every area; a
 * name with no known parent falls back to the theme's muted ink, even inside
 * a header that sets its area's hue.
 */
function prefixColors(prefixColor?: TopicColor): CSSProperties {
  return (
    prefixColor
      ? workstreamColorStyle(prefixColor)
      : {
          "--ws-color-light": "var(--muted-foreground)",
          "--ws-color-dark": "var(--muted-foreground)",
        }
  ) as CSSProperties;
}

/**
 * A workstream's name. An area of a larger product ("Workstreams: Recaps")
 * shows the owner subdued before the area, without the colon; the colon is
 * kept in the accessible text so screen readers hear the full name.
 *
 * The owner wears the container's own color, dimmed (`.ws-text-prefix`), so
 * one parent reads alike beneath every area instead of taking a tint of
 * whichever area's hue its name sits in.
 *
 * Its weight and line height are defaults that the caller's `className`
 * replaces, and the parts inherit the result, so Home and the archived
 * groups set their own type. A sidebar header passes `ws-text-workstream`.
 */
export function WorkstreamName({
  name,
  className,
  prefixColor,
  muted = false,
  accent = false,
}: {
  name: string;
  className?: string;
  /** The color of the container the label's prefix names, when it has one. */
  prefixColor?: TopicColor;
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
      <span className="ws-text-prefix" style={prefixColors(prefixColor)}>
        {parts.owner}
      </span>
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
