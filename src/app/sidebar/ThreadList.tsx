/**
 * The Workstreams sidebar thread list: the Up Next and Pinned bands, the
 * focused workstreams, and the Recent band, then one group per remaining
 * workstream (BB section, in the user's drag-and-drop order, else BB's) that
 * holds a visible thread, Unfiled, a Dormant fold, and a Snoozed fold. Up
 * Next, Pinned, and Recent are overlays: every visible thread appears in
 * exactly one group, or in Snoozed.
 *
 * Workstreams nest by topic (see `nestGroups`): a group lists its own
 * threads, then the threads of subgroups too small for headers, each
 * labeled with its subgroup, then its other subgroups. Each group's contents
 * sit one step (`childIndent`) in. A header folds from the chevron beside its
 * name, and only from there: the row itself drags the workstream.
 * Top-level workstreams always keep their own headers (see `arrangeGroups`).
 *
 * Up Next's rows come from `selectUpNext`, including its focus on the
 * focused workstreams; while any workstream is focused, the rest hide behind
 * a toggle below the focused ones. Focused workstreams are stored as
 * `prioritized`. Up Next never moves the open thread's row out from under
 * the user. Its rows open and close their slots on a spring, and a re-ranked
 * row travels to its new slot (see `useSlotList`); other overlay rows open
 * and close their height over a fixed duration (see `motion.ts`).
 *
 * Pinned lists the roots the user pinned, in BB's pin order, directly under
 * Up Next. The two bands share one sticky plate at the top of the list, so
 * both stay in reach while the workstreams scroll beneath them.
 *
 * This file arranges the list and owns its state. The pieces it draws live
 * beside it: `Bands.tsx` (band headers, menus, the lower toggle),
 * `GroupedBand.tsx` (a band's rows, grouped by workstream or not),
 * `WorkstreamGroup.tsx` (a workstream's header and fold), `GroupBody.tsx` (a
 * group's trees, categories, and nested groups), `SidebarThreadRow.tsx` (a
 * thread row and what its placement offers), and `Row.tsx` (the row itself).
 * `rows.ts` holds the placement table and row planning, `useGroupCollapse.ts`
 * every group fold, and `useSidebarSnooze.tsx` the snoozing.
 */
