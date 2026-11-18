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
import { SIDEBAR_GEOMETRY } from "./tokens.ts";
import { categoryHeadingInset, childIndent } from "./statusSlot.ts";
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
  type WorkstreamColor,
} from "../../domain/workstreamColor.ts";
import { GroupSnooze, RenderRow, ThreadNode, ThreadRow } from "./types.ts";
import { WorkstreamGroup } from "./WorkstreamGroup.tsx";
import {
  PullRequestList,
  type PullRequestPlacement,
} from "./PullRequestList.tsx";

/** The groups drawn inline under `group`, in order, theirs included. */
export function inlineGroups(group: ThreadNode): ThreadNode[] {
  return group.workstreams
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
  renderRow: RenderRow;
  collapsed?: boolean;
  slotWidth: number;
  choosingWorkstream: boolean;
  isCollapsed: (id: string, byDefault?: boolean) => boolean;
};

/**
 * A sortable top-level thread and its visible descendants, with drag-only
 * surface updates.
 */
export function SortableThreadTree({
  tree,
  groupId,
  label,
  renderRow,
  slotWidth,
  choosingWorkstream,
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
          }),
        )}
      </ul>
    ),
    [visible, renderRow, slotWidth, label],
  );
  const topThread = tree[0]!.thread;
  return (
    <Sortable
      id={treeKey(topThread.id)}
      data={{ type: "thread", threadId: topThread.id, groupId }}
      disabled={choosingWorkstream}
      className="list-none"
    >
      {content}
    </Sortable>
  );
}

/**
 * A group's rows as sortable trees; the top row drags the whole tree. Every
 * group decides its status slot together, so titles line up from one group to
 * the next.
 */
export const ThreadTrees = memo(
  function ThreadTrees({
    rows,
    groupId,
    label,
    renderRow,
    slotWidth,
    choosingWorkstream,
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
            renderRow={renderRow}
            slotWidth={slotWidth}
            choosingWorkstream={choosingWorkstream}
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
      before.renderRow === after.renderRow &&
      before.slotWidth === after.slotWidth &&
      before.choosingWorkstream === after.choosingWorkstream &&
      before.isCollapsed === after.isCollapsed),
);

export type GroupBodyProps = {
  group: ThreadNode;
  collapsed: boolean;
  renderRow: RenderRow;
  groupSlot: number;
  /** Which tracked pull requests each group draws, and how a row opens one. */
  pullRequests: PullRequestPlacement;
  choosingWorkstream: boolean;
  colorOf: (group: ThreadNode) => WorkstreamColor;
  newThreadIn: (group: ThreadNode) => () => void;
  /** Opens a workstream's Overview; absent where the list offers none. */
  openOverview?: (group: ThreadNode) => () => void;
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
  choosingWorkstream,
  colorOf,
  isCollapsed,
}: Pick<
  GroupBodyProps,
  | "group"
  | "renderRow"
  | "collapsed"
  | "groupSlot"
  | "choosingWorkstream"
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
    [colorOf, group.id, group.workstreamId],
  );
  return categories.map((category, index) => (
    <Fragment key={category.id ?? "unplaced"}>
      {category.name ? (
        <li
          // The inset follows the status slot as it folds, in step with
          // the rows' own padding (see `.ws-row`).
          className="ws-category-heading list-none"
          style={{
            marginTop:
              index === 0
                ? SIDEBAR_GEOMETRY.category.firstTopGap
                : SIDEBAR_GEOMETRY.category.betweenGap,
            marginBottom: SIDEBAR_GEOMETRY.category.afterGap,
            height: SIDEBAR_GEOMETRY.category.height,
            paddingLeft: categoryHeadingInset(groupSlot),
          }}
        >
          <h4
            className="ws-text-category ws-category-label m-0 truncate"
            style={color}
          >
            {label ? (
              <>
                {label} <span className="sr-only">›</span> {category.name}
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
        renderRow={renderRow}
        collapsed={collapsed}
        slotWidth={groupSlot}
        choosingWorkstream={choosingWorkstream}
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
    openOverview,
    groupSnoozeOf,
    sectionRef,
  } = props;
  const collapsed = groupCollapsed(group);
  const toggleThis = useCallback(
    () => toggleGroup(group),
    [toggleGroup, group],
  );
  const onNewThread = useMemo(() => newThreadIn(group), [newThreadIn, group]);
  const onOpenOverview = useMemo(
    () => openOverview?.(group),
    [openOverview, group],
  );
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
      onOpenOverview={onOpenOverview}
      snooze={groupSnoozeOf(group)}
    >
      <GroupBody {...props} collapsed={collapsed} />
    </WorkstreamGroup>
  );
}

/**
 * A group's pull requests, own rows, and nested groups, isolated from header
 * and drag updates. The pull requests lead, above every thread.
 */
export const GroupBody = memo(
  function GroupBody(props: GroupBodyProps) {
    const { group } = props;
    return (
      <>
        <PullRequestList groupId={group.id} placement={props.pullRequests} />
        <CategorizedTrees {...props} />
        {inlineGroups(group).map((sub) => (
          <CategorizedTrees
            {...props}
            key={`inline:${sub.id}`}
            group={sub}
            label={shortLabel(sub.label)}
          />
        ))}
        {group.workstreams
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
      before.pullRequests === after.pullRequests &&
      before.choosingWorkstream === after.choosingWorkstream &&
      before.colorOf === after.colorOf &&
      before.newThreadIn === after.newThreadIn &&
      before.openOverview === after.openOverview &&
      before.groupSnoozeOf === after.groupSnoozeOf &&
      before.isCollapsed === after.isCollapsed &&
      before.groupCollapsed === after.groupCollapsed &&
      before.toggleGroup === after.toggleGroup),
);
