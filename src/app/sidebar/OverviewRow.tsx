import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useOverviewOpen } from "../page/overview/route.ts";
import { OVERVIEW_ICON } from "../workstream-icon.ts";
import { rowGeometry } from "./rowGeometry.ts";

/** The Overview mark's drawn size, and the least room its slot gives it. */
const ICON_PX = 12;

/**
 * The first row of a workstream's group: opens the workstream's Overview on
 * the Workstreams page, and shows as the active row while that Overview is
 * open. It sits where a root thread row does, with its mark in the group's
 * status slot so "Overview" starts at the thread titles' edge; a group whose
 * threads draw no mark has no slot, and the mark makes its own room.
 */
export function OverviewRow({
  groupId,
  groupName,
  slotWidth,
  onOpen,
}: {
  groupId: string;
  groupName: string;
  /** The group's status slot width (see `slotWidthOf`). */
  slotWidth: number;
  onOpen: () => void;
}) {
  const open = useOverviewOpen(groupId);
  const { paddingLeft, heightClass, leadingClass } = rowGeometry({
    depth: 0,
    slotWidth,
    inGroup: true,
  });
  return (
    <li className="list-none">
      <div
        className={cn(
          "ws-row group/row relative flex gap-1.5 rounded-md pr-2 text-[13px] text-muted-foreground",
          heightClass,
          open && "ws-row-active text-foreground",
        )}
        style={{ paddingLeft }}
      >
        <button
          type="button"
          aria-label={`Overview of ${groupName}`}
          aria-current={open ? "page" : undefined}
          onClick={onOpen}
          className="absolute inset-0 cursor-pointer rounded-md"
        />
        <span
          className="pointer-events-none relative flex h-3.5 shrink-0 items-center justify-center"
          style={{ width: slotWidth > 0 ? slotWidth : ICON_PX }}
        >
          <Icon
            name={OVERVIEW_ICON}
            aria-hidden
            className="shrink-0"
            style={{ width: ICON_PX, height: ICON_PX }}
          />
        </span>
        <span
          className={cn(
            "pointer-events-none relative min-w-0 truncate",
            leadingClass,
          )}
        >
          Overview
        </span>
      </div>
    </li>
  );
}
