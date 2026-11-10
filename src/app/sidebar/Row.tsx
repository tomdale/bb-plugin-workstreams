import type { CSSProperties } from "react";
import {
  ThreadTitle,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
  type PluginSidebarPullRequest,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { dotMark } from "../../domain/presentation.ts";
import { presentRow } from "./presentation.ts";
import { useClock } from "../clock.ts";
import { relativeAge } from "../../domain/presentation.ts";
import type { WorkView } from "../useWorkstreams.ts";
import { StatusMark } from "./StatusMark.tsx";
import { usePrefsSelector } from "../prefs.ts";
import { HoverAction, RowActions, RowPressButton } from "./HoverActions.tsx";
import { SnoozeAction, type SnoozeActionSpec } from "./SnoozeAction.tsx";
import { rowGeometry } from "./rowGeometry.ts";
import { FULL_SLOT_PX } from "./statusSlot.ts";
import { PLACEMENT_TRAITS, STANDALONE_TRAITS, type Placement } from "./rows.ts";

export { MAX_INDENT } from "./rowGeometry.ts";

function prTone(pr: PluginSidebarPullRequest): string {
  if (pr.state === "merged") return "ws-pr-merged";
  if (pr.state === "closed") return "ws-pr-closed";
  if (pr.state === "draft") return "ws-pr-draft";
  if (pr.attention === "checks_failed" || pr.attention === "conflicts")
    return "ws-pr-failed";
  if (pr.attention === "changes_requested" || pr.attention === "blocked")
    return "ws-pr-attention";
  return "ws-pr-open";
}

/**
 * The hover button after Archive: snooze with the default choice, or wake a
 * snoozed thread. The button draws its own name from the shared clock (see
 * `SnoozeAction`); the row only says how large it is.
 */
export type RowSnoozeAction = SnoozeActionSpec;

export function Row({
  thread,
  depth,
  active,
  context,
  placement,
  work,
  slotWidth = FULL_SLOT_PX,
  subtitle,
  snoozeAction,
  disclosure,
  categorized = false,
  onNavigate,
}: {
  thread: PluginSidebarThread;
  depth: number;
  active: boolean;
  /**
   * Shown after the title in overlay bands and inline groups: the row's
   * workstream or subgroup name, or when a snoozed row wakes.
   */
  context?: string;
  /**
   * Where the row is listed (see `PLACEMENT_TRAITS`); absent for a row on its
   * own. Up Next rows, for one, all need Tom, so the title reads at full
   * strength.
   */
  placement?: Placement;
  work?: WorkView;
  /**
   * False when no row in this list has a status mark: the slot collapses,
   * animated, so titles sit flush left.
   */
  /**
   * The width its list reserves for the status slot, shared by every row of
   * the list (see `slotWidthOf`); 0 folds the slot away.
   */
  slotWidth?: number;
  /** A second line under the title, such as what the thread asks of Tom. */
  subtitle?: string | null;
  snoozeAction?: RowSnoozeAction;
  /** Present when the row has child threads: the expand/collapse toggle. */
  disclosure?: { expanded: boolean; toggle: () => void };
  categorized?: boolean;
  onNavigate: () => void;
}) {
  const traits = placement ? PLACEMENT_TRAITS[placement] : STANDALONE_TRAITS;
  const timestamps = usePrefsSelector(
    (prefs) => prefs?.sidebar.timestamps ?? "show",
  );
  const age = useClock((now) =>
    timestamps === "hide" ? "" : relativeAge(thread.latestAttentionAt, now),
  );
  const { slotMark, recap, pinned, accessibleName, timestamp } = presentRow(
    thread,
    work,
    { showPin: traits.showPin, timestamps, age },
  );
  // Unread is never the slot mark: the dots carry it in their fill, other
  // marked rows carry it inline beside the title, markless rows by title
  // weight alone.
  const inlineDot =
    thread.isUnread && slotMark !== null && !dotMark(slotMark.kind);
  const actions = experimental_useSidebarThreadActions();
  const { splitProps } = experimental_useSidebarThreadSplit(thread.id);
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const { pullRequest } = experimental_useSidebarThreadPullRequest(thread.id);
  const { paddingLeft, heightClass, leadingClass, compactActions } =
    rowGeometry({
      depth,
      slotWidth,
      inGroup: traits.inGroup,
      categorized,
      hasSubtitle: Boolean(subtitle),
    });

  return (
    <div
      className={cn(
        "ws-row group/row relative flex gap-1.5 rounded-md pr-2 text-[13px]",
        // Two-line rows give the title a 20px line and center the marks,
        // details, and hover buttons on it (`ws-row-aside`).
        subtitle
          ? "items-start py-1.5 [&>.ws-row-aside]:h-5 [&>.ws-status-slot]:mt-[3px]"
          : heightClass,
        active && "ws-row-active",
      )}
      style={{ paddingLeft }}
    >
      {/* Must stay an anchor: BB's thread shortcuts find rows by these
            data attributes, and modifier-click opens a split. */}
      <a
        {...splitProps}
        href={thread.href}
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id={thread.id}
        aria-current={active ? "page" : undefined}
        aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        aria-label={accessibleName}
        aria-describedby={recap ? `ws-recap-${thread.id}` : undefined}
        onClick={(event) => {
          event.preventDefault();
          actions.open(thread.id, { split: event.metaKey || event.ctrlKey });
          onNavigate();
        }}
        className="absolute inset-0 rounded-md"
      />
      {recap ? (
        <span id={`ws-recap-${thread.id}`} hidden>
          {recap}
        </span>
      ) : null}
      {pinned ? (
        <span
          className="pointer-events-none relative inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
          role="img"
          aria-label="Pinned"
        >
          <Icon name="Pin" className="size-3" />
        </span>
      ) : null}
      <span
        className={cn(
          "ws-status-slot",
          disclosure && slotMark && "ws-has-disclosure",
        )}
        data-collapsed={slotWidth === 0 || undefined}
        style={{ "--ws-slot-width": `${slotWidth}px` } as CSSProperties}
      >
        {slotMark ? (
          <StatusMark mark={slotMark} isUnread={thread.isUnread} />
        ) : null}
        {disclosure ? (
          // Sits in the status slot: always shown when the slot is otherwise
          // empty, and swapped in for the status mark on hover. The 12px
          // chevron's ink is far narrower than its box, so the slot needs
          // no more width than a dot; the button spreads 3px past each side
          // to stay a 14px target.
          <RowPressButton
            aria-label={
              disclosure.expanded ? "Hide child threads" : "Show child threads"
            }
            aria-expanded={disclosure.expanded}
            onClick={disclosure.toggle}
            className="ws-disclosure absolute inset-y-0 -inset-x-[3px] flex cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <Icon
              name={disclosure.expanded ? "ChevronDown" : "ChevronRight"}
              className="size-3"
            />
          </RowPressButton>
        ) : null}
      </span>
      <span
        className={cn(
          "pointer-events-none relative flex min-w-0 flex-1 flex-col",
          thread.isUnread && "font-medium",
          thread.isUnread || active || traits.attention
            ? "text-foreground"
            : "text-muted-foreground group-hover/row:text-foreground",
        )}
      >
        {/* The band's or subgroup's context and the age follow the title
            itself, so the row's trailing end is left to its marks and hover
            buttons. */}
        <span
          className={cn("flex min-w-0 items-baseline gap-1.5", leadingClass)}
        >
          <span
            className={cn(
              "ws-text-thread min-w-0 truncate",
              inlineDot && "flex items-center gap-1.5",
            )}
          >
            {inlineDot ? (
              <span
                className="ws-unread-inline"
                role="img"
                aria-label="Unread"
              />
            ) : null}
            <span className={inlineDot ? "min-w-0 truncate" : undefined}>
              <ThreadTitle threadId={thread.id} />
            </span>
          </span>
          {context ? (
            <span className="block max-w-24 shrink-0 truncate text-[11px] font-normal tabular-nums text-muted-foreground/70">
              {context}
            </span>
          ) : null}
          {timestamp ? (
            <span
              data-timestamp={timestamp.mode}
              className="flex shrink-0 text-[11px] font-normal tabular-nums text-muted-foreground/70"
            >
              {timestamp.text}
            </span>
          ) : null}
        </span>
        {subtitle ? (
          <span className="truncate text-[12px] leading-4 text-muted-foreground/80">
            {subtitle}
          </span>
        ) : null}
      </span>
      {/* Shown until the hover buttons take their place, as in BB's row. */}
      <span className="ws-row-aside pointer-events-none relative flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground/70 empty:hidden group-hover/row:hidden group-has-[:focus-visible]/row:hidden group-has-[[data-state=open]]/row:hidden">
        {rowStatus ? (
          <span aria-label={rowStatus.label} role="img">
            <Icon name={rowStatus.icon} className="size-3" />
          </span>
        ) : hasUnsubmittedDraft ? (
          <span aria-label="Unsent draft" role="img">
            ✎
          </span>
        ) : null}
        {pullRequest ? (
          <span className={cn("ws-pr", prTone(pullRequest))}>
            #{pullRequest.number}
          </span>
        ) : null}
      </span>
      {/* Archive, then snooze (its menu opens on hover), at the trailing
          end, as on a workstream header. */}
      <RowActions className="ws-row-aside">
        {traits.showArchive ? (
          <HoverAction
            compact={compactActions}
            label="Archive"
            onClick={() => actions.archive(thread.id)}
          >
            <Icon name="Archive" className="size-3.5" />
          </HoverAction>
        ) : null}
        {snoozeAction ? (
          <SnoozeAction {...snoozeAction} compact={compactActions} />
        ) : null}
      </RowActions>
      {shortcut ? (
        // BB's jump key while its modifier is held, last so the keys line
        // up down the list.
        <span className="ws-row-aside pointer-events-none relative flex shrink-0 items-center text-[11px] tabular-nums text-muted-foreground/70">
          <span className="rounded border border-border px-1 text-[10px]">
            {shortcut.label}
          </span>
        </span>
      ) : null}
    </div>
  );
}
