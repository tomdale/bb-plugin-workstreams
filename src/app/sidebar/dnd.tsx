/**
 * Drag and drop for the sidebar: workstream headers reorder workstreams, and
 * a root thread's row reorders its tree or moves it to another topic's group.
 * Children follow their root and never drag alone.
 *
 * Drags use mouse and touch sensors rather than pointer events so BB's
 * split drag, which starts from the row anchor's pointerdown and engages only
 * once the pointer leaves the sidebar, keeps working alongside.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDroppable,
  useDndContext,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DndContextProps,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  type Modifier,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/** What each draggable or droppable is. `groupId` is a section id or "unsorted". */
type DragData =
  /** `pinned`: a focused workstream, which reorders only among its tier. */
  | { type: "group"; groupId: string; pinned?: boolean }
  | { type: "thread"; threadId: string; groupId: string }
  /** A group that takes thread drops but does not itself reorder. */
  | { type: "target"; groupId: string };

export type Drop =
  | { kind: "group"; groupId: string; overGroupId: string }
  | {
      kind: "thread";
      threadId: string;
      fromGroupId: string;
      toGroupId: string;
      /** The root the dragged tree lands on; null for a group header. */
      overThreadId: string | null;
      /** Whether the dragged tree ended below the middle of `overThreadId`. */
      below: boolean;
    };

const dataOf = (value: unknown) => value as DragData | undefined;

type AcceptsThreadDrop = (fromGroupId: string, toGroupId: string) => boolean;

/**
 * Threads land on rows first, then on a group; workstreams land only on
 * workstreams in their own tier (focused or not). Only what is under the
 * pointer counts, so releasing over a band or outside the list changes
 * nothing.
 */
const collision =
  (acceptsThread: AcceptsThreadDrop): CollisionDetection =>
  (args) => {
    const active = dataOf(args.active.data.current);
    const activeType = active?.type;
    const accepts = (data: DragData | undefined) =>
      activeType === "group"
        ? data?.type === "group" &&
          !!data.pinned === (active?.type === "group" && !!active.pinned)
        : active?.type === "thread" &&
          data !== undefined &&
          acceptsThread(active.groupId, data.groupId);
    const hits = pointerWithin({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) =>
        accepts(dataOf(container.data.current)),
      ),
    });
    if (activeType !== "thread") return hits;
    const rows = hits.filter(
      (hit) =>
        dataOf(hit.data?.droppableContainer?.data.current)?.type === "thread",
    );
    return rows.length ? rows : hits;
  };

/** Highlights only a group that collision detection has accepted for this tree. */
export function IncomingThread({
  groupId,
  children,
}: {
  groupId: string;
  children: (incoming: boolean) => ReactNode;
}) {
  const { active, over } = useDndContext();
  const source = dataOf(active?.data.current);
  const target = dataOf(over?.data.current);
  return children(
    source?.type === "thread" &&
      source.groupId !== groupId &&
      target?.groupId === groupId,
  );
}

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const mouseSensorOptions = { activationConstraint: { distance: 4 } };
const touchSensorOptions = {
  activationConstraint: { delay: 250, tolerance: 6 },
};

/**
 * DndContext props for reordering and topic moves. `containerRef` bounds the
 * list: a drop outside it sideways belongs to BB's split drag, not a reorder.
 */
