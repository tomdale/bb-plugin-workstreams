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
  UNSORTED_ID,
  type Projection,
  type Section,
  type WorkstreamThread,
} from "../../domain/project.ts";
import { nestGroups, type WorkstreamTopics } from "../../domain/groups.ts";
import { takesThreads } from "../../domain/topics.ts";
import type { ReorderChange } from "../useWorkstreams.ts";
import type { Drop } from "./dnd.tsx";

/** A cross-group drop sets the root's topic before saving its destination order. */
export type DropPlan = {
  assign?: { threadId: string; entityId: string | null };
  reorder: ReorderChange | null;
};

/** A parent topic cannot take threads alongside its subtopics. */
function destination(groupId: string, topics?: WorkstreamTopics) {
  if (groupId === UNSORTED_ID) return { entityId: null };
  const entityId = topics?.bindings[groupId];
  return entityId &&
    topics.entities.some((entity) => entity.id === entityId) &&
    takesThreads(entityId, topics.entities)
    ? { entityId }
    : null;
}

export const acceptsThreadDrop = (
  fromGroupId: string,
  toGroupId: string,
  topics?: WorkstreamTopics,
): boolean =>
  fromGroupId === toGroupId || destination(toGroupId, topics) !== null;

export function planDrop<T extends WorkstreamThread>(
  drop: Drop,
  projection: Projection<T>,
  sections: readonly Section[],
  order: ManualOrder,
  topics?: WorkstreamTopics,
): DropPlan {
  if (drop.kind === "group") {
    // Headers drag top-level groups, which may stand for several sections
    // or for a shared topic with none. The stored order stays a list of
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
        prioritized: false,
      })),
      topics,
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

  const groups = [...projection.all, projection.unsorted];
  const source = groups.find((g) => g.id === drop.fromGroupId);
  if (
    !source?.rows.some(
      (row) => row.depth === 0 && row.thread.id === drop.threadId,
    )
  )
    return { reorder: null };
  const group = groups.find((g) => g.id === drop.toGroupId);
  if (!group) return { reorder: null };
  const roots = group.rows
    .filter((row) => row.depth === 0)
    .map((row) => row.thread.id);
  if (drop.overThreadId !== null && !roots.includes(drop.overThreadId))
    return { reorder: null };
  if (drop.fromGroupId !== drop.toGroupId) {
    const target = destination(drop.toGroupId, topics);
    if (!target) return { reorder: null };
    const at =
      drop.overThreadId === null ? -1 : roots.indexOf(drop.overThreadId);
    const before =
      at < 0 ? (roots[0] ?? null) : (roots[at + (drop.below ? 1 : 0)] ?? null);
    return {
      assign: { threadId: drop.threadId, entityId: target.entityId },
      reorder: {
        kind: "threads",
        groupId: drop.toGroupId,
        ids: placeBefore(roots, drop.threadId, before),
      },
    };
  }
  let ids: string[];
  if (drop.overThreadId === null) {
    // Dropped on a group header: the top of that group.
    ids = placeBefore(roots, drop.threadId, roots[0] ?? null);
  } else {
    // Matches the live preview, where the dragged tree takes the target's slot.
    ids = arrayMove(
      roots,
      roots.indexOf(drop.threadId),
      roots.indexOf(drop.overThreadId),
    );
  }
  return {
    reorder: { kind: "threads", groupId: drop.toGroupId, ids },
  };
}
