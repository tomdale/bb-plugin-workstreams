import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The count of threads waiting on the person, in the Needs you color. The
 * sidebar's group headers use the compact size; Home's group heads use the
 * roomy size, which meets its taller rows.
 */
export function CountPill({
  size = "compact",
  className,
  children,
  ...rest
}: {
  size?: "compact" | "roomy";
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentProps<"span">, "className" | "children">) {
  return (
    <span
      {...rest}
      className={cn(
        "ws-needs-you-pill rounded-full font-medium tabular-nums",
        size === "compact"
          ? "px-1.5 text-[11px]"
          : "px-2 text-xs leading-[1.375rem]",
        className,
      )}
    >
      {children}
    </span>
  );
}
