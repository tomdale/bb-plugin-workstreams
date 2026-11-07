import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { markHue, markShape } from "../../domain/workstreamMark.ts";

/**
 * A category's marker: an unlettered silhouette filled with its workstream's
 * accent, turned one step further around the wheel than the category above it.
 * It carries the resolved hue itself, so it is right even where a label is
 * drawn outside its own workstream's header.
 */
export function CategoryMark({
  hue,
  index,
}: {
  /** The workstream's own hue, `workstreamHue(section.id)`. */
  hue: number;
  /** The category's position in its workstream's generation. */
  index: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ws-mark",
        `ws-mark--${markShape(index)}`,
        "size-3.5 flex-none",
      )}
      style={{ "--ws-hue": markHue(hue, index) } as CSSProperties}
    />
  );
}
