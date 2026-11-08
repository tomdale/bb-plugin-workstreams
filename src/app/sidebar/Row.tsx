import type { ReactNode } from "react";
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
import { presentRow } from "./presentation.ts";
import type { WorkView } from "../useWorkstreams.ts";
import { StatusMark } from "./StatusMark.tsx";
import { usePrefs } from "../prefs.ts";
import { SnoozeIcon, WakeIcon } from "../snooze/icons.tsx";
import { HoverAction, HoverMenuButton, RowActions } from "./HoverActions.tsx";
import { rowGeometry } from "./rowGeometry.ts";

export { INDENT_PX, MAX_INDENT } from "./rowGeometry.ts";

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

export function Row({
  thread,
  depth,
  active,
  now,
  context,
  attention,
  work,
  showStatusSlot = true,
  showPin = true,
  subtitle,
  snoozeAction,
  showArchive = true,
  disclosure,
  categorized = false,
  inGroup = false,
  onNavigate,
}: {
  thread: PluginSidebarThread;
  depth: number;
  active: boolean;
  now: number;
  /**
   * Shown after the title in overlay bands and inline groups: the row's
   * workstream or subgroup name, or when a snoozed row wakes.
   */
  context?: string;
  /**
   * The row is in the Up Next section. Every row there needs Tom, so the
   * needs-decision mark is implied and left out, and the title reads at full
   * strength.
   */
  attention?: boolean;
  work?: WorkView;
  /**
   * False when no row in this list has a status mark: the slot collapses,
   * animated, so titles sit flush left.
   */
  showStatusSlot?: boolean;
  /** Whether to show the pin indicator in this placement. */
  showPin?: boolean;
  /** A second line under the title, such as what the thread asks of Tom. */
  subtitle?: string | null;
  /**
   * The hover button after Archive: snooze with the default choice, or wake
   * a snoozed thread. `title` names what a click does; `menu` holds the other
   * choices, opened by resting the pointer on the button.
   */
  snoozeAction?: {
    kind: "snooze" | "wake";
    title: string;
    run: () => void;
    menu?: ReactNode;
  };
  /** Hide Archive when the row is already in the archived lifecycle. */
  showArchive?: boolean;
  /** Present when the row has child threads: the expand/collapse toggle. */
  disclosure?: { expanded: boolean; toggle: () => void };
  categorized?: boolean;
  inGroup?: boolean;
  onNavigate: () => void;
}) {
  const { prefs } = usePrefs();
  const {
    shownState,
    reported,
    state,
    recap,
    nativeStatus,
    pinned,
    accessibleName,
    timestamp,
  } = presentRow(thread, work, {
    attention,
    showPin,
    timestamps: prefs?.sidebar.timestamps ?? "show",
    now,
  });
  const actions = experimental_useSidebarThreadActions();
  const { splitProps } = experimental_useSidebarThreadSplit(thread.id);
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const { pullRequest } = experimental_useSidebarThreadPullRequest(thread.id);
  const { paddingLeft, heightClass, leadingClass, compactActions } =
    rowGeometry({
      depth,
      inGroup,
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
        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
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
          disclosure && (nativeStatus || state?.glyph) && "ws-has-disclosure",
        )}
        data-collapsed={!showStatusSlot || undefined}
      >
        {nativeStatus ? (
          <StatusMark
            indicator={thread.indicator}
            label={thread.indicatorLabel}
            hasPendingInteraction={thread.hasPendingInteraction}
            isUnread={thread.isUnread}
          />
        ) : null}
        {state?.glyph && !nativeStatus ? (
          <span
            className={`ws-work ws-work-${reported && shownState === "done" ? "complete" : shownState} pointer-events-none relative inline-flex size-3.5 shrink-0 items-center justify-center`}
            role="img"
            aria-label={state.label}
          >
            {state.glyph}
          </span>
        ) : null}
        {disclosure ? (
          // Sits in the status slot: always shown when the slot is otherwise
          // empty, and swapped in for the status mark on hover.
          <button
            type="button"
            aria-label={
              disclosure.expanded ? "Hide child threads" : "Show child threads"
            }
            aria-expanded={disclosure.expanded}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              disclosure.toggle();
            }}
            className="ws-disclosure absolute inset-0 flex cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <Icon
              name={disclosure.expanded ? "ChevronDown" : "ChevronRight"}
              className="size-3"
            />
          </button>
        ) : null}
      </span>
      <span
        className={cn(
          "pointer-events-none relative flex min-w-0 flex-1 flex-col",
          thread.isUnread || active
            ? "font-medium text-foreground"
            : attention
              ? "text-foreground"
              : "text-muted-foreground group-hover/row:text-foreground",
        )}
      >
        {/* The band's or subgroup's context and the age follow the title
            itself, so the row's trailing end is left to its marks and hover
            buttons. */}
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className={cn("ws-text-thread min-w-0 truncate", leadingClass)}>
            <ThreadTitle threadId={thread.id} />
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
        {showArchive ? (
          <HoverAction
            compact={compactActions}
            label="Archive"
            onClick={() => actions.archive(thread.id)}
          >
            <Icon name="Archive" className="size-3.5" />
          </HoverAction>
        ) : null}
        {snoozeAction ? (
          snoozeAction.menu ? (
            <HoverMenuButton
              compact={compactActions}
              label={snoozeAction.title}
              onClick={snoozeAction.run}
              menu={snoozeAction.menu}
            >
              {snoozeIcon(snoozeAction.kind)}
            </HoverMenuButton>
          ) : (
            <HoverAction
              compact={compactActions}
              label={snoozeAction.title}
              onClick={snoozeAction.run}
            >
              {snoozeIcon(snoozeAction.kind)}
            </HoverAction>
          )
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

const snoozeIcon = (kind: "snooze" | "wake") =>
  kind === "wake" ? (
    <WakeIcon className="size-3.5" />
  ) : (
    <SnoozeIcon className="size-3.5" />
  );
