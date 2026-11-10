import {
  Fragment,
  memo,
  useCallback,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { SIDEBAR_GEOMETRY } from "./tokens.ts";
import { childIndent } from "./statusSlot.ts";
import {
  foldKey,
  foldDefault,
  treesOf,
  visibleEntries,
  sameThread,
} from "./rows.ts";
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
  projectionNow: number;
  collapsed?: boolean;
  slotWidth: number;
  choosingTopic: boolean;
  isCollapsed: (id: string, byDefault?: boolean) => boolean;
};

export function sameRows(
  before: readonly ThreadRow[],
  after: readonly ThreadRow[],
) {
  return (
    before.length === after.length &&
    before.every((row, index) => {
      const next = after[index]!;
      return (
        sameThread(row.thread, next.thread) &&
        row.depth === next.depth &&
        row.hasChildren === next.hasChildren &&
        row.workstreamId === next.workstreamId &&
        row.needsYou === next.needsYou
      );
    })
  );
}

export function useStableRows(rows: readonly ThreadRow[]) {
  const previous = useRef(rows);
  return useMemo(() => {
    if (!sameRows(previous.current, rows)) previous.current = rows;
    return previous.current;
  }, [rows]);
}

/** A sortable root and its visible descendants, with drag-only surface updates. */
export function SortableThreadTree({
  tree,
  groupId,
  label,
  categorized = false,
  renderRow,
  projectionNow,
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
            projectionNow,
            handle: index === 0 ? handle : undefined,
            slotWidth,
            label,
            categorized,
          }),
        )}
      </ul>
    ),
    [visible, renderRow, projectionNow, slotWidth, label, categorized],
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
    projectionNow,
    slotWidth,
    choosingTopic,
    isCollapsed,
  }: ThreadTreesProps) {
    const stableRows = useStableRows(rows);
    const trees = useMemo(() => treesOf(stableRows), [stableRows]);
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
            projectionNow={projectionNow}
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
      sameRows(before.rows, after.rows) &&
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
  projectionNow: number;
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
  projectionNow,
  collapsed,
  groupSlot,
  choosingTopic,
  colorOf,
  isCollapsed,
}: Pick<
  GroupBodyProps,
  | "group"
  | "renderRow"
  | "projectionNow"
  | "collapsed"
  | "groupSlot"
  | "choosingTopic"
  | "colorOf"
  | "isCollapsed"
> & { label?: string }) {
  const rows = useStableRows(group.rows);
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
        projectionNow={projectionNow}
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
      sameGroupData(before.group, after.group) &&
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

export function sameGroupData(before: ThreadNode, after: ThreadNode): boolean {
  return (
    before.id === after.id &&
    before.name === after.name &&
    before.label === after.label &&
    before.total === after.total &&
    before.needsYou === after.needsYou &&
    before.lastActiveAt === after.lastActiveAt &&
    before.prioritized === after.prioritized &&
    before.topicId === after.topicId &&
    before.hasSection === after.hasSection &&
    before.inline === after.inline &&
    before.categories === after.categories &&
    sameRows(before.rows, after.rows) &&
    before.sectionIds.length === after.sectionIds.length &&
    before.sectionIds.every((id, index) => id === after.sectionIds[index]) &&
    before.subgroups.length === after.subgroups.length &&
    before.subgroups.every((sub, index) =>
      sameGroupData(sub, after.subgroups[index]!),
    )
  );
}
