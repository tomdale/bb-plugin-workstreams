/**
 * What a sidebar drop changes, worked out from the projection alone so the
 * list component only has to carry it out.
 */
import { arrayMove } from "@dnd-kit/sortable";
import {
  applyOrder,
  placeBefore,
  type ManualOrder,
} from "../../domain/order.ts";
import {
  OTHER_ID,
  type Projection,
  type Section,
  type WorkstreamThread,
} from "../../domain/project.ts";
import {
  nestGroups,
  sharedWorkstreamId,
  type WorkstreamTree,
} from "../../domain/groups.ts";
import { takesThreads } from "../../domain/workstreams.ts";
import type { ReorderChange } from "../useWorkstreams.ts";
import type { Drop } from "./dnd.tsx";

/**
 * A cross-group drop sets the dragged thread's workstream before saving its
 * destination order.
 */
type DropPlan = {
  assign?: { threadId: string; workstreamId: string | null; within?: true };
  reorder: ReorderChange | null;
};

/** Parent groups accept moves by choosing a leaf within them on the server. */
function destination(groupId: string, workstreams?: WorkstreamTree) {
  if (groupId === OTHER_ID) return { workstreamId: null };
  const workstreamId =
    workstreams?.bindings[groupId] ??
    workstreams?.workstreams.find(
      (workstream) => sharedWorkstreamId(workstream.id) === groupId,
    )?.id;
  if (
    !workstreamId ||
    !workstreams?.workstreams.some(
      (workstream) => workstream.id === workstreamId,
    )
  )
    return null;
  return {
    workstreamId,
    ...(!takesThreads(workstreamId, workstreams.workstreams)
      ? { within: true as const }
      : {}),
  };
}

export const acceptsThreadDrop = (
  fromGroupId: string,
  toGroupId: string,
  workstreams?: WorkstreamTree,
): boolean =>
  fromGroupId === toGroupId || destination(toGroupId, workstreams) !== null;

export function planDrop<T extends WorkstreamThread>(
  drop: Drop,
  projection: Projection<T>,
  sections: readonly Section[],
  order: ManualOrder,
  workstreams?: WorkstreamTree,
): DropPlan {
  if (drop.kind === "group") {
    // Headers drag top-level groups, which may stand for several sections
    // or for a shared workstream with none. The stored order stays a list of
    // sections: each group's sections move together, keeping their order.
    const ordered = applyOrder(
      sections,
      order.workstreams,
      (s) => s.id,
      "last",
    );
    const nodes = nestGroups(
      ordered.map((section) => ({
        id: section.id,
        name: section.name,
        rows: [],
        total: 0,
        needsYou: 0,
        lastActiveAt: 0,
        focused: false,
      })),
      workstreams,
    );
    const from = nodes.findIndex((node) => node.id === drop.groupId);
    const to = nodes.findIndex((node) => node.id === drop.overGroupId);
    if (from < 0 || to < 0 || from === to) return { reorder: null };
    return {
      reorder: {
        kind: "workstreams",
        ids: arrayMove(nodes, from, to).flatMap((node) => node.sectionIds),
      },
    };
  }

  const groups = [...projection.all, projection.other];
  const source = groups.find((g) => g.id === drop.fromGroupId);
  if (
    !source?.rows.some(
      (row) => row.depth === 0 && row.thread.id === drop.threadId,
    )
  )
    return { reorder: null };
  const group = groups.find((g) => g.id === drop.toGroupId);
  if (!group) {
    const target = destination(drop.toGroupId, workstreams);
    // A workstream-only header has no section order; its chosen leaf determines
    // where the thread goes.
    return target &&
      drop.overThreadId === null &&
      drop.fromGroupId !== drop.toGroupId
      ? { assign: { threadId: drop.threadId, ...target }, reorder: null }
      : { reorder: null };
  }
  const topThreadIds = group.rows
    .filter((row) => row.depth === 0)
    .map((row) => row.thread.id);
  if (drop.overThreadId !== null && !topThreadIds.includes(drop.overThreadId))
    return { reorder: null };
  if (drop.fromGroupId !== drop.toGroupId) {
    const target = destination(drop.toGroupId, workstreams);
    if (!target) return { reorder: null };
    const at =
      drop.overThreadId === null ? -1 : topThreadIds.indexOf(drop.overThreadId);
    const before =
      at < 0
        ? (topThreadIds[0] ?? null)
        : (topThreadIds[at + (drop.below ? 1 : 0)] ?? null);
    return {
      assign: { threadId: drop.threadId, ...target },
      reorder: {
        kind: "threads",
        groupId: drop.toGroupId,
        ids: placeBefore(topThreadIds, drop.threadId, before),
      },
    };
  }
  const workstreamId = workstreams?.bindings[group.id];
  const categories = workstreamId
    ? workstreams?.categories?.[workstreamId]?.categories
    : undefined;
  if (categories && drop.overThreadId !== null) {
    const categoryOf = (id: string) =>
      categories.find((category) => category.threadIds.includes(id))?.id ??
      null;
    if (categoryOf(drop.threadId) !== categoryOf(drop.overThreadId))
      return { reorder: null };
  }
  let ids: string[];
  if (drop.overThreadId === null) {
    // Dropped on a group header: the top of that group.
    ids = placeBefore(topThreadIds, drop.threadId, topThreadIds[0] ?? null);
  } else {
    // Matches the live preview, where the dragged tree takes the target's slot.
    ids = arrayMove(
      topThreadIds,
      topThreadIds.indexOf(drop.threadId),
      topThreadIds.indexOf(drop.overThreadId),
    );
  }
  return {
    reorder: { kind: "threads", groupId: drop.toGroupId, ids },
  };
}
