import { useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { CountPill } from "../primitives/CountPill.tsx";
import { SIDEBAR_GEOMETRY } from "./tokens.ts";
import { headerCounts } from "./presentation.ts";
import { FULL_SLOT_PX, childIndent } from "./statusSlot.ts";
import { HeaderMenu } from "./RowMenu.tsx";
import { IncomingThread, type DragHandle } from "./dnd.tsx";
import { SnoozeAction } from "./SnoozeAction.tsx";
import { WorkstreamName } from "../WorkstreamName.tsx";
import { useFold, useFoldGap } from "./motion.ts";
import { FocusIcon } from "./FocusIcon.tsx";
import { FoldBody, FoldChevron, useFoldFocusRestore } from "./Fold.tsx";
import {
  HoverAction,
  RowActions,
  RowPressButton,
  rowActionClass,
} from "./HoverActions.tsx";
import {
  colorForWorkstream,
  workstreamColorStyle,
  type TopicColor,
} from "../../domain/workstreamColor.ts";
import { usePrefs } from "../prefs.ts";
import { useOverviewOpen } from "../page/overview/route.ts";
import { GroupSnooze, ThreadNode } from "./types.ts";

export type GroupProps = {
  group: ThreadNode;
  /**
   * A subgroup: its block starts one step in, where its parent's name does,
   * and its name reads as a label, smaller and muted.
   */
  nested?: boolean;
  /** A nested header's left padding: the step its parent's rows indent by. */
  nestedIndent?: number;
  collapsed: boolean;
  toggle: () => void;
  onNewThread?: () => void;
  onToggleFocus?: () => void;
  /** Opens the workstream's Overview when its name is pressed. */
  onOpenOverview?: () => void;
  /** Snoozes every thread the group lists; absent while it lists none. */
  snooze?: GroupSnooze;
  muted?: boolean;
  /** Drag-and-drop wiring: the section moves, the header drags it. */
  sectionRef?: (element: HTMLElement | null) => void;
  color?: TopicColor;
  /** The color of the container the label's prefix names, when it has one. */
  prefixColor?: TopicColor;
  style?: CSSProperties;
  handle?: DragHandle;
  children: ReactNode;
};

export function WorkstreamGroup({
  group,
  nested = false,
  nestedIndent = childIndent(FULL_SLOT_PX),
  collapsed,
  toggle,
  onNewThread,
  onToggleFocus,
  onOpenOverview,
  snooze,
  muted,
  sectionRef,
  color,
  prefixColor,
  style,
  handle,
  children,
}: GroupProps) {
  const { prefs } = usePrefs();
  const overviewOpen = useOverviewOpen(group.id) && Boolean(onOpenOverview);
  const bodyRef = useRef<HTMLUListElement | null>(null);
  /** The section, for the gap the fold moves below it (see `useFoldGap`). */
  const section = useRef<HTMLElement>(null);
  useFoldFocusRestore({
    open: !collapsed,
    root: () => section.current,
    contents: () => bodyRef.current,
  });
  const label = group.label;
  const isWorkstream = group.hasSection;
  const counts = headerCounts(group, collapsed, prefs?.sidebar);
  const fold = useFold(!collapsed);
  const refSection = useRef(sectionRef);
  refSection.current = sectionRef;
  const setSection = useCallback((element: HTMLElement | null) => {
    section.current = element;
    refSection.current?.(element);
  }, []);
  useFoldGap(section, fold.phase);
  const headingClass = "flex min-w-0 flex-1 items-center gap-1";
  const heading = (
    <WorkstreamName
      name={label}
      prefixColor={prefixColor}
      muted={muted || nested}
      accent={isWorkstream}
      className={
        nested && !isWorkstream
          ? "text-[11px] font-semibold uppercase tracking-wide" // slop-ok: 1 the product's section-label style
          : "ws-text-workstream"
      }
    />
  );
  const focusAction = onToggleFocus ? (
    <HoverAction
      compact
      revealed={group.prioritized}
      pressed={group.prioritized}
      label={
        group.prioritized
          ? `Stop focusing on ${group.name}`
          : `Focus on ${group.name}`
      }
      hint={group.prioritized ? "Stop focusing" : "Focus"}
      onClick={onToggleFocus}
      className={group.prioritized ? "text-foreground/70" : undefined}
    >
      <FocusIcon filled={group.prioritized} className="size-3.5" />
    </HoverAction>
  ) : null;
  return (
    <IncomingThread groupId={group.id}>
      {(incoming) => (
        <section
          ref={setSection}
          aria-label={group.name}
          data-flip-key={`group:${group.id}`}
          data-prioritized={group.prioritized ? "" : undefined}
          data-drop-target={incoming ? "" : undefined}
          className={cn(
            "rounded-md",
            nested && "pt-1",
            incoming && "bg-sidebar-accent/60",
          )}
          style={
            {
              ...style,
              ...workstreamColorStyle(color ?? colorForWorkstream(group.id)),
            } as CSSProperties
          }
        >
          <HeaderMenu
            onOverview={onOpenOverview}
            focus={
              onToggleFocus
                ? { focused: group.prioritized, toggle: onToggleFocus }
                : undefined
            }
            onNewWork={onNewThread}
            snooze={snooze}
          >
            <div
              ref={handle?.ref}
              {...handle?.listeners}
              data-overview-open={overviewOpen ? "" : undefined}
              className="group/row relative flex items-center gap-1.5 rounded-md pr-2 transition-[padding] duration-[180ms] ease-out motion-reduce:transition-none data-[overview-open]:bg-sidebar-accent"
              style={{
                height: SIDEBAR_GEOMETRY.workstreamHeader.height,
                paddingLeft: nested
                  ? nestedIndent
                  : SIDEBAR_GEOMETRY.workstreamHeader.indent,
              }}
            >
              <span className={headingClass}>
                {/* A press on the name opens the Overview, and the chevron
              folds the group. The name leaves pointer downs to the row,
              which stays the workstream's drag handle: a drag that starts
              on the name moves the workstream and opens nothing. */}
                {onOpenOverview ? (
                  <button
                    type="button"
                    onClick={onOpenOverview}
                    aria-label={`Overview of ${group.name}`}
                    aria-current={overviewOpen ? "page" : undefined}
                    className="flex min-w-0 cursor-pointer rounded-sm text-left focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {heading}
                  </button>
                ) : (
                  heading
                )}
                <RowPressButton
                  aria-expanded={!collapsed}
                  aria-label={
                    collapsed ? `Expand ${label}` : `Collapse ${label}`
                  }
                  onClick={toggle}
                  className={cn(rowActionClass, "size-5")}
                >
                  <FoldChevron open={!collapsed} />
                </RowPressButton>
              </span>
              {/* Keep the always-visible action at the trailing edge so revealing
            other actions cannot move it underneath the pointer. */}
              <RowActions>
                {onNewThread ? (
                  <HoverAction
                    compact
                    label={`New work in ${group.name}`}
                    onClick={onNewThread}
                  >
                    <Icon name="Plus" className="size-3.5" />
                  </HoverAction>
                ) : null}
                {snooze ? (
                  <SnoozeAction
                    compact
                    kind="snooze"
                    action={`Snooze ${snooze.subject}`}
                    prefs={snooze.prefs}
                    onSnooze={snooze.snooze}
                    menu={snooze.menu}
                  />
                ) : null}
                {focusAction}
              </RowActions>
              {/* The header's details, as a thread row's age. */}
              <span className="flex shrink-0 items-center gap-1 empty:hidden">
                {counts.waiting ? (
                  <CountPill // slop-ok: 2 the product's waiting-count pill, an established header pattern
                    className="transition-colors duration-300"
                    title={`${group.needsYou} waiting on you`}
                  >
                    {group.needsYou}
                  </CountPill>
                ) : null}
                {counts.total ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {group.total}
                  </span>
                ) : null}
              </span>
            </div>
          </HeaderMenu>
          <FoldBody fold={fold} listRef={bodyRef} listClassName="list-none">
            {children}
          </FoldBody>
        </section>
      )}
    </IncomingThread>
  );
}
