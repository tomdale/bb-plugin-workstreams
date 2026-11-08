import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The small uppercase heading over a page section. Anything after the title
 * (a count, a toggle) goes in as children and sets its own type.
 */
export function SectionHeading({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <h2
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </h2>
  );
}
