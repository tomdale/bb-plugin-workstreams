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
 * sit one step (`INDENT_PX`) in. A header folds from the chevron beside its
 * name, and only from there: the row itself drags the workstream.
 * Top-level workstreams always keep their own headers (see `arrangeGroups`).
 *
 * Up Next's rows come from `selectUpNext`, including its focus on the
 * focused workstreams; while any workstream is focused, the rest hide behind
 * a toggle below the focused ones. Focused workstreams are stored as
 * `prioritized`. Up Next never moves the open thread's row out from under
 * the user, and rows open and close rather than pop (see `motion.ts`).
 *
 * Pinned lists the roots the user pinned, in BB's pin order, directly under
 * Up Next. The two bands share one sticky plate at the top of the list, so
 * both stay in reach while the workstreams scroll beneath them.
 */
import {
  cloneElement,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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
import { SPARKLES_ICON } from "../workstream-icon.ts";
import { cn } from "@/lib/utils";
import {
  MENU_ITEM_CLASS,
  MENU_LABEL_CLASS,
  MENU_SEPARATOR_CLASS,
  menuSurfaceClass,
} from "../primitives/menu.ts";
import { CountPill } from "../primitives/CountPill.tsx";
import {
  UNFILED_NAME,
  type Group,
  type Row as RowModel,
} from "../../domain/project.ts";
import {
  arrangeGroups,
  focusedSections,
  type WorkstreamNode,
} from "../../domain/groups.ts";
import { selectRecent } from "../../domain/upNext.ts";
import { initialUpNextState, planSidebarUpNext } from "./upNextState.ts";
import { useWorkstreams, type ServerState } from "../useWorkstreams.ts";
import { useStableSidebarThreads } from "../useStableSidebarThreads.ts";
import { shareJson } from "../structuralSharing.ts";
import { workView } from "../../domain/status.ts";
import { relativeAge } from "../../domain/presentation.ts";
import { groupCollapseKey, useCollapsed } from "./useCollapsed.ts";
import { SIDEBAR_GEOMETRY } from "./tokens.ts";
import { workstreamGap } from "./workstreamGap.ts";
import {
  useBandOptions,
  type BandId,
  type BandOptions,
  type BandSort,
  type BandSortOption,
} from "./useBandOptions.ts";
import { NameDialog, type NameRequest } from "./NameDialog.tsx";
import { Row } from "./Row.tsx";
import { hasStatusMark, headerCounts } from "./presentation.ts";
import {
  descendantsOf,
  foldKey,
  foldDefault,
  treesOf,
  unfoldedRows,
  sortedBandRows,
  planBandRows,
  planArchived,
  groupSnoozeRequest,
  type Placement,
} from "./rows.ts";
import { HeaderMenu, RowMenu, type RowMenuHandlers } from "./RowMenu.tsx";
import { TraceInspector } from "../debug/Inspector.tsx";
import {
  DropTarget,
  IncomingThread,
  Sortable,
  useSidebarDnd,
  type DragHandle,
  type Drop,
} from "./dnd.tsx";
import { acceptsThreadDrop, planDrop } from "./drop.ts";
import { setComposerPreset } from "../composer/preset.ts";
import {
  defaultPreset,
  describeWake,
  isSnoozed,
  presetWhen,
  shortWake,
  type SnoozeWhen,
  type ThreadSnooze,
} from "../../domain/snooze.ts";
import { snoozeThreads, wakeThreads } from "../snooze/actions.ts";
import { CustomSnoozeDialog } from "../snooze/CustomSnoozeDialog.tsx";
import { SnoozeMenuItems, plainMenuKit } from "../snooze/SnoozeMenuItems.tsx";
import { SnoozeIcon } from "../snooze/icons.tsx";
import { WorkstreamName } from "../WorkstreamName.tsx";
import {
  presenceProps,
  useFlip,
  useFold,
  useFoldGap,
  usePresence,
  type PresenceEntry,
} from "./motion.ts";
import { FocusIcon } from "./FocusIcon.tsx";
import {
  HoverAction,
  HoverMenuButton,
  RowActions,
  rowActionClass,
} from "./HoverActions.tsx";
import { categoryRows } from "../../domain/categoryRows.ts";
import {
  colorForWorkstream,
  workstreamColorStyle,
  type TopicColor,
} from "../../domain/workstreamColor.ts";
import { Hint } from "../Hint.tsx";
import { usePrefs } from "../prefs.ts";

type ThreadGroup = Group<PluginSidebarThread>;
type ThreadNode = WorkstreamNode<PluginSidebarThread>;

/** The groups drawn inline under `group`, in order, theirs included. */
function inlineGroups(group: ThreadNode): ThreadNode[] {
  return group.subgroups
    .filter((sub) => sub.inline)
    .flatMap((sub) => [sub, ...inlineGroups(sub)]);
}

/** A group's own name, for its rows' label: "Walkthrough Plugin" for "bb: Walkthrough Plugin". */
const shortLabel = (label: string) => label.split(/:\s*/).at(-1) ?? label;
type ThreadRow = RowModel<PluginSidebarThread>;
type RowTimes = { display: number; projection: number };
type RenderRow = (
  row: ThreadRow,
  placement: Placement,
  times: RowTimes,
  handle?: DragHandle,
  showStatusSlot?: boolean,
  depth?: number,
  key?: string,
  /** Its group's name, for a row listed outside that group's header. */
  label?: string,
  categorized?: boolean,
) => ReactNode;

/** Snooze menus sample the clock when their portal actually renders. */
function CurrentSnoozeMenuItems(
  props: Omit<ComponentProps<typeof SnoozeMenuItems>, "now">,
) {
  return <SnoozeMenuItems {...props} now={Date.now()} />;
}

/**
 * Threads to snooze together, from a thread row or a workstream row.
 * `subject` names them in the toast ("4 threads in Alpha").
 */
type SnoozeRequest = {
  readonly threads: readonly PluginSidebarThread[];
  readonly subject?: string;
};
/** A workstream row's snooze button (see `WorkstreamGroup`). */
type GroupSnooze = {
  /** Names the batch: "Snooze 3 threads". */
  label: string;
  /** What a click does: "Snooze 3 threads in Alpha until …". */
  title: string;
  run: () => void;
  /** The hover menu's choices. */
  menu: ReactNode;
  /** Snoozes the batch until a time, a wake event, or whichever is first. */
  snooze: (when: SnoozeWhen) => void;
  /** Opens the Custom… snooze dialog for the batch. */
  custom: () => void;
};

const groupKey = (id: string) => `ws:${id}`;
const treeKey = (id: string) => `t:${id}`;

/** Overlays draw a row flat, with its children only when expanded. */
const isOverlay = foldDefault;

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
  const { isCollapsed, toggle } = useCollapsed();
  const { bandOptions, updateBandOptions } = useBandOptions();
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
  const [customSnooze, setCustomSnooze] = useState<SnoozeRequest | null>(null);
  const { projection, sections, displayNow: now, now: projectionNow } = ws;
  const nameOf = useMemo(
    () => new Map(sections.map((section) => [section.id, section.name])),
    [sections],
  );
  const prioritizedIds = ws.server.order.prioritized;
  const groupSort = prefs?.sidebar.groupSort ?? "alphabetical";
  const timestamps = prefs?.sidebar.timestamps ?? "show";
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
  const arrangement = useMemo(
    () => arrangeGroups(projection, groupSort, ws.topics),
    [projection, groupSort, ws.topics],
  );
  const {
    pinned: pinnedGroups,
    populated: populatedGroups,
    dormant: dormantGroups,
    tiered,
    hasLower,
    lowerCounts,
  } = arrangement;
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
  const { rows: shownNeedsRows, moreCount } = upNext;
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
  const {
    threads: archivedThreads,
    rows: archivedRows,
    groups: archivedGroups,
    unfiled: unsortedArchived,
    workstreamOf: archivedWorkstreamOf,
  } = useMemo(
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
  const folded = useCallback(
    (placement: Placement, id: string) =>
      isCollapsed(foldKey(placement, id), foldDefault(placement)),
    [isCollapsed],
  );
  const unfolded = useCallback(
    (rows: readonly ThreadRow[], placement: Placement) =>
      unfoldedRows(rows, (id) => descendants.has(id) && folded(placement, id)),
    [descendants, folded],
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

  const applySnooze = (request: SnoozeRequest, when: SnoozeWhen) =>
    snoozeThreads(ws.setSnoozes, request.threads, when, {
      previous: ws.snoozeOf,
      subject: request.subject,
    });
  const currentRowActions = useRef({
    actions,
    navigate,
    onNavigate,
    applySnooze,
    setSnoozes: ws.setSnoozes,
  });
  useLayoutEffect(() => {
    currentRowActions.current = {
      actions,
      navigate,
      onNavigate,
      applySnooze,
      setSnoozes: ws.setSnoozes,
    };
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
      snooze: (thread, when) =>
        currentRowActions.current.applySnooze({ threads: [thread] }, when),
      customSnooze: (thread) => setCustomSnooze({ threads: [thread] }),
      wake: (thread) =>
        wakeThreads(currentRowActions.current.setSnoozes, [thread]),
      reportError: report,
    }),
    [],
  );
  const snoozePrefs = ws.snoozePrefs;
  const preset = defaultPreset(snoozePrefs);
  /** When the default preset wakes, from the moment of the click. */
  const defaultWake = () => presetWhen(preset, Date.now());
  const currentDefaultWake = useRef(defaultWake);
  useLayoutEffect(() => {
    currentDefaultWake.current = defaultWake;
  });
  const wakeByDefault = useMemo(() => () => currentDefaultWake.current(), []);
  const applySnoozeLatest = useCallback(
    (request: SnoozeRequest, when: SnoozeWhen) =>
      currentRowActions.current.applySnooze(request, when),
    [],
  );
  /**
   * A workstream row's snooze button, while the row lists threads: it
   * snoozes every one of them (see `groupRoots`) with the default preset,
   * and its menu offers every preset and Custom….
   */
  const groupSnoozeOf = useCallback(
    (group: ThreadGroup | ThreadNode): GroupSnooze | undefined => {
      const request = groupSnoozeRequest(group);
      if (!request) return undefined;
      const snooze = (when: SnoozeWhen) => applySnoozeLatest(request, when);
      const custom = () => setCustomSnooze(request);
      const wake = wakeByDefault();
      return {
        label: request.label,
        title: `Snooze ${request.subject} ${describeWake(wake.until, Date.now(), wake.events)}`,
        run: () => snooze(wakeByDefault()),
        menu: (
          <CurrentSnoozeMenuItems
            kit={plainMenuKit}
            heading={request.label}
            prefs={snoozePrefs}
            onSnooze={snooze}
            onCustom={custom}
          />
        ),
        snooze,
        custom,
      };
    },
    [applySnoozeLatest, wakeByDefault, snoozePrefs],
  );

  /** Whether any of these rows draws a status mark (see `hasStatusMark`). */
  const anyMark = (rows: readonly ThreadRow[], placement: Placement) =>
    rows.some(
      (row) =>
        row.hasChildren ||
        hasStatusMark(
          row.thread,
          ws.work(row.thread),
          placement === "needs-you",
        ),
    );
  const needsMarks = useMemo(
    () => anyMark(shownNeedsRows, "needs-you"),
    [shownNeedsRows, ws.server.analysis, ws.server.recaps],
  );
  const groupMarks = useMemo(
    () =>
      anyMark(
        [
          ...projection.groups,
          projection.unsorted,
          ...projection.dormant,
        ].flatMap((group) => group.rows),
        "group",
      ),
    [projection, ws.server.analysis, ws.server.recaps],
  );
  const rowKey = (row: ThreadRow) => row.thread.id;
  const showBand = ws.showForYou && shownNeedsRows.length > 0;
  const pinnedRows = projection.pinnedThreads;
  const pinnedMarks = useMemo(
    () => anyMark(pinnedRows, "pinned"),
    [pinnedRows, ws.server.analysis, ws.server.recaps],
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
  const needsPresence = usePresence(shownNeedsRows, rowKey);
  const needsControls = usePresence(
    showMore || moreCount > 0 ? ["more"] : [],
    String,
  );
  const snoozes = ws.server.snoozes;
  const renderRow = useCallback<RenderRow>(
    (
      row,
      placement,
      times,
      handle,
      showStatusSlot = true,
      depth = isOverlay(placement) ? 0 : row.depth,
      key = row.thread.id,
      label,
      categorized = false,
    ) => {
      const storedSnooze = snoozes[row.thread.id];
      const snooze =
        storedSnooze && isSnoozed(storedSnooze, times.projection)
          ? storedSnooze
          : undefined;
      let context = label;
      if (
        context === undefined &&
        placement !== "group" &&
        !(placement === "archived" && bandOptions.archived.grouped)
      )
        context =
          placement === "snoozed"
            ? snooze
              ? shortWake(snooze.until, times.display)
              : undefined
            : row.workstreamId
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
          now={
            timestamps === "hide" && placement !== "snoozed" ? 0 : times.display
          }
          timestamps={timestamps}
          context={context}
          placement={placement}
          analysis={ws.server.analysis[row.thread.id]}
          recap={ws.server.recaps[row.thread.id]}
          showStatusSlot={showStatusSlot}
          snooze={snooze}
          snoozePrefs={snoozePrefs}
          defaultWake={wakeByDefault}
          handlers={handlers}
          disclosureExpanded={
            placement !== "recent" && row.hasChildren
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
      timestamps,
      toggle,
      wakeByDefault,
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
  /**
   * An overlay row followed, when expanded, by its visible descendants,
   * indented relative to it.
   */
  const renderBandRows = (
    rows: readonly ThreadRow[],
    planned: ReturnType<typeof planBandRows>,
    placement: "recent" | "snoozed" | "archived",
    section: BandId,
  ) => {
    const options = bandOptions[section];
    const marks = anyMark(rows, placement);
    const renderTrees = (items: readonly ThreadRow[][]) =>
      items.flatMap((tree) =>
        unfolded(tree, placement).map((row) =>
          renderRow(
            row,
            placement,
            { display: now, projection: projectionNow },
            undefined,
            marks,
          ),
        ),
      );
    if (!options.grouped) return renderTrees(planned[0]!.trees);
    return planned.map(({ id, name, trees: groupTrees }) => {
      return (
        <li key={`${placement}:${id ?? "unsorted"}`} className="list-none">
          <section
            aria-label={`${placement[0]!.toUpperCase()}${placement.slice(1)} ${name}`}
            className="px-1"
          >
            <h3 className="px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground">
              {name}
            </h3>
            <ul className="mt-0.5">{renderTrees(groupTrees)}</ul>
          </section>
        </li>
      );
    });
  };
  const renderOverlayTree = (
    row: ThreadRow,
    placement: Placement,
    marks: boolean,
  ) => [
    renderRow(
      row,
      placement,
      { display: now, projection: projectionNow },
      undefined,
      marks,
    ),
    ...(folded(placement, row.thread.id)
      ? []
      : unfolded(descendants.get(row.thread.id) ?? [], placement).map((child) =>
          renderRow(
            child,
            placement,
            { display: now, projection: projectionNow },
            undefined,
            marks,
            child.depth - row.depth,
            // A child can also be a row of its own in the same band.
            `${row.thread.id}/${child.thread.id}`,
          ),
        )),
  ];
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
          <GroupBody
            group={group}
            collapsed={props.collapsed}
            renderRow={renderRow}
            now={now}
            projectionNow={projectionNow}
            timestamps={timestamps}
            groupMarks={groupMarks}
            choosingTopic={choosingTopic}
            colorOf={colorOf}
            newThreadIn={newThreadIn}
            groupSnoozeOf={groupSnoozeOf}
            catalog={ws.server.catalog}
            isCollapsed={isCollapsed}
            toggle={toggle}
          />
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
  /**
   * Collapse state follows the group's topic; a shared topic's header has
   * no section to look the topic up by, so it passes its own.
   */
  const groupStateKey = (id: string, topicId?: string | null) =>
    groupCollapseKey(id, topicId ?? ws.server.catalog?.groups[id]);
  const groupCollapsed = (
    id: string,
    byDefault = false,
    topicId?: string | null,
  ) => isCollapsed(groupStateKey(id, topicId), isCollapsed(id, byDefault));
  const toggleGroup = (
    id: string,
    byDefault = false,
    topicId?: string | null,
  ) =>
    toggle(groupStateKey(id, topicId), groupCollapsed(id, byDefault, topicId));
  const lowerCollapsed = (
    id: string,
    byDefault = false,
    topicId?: string | null,
  ) =>
    tiered
      ? !lowerExpanded.has(groupStateKey(id, topicId))
      : groupCollapsed(id, byDefault, topicId);
  const lowerToggle = (
    id: string,
    byDefault = false,
    topicId?: string | null,
  ) => {
    if (!tiered) return toggleGroup(id, byDefault, topicId);
    const key = groupStateKey(id, topicId);
    setLowerExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const toggleLower = () => {
    if (showLower) setLowerExpanded(new Set());
    setShowLower(!showLower);
  };
  const activeGroupProps = (
    group: ThreadNode,
  ): Omit<GroupProps, "group" | "children"> => ({
    collapsed: group.prioritized
      ? groupCollapsed(group.id, false, group.topicId)
      : lowerCollapsed(group.id, false, group.topicId),
    toggle: () =>
      group.prioritized
        ? toggleGroup(group.id, false, group.topicId)
        : lowerToggle(group.id, false, group.topicId),
    onToggleFocus: () => toggleFocus(group),
    onNewThread: newThreadIn(group),
  });
  /** An item that opens and closes with its presence phase. */
  const present = (entry: PresenceEntry<unknown>, children: ReactNode) => (
    <li
      key={entry.key}
      className="ws-presence list-none"
      {...presenceProps(entry.phase)}
    >
      <ul>{children}</ul>
    </li>
  );
  // Left edge matches the row titles: 26px with the status slot, 14px when
  // the rows fold it away (see styles.css).
  const bandControlClass = (tone: string) =>
    cn(
      "w-full cursor-pointer rounded-md py-0.5 pr-2 text-left text-[12px] transition-[padding] duration-[180ms] ease-out hover:bg-sidebar-accent/60 motion-reduce:transition-none",
      tone,
      needsMarks ? "pl-[26px]" : "pl-[14px]",
    );
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
        {renderBandRows(recentRows, recentPlan, "recent", "recent")}
      </Band>
    ) : null;
  const hasWorkstreams =
    pinnedGroups.length +
      populatedGroups.length +
      dormantGroups.length +
      projection.unsorted.total >
    0;
  const suggestionCount = ws.server.pendingSuggestions ?? 0;
  /**
   * The heading over the workstreams, holding their sort and, while
   * organizing suggestions wait for review, the action that opens them.
   * Not a region: each workstream below is one.
   */
  const workstreamsHeading = hasWorkstreams ? (
    <div
      key="workstreams-heading"
      className="flex items-center gap-3"
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
      {suggestionCount > 0 ? (
        <Hint
          label={
            suggestionCount === 1
              ? "1 organizing suggestion"
              : `${suggestionCount} organizing suggestions`
          }
        >
          <button
            type="button"
            onClick={() =>
              navigate.toPluginPanel("home", { subPath: "organization" })
            }
            // A transparent border is the chip: the border-box (what the
            // hover background paints and the pointer hits) grows 3px up,
            // 2px down and 8px sideways around the text, and the matching
            // negative margin keeps the layout box on the heading's line,
            // so the row never moves and the rest-state text stays on the
            // label's baseline. The 1px top-bottom split nudges the chip
            // onto the caps label's optical center.
            className="ws-suggestions-action ws-needs-you-text -mx-2 -mb-[2px] -mt-[3px] flex shrink-0 cursor-pointer items-center gap-[3px] rounded-full border-transparent border-x-8 border-b-2 border-t-[3px] text-[12px] leading-[1.2] font-medium transition-colors"
          >
            <Icon name={SPARKLES_ICON} className="size-[13.5px]" aria-hidden />
            Reorganize
          </button>
        </Hint>
      ) : null}
      <div className="flex-1" />
      <SidebarViewOptionsMenu
        sort={groupSort}
        onChange={(groupSort) =>
          void savePrefs({ sidebar: { groupSort } }).catch(report)
        }
      />
    </div>
  ) : null;
  /** Everything below the focused workstreams, as one opening block. */
  const lowerBlock = lowerPresence.map((entry) => (
    <div
      key="lower"
      data-flip-key="lower"
      className="ws-presence [--ws-presence-gap:0.5rem]"
      {...presenceProps(entry.phase)}
    >
      <div className="flex flex-col">
        <SortableContext
          items={populatedGroupItems}
          strategy={verticalListSortingStrategy}
        >
          {populatedGroups.map((group, index) => {
            const prev = index > 0 ? populatedGroups[index - 1]! : null;
            const prevCollapsed = prev
              ? lowerCollapsed(prev.id, false, prev.topicId)
              : false;
            const marginTop = workstreamGap(prev, group, prevCollapsed);
            return renderSortableGroup(
              group,
              activeGroupProps(group),
              marginTop ? { marginTop } : undefined,
            );
          })}
        </SortableContext>
        {projection.unsorted.total > 0 ? (
          <DropTarget
            id={groupKey(projection.unsorted.id)}
            data={{ type: "target", groupId: projection.unsorted.id }}
          >
            {(ref) => {
              const prev = populatedGroups[populatedGroups.length - 1] ?? null;
              const prevCollapsed = prev
                ? lowerCollapsed(prev.id, false, prev.topicId)
                : false;
              const marginTop = workstreamGap(
                prev,
                projection.unsorted,
                prevCollapsed,
              );
              return (
                <WorkstreamGroup
                  group={projection.unsorted}
                  sectionRef={ref}
                  collapsed={lowerCollapsed(projection.unsorted.id)}
                  toggle={() => lowerToggle(projection.unsorted.id)}
                  snooze={groupSnoozeOf(projection.unsorted)}
                  style={marginTop ? { marginTop } : undefined}
                  muted
                >
                  <ThreadTrees
                    rows={projection.unsorted.rows}
                    groupId={projection.unsorted.id}
                    renderRow={renderRow}
                    now={now}
                    projectionNow={projectionNow}
                    timestamps={timestamps}
                    collapsed={lowerCollapsed(projection.unsorted.id)}
                    marks={groupMarks}
                    choosingTopic={choosingTopic}
                    isCollapsed={isCollapsed}
                  />
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
            collapsed={lowerCollapsed("__dormant", true)}
            toggle={() => lowerToggle("__dormant", true)}
          >
            <SortableContext
              items={dormantGroupItems}
              strategy={verticalListSortingStrategy}
            >
              {dormantGroups.map((group, index) => {
                const prev = index > 0 ? dormantGroups[index - 1]! : null;
                const prevCollapsed = prev
                  ? groupCollapsed(prev.id, true, prev.topicId)
                  : false;
                const marginTop = workstreamGap(prev, group, prevCollapsed);
                return (
                  <li key={group.id} className="list-none">
                    {renderSortableGroup(
                      group,
                      {
                        collapsed: groupCollapsed(
                          group.id,
                          true,
                          group.topicId,
                        ),
                        toggle: () =>
                          toggleGroup(group.id, true, group.topicId),
                        onToggleFocus: () => toggleFocus(group),
                        onNewThread: newThreadIn(group),
                        muted: true,
                      },
                      marginTop ? { marginTop } : undefined,
                    )}
                  </li>
                );
              })}
            </SortableContext>
          </Band>
        ) : null}
      </div>
    </div>
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
          <div
            key={stack.key}
            data-flip-key="up-next"
            className="ws-presence ws-up-next-sticky [--ws-presence-gap:0.5rem]"
            {...presenceProps(stack.phase)}
          >
            <div className="flex flex-col gap-[10px]">
              {bandPresence.map((band) => (
                <div
                  key={band.key}
                  className="ws-presence [--ws-presence-gap:0.5rem]"
                  {...presenceProps(band.phase)}
                >
                  <div>
                    <Band
                      title={UP_NEXT}
                      box="attention"
                      markless={!needsMarks}
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
                      {needsPresence.map((entry) =>
                        present(
                          entry,
                          renderOverlayTree(
                            entry.item,
                            "needs-you",
                            needsMarks,
                          ),
                        ),
                      )}
                      {needsControls.map((entry) =>
                        present(
                          entry,
                          <li>
                            <button
                              type="button"
                              aria-expanded={showMore}
                              onClick={() => setShowMore((more) => !more)}
                              className={bandControlClass("ws-needs-you-text")}
                            >
                              {showMore
                                ? "Show less"
                                : `Show ${Math.max(1, moreCount)} more`}
                            </button>
                          </li>,
                        ),
                      )}
                    </Band>
                  </div>
                </div>
              ))}
              {pinnedBandPresence.map((band) => (
                <div
                  key={band.key}
                  className="ws-presence [--ws-presence-gap:0.5rem]"
                  {...presenceProps(band.phase)}
                >
                  <div>
                    <Band
                      title={PINNED}
                      box="pinned"
                      markless={!pinnedMarks}
                      badge={
                        <span className="inline-flex items-center">
                          <Icon name="Pin" className="size-3" />
                        </span>
                      }
                    >
                      {pinnedRowPresence.map((entry) =>
                        present(
                          entry,
                          renderOverlayTree(entry.item, "pinned", pinnedMarks),
                        ),
                      )}
                    </Band>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {tiered
          ? [
              workstreamsHeading,
              <SortableContext
                key="pinned"
                items={pinnedGroupItems}
                strategy={verticalListSortingStrategy}
              >
                {pinnedGroups.map((group, index) => {
                  const prev = index > 0 ? pinnedGroups[index - 1]! : null;
                  const prevCollapsed = prev
                    ? groupCollapsed(prev.id, false, prev.topicId)
                    : false;
                  const marginTop = workstreamGap(prev, group, prevCollapsed);
                  return renderSortableGroup(
                    group,
                    activeGroupProps(group),
                    marginTop ? { marginTop } : undefined,
                  );
                })}
              </SortableContext>,
              ...(hasLower
                ? [
                    <button
                      key="lower-toggle"
                      type="button"
                      data-flip-key="lower-toggle"
                      aria-expanded={showLower}
                      aria-label={
                        !showLower
                          ? [
                              "Show other workstreams",
                              ...(lowerWaiting
                                ? [`${lowerCounts.needsYou} waiting on you`]
                                : []),
                              ...(lowerTotal
                                ? [
                                    `${lowerCounts.total} ${lowerCounts.total === 1 ? "thread" : "threads"}`,
                                  ]
                                : []),
                            ].join(", ")
                          : undefined
                      }
                      onClick={toggleLower}
                      // A quiet link-style toggle, not a section header:
                      // the workstreams it reveals keep their own headers.
                      className="group/lower flex items-center gap-1.5 self-stretch rounded-sm text-left text-[12px] font-normal leading-[1.2] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
                      style={{
                        marginLeft: SIDEBAR_GEOMETRY.lowerToggle.inset,
                        marginRight: SIDEBAR_GEOMETRY.lowerToggle.inset,
                        marginTop: SIDEBAR_GEOMETRY.lowerToggle.topMargin,
                        marginBottom: SIDEBAR_GEOMETRY.lowerToggle.bottomMargin,
                        height: SIDEBAR_GEOMETRY.lowerToggle.height,
                      }}
                    >
                      <span className="underline-offset-2 group-hover/lower:underline">
                        {showLower
                          ? "Hide other workstreams"
                          : "Show other workstreams"}
                      </span>
                      {!showLower && (lowerWaiting || lowerTotal) ? (
                        <span
                          className="ml-auto flex shrink-0 items-center gap-1"
                          aria-hidden="true"
                        >
                          {lowerWaiting ? (
                            <CountPill>{lowerCounts.needsYou}</CountPill> // slop-ok: 2 the product's waiting-count pill, an established header pattern
                          ) : null}
                          {lowerTotal ? (
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              {lowerCounts.total}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>,
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
            {bandOptions.archived.grouped
              ? [
                  ...archivedGroups,
                  ...(unsortedArchived.length > 0
                    ? [
                        {
                          id: "__unsorted",
                          name: UNFILED_NAME,
                          threads: unsortedArchived,
                        },
                      ]
                    : []),
                ].map((group) => {
                  const key = `archived:${group.id}`;
                  const collapsed = isCollapsed(key, true);
                  return (
                    <li key={key} className="list-none">
                      <ArchivedWorkstreamGroup
                        name={group.name}
                        count={group.threads.length}
                        collapsed={collapsed}
                        onToggle={() => toggle(key, true)}
                      >
                        {sortedBandRows(
                          group.threads.map((thread) => ({
                            thread,
                            depth: 0,
                            hasChildren: false,
                            workstreamId: archivedWorkstreamOf(thread),
                            needsYou: false,
                          })),
                          bandOptions.archived.sort,
                          ws.snoozeOf,
                        ).map((row) =>
                          renderRow(
                            row,
                            "archived",
                            { display: now, projection: projectionNow },
                            undefined,
                            false,
                          ),
                        )}
                      </ArchivedWorkstreamGroup>
                    </li>
                  );
                })
              : renderBandRows(
                  archivedRows,
                  archivedPlan,
                  "archived",
                  "archived",
                )}
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
            {renderBandRows(
              projection.snoozed,
              snoozedPlan,
              "snoozed",
              "snoozed",
            )}
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

type ThreadTreesProps = {
  rows: readonly ThreadRow[];
  groupId: string;
  label?: string;
  categorized?: boolean;
  renderRow: RenderRow;
  now: number;
  projectionNow: number;
  timestamps: "show" | "hover" | "hide";
  collapsed?: boolean;
  marks: boolean;
  choosingTopic: boolean;
  isCollapsed: (id: string, byDefault?: boolean) => boolean;
};

function sameThread(before: PluginSidebarThread, after: PluginSidebarThread) {
  return before === after || shareJson(before, after) === before;
}

function sameRows(before: readonly ThreadRow[], after: readonly ThreadRow[]) {
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

function useStableRows(rows: readonly ThreadRow[]) {
  const previous = useRef(rows);
  return useMemo(() => {
    if (!sameRows(previous.current, rows)) previous.current = rows;
    return previous.current;
  }, [rows]);
}

function sameAges(
  rows: readonly ThreadRow[],
  timestamps: "show" | "hover" | "hide",
  before: number,
  after: number,
) {
  return (
    timestamps === "hide" ||
    before === after ||
    rows.every(
      (row) =>
        relativeAge(row.thread.latestAttentionAt, before) ===
        relativeAge(row.thread.latestAttentionAt, after),
    )
  );
}

/** A sortable root and its visible descendants, with drag-only surface updates. */
function SortableThreadTree({
  tree,
  groupId,
  label,
  categorized = false,
  renderRow,
  now,
  projectionNow,
  marks,
  choosingTopic,
  isCollapsed,
}: Omit<ThreadTreesProps, "rows" | "timestamps"> & {
  tree: readonly ThreadRow[];
}) {
  const visible = useMemo(
    () =>
      unfoldedRows(tree, (id) =>
        isCollapsed(foldKey("group", id), foldDefault("group")),
      ),
    [tree, isCollapsed],
  );
  const content = useCallback(
    ({ handle }: { handle: DragHandle }) => (
      <ul>
        {visible.map((row, index) =>
          renderRow(
            row,
            "group",
            { display: now, projection: projectionNow },
            index === 0 ? handle : undefined,
            marks,
            undefined,
            undefined,
            label,
            categorized,
          ),
        )}
      </ul>
    ),
    [visible, renderRow, now, projectionNow, marks, label, categorized],
  );
  const root = tree[0]!.thread;
  return (
    <Sortable
      id={treeKey(root.id)}
      data={{ type: "thread", threadId: root.id, groupId }}
      disabled={choosingTopic}
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
const ThreadTrees = memo(
  function ThreadTrees({
    rows,
    groupId,
    label,
    categorized = false,
    renderRow,
    now,
    projectionNow,
    timestamps,
    marks,
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
            now={now}
            projectionNow={projectionNow}
            marks={marks}
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
      before.timestamps === after.timestamps &&
      before.marks === after.marks &&
      before.choosingTopic === after.choosingTopic &&
      before.isCollapsed === after.isCollapsed &&
      sameAges(before.rows, before.timestamps, before.now, after.now)),
);

type GroupBodyProps = {
  group: ThreadNode;
  collapsed: boolean;
  renderRow: RenderRow;
  now: number;
  projectionNow: number;
  timestamps: "show" | "hover" | "hide";
  groupMarks: boolean;
  choosingTopic: boolean;
  colorOf: (group: ThreadNode) => TopicColor;
  newThreadIn: (group: ThreadNode) => () => void;
  groupSnoozeOf: (group: ThreadGroup | ThreadNode) => GroupSnooze | undefined;
  catalog: ServerState["catalog"];
  isCollapsed: (id: string, byDefault?: boolean) => boolean;
  toggle: (id: string, byDefault?: boolean) => void;
};

function CategorizedTrees({
  group,
  label,
  renderRow,
  now,
  projectionNow,
  timestamps,
  collapsed,
  groupMarks,
  choosingTopic,
  colorOf,
  isCollapsed,
}: Pick<
  GroupBodyProps,
  | "group"
  | "renderRow"
  | "now"
  | "projectionNow"
  | "timestamps"
  | "collapsed"
  | "groupMarks"
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
        now={now}
        projectionNow={projectionNow}
        timestamps={timestamps}
        collapsed={collapsed}
        marks={groupMarks}
        choosingTopic={choosingTopic}
        isCollapsed={isCollapsed}
      />
    </Fragment>
  ));
}

const collapseKeyOf = (group: ThreadNode, catalog: ServerState["catalog"]) =>
  groupCollapseKey(group.id, group.topicId ?? catalog?.groups[group.id]);

function NestedGroup(
  props: GroupBodyProps & {
    sectionRef?: (element: HTMLElement | null) => void;
  },
) {
  const {
    group,
    catalog,
    isCollapsed,
    toggle,
    colorOf,
    newThreadIn,
    groupSnoozeOf,
    sectionRef,
  } = props;
  const key = collapseKeyOf(group, catalog);
  const collapsed = isCollapsed(key, isCollapsed(group.id, false));
  const toggleThis = useCallback(
    () => toggle(key, collapsed),
    [toggle, key, collapsed],
  );
  const onNewThread = useMemo(() => newThreadIn(group), [newThreadIn, group]);
  return (
    <WorkstreamGroup
      group={group}
      color={colorOf(group)}
      nested
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
const GroupBody = memo(
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
      before.timestamps === after.timestamps &&
      before.groupMarks === after.groupMarks &&
      before.choosingTopic === after.choosingTopic &&
      before.colorOf === after.colorOf &&
      before.newThreadIn === after.newThreadIn &&
      before.groupSnoozeOf === after.groupSnoozeOf &&
      before.catalog === after.catalog &&
      before.isCollapsed === after.isCollapsed &&
      before.toggle === after.toggle &&
      sameGroupAges(before.group, before.timestamps, before.now, after.now)),
);

function sameGroupData(before: ThreadNode, after: ThreadNode): boolean {
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

function sameGroupAges(
  group: ThreadNode,
  timestamps: "show" | "hover" | "hide",
  before: number,
  after: number,
): boolean {
  return (
    sameAges(group.rows, timestamps, before, after) &&
    group.subgroups.every((sub) =>
      sameGroupAges(sub, timestamps, before, after),
    )
  );
}

type SidebarThreadRowProps = {
  handleRef?: DragHandle["ref"];
  handleListeners?: DragHandle["listeners"];
  thread: PluginSidebarThread;
  depth: number;
  active: boolean;
  now: number;
  timestamps: "show" | "hover" | "hide";
  context?: string;
  placement: Placement;
  analysis?: ServerState["analysis"][string];
  recap?: ServerState["recaps"][string];
  showStatusSlot: boolean;
  snooze?: ThreadSnooze;
  snoozePrefs: ServerState["snoozePrefs"];
  defaultWake: () => SnoozeWhen;
  handlers: RowMenuHandlers;
  disclosureExpanded?: boolean;
  categorized: boolean;
  onNavigate: () => void;
  toggleDisclosure: (id: string, byDefault?: boolean) => void;
};

/**
 * A list row with stable action identities. Its memo compares every prop,
 * including callbacks, so an unrelated thread update skips the SDK hooks and
 * presentation work in `Row` without retaining stale actions.
 */
const SidebarThreadRow = memo(function SidebarThreadRow({
  thread,
  depth,
  active,
  now,
  context,
  placement,
  analysis,
  recap,
  showStatusSlot,
  snooze,
  snoozePrefs,
  defaultWake,
  handlers,
  disclosureExpanded,
  categorized,
  onNavigate,
  toggleDisclosure,
  handleRef,
  handleListeners,
}: SidebarThreadRowProps) {
  const work = workView(thread, analysis, recap);
  let snoozeAction:
    | {
        kind: "snooze" | "wake";
        title: string;
        run: () => void;
        menu: ReactNode;
      }
    | undefined;
  if (
    placement !== "archived" &&
    (placement !== "snoozed" || snooze !== undefined)
  ) {
    const wake = defaultWake();
    const menu = (
      <CurrentSnoozeMenuItems
        kit={plainMenuKit}
        prefs={snoozePrefs}
        snooze={snooze}
        onSnooze={(when) => handlers.snooze(thread, when)}
        onWake={() => handlers.wake(thread)}
        onCustom={() => handlers.customSnooze(thread)}
      />
    );
    snoozeAction =
      placement === "snoozed"
        ? {
            kind: "wake",
            title: `Wake now (snoozed ${describeWake(snooze!.until, now, snooze!.events)})`,
            run: () => handlers.wake(thread),
            menu,
          }
        : {
            kind: "snooze",
            title: `Snooze ${describeWake(wake.until, Date.now(), wake.events)}`,
            run: () => handlers.snooze(thread, defaultWake()),
            menu,
          };
  }
  return (
    <RowMenu
      thread={thread}
      handlers={handlers}
      snooze={snooze}
      snoozePrefs={snoozePrefs}
      showArchive={placement !== "archived"}
    >
      <li ref={handleRef} {...handleListeners} className="list-none">
        <Row
          thread={thread}
          depth={depth}
          active={active}
          now={now}
          context={context}
          attention={placement === "needs-you"}
          work={work}
          showStatusSlot={showStatusSlot}
          showPin={placement === "group"}
          subtitle={
            placement === "needs-you" && work.kind === "current"
              ? work.analysis.needsYou
              : null
          }
          snoozeAction={snoozeAction}
          showArchive={placement !== "archived"}
          disclosure={
            disclosureExpanded === undefined
              ? undefined
              : {
                  expanded: disclosureExpanded,
                  toggle: () =>
                    toggleDisclosure(
                      foldKey(placement, thread.id),
                      foldDefault(placement),
                    ),
                }
          }
          categorized={categorized}
          inGroup={placement === "group"}
          onNavigate={onNavigate}
        />
      </li>
    </RowMenu>
  );
}, sameSidebarThreadRow);

function sameSidebarThreadRow(
  before: SidebarThreadRowProps,
  after: SidebarThreadRowProps,
) {
  return (
    sameThread(before.thread, after.thread) &&
    before.depth === after.depth &&
    before.active === after.active &&
    before.timestamps === after.timestamps &&
    before.context === after.context &&
    before.placement === after.placement &&
    before.analysis === after.analysis &&
    before.recap === after.recap &&
    before.showStatusSlot === after.showStatusSlot &&
    before.snooze === after.snooze &&
    before.snoozePrefs === after.snoozePrefs &&
    before.defaultWake === after.defaultWake &&
    before.handlers === after.handlers &&
    before.disclosureExpanded === after.disclosureExpanded &&
    before.categorized === after.categorized &&
    before.onNavigate === after.onNavigate &&
    before.toggleDisclosure === after.toggleDisclosure &&
    before.handleRef === after.handleRef &&
    before.handleListeners === after.handleListeners &&
    (before.now === after.now ||
      (before.timestamps === "hide" &&
        (before.placement !== "snoozed" ||
          describeWake(
            before.snooze?.until ?? null,
            before.now,
            before.snooze?.events,
          ) ===
            describeWake(
              after.snooze?.until ?? null,
              after.now,
              after.snooze?.events,
            ))) ||
      (before.timestamps !== "hide" &&
        relativeAge(before.thread.latestAttentionAt, before.now) ===
          relativeAge(after.thread.latestAttentionAt, after.now) &&
        (before.placement !== "snoozed" ||
          describeWake(
            before.snooze?.until ?? null,
            before.now,
            before.snooze?.events,
          ) ===
            describeWake(
              after.snooze?.until ?? null,
              after.now,
              after.snooze?.events,
            ))))
  );
}

/** The band of threads most worth the user's attention (see `selectUpNext`). */
const UP_NEXT = "Up Next";
const PINNED = "Pinned";

/**
 * A fold's chevron: one arrow that turns a quarter turn as the fold opens,
 * over the 150ms BB's own sidebar uses, so the state reads without the icon
 * swapping out from under the pointer.
 */
function FoldChevron({ open }: { open: boolean }) {
  return (
    <Icon
      name="ChevronRight"
      className={cn(
        "size-3 transition-transform duration-150 motion-reduce:transition-none",
        open && "rotate-90",
      )}
    />
  );
}

/**
 * A workstream's archived threads, under a compact header that carries its
 * name and count.
 */
function ArchivedWorkstreamGroup({
  name,
  count,
  collapsed,
  onToggle,
  children,
}: {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const fold = useFold(!collapsed);
  return (
    <section aria-label={`Archived ${name}`} className="px-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[12px] font-medium text-muted-foreground hover:bg-sidebar-accent/60"
      >
        <FoldChevron open={!collapsed} />
        <WorkstreamName name={name} muted className="flex-1 text-[12px]" />
        <span className="tabular-nums">{count}</span>
      </button>
      {fold.render ? (
        <div className="ws-fold" ref={fold.ref} {...presenceProps(fold.phase)}>
          <ul className="mt-0.5">{children}</ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * An overlay band. A plain band collapses from its header. A boxed band is an
 * always-open block spanning the column, with its header inside: `attention`
 * is the Up Next card (`.ws-needs`), `pinned` the quiet card of the threads
 * kept in reach (`.ws-pinned`), and `neutral` the
 * quieter Recent block (`.ws-band-neutral`). Each sets its rows apart from
 * the workstream list below.
 */
function Band({
  title,
  count,
  box,
  badge,
  markless,
  collapsed,
  toggle,
  menu,
  flipKey,
  style,
  children,
}: {
  title: string;
  /** Row total, shown only while the band is collapsed. */
  count?: number;
  box?: "attention" | "pinned" | "neutral";
  /** A small mark after the title. */
  badge?: ReactNode;
  /**
   * No row in a boxed band draws a status mark, so titles sit at the
   * collapsed slot's 14px indent; the header indents to match.
   */
  markless?: boolean;
  collapsed?: boolean;
  toggle?: () => void;
  menu?: ReactNode;
  /** Glides the band when a focus change moves it (see `useFlip`). */
  flipKey?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const fold = useFold(collapsed === undefined || !collapsed);
  const heading = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        {title}
        {badge}
      </span>
      {count !== undefined && collapsed ? (
        <span
          className={cn(
            "tabular-nums",
            box === "attention" && "ws-needs-count",
          )}
        >
          {count}
        </span>
      ) : null}
    </>
  );
  if (box) {
    return (
      <section
        aria-label={title}
        data-flip-key={flipKey}
        style={style}
        className={cn(
          box === "attention"
            ? "ws-needs mx-2 mt-0 px-1 pt-0.5 pb-2" // slop-ok: 2 the Needs you band, an established product surface
            : box === "pinned"
              ? "ws-pinned mx-2 mt-0 px-1 pt-0.5 pb-2" // slop-ok: 2 the Pinned band, the Up Next card's quieter neighbor
              : "ws-band-neutral my-1 px-2 py-1", // slop-ok: 2 the neutral band, an established product surface
        )}
      >
        <div className="flex items-center gap-1">
          <h2
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 pr-1.5",
              box === "attention"
                ? "py-0.5 text-[11px] font-semibold uppercase tracking-wide" // slop-ok: 1 the product's section-label style
                : box === "neutral"
                  ? "py-0.5 text-[11px] font-semibold uppercase tracking-wide" // slop-ok: 1 the product's section-label style
                  : "pb-1 text-[12px] font-medium",
              markless ? "pl-3.5" : "pl-1.5",
              box === "attention"
                ? "ws-needs-heading"
                : "text-muted-foreground",
            )}
          >
            {heading}
          </h2>
          {menu}
        </div>
        <ul className="mt-0.5">{children}</ul>
      </section>
    );
  }
  return (
    <section
      aria-label={title}
      data-flip-key={flipKey}
      style={style}
      className="px-1"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={toggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-sidebar-accent/60" // slop-ok: 1 the product's section-label style
        >
          <FoldChevron open={!collapsed} />
          {heading}
        </button>
        {menu}
      </div>
      {fold.render ? (
        <div className="ws-fold" ref={fold.ref} {...presenceProps(fold.phase)}>
          <ul className="mt-0.5">{children}</ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The ⋯ button that opens a section's options, such as its sort. It looks
 * like a row action (`rowActionClass`), but stays in view, dimmed until used,
 * because it is the only way to those options, on touch screens too.
 */
function SectionMenuTrigger({ label }: { label: string }) {
  return (
    <DropdownMenu.Trigger asChild>
      <Hint label={label}>
        <button
          type="button"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            rowActionClass,
            "opacity-50 hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          <Icon name="MoreHorizontal" className="size-3.5" />
        </button>
      </Hint>
    </DropdownMenu.Trigger>
  );
}

function SidebarViewOptionsMenu({
  sort,
  onChange,
}: {
  sort: "alphabetical" | "activity" | "manual";
  onChange: (sort: "alphabetical" | "activity" | "manual") => void;
}) {
  const options = [
    ["alphabetical", "Name A–Z"],
    ["activity", "Recent activity"],
    ["manual", "Manual order"],
  ] as const;
  return (
    <DropdownMenu.Root>
      <SectionMenuTrigger label="Sort workstreams" />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          aria-label="Sort workstreams"
          className={menuSurfaceClass("48")}
        >
          <DropdownMenu.Label className={MENU_LABEL_CLASS}>
            Sort workstreams
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={sort}
            onValueChange={(value) =>
              onChange(value as "alphabetical" | "activity" | "manual")
            }
          >
            {options.map(([value, name]) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className={cn(MENU_ITEM_CLASS, "gap-2")}
              >
                <span className="inline-flex size-4 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Icon name="Check" className="size-3.5" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {name}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function BandOptionsMenu({
  section,
  options,
  onChange,
}: {
  section: BandId;
  options: BandOptions[BandId];
  onChange: (change: Partial<BandOptions[BandId]>) => void;
}) {
  const label = section[0]!.toUpperCase() + section.slice(1);
  const sortOptions: readonly BandSortOption[] =
    section === "recent"
      ? [
          ["activity", "Recent activity"],
          ["title", "Title A–Z"],
        ]
      : section === "snoozed"
        ? [
            ["wake", "Soonest to wake"],
            ["activity", "Recent activity"],
            ["title", "Title A–Z"],
          ]
        : [
            ["archived", "Archive date"],
            ["activity", "Recent activity"],
            ["title", "Title A–Z"],
          ];
  return (
    <DropdownMenu.Root>
      <SectionMenuTrigger label={`${label} options`} />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className={menuSurfaceClass("48")}
        >
          <DropdownMenu.Label className={MENU_LABEL_CLASS}>
            Sort by
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={options.sort}
            onValueChange={(value) => onChange({ sort: value as BandSort })}
          >
            {sortOptions.map(([value, name]) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className={cn(MENU_ITEM_CLASS, "gap-2")}
              >
                <span className="inline-flex size-4 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Icon name="Check" className="size-3.5" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {name}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className={MENU_SEPARATOR_CLASS} />
          <DropdownMenu.CheckboxItem
            checked={options.grouped}
            onCheckedChange={(checked) =>
              onChange({ grouped: checked === true })
            }
            className={cn(MENU_ITEM_CLASS, "gap-2")}
          >
            <span className="inline-flex size-4 items-center justify-center">
              <DropdownMenu.ItemIndicator>
                <Icon name="Check" className="size-3.5" />
              </DropdownMenu.ItemIndicator>
            </span>
            Group by workstream
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

type GroupProps = {
  group: ThreadGroup | ThreadNode;
  /**
   * A subgroup: its block starts one step in, where its parent's name does,
   * and its name reads as a label, smaller and muted.
   */
  nested?: boolean;
  collapsed: boolean;
  toggle: () => void;
  onNewThread?: () => void;
  onToggleFocus?: () => void;
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

function WorkstreamGroup({
  group,
  nested = false,
  collapsed,
  toggle,
  onNewThread,
  onToggleFocus,
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
  const bodyRef = useRef<HTMLUListElement | null>(null);
  /** The section, for the gap the fold moves below it (see `useFoldGap`). */
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!collapsed) return;
    const root = section.current;
    const list = bodyRef.current;
    if (list) {
      for (const trigger of list.querySelectorAll("button")) {
        const leave = new Event("pointerleave");
        Object.defineProperty(leave, "pointerType", { value: "mouse" });
        trigger.dispatchEvent(leave);
      }
      const open = list.querySelector("[data-state='open']");
      if (open)
        (document.activeElement ?? open).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    }
    // Focus that was inside the fold resets to <body> when it unmounts;
    // move it to the header rather than dropping it from the list.
    const active = document.activeElement;
    if ((list && list.contains(active)) || active === document.body)
      root?.querySelector<HTMLButtonElement>("button")?.focus();
    // section.current is a ref; only `collapsed` gates the cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);
  const label = "label" in group ? group.label : group.name;
  const isWorkstream = "hasSection" in group && group.hasSection;
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
              className="group/row relative flex items-center gap-1.5 rounded-md pr-2"
              style={{
                height: SIDEBAR_GEOMETRY.workstreamHeader.height,
                paddingLeft: nested
                  ? SIDEBAR_GEOMETRY.row.childIndent
                  : SIDEBAR_GEOMETRY.workstreamHeader.indent,
              }}
            >
              <span className={headingClass}>
                {heading}
                {/* The chevron is the header's only press: the row stays the
              workstream's drag handle, and a press on the name does
              nothing. */}
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  aria-label={
                    collapsed ? `Expand ${label}` : `Collapse ${label}`
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggle();
                  }}
                  className={cn(rowActionClass, "size-5")}
                >
                  <FoldChevron open={!collapsed} />
                </button>
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
                  <HoverMenuButton
                    compact
                    label={snooze.title}
                    onClick={snooze.run}
                    menu={snooze.menu}
                  >
                    <SnoozeIcon className="size-3.5" />
                  </HoverMenuButton>
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
          {fold.render ? (
            <div
              className="ws-fold"
              ref={fold.ref}
              {...presenceProps(fold.phase)}
            >
              <ul ref={bodyRef} className="list-none">
                {children}
              </ul>
            </div>
          ) : null}
        </section>
      )}
    </IncomingThread>
  );
}
