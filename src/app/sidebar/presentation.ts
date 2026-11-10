import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  relativeAge,
  slotMarkFor,
  type SlotMark,
} from "../../domain/presentation.ts";
import type { WorkView } from "../../domain/status.ts";

/** Whether the row's leading slot has a mark to show. */
export function hasStatusMark(
  thread: PluginSidebarThread,
  work: WorkView | undefined,
): boolean {
  return slotMarkFor(thread, work ?? { kind: "none" }) !== null;
}

/** The row's text and marks, shared by every placement without rendering a thread list. */
export function presentRow(
  thread: PluginSidebarThread,
  work: WorkView | undefined,
  options: {
    showPin: boolean;
    timestamps: "show" | "hover" | "hide";
    now: number;
  },
) {
  const slotMark = slotMarkFor(thread, work ?? { kind: "none" });
  return {
    slotMark,
    pinned: thread.isPinned && options.showPin,
    accessibleName: slotMark
      ? `${thread.displayTitle}, ${slotMark.label}`
      : thread.displayTitle,
    recap:
      work?.kind === "current"
        ? work.analysis.recap
        : work?.kind === "pending"
          ? `Updating… (was: ${work.previous.recap})`
          : undefined,
    timestamp:
      options.timestamps === "hide"
        ? null
        : {
            mode: options.timestamps,
            text: relativeAge(thread.latestAttentionAt, options.now),
          },
  };
}

type CountVisibility = "always" | "collapsed" | "never";
/** Zero counts stay hidden even when the preference says to show counts always. */
export function headerCounts(
  group: { total: number; needsYou: number },
  collapsed: boolean,
  prefs?: {
    threadCount?: CountVisibility;
    waitingCount?: CountVisibility;
  },
) {
  const shows = (when: CountVisibility = "collapsed") =>
    when === "always" || (when === "collapsed" && collapsed);
  return {
    waiting: group.needsYou > 0 && shows(prefs?.waitingCount),
    total: group.total > 0 && shows(prefs?.threadCount),
  };
}
