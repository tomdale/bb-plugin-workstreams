import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  slotMarkFor,
  STATUS_LABEL,
  threadStatus,
} from "../../domain/presentation.ts";
import type { WorkView } from "../../domain/status.ts";

/** Whether the row's leading slot has a mark to show. */
export function hasStatusMark(
  thread: PluginSidebarThread,
  work: WorkView | undefined,
): boolean {
  return slotMarkFor(thread, work ?? { kind: "none" }) !== null;
}

/**
 * The row's text and marks, shared by every location without rendering a thread
 * list.
 */
export function presentRow(
  thread: PluginSidebarThread,
  work: WorkView | undefined,
  options: {
    showPin: boolean;
    timestamps: "show" | "hover" | "hide";
    /** The thread's age as the row shows it (see `relativeAge`). */
    age: string;
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
        : { mode: options.timestamps, text: options.age },
  };
}

/**
 * The second line of a Full row: the most useful thing known about the
 * thread that its title doesn't already say, or null when nothing is known
 * and the row stays one line.
 *
 * - Needs input or Blocked: what the turn asks of the user.
 * - Ready for review, Waiting, or Complete: the turn's one-line result.
 * - Working, or a turn not yet analyzed: the thread's goal, which holds
 *   across turns, since the last turn's result no longer describes it.
 *
 * A thread with a status and none of that text names its status, so a new
 * thread's first turn and a failed turn still read as two lines.
 */
export function rowDetail(
  thread: PluginSidebarThread,
  work: WorkView | undefined,
): string | null {
  const view = work ?? { kind: "none" };
  const status = threadStatus(thread, view);
  const text = (value: string | null | undefined) => value?.trim() || null;
  let known: string | null = null;
  if (view.kind === "pending") known = text(view.previous.goal);
  else if (view.kind === "current") {
    const { analysis } = view;
    const asks = status === "needs-input" || status === "blocked";
    known =
      status === "working"
        ? text(analysis.goal)
        : ((asks ? text(analysis.ask) : null) ??
          text(analysis.recap) ??
          text(analysis.goal));
  }
  return known ?? (status ? STATUS_LABEL[status] : null);
}

type CountVisibility = "always" | "collapsed" | "never";
/** Zero counts stay hidden even when the preference says to show counts always. */
export function headerCounts(
  group: { total: number; needsYou: number },
  collapsed: boolean,
  prefs?: {
    threadCount?: CountVisibility;
    needsYouCount?: CountVisibility;
  },
) {
  const shows = (when: CountVisibility = "collapsed") =>
    when === "always" || (when === "collapsed" && collapsed);
  return {
    needsYou: group.needsYou > 0 && shows(prefs?.needsYouCount),
    total: group.total > 0 && shows(prefs?.threadCount),
  };
}
