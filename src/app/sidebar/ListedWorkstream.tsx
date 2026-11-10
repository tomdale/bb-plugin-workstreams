import {
  cloneElement,
  memo,
  useCallback,
  useMemo,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type { TopicColor } from "../../domain/workstreamColor.ts";
import { DropTarget, Sortable, groupKey, type DragHandle } from "./dnd.tsx";
import { GroupBody, type GroupBodyProps } from "./GroupBody.tsx";
import type { CollapseScope } from "./useGroupCollapse.ts";
import type { ThreadNode } from "./types.ts";
import { WorkstreamGroup, type GroupProps } from "./WorkstreamGroup.tsx";

/** Which list of the arrangement a group sits in (see `arrangeGroups`). */
export type GroupList = "pinned" | "populated" | "dormant" | "unfiled";

/** How a list's groups fold: Dormant's start closed, the lower tier's per reveal. */
export const collapseScopeOf = (list: GroupList): CollapseScope => ({
  byDefault: list === "dormant",
  lower: list === "populated" || list === "unfiled",
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
  prefixColorOf: (group: ThreadNode) => TopicColor | undefined;
  toggleFocus: (group: ThreadNode) => void;
  toggleGroup: (group: ThreadNode, scope?: CollapseScope) => void;
};

/**
 * One workstream in the thread list: its header and body, sortable by the
 * header, or for Unfiled a drop target only. Every prop is a value or a
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
  choosingTopic,
  colorOf,
  newThreadIn,
  groupSnoozeOf,
  isCollapsed,
  groupCollapsed,
}: ListedWorkstreamProps) {
  const unfiled = list === "unfiled";
  const toggle = useCallback(
    () => toggleGroup(group, collapseScopeOf(list)),
    [toggleGroup, group, list],
  );
  const onToggleFocus = useMemo(
    () => (unfiled ? undefined : () => toggleFocus(group)),
    [unfiled, toggleFocus, group],
  );
  const onNewThread = useMemo(
    () => (unfiled ? undefined : newThreadIn(group)),
    [unfiled, newThreadIn, group],
  );
  const color = useMemo(
    () => (unfiled ? undefined : colorOf(group)),
    [unfiled, colorOf, group],
  );
  const prefixColor = useMemo(
    () => (unfiled ? undefined : prefixColorOf(group)),
    [unfiled, prefixColorOf, group],
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
        muted={list === "dormant" || unfiled ? true : undefined}
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
          choosingTopic={choosingTopic}
          colorOf={colorOf}
          newThreadIn={newThreadIn}
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
      unfiled,
      collapsed,
      toggle,
      onToggleFocus,
      onNewThread,
      color,
      prefixColor,
      snooze,
      style,
      renderRow,
      groupSlot,
      choosingTopic,
      colorOf,
      newThreadIn,
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
  if (unfiled)
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
      data={{ type: "group", groupId: group.id, pinned: group.prioritized }}
      disabled={!headersDrag}
      surface={surface}
    >
      {content}
    </Sortable>
  );
});
