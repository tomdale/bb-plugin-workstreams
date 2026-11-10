/**
 * Keeps node identity across recomputations. The projection shares its own
 * rows and groups (see `projectWorkstreams`), so a workstream node here is
 * unchanged exactly when its own fields and its shared rows are, and a
 * consumer that compares by identity, such as a memoized group body, skips an
 * unchanged workstream without comparing rows field by field.
 */
import type { GroupArrangement, WorkstreamNode } from "../domain/groups.ts";
import type { WorkstreamThread } from "../domain/project.ts";

/**
 * `next` with each node replaced by the previous arrangement's node when the
 * two are the same group with the same content, matched by group id. The
 * node lists keep their identity too while every node in them does.
 */
export function shareArrangement<T extends WorkstreamThread>(
  previous: GroupArrangement<T> | undefined,
  next: GroupArrangement<T>,
): GroupArrangement<T> {
  const before = new Map<string, WorkstreamNode<T>>();
  if (previous) for (const node of nodesIn(previous)) before.set(node.id, node);

  const share = (node: WorkstreamNode<T>): WorkstreamNode<T> => {
    const last = before.get(node.id);
    const subgroups = shareList(last?.subgroups, node.subgroups, share);
    const candidate = { ...node, subgroups };
    return last && sameGroup(last, candidate) ? last : candidate;
  };

  return {
    ...next,
    pinned: shareList(previous?.pinned, next.pinned, share),
    populated: shareList(previous?.populated, next.populated, share),
    dormant: shareList(previous?.dormant, next.dormant, share),
    unfiled: share(next.unfiled),
  };
}

/** Every node of an arrangement, nested subgroups included. */
function nodesIn<T extends WorkstreamThread>(
  arrangement: GroupArrangement<T>,
): WorkstreamNode<T>[] {
  const nodes: WorkstreamNode<T>[] = [];
  const visit = (node: WorkstreamNode<T>) => {
    nodes.push(node);
    node.subgroups.forEach(visit);
  };
  [
    ...arrangement.pinned,
    ...arrangement.populated,
    ...arrangement.dormant,
    arrangement.unfiled,
  ].forEach(visit);
  return nodes;
}

/**
 * `next` as the previous list when it holds the same values in the same order,
 * so a list whose groups are all unchanged is the same array again.
 */
function shareList<T>(
  previous: readonly T[] | undefined,
  next: readonly T[],
  share: (value: T) => T,
): readonly T[] {
  const shared = next.map(share);
  return previous && sameList(previous, shared) ? previous : shared;
}

/**
 * Whether a node drawn now draws exactly what the previous one did. Its rows
 * and subgroups are the previous objects whenever their own contents match,
 * so those compare by identity.
 */
function sameGroup<T extends WorkstreamThread>(
  before: WorkstreamNode<T>,
  after: WorkstreamNode<T>,
): boolean {
  return (
    before.id === after.id &&
    before.name === after.name &&
    before.label === after.label &&
    before.total === after.total &&
    before.needsYou === after.needsYou &&
    before.lastActiveAt === after.lastActiveAt &&
    before.prioritized === after.prioritized &&
    before.topicId === after.topicId &&
    before.parentTopicId === after.parentTopicId &&
    before.hasSection === after.hasSection &&
    before.inline === after.inline &&
    before.categories === after.categories &&
    sameList(before.rows, after.rows) &&
    sameList(before.sectionIds, after.sectionIds) &&
    sameList(before.subgroups, after.subgroups)
  );
}

/** Whether two lists hold the very same values, in the same order. */
function sameList<T>(before: readonly T[], after: readonly T[]): boolean {
  return (
    before === after ||
    (before.length === after.length &&
      before.every((value, index) => value === after[index]))
  );
}
