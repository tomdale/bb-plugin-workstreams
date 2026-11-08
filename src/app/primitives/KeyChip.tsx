import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A key, drawn as an outlined chip; the answers' digits and the buttons'
 * letters match. Touch layouts have no keyboard, so the chip hides under a
 * coarse pointer on a phone. `inline` is the smaller form for a sentence of
 * shortcuts.
 */
export function KeyChip({
  children,
  bright = false,
  inline = false,
  className,
}: {
  children: ReactNode;
  /** The chip's key is the one that would act now. */
  bright?: boolean;
  inline?: boolean;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        inline
          ? "rounded-[3px] border border-border px-1 font-sans"
          : [
              "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[4px] border px-1 font-sans text-[11px] font-medium not-italic transition-colors max-md:pointer-coarse:hidden",
              bright
                ? "border-foreground/40 text-foreground"
                : "border-border text-muted-foreground",
            ],
        className,
      )}
    >
      {children}
    </kbd>
  );
}
