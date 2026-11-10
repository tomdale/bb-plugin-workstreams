import { memo } from "react";
import {
  ThreadTitle,
  useSidebarThreadDraft,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import {
  relativeAge,
  relativeAgeLabel,
  slotMarkFor,
} from "../../domain/presentation.ts";
import { WorkstreamIcon } from "../WorkstreamIcon.tsx";
import {
  workstreamColorStyle,
  type TopicColor,
} from "../../domain/workstreamColor.ts";
import type { ServerState, WorkView } from "../useWorkstreams.ts";
import { workView } from "../../domain/status.ts";
import { StatusMark } from "../sidebar/StatusMark.tsx";

/** Stable clock prop for memoized rows that show neither age nor wake time. */
export const HIDDEN_NOW = 0;

/**
 * A Home row with stable action identities. The memo compares every prop,
 * including the disclosure callback, so unrelated thread updates do not rerun
 * the draft hook and presentation work with a stale callback hidden by a
 * custom comparator.
 */
export const HomeThreadRow = memo(function HomeThreadRow({
  thread,
  analysis,
  recap,
  now,
  variant,
  depth = 0,
  showMarkSlot,
  showAge,
  workstreamName,
  workstreamHue,
  workstreamLevel,
  showPin,
  trailing,
  disclosureId,
  disclosureOpen,
  disclosureCount,
  toggleDisclosure,
}: {
  thread: PluginSidebarThread;
  analysis?: ServerState["analysis"][string];
  recap?: ServerState["recaps"][string];
  now: number;
  variant: "attention" | "group" | "snoozed";
  depth?: number;
  showMarkSlot: boolean;
  showAge: boolean;
  workstreamName?: string;
  workstreamHue?: number;
  workstreamLevel?: TopicColor["level"];
  /** False in a list of pinned threads, whose heading already says so. */
  showPin?: boolean;
  trailing?: string;
  disclosureId?: string;
  disclosureOpen?: boolean;
  disclosureCount?: number;
  toggleDisclosure?: (id: string, byDefault: boolean) => void;
}) {
  const work = workView(thread, analysis, recap);
  return (
    <HomeRow
      thread={thread}
      work={work}
      now={now}
      variant={variant}
      depth={depth}
      showMarkSlot={showMarkSlot}
      showAge={showAge}
      workstream={
        workstreamName &&
        workstreamHue !== undefined &&
        workstreamLevel !== undefined
          ? {
              name: workstreamName,
              color: { hue: workstreamHue, level: workstreamLevel },
            }
          : null
      }
      ask={
        variant === "attention" && work.kind === "current"
          ? work.analysis.needsYou
          : null
      }
      showPin={showPin}
      trailing={trailing}
      disclosure={
        disclosureId &&
        disclosureOpen !== undefined &&
        disclosureCount !== undefined
          ? {
              open: disclosureOpen,
              count: disclosureCount,
              toggle: () => toggleDisclosure?.(disclosureId, true),
            }
          : undefined
      }
    />
  );
});

/**
 * One thread as a Home row: BB's status mark or the work state's, the BB
 * display title, an unsent-draft mark when there is one, and its age, in a row
 * at least 48px tall. Up Next rows add a second line naming the workstream (in
 * its hue) and what the thread asks. The row is an anchor, so BB opens the
 * thread in place on a plain tap. Its accessible name is its content (mark,
 * title, workstream, ask, age), so what a screen reader announces is what the
 * row shows.
 */
export function HomeRow({
  thread,
  work,
  now,
  variant,
  depth = 0,
  showMarkSlot,
  showAge,
  workstream,
  ask,
  showPin = true,
  trailing,
  disclosure,
}: {
  thread: PluginSidebarThread;
  work: WorkView | undefined;
  now: number;
  /** Up Next rows (every thread there needs the user), group rows, Snoozed rows. */
  variant: "attention" | "group" | "snoozed";
  depth?: number;
  /** False when no row in this list draws a mark, so titles sit flush left. */
  showMarkSlot: boolean;
  /** The Timestamp setting: ages show only when it says Always. */
  showAge: boolean;
  /** The workstream Up Next names under the title; null for Unfiled. */
  workstream?: { name: string; color: TopicColor } | null;
  /** What the thread asks of the user, from its current analysis. */
  ask?: string | null;
  /** Whether the row marks a pinned thread; on unless the list is Pinned. */
  showPin?: boolean;
  /**
   * Replaces the age: a snoozed thread's wake time, or the name of the group
   * a row lists for when that group has no header of its own.
   */
  trailing?: string;
  /** Present on a thread with child threads: shows and hides them. */
  disclosure?: { open: boolean; count: number; toggle: () => void };
}) {
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const slotMark = slotMarkFor(thread, work ?? { kind: "none" });
  const inlineDot =
    thread.isUnread && slotMark !== null && slotMark.kind !== "needs-you";
  return (
    <li
      className="ws-home-row"
      data-variant={variant}
      data-flip-row={thread.id}
      data-unread={thread.isUnread || undefined}
      style={{ "--ws-depth": Math.min(depth, 2) } as React.CSSProperties}
    >
      <a
        className="ws-home-link"
        href={thread.href}
        data-ws-home-thread={thread.id}
      >
        {showMarkSlot ? (
          <span className="ws-home-mark">
            {slotMark ? (
              <StatusMark mark={slotMark} isUnread={thread.isUnread} />
            ) : null}
          </span>
        ) : null}
        {thread.isPinned && showPin ? (
          <span className="ws-home-pin" role="img" aria-label="Pinned">
            <Icon name="Pin" className="ws-home-pin-icon" />
          </span>
        ) : null}
        <span className="ws-home-text">
          <span className="ws-home-title">
            {inlineDot ? (
              <span
                className="ws-unread-inline"
                role="img"
                aria-label="Unread"
              />
            ) : null}
            <ThreadTitle threadId={thread.id} />
          </span>
          {workstream || ask ? (
            <span className="ws-home-meta">
              {workstream ? (
                <span
                  className="ws-home-ws"
                  style={
                    workstreamColorStyle(
                      workstream.color,
                    ) as React.CSSProperties
                  }
                >
                  <WorkstreamIcon className="ws-home-ws-icon" />
                  <span className="ws-home-ws-name">{workstream.name}</span>
                </span>
              ) : null}
              {ask ? <span className="ws-home-ask">{ask}</span> : null}
            </span>
          ) : null}
        </span>
        {hasUnsubmittedDraft ? (
          <span className="ws-home-draft" role="img" aria-label="Unsent draft">
            ✎
          </span>
        ) : null}
        {trailing ? (
          <span className="ws-home-age">{trailing}</span>
        ) : showAge ? (
          <span className="ws-home-age">
            <span aria-hidden="true">
              {relativeAge(thread.latestAttentionAt, now)}
            </span>
            <span className="sr-only">
              {relativeAgeLabel(thread.latestAttentionAt, now)}
            </span>
          </span>
        ) : null}
      </a>
      {disclosure ? (
        <button
          type="button"
          className="ws-home-fold"
          aria-expanded={disclosure.open}
          aria-label={`${disclosure.open ? "Hide" : "Show"} ${disclosure.count} ${disclosure.count === 1 ? "thread" : "threads"} under ${thread.displayTitle}`}
          onClick={disclosure.toggle}
        >
          <span className="ws-home-fold-count" aria-hidden="true">
            {disclosure.count}
          </span>
          <Icon name="ChevronRight" className="ws-home-chevron" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}
