import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const SIZE = { xs: "size-1.5", sm: "size-[7px]", md: "size-2" } as const;

/**
 * A small filled circle that carries color alone, so it is hidden from
 * assistive technology; pair it with a word. `tone` is a background class
 * (`bg-(--ws-complete)`) or `style` sets `backgroundColor`. `workstream`
 * takes the workstream hue from `--ws-color-dot` or `--ws-hue`, and `hollow`
 * draws a ring that holds the dot's place for collections that are not
 * workstreams.
 */
export function StatusDot({
  size = "xs",
  tone,
  workstream = false,
  hollow = false,
  className,
  style,
}: {
  size?: keyof typeof SIZE;
  tone?: string;
  workstream?: boolean;
  hollow?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "shrink-0 rounded-full",
        SIZE[size],
        workstream && "ws-dot-workstream",
        hollow && "ws-dot-hollow",
        tone,
        className,
      )}
      style={style}
    />
  );
}
