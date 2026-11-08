import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  relativeAge,
  statusRole,
  workStateMark,
} from "../../domain/presentation.ts";
import type { WorkView } from "../../domain/status.ts";

/** Up Next implies a needed decision, so it does not repeat that mark. */
export function shownWorkState(
  work: WorkView | undefined,
  attention?: boolean,
) {
  return work?.kind === "current" &&
    !(attention && work.analysis.state === "needs_decision")
    ? work.analysis.state
    : null;
}

/** Native working, unread, waiting, and error marks take precedence over assessments. */
export function hasNativeStatus(thread: PluginSidebarThread): boolean {
  return (
    Boolean(statusRole(thread.indicator)) ||
    thread.hasPendingInteraction ||
    thread.isUnread
  );
}

export function hasStatusMark(
  thread: PluginSidebarThread,
  work: WorkView | undefined,
  attention?: boolean,
): boolean {
  if (hasNativeStatus(thread)) return true;
  const state = shownWorkState(work, attention);
  return Boolean(
    state &&
    workStateMark(state, work?.kind === "current" && work.reported).glyph,
  );
}

/** The row's text and marks, shared by every placement without rendering a thread list. */
export function presentRow(
  thread: PluginSidebarThread,
  work: WorkView | undefined,
  options: {
    attention?: boolean;
    showPin: boolean;
    timestamps: "show" | "hover" | "hide";
    now: number;
  },
) {
  const shownState = shownWorkState(work, options.attention);
  const reported = work?.kind === "current" && work.reported;
  const state = shownState ? workStateMark(shownState, reported) : null;
  return {
    shownState,
    reported,
    state,
    nativeStatus: hasNativeStatus(thread),
    pinned: thread.isPinned && options.showPin,
    accessibleName: state?.glyph
      ? `${thread.displayTitle}, ${state.label}`
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