import {
  cloneElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  experimental_useSidebarThreadActions,
  useBbNavigate,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

import {
  arrangeGroups,
  focusedSections,
  type GroupArrangement,
} from "../../domain/groups.ts";
import { selectRecent } from "../../domain/upNext.ts";
import { initialUpNextState, planSidebarUpNext } from "./upNextState.ts";
import { useWorkstreams } from "../useWorkstreams.ts";
import { shareArrangement } from "../shareNodes.ts";
import { useStableSidebarThreads } from "../useStableSidebarThreads.ts";
import { useLatest } from "../useLatest.ts";
import { useSidebarSnooze } from "./useSidebarSnooze.tsx";
import { useGroupCollapse } from "./useGroupCollapse.ts";
import { SIDEBAR_GEOMETRY } from "./tokens.ts";
import { workstreamGap } from "./workstreamGap.ts";
import { useBandOptions, type BandId } from "./useBandOptions.ts";
import { GroupedBand } from "./GroupedBand.tsx";
import { NameDialog, type NameRequest } from "./NameDialog.tsx";
import { SuggestionsFlyaway } from "./SuggestionsFlyaway.tsx";
import { headerCounts } from "./presentation.ts";
import {
  FULL_SLOT_PX,
  bandTitleInset,
  slotWidthOf as slotWidthOfRows,
} from "./statusSlot.ts";
import { useSpinner } from "../spinner.ts";
import {
  descendantsOf,
  rowsById,
  foldKey,
  foldDefault,
  PLACEMENT_TRAITS,
  visibleEntries,
  planBandRows,
  planArchived,
  type BandGroupPlan,
  type Placement,
} from "./rows.ts";
import { type RowMenuHandlers } from "./RowMenu.tsx";
import { TraceInspector } from "../debug/Inspector.tsx";
import {
  DropTarget,
  Sortable,
  useSidebarDnd,
  type Drop,
  groupKey,
} from "./dnd.tsx";
import { acceptsThreadDrop, planDrop } from "./drop.ts";
import { setComposerPreset } from "../composer/preset.ts";
import { isSnoozed } from "../../domain/snooze.ts";
import { wakeThreads } from "../snooze/actions.ts";
import { CustomSnoozeDialog } from "../snooze/CustomSnoozeDialog.tsx";

import {
  presenceProps,
  useFlip,
  usePresence,
  usePointerHold,
  useSlotList,
  type PresenceEntry,
} from "./motion.ts";
import { FocusIcon } from "./FocusIcon.tsx";
import { Presence } from "./Fold.tsx";
import { colorForWorkstream } from "../../domain/workstreamColor.ts";
import { Hint } from "../Hint.tsx";
import { usePrefs } from "../prefs.ts";
import { RenderRow, ThreadNode, ThreadRow } from "./types.ts";
import { SidebarThreadRow } from "./SidebarThreadRow.tsx";
import { GroupBody } from "./GroupBody.tsx";
import {
  Band,
  BandOptionsMenu,
  SidebarViewOptionsMenu,
  LowerToggle,
} from "./Bands.tsx";
import { GroupProps, WorkstreamGroup } from "./WorkstreamGroup.tsx";
/** The Dormant band folds with the lower workstreams, closed until opened. */
const DORMANT_BAND = { id: "__dormant" };
const DORMANT_SCOPE = { byDefault: true, lower: true };

/** Which list of the arrangement a group sits in (see `arrangeGroups`). */
type GroupList = "pinned" | "populated" | "dormant" | "unfiled";
export function WorkstreamsThreadList({
  activeThreadId,
  onNavigate,
}: PluginThreadListProps) {
  const ws = useWorkstreams();
  const { prefs, save: savePrefs } = usePrefs();
  const archived = useStableSidebarThreads({
    experimental_lifecycles: ws.showArchived ? ["archived"] : [],
  });
  const actions = experimental_useSidebarThreadActions();
  const navigate = useBbNavigate();
  const { bandOptions, updateBandOptions } = useBandOptions();
  const {
    snoozePrefs,
    applySnooze,
    groupSnoozeOf,
    customSnooze,
    setCustomSnooze,
  } = useSidebarSnooze(ws);
  const [nameRequest, setNameRequest] = useState<NameRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosingTopic, setChoosingTopic] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showLower, setShowLower] = useState(false);
  // Other workstreams the user expanded since revealing them. Not
  // persisted: each reveal starts with every one collapsed.
  const [lowerExpanded, setLowerExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [inspecting, setInspecting] = useState<PluginSidebarThread | null>(
    null,
  );
  const { projection, sections, now: projectionNow } = ws;
  const nameOf = useMemo(
    () => new Map(sections.map((section) => [section.id, section.name])),
    [sections],
  );
  const prioritizedIds = ws.server.order.prioritized;
  const groupSort = prefs?.sidebar.groupSort ?? "alphabetical";
  /**
   * A header drag writes the stored manual order, which the active groups do
   * not show under another sort. Dormant groups are displayed in manual order
   * regardless, but header dragging still follows the selected sort. Thread
   * rows drag under every sort.
   */
  const headersDrag = groupSort === "manual" && !choosingTopic;
  // Unfiled, a group only while it has threads, follows the populated
  // workstreams. With any workstream focused, the rest (with Unfiled and
  // Dormant) sit hidden behind a toggle below the focused ones.
  /** The arrangement this one replaces: unchanged groups keep their nodes. */
  const previousArrangement = useRef<
    GroupArrangement<PluginSidebarThread> | undefined
  >(undefined);
  const arrangement = useMemo(() => {
    const next = arrangeGroups(projection, groupSort, ws.topics);
    const shared = shareArrangement(previousArrangement.current, next);
    previousArrangement.current = shared;
    return shared;
  }, [projection, groupSort, ws.topics]);
  const {
    pinned: pinnedGroups,
    populated: populatedGroups,
    dormant: dormantGroups,
    tiered,
    hasLower,
    lowerCounts,
    unfiled,
  } = arrangement;
  const { isCollapsed, toggle, groupCollapsed, toggleGroup } = useGroupCollapse(
    {
      catalog: ws.server.catalog,
      tiered,
      lowerExpanded,
      setLowerExpanded,
    },
  );
  const { waiting: lowerWaiting, total: lowerTotal } = headerCounts(
    lowerCounts,
    true,
    prefs?.sidebar,
  );
  const pinnedGroupItems = useMemo(
    () => pinnedGroups.map((group) => groupKey(group.id)),
    [pinnedGroups],
  );
  const populatedGroupItems = useMemo(
    () => populatedGroups.map((group) => groupKey(group.id)),
    [populatedGroups],
  );
  const dormantGroupItems = useMemo(
    () => dormantGroups.map((group) => groupKey(group.id)),
    [dormantGroups],
  );
  const prioritized = useMemo(
    () => focusedSections(arrangement, new Set(prioritizedIds)),
    [arrangement, prioritizedIds],
  );

  const upNextState = useRef(initialUpNextState);
  const upNext = useMemo(
    () =>
      planSidebarUpNext(
        upNextState.current,
        projection,
        { ...ws.upNextOptions, prioritized },
        activeThreadId,
        showMore,
      ),
    [projection, ws.upNextOptions, prioritized, activeThreadId, showMore],
  );
  if (showMore !== upNext.expanded) setShowMore(upNext.expanded);
  const { rows: shownNeedsRows, moreCount, trimmed: trimmedNeeds } = upNext;
  useLayoutEffect(() => {
    upNextState.current = upNext.state;
  });
  const focus = { active: upNext.focused };
  const recentRows = useMemo(
    () =>
      selectRecent(
        projection,
        ws.showForYou ? shownNeedsRows : [],
        ws.recentLimit,
      ),
    [projection, ws.showForYou, shownNeedsRows, ws.recentLimit],
  );
  const { threads: archivedThreads, rows: archivedRows } = useMemo(
    () => planArchived(archived.threads, sections, ws.showArchived),
    [archived.threads, sections, ws.showArchived],
  );

  const descendants = useMemo(
    () =>
      descendantsOf([
        ...[
          ...projection.groups,
          projection.unsorted,
          ...projection.dormant,
        ].map((group) => group.rows),
        projection.snoozed,
      ]),
    [projection],
  );
  const currentRows = useMemo(() => rowsById(projection), [projection]);
  const folded = useCallback(
    (placement: Placement, id: string) =>
      isCollapsed(foldKey(placement, id), foldDefault(placement)),
    [isCollapsed],
  );
  /** One tree, root first, as `placement` draws it with its folds applied. */
  const entriesOf = useCallback(
    (tree: readonly ThreadRow[], placement: Placement) =>
      visibleEntries(tree, placement, (id) => folded(placement, id)),
    [folded],
  );

  const listRef = useRef<HTMLDivElement>(null);
  const captureLayout = useFlip(listRef, [...prioritized].sort().join(" "));
  /** Focus covers a whole top-level group, so it names every section in it. */
  const toggleFocus = (group: ThreadNode) => {
    setError(null);
    captureLayout(`group:${group.id}`);
    const ids = group.prioritized
      ? prioritizedIds.filter((id) => !group.sectionIds.includes(id))
      : [
          ...prioritizedIds,
          ...group.sectionIds.filter((id) => !prioritizedIds.includes(id)),
        ];
    ws.reorder({ kind: "prioritized", ids }).catch(report);
  };

  const report = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause));
  const onDrop = async (drop: Drop) => {
    setError(null);
    const plan = planDrop(
      drop,
      projection,
      sections,
      ws.server.order,
      ws.topics,
    );
    try {
      if (plan.assign) {
        const { within, ...target } = plan.assign;
        if (within && target.entityId) {
          setChoosingTopic(true);
          await ws.rpc.call("taskMove", {
            ...target,
            entityId: target.entityId,
          });
        } else await ws.rpc.call("taskAssign", target);
        await ws.refresh();
      }
      if (plan.reorder) await ws.reorder(plan.reorder);
    } catch (cause) {
      report(cause);
    } finally {
      setChoosingTopic(false);
    }
  };
  const { contextProps } = useSidebarDnd({
    containerRef: listRef,
    onDrop,
    acceptsThread: (from, to) => acceptsThreadDrop(from, to, ws.topics),
  });

  const currentRowActions = useLatest({
    actions,
    navigate,
    onNavigate,
    setSnoozes: ws.setSnoozes,
  });
  const handlers = useMemo<RowMenuHandlers>(
    () => ({
      rename: (thread) =>
        setNameRequest({
          title: "Rename thread",
          initial: thread.title ?? thread.displayTitle,
          submitLabel: "Rename",
          onSubmit: (name) =>
            currentRowActions.current.actions.rename(thread.id, name),
        }),
      openParent: (thread) => {
        if (thread.parentThreadId) {
          currentRowActions.current.navigate.toThread(thread.parentThreadId);
          currentRowActions.current.onNavigate();
        }
      },
      inspect: (thread) => setInspecting(thread),
      snooze: (thread, when) => applySnooze({ threads: [thread] }, when),
      customSnooze: (thread) => setCustomSnooze({ threads: [thread] }),
      wake: (thread) =>
        wakeThreads(currentRowActions.current.setSnoozes, [thread]),
      reportError: report,
    }),
    [],
  );
  /** The status slot width these rows share (see `slotWidthOf`). */
  const { shape: spinnerShape } = useSpinner();
  const slotWidthOf = (rows: readonly ThreadRow[]) =>
    slotWidthOfRows(rows, ws.work, spinnerShape);
  const needsSlot = useMemo(
    () => slotWidthOf(shownNeedsRows),
    [shownNeedsRows, ws.server.analysis, ws.server.recaps, spinnerShape],
  );
  const groupSlot = useMemo(
    () =>
      slotWidthOf(
        [
          ...projection.groups,
          projection.unsorted,
          ...projection.dormant,
        ].flatMap((group) => group.rows),
      ),
    [projection, ws.server.analysis, ws.server.recaps, spinnerShape],
  );
  const rowKey = (row: ThreadRow) => row.thread.id;
  const showMoreControl = showMore || moreCount > 0;
  const upNextItems = useMemo<UpNextItem[]>(
    () =>
      ws.showForYou
        ? [
            ...shownNeedsRows.map((row) => ({ kind: "row" as const, row })),
            ...(showMoreControl
              ? [{ kind: "more" as const, count: moreCount }]
              : []),
          ]
        : [],
    [ws.showForYou, shownNeedsRows, showMoreControl, moreCount],
  );
  // Up Next's rows and Show more, as drawn: a change in which rows show
  // waits out its burst, then every slot moves at once (see `useSlotList`).
  const upNextPointer = usePointerHold();
  const upNextSlots = useSlotList(upNextItems, upNextItemKey, {
    trimmed: trimmedNeeds,
    edge: UP_NEXT_MORE_KEY,
    immediate: String(showMore),
    arranged: (item) => item.kind === "more",
    settleKey: activeThreadId,
    holdUntil: upNextPointer.holdUntil,
  });
  const showBand = upNextSlots.some(
    (slot) => slot.item.kind === "row" && !slot.leaving,
  );
  const pinnedRows = projection.pinnedThreads;
  const pinnedSlot = useMemo(
    () => slotWidthOf(pinnedRows),
    [pinnedRows, ws.server.analysis, ws.server.recaps, spinnerShape],
  );
  const showPinned = pinnedRows.length > 0;
  // The sticky plate holds both bands: it enters and leaves as one, while each
  // band inside opens and closes on its own.
  const stackPresence = usePresence(
    showBand || showPinned ? ["stack"] : [],
    String,
  );
  const bandPresence = usePresence(showBand ? ["band"] : [], String);
  const pinnedBandPresence = usePresence(showPinned ? ["pinned"] : [], String);
  const pinnedRowPresence = usePresence(pinnedRows, rowKey);
  const snoozes = ws.server.snoozes;
  const renderRow = useCallback<RenderRow>(
    (
      { row, depth, key },
      {
        placement,
        projectionNow,
        handle,
        slotWidth = FULL_SLOT_PX,
        label,
        categorized = false,
      },
    ) => {
      const storedSnooze = snoozes[row.thread.id];
      const snooze =
        storedSnooze && isSnoozed(storedSnooze, projectionNow)
          ? storedSnooze
          : undefined;
      let context = label;
      if (
        context === undefined &&
        placement !== "group" &&
        !(placement === "archived" && bandOptions.archived.grouped)
      )
        // A snoozed row names its wake time itself, which changes with the clock.
        context =
          placement !== "snoozed" && row.workstreamId
            ? nameOf.get(row.workstreamId)
            : undefined;
      return (
        <SidebarThreadRow
          key={key}
          handleRef={handle?.ref}
          handleListeners={handle?.listeners}
          thread={row.thread}
          depth={depth}
          active={row.thread.id === activeThreadId}
          context={context}
          placement={placement}
          analysis={ws.server.analysis[row.thread.id]}
          recap={ws.server.recaps[row.thread.id]}
          slotWidth={slotWidth}
          snooze={snooze}
          snoozePrefs={snoozePrefs}
          handlers={handlers}
          disclosureExpanded={
            PLACEMENT_TRAITS[placement].disclosure && row.hasChildren
              ? !folded(placement, row.thread.id)
              : undefined
          }
          categorized={categorized}
          onNavigate={onNavigate}
          toggleDisclosure={toggle}
        />
      );
    },
    [
      activeThreadId,
      bandOptions.archived.grouped,
      folded,
      handlers,
      nameOf,
      onNavigate,
      snoozePrefs,
      snoozes,
      toggle,
      ws.server.analysis,
      ws.server.recaps,
    ],
  );
  const planningSnoozeOf = useMemo(
    () => (thread: PluginSidebarThread) => snoozes[thread.id],
    [snoozes],
  );
  const recentPlan = useMemo(
    () =>
      planBandRows(
        recentRows,
        "recent",
        bandOptions.recent,
        planningSnoozeOf,
        nameOf,
      ),
    [recentRows, bandOptions.recent, planningSnoozeOf, nameOf],
  );
  const snoozedPlan = useMemo(
    () =>
      planBandRows(
        projection.snoozed,
        "snoozed",
        bandOptions.snoozed,
        planningSnoozeOf,
        nameOf,
      ),
    [projection.snoozed, bandOptions.snoozed, planningSnoozeOf, nameOf],
  );
  const archivedPlan = useMemo(
    () =>
      planBandRows(
        archivedRows,
        "archived",
        bandOptions.archived,
        planningSnoozeOf,
        nameOf,
      ),
    [archivedRows, bandOptions.archived, planningSnoozeOf, nameOf],
  );
  /** A band's rows, drawn in one list or grouped by workstream. */
  const bandBody = (
    placement: BandId,
    rows: readonly ThreadRow[],
    planned: readonly BandGroupPlan[],
  ) => (
    <GroupedBand
      placement={placement}
      planned={planned}
      grouped={bandOptions[placement].grouped}
      slotWidth={slotWidthOf(rows)}
      projectionNow={projectionNow}
      renderRow={renderRow}
      isCollapsed={isCollapsed}
      toggle={toggle}
    />
  );
  /** An overlay row followed, when expanded, by its visible descendants. */
  const renderOverlayTree = (
    row: ThreadRow,
    placement: Placement,
    slotWidth: number,
  ) =>
    entriesOf([row, ...(descendants.get(row.thread.id) ?? [])], placement).map(
      (entry) =>
        renderRow(entry, {
          placement,
          projectionNow,
          slotWidth,
        }),
    );
  /** The new thread starts with this workstream's topic. */
  const newThreadIn = useCallback(
    (group: ThreadNode) => () => {
      setComposerPreset(
        group.hasSection
          ? { sectionId: group.id }
          : { topicId: group.topicId! },
        group.label,
      );
      navigate.toCompose({ focusPrompt: true });
    },
    [navigate],
  );
  const colorOf = useCallback(
    (group: ThreadNode) =>
      colorForWorkstream(group.id, ws.server.catalog, group.topicId),
    [ws.server.catalog],
  );

  /**
   * The container above the workstream, in the color the organizer gave that
   * container, so every area of one parent shows the same parent color.
   */
  const prefixColorOf = useCallback(
    (group: ThreadNode) =>
      group.parentTopicId
        ? colorForWorkstream(
            group.parentTopicId,
            ws.server.catalog,
            group.parentTopicId,
          )
        : undefined,
    [ws.server.catalog],
  );
  const renderGroupBody = (group: ThreadNode, collapsed: boolean) => (
    <GroupBody
      group={group}
      collapsed={collapsed}
      renderRow={renderRow}
      projectionNow={projectionNow}
      groupSlot={groupSlot}
      choosingTopic={choosingTopic}
      colorOf={colorOf}
      newThreadIn={newThreadIn}
      groupSnoozeOf={groupSnoozeOf}
      isCollapsed={isCollapsed}
      groupCollapsed={groupCollapsed}
      toggleGroup={toggleGroup}
    />
  );
  const renderSortableGroup = (
    group: ThreadNode,
    props: Omit<GroupProps, "group" | "children">,
    style?: CSSProperties,
  ) => (
    <Sortable
      key={group.id}
      id={groupKey(group.id)}
      data={{ type: "group", groupId: group.id, pinned: group.prioritized }}
      disabled={!headersDrag}
      surface={({ ref, style: sortableStyle, children }) =>
        cloneElement(children as ReactElement<GroupProps>, {
          sectionRef: ref,
          style: { ...sortableStyle, ...style },
        })
      }
    >
      {({ handle }) => (
        <WorkstreamGroup
          {...props}
          group={group}
          color={colorOf(group)}
          prefixColor={prefixColorOf(group)}
          snooze={groupSnoozeOf(group)}
          handle={handle}
        >
          {renderGroupBody(group, props.collapsed)}
        </WorkstreamGroup>
      )}
    </Sortable>
  );

  if (!tiered && (showLower || lowerExpanded.size > 0)) {
    setShowLower(false);
    setLowerExpanded(new Set());
  }
  const wasTiered = useRef(tiered);
  useLayoutEffect(() => {
    wasTiered.current = tiered;
  });
  // Entering or leaving tiers rearranges the whole list, which the focus
  // glide covers; only the toggle opens and closes the hidden block.
  const lowerPresence = usePresence(
    hasLower && (!tiered || showLower) ? ["lower"] : [],
    String,
    wasTiered.current === tiered,
  );
  const toggleLower = () => {
    if (showLower) setLowerExpanded(new Set());
    setShowLower(!showLower);
  };
  const groupPropsOf = (
    group: ThreadNode,
    list: GroupList,
  ): Omit<GroupProps, "group" | "children"> => {
    const scope = {
      byDefault: list === "dormant",
      lower: list === "populated" || list === "unfiled",
    };
    return {
      collapsed: groupCollapsed(group, scope),
      toggle: () => toggleGroup(group, scope),
      onToggleFocus: list === "unfiled" ? undefined : () => toggleFocus(group),
      onNewThread: list === "unfiled" ? undefined : newThreadIn(group),
      muted: list === "dormant" || list === "unfiled" ? true : undefined,
    };
  };
  /** A list's groups, each spaced from the one above by its collapse state. */
  const renderGroupList = (
    groups: readonly ThreadNode[],
    list: GroupList,
    /** The last group of the list above, whose fold sets the first gap. */
    above: [ThreadNode, GroupList] | null = null,
  ) =>
    groups.map((group, index) => {
      const [prev, prevList] =
        index > 0 ? ([groups[index - 1]!, list] as const) : (above ?? []);
      const marginTop = workstreamGap(
        prev ?? null,
        group,
        prev ? groupPropsOf(prev, prevList!).collapsed : false,
      );
      const sortable = renderSortableGroup(
        group,
        groupPropsOf(group, list),
        marginTop ? { marginTop } : undefined,
      );
      return list === "dormant" ? (
        <li key={group.id} className="list-none">
          {sortable}
        </li>
      ) : (
        sortable
      );
    });
  /** An item that opens and closes with its presence phase. */
  const present = (entry: PresenceEntry<unknown>, children: ReactNode) => (
    <Presence key={entry.key} as="li" phase={entry.phase} className="list-none">
      <ul>{children}</ul>
    </Presence>
  );
  // Left edge matches the row titles in Up Next (see `bandTitleInset`).
  const bandControlClass = (tone: string) =>
    cn(
      "w-full cursor-pointer rounded-md py-0.5 pr-2 text-left text-[12px] transition-[padding] duration-[180ms] ease-out hover:bg-sidebar-accent/60 motion-reduce:transition-none",
      tone,
    );
  const bandControlStyle = { paddingLeft: bandTitleInset(needsSlot) };
  const recentBlock =
    ws.showRecent && recentRows.length > 0 ? (
      <Band
        key="recent"
        title="Recent"
        flipKey="recent"
        box="neutral"
        menu={
          <BandOptionsMenu
            section="recent"
            options={bandOptions.recent}
            onChange={(change) => updateBandOptions("recent", change)}
          />
        }
      >
        {bandBody("recent", recentRows, recentPlan)}
      </Band>
    ) : null;
  const hasWorkstreams =
    pinnedGroups.length +
      populatedGroups.length +
      dormantGroups.length +
      projection.unsorted.total >
    0;
  /**
   * The heading over the workstreams, holding the organizing suggestions'
   * count, which opens them, and the workstreams' sort. Not a region: each
   * workstream below is one.
   */
  const workstreamsHeading = hasWorkstreams ? (
    <SuggestionsFlyaway
      key="workstreams-heading"
      rpc={ws.rpc}
      colors={ws.server.catalog}
      count={ws.server.pendingSuggestions ?? 0}
      onOpenTopics={() => navigate.toPluginPanel("home", { subPath: "topics" })}
    >
      {(suggestions) => (
        <div
          className="flex items-center gap-3 outline-none"
          style={{
            height: SIDEBAR_GEOMETRY.sectionHeading.height,
            marginTop: SIDEBAR_GEOMETRY.sectionHeading.topMargin,
            marginBottom: SIDEBAR_GEOMETRY.sectionHeading.bottomMargin,
            paddingLeft: SIDEBAR_GEOMETRY.sectionHeading.leftInset,
          }}
        >
          <h2 className="ws-text-section flex min-w-0 items-center text-muted-foreground">
            Workstreams
          </h2>
          <div className="flex-1" />
          {suggestions}
          <SidebarViewOptionsMenu
            sort={groupSort}
            onChange={(groupSort) =>
              void savePrefs({ sidebar: { groupSort } }).catch(report)
            }
          />
        </div>
      )}
    </SuggestionsFlyaway>
  ) : null;
  /** Everything below the focused workstreams, as one opening block. */
  const lowerBlock = lowerPresence.map((entry) => (
    <Presence key="lower" data-flip-key="lower" phase={entry.phase} gap>
      <div className="flex flex-col">
        <SortableContext
          items={populatedGroupItems}
          strategy={verticalListSortingStrategy}
        >
          {renderGroupList(populatedGroups, "populated")}
        </SortableContext>
        {unfiled.total > 0 ? (
          <DropTarget
            id={groupKey(unfiled.id)}
            data={{ type: "target", groupId: unfiled.id }}
          >
            {(ref) => {
              const props = groupPropsOf(unfiled, "unfiled");
              const last = populatedGroups.at(-1);
              const marginTop = workstreamGap(
                last ?? null,
                unfiled,
                last ? groupPropsOf(last, "populated").collapsed : false,
              );
              return (
                <WorkstreamGroup
                  {...props}
                  group={unfiled}
                  sectionRef={ref}
                  snooze={groupSnoozeOf(unfiled)}
                  style={marginTop ? { marginTop } : undefined}
                >
                  {renderGroupBody(unfiled, props.collapsed)}
                </WorkstreamGroup>
              );
            }}
          </DropTarget>
        ) : null}
        {dormantGroups.length > 0 ? (
          <Band
            title="Dormant"
            flipKey="dormant"
            count={dormantGroups.length}
            collapsed={groupCollapsed(DORMANT_BAND, DORMANT_SCOPE)}
            toggle={() => toggleGroup(DORMANT_BAND, DORMANT_SCOPE)}
          >
            <SortableContext
              items={dormantGroupItems}
              strategy={verticalListSortingStrategy}
            >
              {renderGroupList(dormantGroups, "dormant")}
            </SortableContext>
          </Band>
        ) : null}
      </div>
    </Presence>
  ));
  if (ws.status === "loading")
    return <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>;
  if (ws.status === "error")
    return (
      <p className="px-3 py-2 text-xs text-destructive">
        Couldn't load threads.
      </p>
    );

  const showArchivedBand =
    ws.showArchived &&
    archived.experimental_archived?.status !== "error" &&
    (archivedThreads.length > 0 ||
      archived.experimental_archived?.status === "loading" ||
      archived.experimental_archived?.hasNextPage);
  const showSnoozedBand = ws.showSnoozed && projection.snoozed.length > 0;

  return (
    <DndContext {...contextProps}>
      <div
        ref={listRef}
        className="ws-list flex flex-col"
        style={{
          paddingLeft: SIDEBAR_GEOMETRY.container.paddingX,
          paddingRight: SIDEBAR_GEOMETRY.container.paddingX,
          paddingTop: SIDEBAR_GEOMETRY.container.paddingTop,
          paddingBottom: SIDEBAR_GEOMETRY.container.paddingBottom,
          ["--ws-list-pad-top" as string]: `${SIDEBAR_GEOMETRY.container.paddingTop}px`,
        }}
      >
        {error ? (
          <p
            role="alert"
            className="mx-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
        {choosingTopic ? (
          <p
            role="status"
            className="mx-2 px-2 py-1 text-xs text-muted-foreground"
          >
            Choosing a topic in the destination workstream…
          </p>
        ) : null}
        {stackPresence.map((stack) => (
          <Presence
            key={stack.key}
            data-flip-key="up-next"
            phase={stack.phase}
            gap
            className="ws-up-next-sticky"
          >
            <div className="flex flex-col gap-[10px]">
              {bandPresence.map((band) => (
                <Presence key={band.key} phase={band.phase} gap>
                  <div onPointerMove={upNextPointer.onPointerMove}>
                    <Band
                      title={UP_NEXT}
                      box="attention"
                      markless={needsSlot === 0}
                      badge={
                        focus.active ? (
                          <Hint label="Showing focused workstreams">
                            <span
                              role="img"
                              aria-label="Showing focused workstreams"
                              className="inline-flex"
                            >
                              <FocusIcon className="size-3" />
                            </span>
                          </Hint>
                        ) : null
                      }
                    >
                      {upNextSlots.map((slot) => (
                        <li
                          key={slot.key}
                          ref={slot.ref}
                          className="list-none rounded-md"
                          {...presenceProps(slot.leaving ? "leave" : "idle")}
                        >
                          <ul>
                            {slot.item.kind === "row" ? (
                              renderOverlayTree(
                                currentRows.get(slot.item.row.thread.id) ??
                                  slot.item.row,
                                "needs-you",
                                needsSlot,
                              )
                            ) : (
                              <li>
                                <button
                                  type="button"
                                  aria-expanded={showMore}
                                  onClick={() => setShowMore((more) => !more)}
                                  className={bandControlClass(
                                    "ws-needs-you-text",
                                  )}
                                  style={bandControlStyle}
                                >
                                  {showMore
                                    ? "Show less"
                                    : `Show ${Math.max(1, slot.item.count)} more`}
                                </button>
                              </li>
                            )}
                          </ul>
                        </li>
                      ))}
                    </Band>
                  </div>
                </Presence>
              ))}
              {pinnedBandPresence.map((band) => (
                <Presence key={band.key} phase={band.phase} gap>
                  <div>
                    <Band
                      title={PINNED}
                      box="pinned"
                      markless={pinnedSlot === 0}
                      badge={
                        <span className="inline-flex items-center">
                          <Icon name="Pin" className="size-3" />
                        </span>
                      }
                    >
                      {pinnedRowPresence.map((entry) =>
                        present(
                          entry,
                          renderOverlayTree(entry.item, "pinned", pinnedSlot),
                        ),
                      )}
                    </Band>
                  </div>
                </Presence>
              ))}
            </div>
          </Presence>
        ))}
        {tiered
          ? [
              workstreamsHeading,
              <SortableContext
                key="pinned"
                items={pinnedGroupItems}
                strategy={verticalListSortingStrategy}
              >
                {renderGroupList(pinnedGroups, "pinned")}
              </SortableContext>,
              ...(hasLower
                ? [
                    <LowerToggle
                      key="lower-toggle"
                      open={showLower}
                      waiting={lowerWaiting ? lowerCounts.needsYou : 0}
                      total={lowerTotal ? lowerCounts.total : 0}
                      onToggle={toggleLower}
                    />,
                  ]
                : []),
              ...lowerBlock,
              recentBlock,
            ]
          : [recentBlock, workstreamsHeading, ...lowerBlock]}
        {showArchivedBand ? (
          <Band
            title="Archived"
            flipKey="archived"
            style={{ marginTop: SIDEBAR_GEOMETRY.gaps.inlineBoundary }}
            count={archivedThreads.length}
            collapsed={isCollapsed("__archived", true)}
            toggle={() => toggle("__archived", true)}
            menu={
              <BandOptionsMenu
                section="archived"
                options={bandOptions.archived}
                onChange={(change) => updateBandOptions("archived", change)}
              />
            }
          >
            {bandBody("archived", archivedRows, archivedPlan)}
            {archived.experimental_archived?.status === "loading" ? (
              <li className="list-none px-2 py-1 text-xs text-muted-foreground">
                Loading archived threads…
              </li>
            ) : null}
            {archived.experimental_archived?.hasNextPage ? (
              <li className="list-none px-2 pt-1">
                <button
                  type="button"
                  disabled={archived.experimental_archived.isFetchingNextPage}
                  onClick={() =>
                    void archived.experimental_archived?.fetchNextPage()
                  }
                  className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground disabled:opacity-50"
                >
                  {archived.experimental_archived.isFetchingNextPage
                    ? "Loading…"
                    : "Load more archived threads"}
                </button>
              </li>
            ) : null}
          </Band>
        ) : null}
        {showSnoozedBand ? (
          <Band
            title="Snoozed"
            flipKey="snoozed"
            style={
              showArchivedBand
                ? undefined
                : { marginTop: SIDEBAR_GEOMETRY.gaps.inlineBoundary }
            }
            count={projection.snoozed.filter((row) => row.depth === 0).length}
            collapsed={isCollapsed("__snoozed", true)}
            toggle={() => toggle("__snoozed", true)}
            menu={
              <BandOptionsMenu
                section="snoozed"
                options={bandOptions.snoozed}
                onChange={(change) => updateBandOptions("snoozed", change)}
              />
            }
          >
            {bandBody("snoozed", projection.snoozed, snoozedPlan)}
          </Band>
        ) : null}
        <NameDialog
          request={nameRequest}
          onClose={() => setNameRequest(null)}
        />
        <CustomSnoozeDialog
          open={customSnooze !== null}
          onClose={() => setCustomSnooze(null)}
          onSubmit={(when) => {
            if (customSnooze) applySnooze(customSnooze, when);
          }}
        />
        {inspecting ? (
          <TraceInspector
            open
            onOpenChange={(open) => !open && setInspecting(null)}
            target={{ link: { kind: "thread", ref: inspecting.id } }}
            title={`Model calls for ${inspecting.displayTitle}`}
          />
        ) : null}
      </div>
    </DndContext>
  );
}

/** The band of threads most worth the user's attention (see `selectUpNext`). */
const UP_NEXT = "Up Next";

/** One of Up Next's slots: a row, or Show more below the rows. */
type UpNextItem =
  | { readonly kind: "row"; readonly row: ThreadRow }
  | {
      readonly kind: "more";
      /** The rows Show more holds, counted with the rows shown above it. */
      readonly count: number;
    };
const UP_NEXT_MORE_KEY = ":more";
const upNextItemKey = (item: UpNextItem) =>
  item.kind === "row" ? item.row.thread.id : UP_NEXT_MORE_KEY;
const PINNED = "Pinned";
