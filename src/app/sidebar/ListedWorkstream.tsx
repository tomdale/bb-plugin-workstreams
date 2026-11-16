import {
  cloneElement,
  memo,
  useCallback,
  useMemo,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type { WorkstreamColor } from "../../domain/workstreamColor.ts";
import { DropTarget, Sortable, groupKey, type DragHandle } from "./dnd.tsx";
import { GroupBody, type GroupBodyProps } from "./GroupBody.tsx";
import type { CollapseScope } from "./useGroupCollapse.ts";
import type { ThreadNode } from "./types.ts";
import { WorkstreamGroup, type GroupProps } from "./WorkstreamGroup.tsx";

/** Which list of the arrangement a group sits in (see `arrangeGroups`). */
export type GroupList = "pinned" | "populated" | "dormant" | "other";

/** How a list's groups fold: Dormant's start closed, the lower tier's per reveal. */
export const collapseScopeOf = (list: GroupList): CollapseScope => ({
  byDefault: list === "dormant",
  lower: list === "populated" || list === "other",
});

export type ListedWorkstreamProps = Omit<
  GroupBodyProps,
  "collapsed" | "toggleGroup"
> & {
  list: GroupList;
  collapsed: boolean;
  /** The gap above the group (see `workstreamGap`); 0 for none. */
  marginTop: number;
  /** Whether the header drags the workstream (manual sort only). */
  headersDrag: boolean;
  prefixColorOf: (group: ThreadNode) => WorkstreamColor | undefined;
  toggleFocus: (group: ThreadNode) => void;
  toggleGroup: (group: ThreadNode, scope?: CollapseScope) => void;
};

/**
 * One workstream in the thread list: its header and body, sortable by the
 * header, or for Other a drop target only. Every prop is a value or a
 * callback with a stable identity, so a list render that leaves the group's
 * own inputs alone skips the header, its drag wiring, and its body.
 */
export const ListedWorkstream = memo(function ListedWorkstream({
  group,
  list,
  collapsed,
  marginTop,
  headersDrag,
  prefixColorOf,
  toggleFocus,
  toggleGroup,
  renderRow,
  groupSlot,
  choosingWorkstream,
  colorOf,
  newThreadIn,
  openOverview,
  groupSnoozeOf,
  isCollapsed,
  groupCollapsed,
}: ListedWorkstreamProps) {
  const other = list === "other";
  const toggle = useCallback(
    () => toggleGroup(group, collapseScopeOf(list)),
    [toggleGroup, group, list],
  );
  const onToggleFocus = useMemo(
    () => (other ? undefined : () => toggleFocus(group)),
    [other, toggleFocus, group],
  );
  const onNewThread = useMemo(
    () => (other ? undefined : newThreadIn(group)),
    [other, newThreadIn, group],
  );
  const onOpenOverview = useMemo(
    () => openOverview?.(group),
    [openOverview, group],
  );
  const color = useMemo(
    () => (other ? undefined : colorOf(group)),
    [other, colorOf, group],
  );
  const prefixColor = useMemo(
    () => (other ? undefined : prefixColorOf(group)),
    [other, prefixColorOf, group],
  );
  const snooze = useMemo(() => groupSnoozeOf(group), [groupSnoozeOf, group]);
  const style = useMemo<CSSProperties | undefined>(
    () => (marginTop ? { marginTop } : undefined),
    [marginTop],
  );
  const header = useCallback(
    (wiring: Pick<GroupProps, "handle" | "sectionRef">) => (
      <WorkstreamGroup
        group={group}
        collapsed={collapsed}
        toggle={toggle}
        onToggleFocus={onToggleFocus}
        onNewThread={onNewThread}
        onOpenOverview={onOpenOverview}
        muted={list === "dormant" || other ? true : undefined}
        color={color}
        prefixColor={prefixColor}
        snooze={snooze}
        style={style}
        {...wiring}
      >
        <GroupBody
          group={group}
          collapsed={collapsed}
          renderRow={renderRow}
          groupSlot={groupSlot}
          choosingWorkstream={choosingWorkstream}
          colorOf={colorOf}
          newThreadIn={newThreadIn}
          openOverview={openOverview}
          groupSnoozeOf={groupSnoozeOf}
          isCollapsed={isCollapsed}
          groupCollapsed={groupCollapsed}
          toggleGroup={toggleGroup}
        />
      </WorkstreamGroup>
    ),
    [
      group,
      list,
      other,
      collapsed,
      toggle,
      onToggleFocus,
      onNewThread,
      onOpenOverview,
      color,
      prefixColor,
      snooze,
      style,
      renderRow,
      groupSlot,
      choosingWorkstream,
      colorOf,
      newThreadIn,
      openOverview,
      groupSnoozeOf,
      isCollapsed,
      groupCollapsed,
      toggleGroup,
    ],
  );
  const content = useCallback(
    ({ handle }: { handle: DragHandle }) => header({ handle }),
    [header],
  );
  const surface = useCallback(
    ({
      ref,
      style: sortableStyle,
      children,
    }: {
      ref: (element: HTMLElement | null) => void;
      style: CSSProperties;
      children: ReactNode;
    }) =>
      cloneElement(children as ReactElement<GroupProps>, {
        sectionRef: ref,
        style: { ...sortableStyle, ...style },
      }),
    [style],
  );
  if (other)
    return (
      <DropTarget
        id={groupKey(group.id)}
        data={{ type: "target", groupId: group.id }}
      >
        {(ref) => header({ sectionRef: ref })}
      </DropTarget>
    );
  return (
    <Sortable
      id={groupKey(group.id)}
      data={{ type: "group", groupId: group.id, pinned: group.focused }}
      disabled={!headersDrag}
      surface={surface}
    >
      {content}
    </Sortable>
  );
});
