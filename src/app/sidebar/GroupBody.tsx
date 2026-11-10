import {
  Fragment,
  memo,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { SIDEBAR_GEOMETRY } from "./tokens.ts";
import { childIndent } from "./statusSlot.ts";
import { foldKey, foldDefault, treesOf, visibleEntries } from "./rows.ts";
import {
  DropTarget,
  Sortable,
  type DragHandle,
  groupKey,
  treeKey,
} from "./dnd.tsx";
import { categoryRows } from "../../domain/categoryRows.ts";
import {
  workstreamColorStyle,
  type TopicColor,
} from "../../domain/workstreamColor.ts";
import { GroupSnooze, RenderRow, ThreadNode, ThreadRow } from "./types.ts";
import { WorkstreamGroup } from "./WorkstreamGroup.tsx";

/** The groups drawn inline under `group`, in order, theirs included. */
export function inlineGroups(group: ThreadNode): ThreadNode[] {
  return group.subgroups
    .filter((sub) => sub.inline)
    .flatMap((sub) => [sub, ...inlineGroups(sub)]);
}

/** A group's own name, for its rows' label: "Walkthrough Plugin" for "bb: Walkthrough Plugin". */
export const shortLabel = (label: string) =>
  label.split(/:\s*/).at(-1) ?? label;

export type ThreadTreesProps = {
  rows: readonly ThreadRow[];
  groupId: string;
  label?: string;
  categorized?: boolean;
  renderRow: RenderRow;
  collapsed?: boolean;
  slotWidth: number;
  choosingTopic: boolean;
  isCollapsed: (id: string, byDefault?: boolean) => boolean;
};

/** A sortable root and its visible descendants, with drag-only surface updates. */
export function SortableThreadTree({
  tree,
  groupId,
  label,
  categorized = false,
  renderRow,
  slotWidth,
  choosingTopic,
  isCollapsed,
}: Omit<ThreadTreesProps, "rows"> & {
  tree: readonly ThreadRow[];
}) {
  const visible = useMemo(
    () =>
      visibleEntries(tree, "group", (id) =>
        isCollapsed(foldKey("group", id), foldDefault("group")),
      ),
    [tree, isCollapsed],
  );
  const content = useCallback(
    ({ handle }: { handle: DragHandle }) => (
      <ul>
        {visible.map((entry, index) =>
          renderRow(entry, {
            placement: "group",
            handle: index === 0 ? handle : undefined,
            slotWidth,
            label,
            categorized,
          }),
        )}
      </ul>
    ),
    [visible, renderRow, slotWidth, label, categorized],
  );
  const root = tree[0]!.thread;
  return (
    <Sortable
      id={treeKey(root.id)}
      data={{ type: "thread", threadId: root.id, groupId }}
      disabled={choosingTopic}
      // `pl-3` is `SIDEBAR_GEOMETRY.category.treeInset`, which `rowGeometry`
      // subtracts from the category indent.
      className={cn("list-none", categorized && "pl-3")}
    >
      {content}
    </Sortable>
  );
}

/**
 * A group's rows as sortable trees; the root row drags the whole tree.
 * Every group decides its status slot together, so titles line up from
 * one group to the next.
 */
export const ThreadTrees = memo(
  function ThreadTrees({
    rows,
    groupId,
    label,
    categorized = false,
    renderRow,
    slotWidth,
    choosingTopic,
    isCollapsed,
  }: ThreadTreesProps) {
    const trees = useMemo(() => treesOf(rows), [rows]);
    const items = useMemo(
      () => trees.map((tree) => treeKey(tree[0]!.thread.id)),
      [trees],
    );
    return (
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {trees.map((tree) => (
          <SortableThreadTree
            key={tree[0]!.thread.id}
            tree={tree}
            groupId={groupId}
            label={label}
            categorized={categorized}
            renderRow={renderRow}
            slotWidth={slotWidth}
            choosingTopic={choosingTopic}
            isCollapsed={isCollapsed}
          />
        ))}
      </SortableContext>
    );
  },
  (before, after) =>
    (before.collapsed && after.collapsed) ||
    (before.collapsed === after.collapsed &&
      before.rows === after.rows &&
      before.groupId === after.groupId &&
      before.label === after.label &&
      before.categorized === after.categorized &&
      before.renderRow === after.renderRow &&
      before.slotWidth === after.slotWidth &&
      before.choosingTopic === after.choosingTopic &&
      before.isCollapsed === after.isCollapsed),
);

export type GroupBodyProps = {
  group: ThreadNode;
  collapsed: boolean;
  renderRow: RenderRow;
  groupSlot: number;
  choosingTopic: boolean;
  colorOf: (group: ThreadNode) => TopicColor;
  newThreadIn: (group: ThreadNode) => () => void;
  groupSnoozeOf: (group: ThreadNode) => GroupSnooze | undefined;
  isCollapsed: (id: string, byDefault?: boolean) => boolean;
  groupCollapsed: (group: ThreadNode) => boolean;
  toggleGroup: (group: ThreadNode) => void;
};

export function CategorizedTrees({
  group,
  label,
  renderRow,
  collapsed,
  groupSlot,
  choosingTopic,
  colorOf,
  isCollapsed,
}: Pick<
  GroupBodyProps,
  | "group"
  | "renderRow"
  | "collapsed"
  | "groupSlot"
  | "choosingTopic"
  | "colorOf"
  | "isCollapsed"
> & { label?: string }) {
  const rows = group.rows;
  const categories = useMemo(
    () => categoryRows(rows, group.categories),
    [rows, group.categories],
  );
  const color = useMemo(
    () => workstreamColorStyle(colorOf(group)) as CSSProperties,
    [colorOf, group.id, group.topicId],
  );
  return categories.map((category, index) => (
    <Fragment key={category.id ?? "unplaced"}>
      {category.name ? (
        <li
          className="list-none"
          style={{
            marginTop:
              index === 0
                ? SIDEBAR_GEOMETRY.category.firstTopGap
                : SIDEBAR_GEOMETRY.category.betweenGap,
            marginBottom: SIDEBAR_GEOMETRY.category.afterGap,
            height: SIDEBAR_GEOMETRY.category.height,
            paddingLeft: SIDEBAR_GEOMETRY.category.indent,
          }}
        >
          <h4
            className="ws-text-category ws-category-label m-0 truncate"
            style={color}
          >
            {label ? (
              <>
                {label}
                <span className="sr-only">:</span> {category.name}
              </>
            ) : (
              category.name
            )}
          </h4>
        </li>
      ) : null}
      <ThreadTrees
        rows={category.rows}
        groupId={group.id}
        label={label}
        categorized={Boolean(category.name)}
        renderRow={renderRow}
        collapsed={collapsed}
        slotWidth={groupSlot}
        choosingTopic={choosingTopic}
        isCollapsed={isCollapsed}
      />
    </Fragment>
  ));
}

export function NestedGroup(
  props: GroupBodyProps & {
    sectionRef?: (element: HTMLElement | null) => void;
  },
) {
  const {
    group,
    groupCollapsed,
    toggleGroup,
    colorOf,
    newThreadIn,
    groupSnoozeOf,
    sectionRef,
  } = props;
  const collapsed = groupCollapsed(group);
  const toggleThis = useCallback(
    () => toggleGroup(group),
    [toggleGroup, group],
  );
  const onNewThread = useMemo(() => newThreadIn(group), [newThreadIn, group]);
  return (
    <WorkstreamGroup
      group={group}
      color={colorOf(group)}
      nested
      nestedIndent={childIndent(props.groupSlot)}
      sectionRef={sectionRef}
      collapsed={collapsed}
      toggle={toggleThis}
      onNewThread={onNewThread}
      snooze={groupSnoozeOf(group)}
    >
      <GroupBody {...props} collapsed={collapsed} />
    </WorkstreamGroup>
  );
}

/** A group's own rows and nested groups, isolated from header and drag updates. */
export const GroupBody = memo(
  function GroupBody(props: GroupBodyProps) {
    const { group } = props;
    return (
      <>
        <CategorizedTrees {...props} />
        {inlineGroups(group).map((sub) => (
          <CategorizedTrees
            {...props}
            key={`inline:${sub.id}`}
            group={sub}
            label={shortLabel(sub.label)}
          />
        ))}
        {group.subgroups
          .filter((sub) => !sub.inline)
          .map((sub) => (
            <li key={sub.id} className="list-none">
              <DropTarget
                id={groupKey(sub.id)}
                data={{ type: "target", groupId: sub.id }}
              >
                {(ref) => (
                  <NestedGroup {...props} group={sub} sectionRef={ref} />
                )}
              </DropTarget>
            </li>
          ))}
      </>
    );
  },
  (before, after) =>
    (before.collapsed && after.collapsed) ||
    (before.collapsed === after.collapsed &&
      before.group === after.group &&
      before.renderRow === after.renderRow &&
      before.groupSlot === after.groupSlot &&
      before.choosingTopic === after.choosingTopic &&
      before.colorOf === after.colorOf &&
      before.newThreadIn === after.newThreadIn &&
      before.groupSnoozeOf === after.groupSnoozeOf &&
      before.isCollapsed === after.isCollapsed &&
      before.groupCollapsed === after.groupCollapsed &&
      before.toggleGroup === after.toggleGroup),
);