export function useSidebarDnd({
  containerRef,
  onDrop,
  acceptsThread,
}: {
  containerRef: RefObject<HTMLElement | null>;
  onDrop: (drop: Drop) => void;
  acceptsThread: AcceptsThreadDrop;
}): { contextProps: DndContextProps } {
  const sensors = useSensors(
    useSensor(MouseSensor, mouseSensorOptions),
    useSensor(TouchSensor, touchSensorOptions),
  );
  const suppressClick = useClickSuppression();
  const latest = useRef({ onDrop, acceptsThread });
  useLayoutEffect(() => {
    latest.current = { onDrop, acceptsThread };
  });

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      suppressClick.end();
      const active = dataOf(event.active.data.current);
      const over = dataOf(event.over?.data.current);
      if (!active || !over || event.active.id === event.over?.id) return;
      const start = event.activatorEvent as MouseEvent | TouchEvent;
      const point = "touches" in start ? start.touches[0] : start;
      const bounds = containerRef.current?.getBoundingClientRect();
      if (point && bounds) {
        const x = point.clientX + event.delta.x;
        if (x < bounds.left || x > bounds.right) return;
      }
      if (active.type === "group") {
        if (over.type === "group")
          latest.current.onDrop({
            kind: "group",
            groupId: active.groupId,
            overGroupId: over.groupId,
          });
        return;
      }
      if (active.type !== "thread") return;
      const dragged = event.active.rect.current.translated;
      const target = event.over!.rect;
      latest.current.onDrop({
        kind: "thread",
        threadId: active.threadId,
        fromGroupId: active.groupId,
        toGroupId: over.groupId,
        overThreadId: over.type === "thread" ? over.threadId : null,
        below: dragged
          ? dragged.top + dragged.height / 2 > target.top + target.height / 2
          : false,
      });
    },
    [containerRef, suppressClick],
  );
  const accepts = useCallback(
    (from: string, to: string) => latest.current.acceptsThread(from, to),
    [],
  );
  const collisionDetection = useMemo(() => collision(accepts), [accepts]);

  return useMemo(
    () => ({
      contextProps: {
        sensors,
        collisionDetection,
        modifiers: [verticalOnly],
        onDragStart: suppressClick.begin,
        onDragEnd,
        onDragCancel: suppressClick.end,
      },
    }),
    [sensors, collisionDetection, suppressClick, onDragEnd],
  );
}

/**
 * Swallows the click that ends a drag, before it reaches the row anchor and
 * opens the thread. Listens on window in the capture phase, ahead of the
 * document-level listener the sensor adds, which only stops propagation and
 * would let the anchor's default navigation through.
 */
function useClickSuppression() {
  const listener = useRef<((event: MouseEvent) => void) | null>(null);
  const remove = useCallback(() => {
    if (listener.current)
      window.removeEventListener("click", listener.current, true);
    listener.current = null;
  }, []);
  useEffect(() => remove, [remove]);
  const begin = useCallback(() => {
    remove();
    listener.current = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("click", listener.current, true);
  }, [remove]);
  // The click follows the mouseup that ends the drag in the same task.
  const end = useCallback(() => void setTimeout(remove, 0), [remove]);
  return useMemo(() => ({ begin, end }), [begin, end]);
}

/** Props that make an element the drag handle for its sortable item. */
export type DragHandle = {
  ref: (element: HTMLElement | null) => void;
  listeners: DraggableSyntheticListeners;
};

/**
 * One reorderable item. Drag updates rerender only its shallow surface; the
 * row or group content is cached until its own inputs change. Only listeners
 * go on the handle: the keyboard sortable attributes would turn a row that
 * already holds a link into a nested button.
 */
export function Sortable({
  id,
  data,
  disabled = false,
  className,
  surface,
  children,
}: {
  id: string;
  data: DragData;
  disabled?: boolean;
  className?: string;
  /** A group supplies its section; thread trees use the default `li`. */
  surface?: (binding: {
    ref: (element: HTMLElement | null) => void;
    style: CSSProperties;
    children: ReactNode;
  }) => ReactNode;
  children: (binding: { handle: DragHandle }) => ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id, data, disabled });
  const { active } = useDndContext();
  const activeData = dataOf(active?.data.current);
  const incoming =
    isOver &&
    activeData?.type === "thread" &&
    data.type === "thread" &&
    activeData.groupId !== data.groupId;
  const handle = useMemo(
    () => ({ ref: setActivatorNodeRef, listeners }),
    [setActivatorNodeRef, listeners],
  );
  const content = useMemo(() => children({ handle }), [children, handle]);
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    ...(incoming && { background: "var(--sidebar-accent)" }),
    ...(isDragging && {
      position: "relative",
      zIndex: 10,
      borderRadius: 6,
      background: "var(--sidebar, var(--background))",
      boxShadow: "0 4px 12px rgb(0 0 0 / 0.25)",
    }),
  };
  if (surface) return surface({ ref: setNodeRef, style, children: content });
  return (
    <li ref={setNodeRef} style={style} className={className}>
      {content}
    </li>
  );
}

/** A group that accepts thread drops without reordering itself. */
export function DropTarget({
  id,
  data,
  children,
}: {
  id: string;
  data: DragData;
  children: (ref: (element: HTMLElement | null) => void) => ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id, data });
  return children(setNodeRef);
}

/** The sortable or droppable id of a workstream group. */
export const groupKey = (id: string) => `ws:${id}`;
/** The sortable id of a root thread's tree. */
export const treeKey = (id: string) => `t:${id}`;
