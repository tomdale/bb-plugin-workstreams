import { cn } from "@/lib/utils";
import { workstreamAbbreviation } from "../../domain/workstreamMark.ts";

/**
 * A workstream's two-character tile: the initials of its words, or its first
 * two letters when it has one. It is drawn in the workstream's own accent with
 * the letters knocked out, after the first-tier prefix when the workstream has
 * a parent topic, and leading the header when it does not.
 */
export function WorkstreamTile({ name }: { name: string }) {
  const text = workstreamAbbreviation(name);
  if (!text) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ws-workstream-tile",
        "grid h-[18px] w-[30px] flex-none place-items-center rounded-[5px]",
        "text-[10px] font-bold leading-none tracking-[0.04em]",
      )}
    >
      {text}
    </span>
  );
}
