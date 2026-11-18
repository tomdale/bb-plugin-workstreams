/**
 * The Workstreams sidebar thread list: the Up Next and Pinned bands, then the
 * Recents and Workstreams sections (Recents below the workstreams while any
 * is focused). Workstreams holds the focused workstreams, then one group per
 * remaining workstream (BB section, in the user's drag-and-drop order, else
 * BB's) that holds a visible thread, Other, and a Dormant fold; Snoozed and
 * Archived sections follow. Every section folds from its heading. Up Next,
 * Pinned, and Recents are overlays: every visible thread appears in exactly
 * one group, or in Snoozed.
 *
 * Groups nest by workstream (see `nestGroups`): a group lists its own
 * threads, then the threads of workstreams too small for headers, each
 * labeled with its workstream, then its other workstreams. Each group's contents
 * sit one step (`childIndent`) in. A header folds from the chevron beside its
 * name, and only from there: the row itself drags the workstream.
 * Top-level workstreams always keep their own headers (see `arrangeGroups`).
 *
 * Up Next's rows come from `selectUpNext`, including its focus on the
 * focused workstreams; while any workstream is focused, the rest hide behind
 * a toggle below the focused ones. Focused workstreams are stored as
 * `focused`. Up Next never moves the open thread's row out from under
 * the user. Its rows open and close their slots on a spring, and a re-ranked
 * row travels to its new slot (see `useSlotList`); other overlay rows open
 * and close their height over a fixed duration (see `motion.ts`).
 *
 * Pinned lists the threads the user pinned, in BB's pin order, directly under
 * Up Next. The two bands share one sticky plate at the top of the list, so both
 * stay in reach while the workstreams scroll beneath them.
 *
 * This file arranges the list and owns its state. The pieces it draws live
 * beside it: `Bands.tsx` (band headers, menus, the lower toggle),
 * `GroupedBand.tsx` (a band's rows, grouped by workstream or not),
 * `ListedWorkstream.tsx` (a workstream as the list holds it, sortable and
 * memoized), `WorkstreamGroup.tsx` (its header and fold), `GroupBody.tsx` (a
 * group's trees, categories, and nested groups), `SidebarThreadRow.tsx` (a
 * thread row and what its location offers), and `Row.tsx` (the row itself).
 * `rows.ts` holds the location table and row planning, `useGroupCollapse.ts`
 * every group fold, and `useSidebarSnooze.tsx` the snoozing.
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import { publishSidebarUpNext } from "../upNext/sidebarOrder.ts";
import { useWorkstreams } from "../useWorkstreams.ts";
import { shareArrangement } from "../shareNodes.ts";
import { useStableSidebarThreads } from "../useStableSidebarThreads.ts";
import { useLatest, useStableCallback } from "../useLatest.ts";
import { useSidebarSnooze } from "./useSidebarSnooze.tsx";
import { useRevealActiveThread } from "./revealActive.ts";
import { useGroupCollapse } from "./useGroupCollapse.ts";
import { SIDEBAR_GEOMETRY } from "./tokens.ts";
import { workstreamGap } from "./workstreamGap.ts";
import { BAND_LABELS, useBandOptions, type BandId } from "./useBandOptions.ts";
import { GroupedBand } from "./GroupedBand.tsx";
import { NameDialog, type NameRequest } from "./NameDialog.tsx";
import { SuggestionsChip } from "./SuggestionsChip.tsx";
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
  LOCATION_TRAITS,
  visibleEntries,
  planBandRows,
  planArchived,
  type BandGroupPlan,
  type RowLocation,
} from "./rows.ts";
import { type RowMenuHandlers } from "./RowMenu.tsx";
import { TraceInspector } from "../debug/Inspector.tsx";
import { useSidebarDnd, type Drop, groupKey } from "./dnd.tsx";
import { acceptsThreadDrop, planDrop } from "./drop.ts";
import { setComposerPreset } from "../composer/preset.ts";
import { overviewSubPath } from "../page/overview/route.ts";
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
import type { PullRequestPlacement } from "./PullRequestList.tsx";
import { placePullRequests } from "./pullRequestGroups.ts";
import {
  pullRequestSubPath,
  workstreamIdsWithPullRequests,
} from "../pullRequests/model.ts";
import { usePullRequestSelector } from "../pullRequests/store.ts";
import { shareJson } from "../structuralSharing.ts";
import {
  Band,
  BandOptionsMenu,
  Section,
  SectionHeading,
  SidebarViewOptionsMenu,
  LowerToggle,
} from "./Bands.tsx";
import {
  ListedWorkstream,
  collapseScopeOf,
  type GroupList,
} from "./ListedWorkstream.tsx";
/** The Dormant band folds with the lower workstreams, closed until opened. */
const DORMANT_BAND = { id: "__dormant" };
const DORMANT_SCOPE = { byDefault: true, lower: true };
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
  const [choosingWorkstream, setChoosingWorkstream] = useState(false);
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
  const { projection, sections } = ws;
  const nameOf = useMemo(
    () => new Map(sections.map((section) => [section.id, section.name])),
    [sections],
  );
  const focusedIds = ws.server.order.focused;
  const groupSort = prefs?.sidebar.groupSort ?? "alphabetical";
  /**
   * A header drag writes the stored manual order, which the active groups do
   * not show under another sort. Dormant groups are displayed in manual order
   * regardless, but header dragging still follows the selected sort. Thread
   * rows drag under every sort.
   */
  const headersDrag = groupSort === "manual" && !choosingWorkstream;
  // Other, a group only while it has threads, follows the populated
  // workstreams. With any workstream focused, the rest (with Other and
  // Dormant) sit hidden behind a toggle below the focused ones.
  /** The arrangement this one replaces: unchanged groups keep their nodes. */
  const previousArrangement = useRef<
    GroupArrangement<PluginSidebarThread> | undefined
  >(undefined);
  const arrangedGroups = useMemo(() => {
    const next = arrangeGroups(projection, groupSort, ws.workstreams);
    const shared = shareArrangement(previousArrangement.current, next);
    previousArrangement.current = shared;
    return shared;
  }, [projection, groupSort, ws.workstreams]);
  // A workstream holding a tracked pull request keeps its header while it has
  // no thread. Only the set of such workstreams matters here: a poll that
  // changes a pull request's status leaves this, and so the list, alone.
  const pullRequestWorkstreams = usePullRequestSelector((state) =>
    workstreamIdsWithPullRequests(state.items),
  );
  const placed = useMemo(
    () =>
      placePullRequests({
        arrangement: arrangedGroups,
        workstreamIds: ws.server.loaded ? pullRequestWorkstreams : [],
        all: projection.all,
        tree: ws.workstreams,
        sort: groupSort,
      }),
    [
      arrangedGroups,
      pullRequestWorkstreams,
      ws.server.loaded,
      projection.all,
      ws.workstreams,
      groupSort,
    ],
  );
  const arrangement = placed.arrangement;
  const previousScopes = useRef(placed.scopes);
  const pullRequestScopes = shareJson(previousScopes.current, placed.scopes);
  previousScopes.current = pullRequestScopes;
  const {
    focused: focusedGroups,
    populated: populatedGroups,
    dormant: dormantGroups,
    tiered,
    hasLower,
    lowerCounts,
    other,
  } = arrangement;
  const { isCollapsed, toggle, groupCollapsed, toggleGroup } = useGroupCollapse(
    {
      groups: ws.server.tree?.groups,
      tiered,
      lowerExpanded,
      setLowerExpanded,
    },
  );
  const { needsYou: lowerNeedsYou, total: lowerTotal } = headerCounts(
    lowerCounts,
    true,
    prefs?.sidebar,
  );
  const focusedGroupItems = useGroupItems(focusedGroups);
  const populatedGroupItems = useGroupItems(populatedGroups);
  const dormantGroupItems = useGroupItems(dormantGroups);
  const focused = useMemo(
    () => focusedSections(arrangement, new Set(focusedIds)),
    [arrangement, focusedIds],
  );

  const upNextState = useRef(initialUpNextState);
  const upNext = useMemo(
    () =>
      planSidebarUpNext(
        upNextState.current,
        projection,
        { ...ws.upNextOptions, focused },
        activeThreadId,
        showMore,
      ),
    [projection, ws.upNextOptions, focused, activeThreadId, showMore],
  );
  if (showMore !== upNext.expanded) setShowMore(upNext.expanded);
  const { rows: shownNeedsRows, moreCount, trimmed: trimmedNeeds } = upNext;
  useLayoutEffect(() => {
    upNextState.current = upNext.state;
    publishSidebarUpNext(upNext.state.shown);
  });
  useLayoutEffect(() => () => publishSidebarUpNext(null), []);
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
        ...[...projection.groups, projection.other, ...projection.dormant].map(
          (group) => group.rows,
        ),
        projection.snoozed,
      ]),
    [projection],
  );
  const currentRows = useMemo(() => rowsById(projection), [projection]);
  const folded = useCallback(
    (placement: RowLocation, id: string) =>
      isCollapsed(foldKey(placement, id), foldDefault(placement)),
    [isCollapsed],
  );
  /** One tree, top thread first, as `placement` draws it with folds applied. */
  const entriesOf = useCallback(
    (tree: readonly ThreadRow[], placement: RowLocation) =>
      visibleEntries(tree, placement, (id) => folded(placement, id)),
    [folded],
  );

  const listRef = useRef<HTMLDivElement>(null);
  // Rows place only once the server state has loaded, since snoozes and the
  // stored order move them.
  const listedIds = useMemo(
    () =>
      ws.status === "ready" && ws.server.loaded
        ? new Set(
            [...ws.threads, ...archivedThreads].map((thread) => thread.id),
          )
        : null,
    [ws.status, ws.server.loaded, ws.threads, archivedThreads],
  );
  useRevealActiveThread(
    listRef,
    activeThreadId,
    (id) => listedIds?.has(id) ?? false,
  );
  const captureLayout = useFlip(listRef, [...focused].sort().join(" "));
  /** Focus covers a whole top-level group, so it names every section in it. */
  const toggleFocus = useStableCallback((group: ThreadNode) => {
    setError(null);
    captureLayout(`group:${group.id}`);
    const ids = group.focused
      ? focusedIds.filter((id) => !group.sectionIds.includes(id))
      : [
          ...focusedIds,
          ...group.sectionIds.filter((id) => !focusedIds.includes(id)),
        ];
    ws.reorder({ kind: "focused", ids }).catch(report);
  });

  const report = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause));
  const onDrop = async (drop: Drop) => {
    setError(null);
    const plan = planDrop(
      drop,
      projection,
      sections,
      ws.server.order,
      ws.workstreams,
    );
    try {
      if (plan.assign) {
        const { within, ...target } = plan.assign;
        if (within && target.workstreamId) {
          setChoosingWorkstream(true);
          await ws.rpc.call("threadMoveToGroup", {
            ...target,
            workstreamId: target.workstreamId,
          });
        } else await ws.rpc.call("threadMove", target);
        await ws.refresh();
      }
      if (plan.reorder) await ws.reorder(plan.reorder);
    } catch (cause) {
      report(cause);
    } finally {
      setChoosingWorkstream(false);
    }
  };
  const { contextProps } = useSidebarDnd({
    containerRef: listRef,
    onDrop,
    acceptsThread: (from, to) => acceptsThreadDrop(from, to, ws.workstreams),
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
        [...projection.groups, projection.other, ...projection.dormant].flatMap(
          (group) => group.rows,
        ),
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
  /**
   * Draws one row. Each row selects its own analysis, recap, and snooze (see
   * `SidebarThreadRow`), so a server change leaves this renderer, and every
   * group body memoized on it, as they were.
   */
  const renderRow = useCallback<RenderRow>(
    (
      { row, depth, key },
      {
        placement,
        handle,
        slotWidth = FULL_SLOT_PX,
        label,
        categorized = false,
      },
    ) => {
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
          slotWidth={slotWidth}
          snoozePrefs={snoozePrefs}
          handlers={handlers}
          disclosureExpanded={
            LOCATION_TRAITS[placement].disclosure && row.hasChildren
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
      toggle,
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
  // The Recents section opens and closes, and its rows enter and leave, as
  // Pinned's do. Grouped by workstream, its rows sit in folded sections
  // instead (see `GroupedBand`).
  const recentSlot = useMemo(
    () => slotWidthOf(recentRows),
    [recentRows, ws.server.analysis, ws.server.recaps, spinnerShape],
  );
  const sortedRecentRows = useMemo(
    () =>
      bandOptions.recent.grouped
        ? []
        : recentPlan[0]!.trees.map((tree) => tree[0]!),
    [bandOptions.recent.grouped, recentPlan],
  );
  const recentBandPresence = usePresence(
    ws.showRecent && recentRows.length > 0 ? ["recent"] : [],
    String,
  );
  const recentRowPresence = usePresence(sortedRecentRows, rowKey);
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
      renderRow={renderRow}
      isCollapsed={isCollapsed}
      toggle={toggle}
    />
  );
  /** An overlay row followed, when expanded, by its visible descendants. */
  const renderOverlayTree = (
    row: ThreadRow,
    placement: RowLocation,
    slotWidth: number,
  ) =>
    entriesOf([row, ...(descendants.get(row.thread.id) ?? [])], placement).map(
      (entry) => renderRow(entry, { placement, slotWidth }),
    );
  /** The new thread starts in this workstream. */
  const newThreadIn = useCallback(
    (group: ThreadNode) => () => {
      setComposerPreset(
        group.hasSection
          ? { sectionId: group.id }
          : { workstreamId: group.workstreamId! },
        group.label,
      );
      navigate.toCompose({ focusPrompt: true });
    },
    [navigate],
  );
  /** Opens the workstream's Overview on the Workstreams page. */
  const openOverview = useCallback(
    (group: ThreadNode) => () => {
      navigate.toPluginPanel("home", { subPath: overviewSubPath(group.id) });
      onNavigate();
    },
    [navigate, onNavigate],
  );
  /** Opens a tracked pull request's view on the Workstreams page. */
  const openPullRequest = useCallback(
    (id: string) => {
      navigate.toPluginPanel("home", { subPath: pullRequestSubPath(id) });
      onNavigate();
    },
    [navigate, onNavigate],
  );
  const pullRequests = useMemo<PullRequestPlacement>(
    () => ({ scopes: pullRequestScopes, open: openPullRequest }),
    [pullRequestScopes, openPullRequest],
  );
  // Colors read only the workstream tree's section bindings and stored colors,
  // so moving a thread, which changes only threads' workstreams, leaves the
  // group renderers alone.
  const colorBindings = ws.server.tree?.groups;
  const storedColors = ws.server.tree?.colors;
  const colorOf = useCallback(
    (group: ThreadNode) =>
      colorForWorkstream(
        group.id,
        colorBindings && { groups: colorBindings, colors: storedColors },
        group.workstreamId,
      ),
    [colorBindings, storedColors],
  );

  /**
   * The container above the workstream, in the color the organizer gave that
   * container, so every area of one parent shows the same parent color.
   */
  const prefixColorOf = useCallback(
    (group: ThreadNode) =>
      group.parentWorkstreamId
        ? colorForWorkstream(
            group.parentWorkstreamId,
            colorBindings && { groups: colorBindings, colors: storedColors },
            group.parentWorkstreamId,
          )
        : undefined,
    [colorBindings, storedColors],
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
  const collapsedIn = (group: ThreadNode, list: GroupList) =>
    groupCollapsed(group, collapseScopeOf(list));
  /** One group of a list, spaced from the one above by that one's fold. */
  const listedGroup = (
    group: ThreadNode,
    list: GroupList,
    above: [ThreadNode, GroupList] | null,
  ) => (
    <ListedWorkstream
      key={group.id}
      group={group}
      list={list}
      collapsed={collapsedIn(group, list)}
      marginTop={workstreamGap(
        above?.[0] ?? null,
        group,
        above ? collapsedIn(...above) : false,
      )}
      headersDrag={headersDrag}
      prefixColorOf={prefixColorOf}
      toggleFocus={toggleFocus}
      toggleGroup={toggleGroup}
      renderRow={renderRow}
      groupSlot={groupSlot}
      pullRequests={pullRequests}
      choosingWorkstream={choosingWorkstream}
      colorOf={colorOf}
      newThreadIn={newThreadIn}
      openOverview={openOverview}
      groupSnoozeOf={groupSnoozeOf}
      isCollapsed={isCollapsed}
      groupCollapsed={groupCollapsed}
    />
  );
  /** A list's groups, each spaced from the one above by its collapse state. */
  const renderGroupList = (
    groups: readonly ThreadNode[],
    list: GroupList,
    /** The last group of the list above, whose fold sets the first gap. */
    above: [ThreadNode, GroupList] | null = null,
  ) =>
    groups.map((group, index) => {
      const listed = listedGroup(
        group,
        list,
        index > 0 ? [groups[index - 1]!, list] : above,
      );
      return list === "dormant" ? (
        <li key={group.id} className="list-none">
          {listed}
        </li>
      ) : (
        listed
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
  const recentCollapsed = isCollapsed(RECENT_FOLD, false);
  const recentBlock = recentBandPresence.map((band) => (
    <Presence key={band.key} data-flip-key="recent" phase={band.phase}>
      <Band
        title={BAND_LABELS.recent}
        count={recentRows.length}
        collapsed={recentCollapsed}
        toggle={() => toggle(RECENT_FOLD, false)}
        // Recents sits above the workstreams, or below them when some are
        // focused; the gap separates it from them either way.
        style={
          tiered
            ? { marginTop: SIDEBAR_GEOMETRY.gaps.betweenSections }
            : { marginBottom: SIDEBAR_GEOMETRY.gaps.betweenSections }
        }
        menu={
          <BandOptionsMenu
            section="recent"
            options={bandOptions.recent}
            onChange={(change) => updateBandOptions("recent", change)}
          />
        }
      >
        {bandOptions.recent.grouped
          ? bandBody("recent", recentRows, recentPlan)
          : recentRowPresence.map((entry) =>
              present(
                entry,
                entriesOf([entry.item], "recent").map((row) =>
                  renderRow(row, {
                    placement: "recent",
                    slotWidth: recentSlot,
                  }),
                ),
              ),
            )}
      </Band>
    </Presence>
  ));
  const hasWorkstreams =
    focusedGroups.length +
      populatedGroups.length +
      dormantGroups.length +
      projection.other.total >
      0 || placed.otherHasPullRequests;
  const workstreamsCollapsed = isCollapsed(WORKSTREAMS_FOLD, false);
  /**
   * The heading over the workstreams, holding the organizing suggestions'
   * count, which opens them, and the workstreams' sort.
   */
  const workstreamsHeading = hasWorkstreams ? (
    <SuggestionsChip
      key="workstreams-heading"
      rpc={ws.rpc}
      sidebar={{
        projection,
        tree: ws.server.tree,
        sort: groupSort,
        manualOrder: ws.server.order.workstreams,
        sections,
        now: ws.now,
      }}
      count={ws.server.pendingSuggestions ?? 0}
      onOpenOrganize={() =>
        navigate.toPluginPanel("home", { subPath: "organize" })
      }
    >
      {(suggestions) => (
        <SectionHeading
          title="Workstreams"
          collapsed={workstreamsCollapsed}
          toggle={() => toggle(WORKSTREAMS_FOLD, false)}
        >
          {suggestions}
          <SidebarViewOptionsMenu
            sort={groupSort}
            onChange={(groupSort) =>
              void savePrefs({ sidebar: { groupSort } }).catch(report)
            }
          />
        </SectionHeading>
      )}
    </SuggestionsChip>
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
        {other.total > 0 || placed.otherHasPullRequests
          ? listedGroup(
              other,
              "other",
              populatedGroups.length > 0
                ? [populatedGroups.at(-1)!, "populated"]
                : null,
            )
          : null}
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
  /**
   * The workstreams under their heading, folding with it. Not a region: each
   * workstream inside is one. With no workstream there is no heading, and
   * whatever remains (a block still closing) stands alone.
   */
  const workstreamsSection = (contents: ReactNode[]) =>
    workstreamsHeading ? (
      <Section
        key="workstreams"
        open={!workstreamsCollapsed}
        list={false}
        heading={workstreamsHeading}
      >
        {contents}
      </Section>
    ) : (
      contents
    );
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
        {choosingWorkstream ? (
          <p
            role="status"
            className="mx-2 px-2 py-1 text-xs text-muted-foreground"
          >
            Choosing a workstream in the destination group…
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
                                "up-next",
                                needsSlot,
                              )
                            ) : (
                              <li>
                                <button
                                  type="button"
                                  aria-expanded={showMore}
                                  onClick={() => setShowMore((more) => !more)}
                                  className={bandControlClass(
                                    "ws-needs-input-text",
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
              workstreamsSection([
                <SortableContext
                  key="focused"
                  items={focusedGroupItems}
                  strategy={verticalListSortingStrategy}
                >
                  {renderGroupList(focusedGroups, "focused")}
                </SortableContext>,
                ...(hasLower
                  ? [
                      <LowerToggle
                        key="lower-toggle"
                        open={showLower}
                        needsYou={lowerNeedsYou ? lowerCounts.needsYou : 0}
                        total={lowerTotal ? lowerCounts.total : 0}
                        onToggle={toggleLower}
                      />,
                    ]
                  : []),
                ...lowerBlock,
              ]),
              recentBlock,
            ]
          : [recentBlock, workstreamsSection([...lowerBlock])]}
        {showArchivedBand ? (
          <Band
            title="Archived"
            flipKey="archived"
            style={{ marginTop: SIDEBAR_GEOMETRY.gaps.betweenSections }}
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
                : { marginTop: SIDEBAR_GEOMETRY.gaps.betweenSections }
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

/**
 * A list's sortable ids, one array while they are unchanged. dnd-kit renders
 * every sortable in a context whose items change identity, so a group whose
 * rows changed would otherwise render every header beside it.
 */
function useGroupItems(groups: readonly ThreadNode[]): string[] {
  const key = groups.map((group) => groupKey(group.id)).join("\n");
  return useMemo(() => (key ? key.split("\n") : []), [key]);
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
/** The fold keys of the Recents and Workstreams sections, open by default. */
const RECENT_FOLD = "__recent";
const WORKSTREAMS_FOLD = "__workstreams";
