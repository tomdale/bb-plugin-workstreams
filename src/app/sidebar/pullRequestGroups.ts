/**
 * Which workstream group draws which tracked pull requests, and the groups
 * that exist only to hold them. `arrangeGroups` draws a workstream with no
 * visible thread nowhere, which would hide tracked work that outlives its
 * threads, so a workstream holding a pull request but no thread gets its
 * header back here.
 *
 * A pull request's stored workstream decides its group; moving a thread never
 * moves it. A header draws the pull requests of its own workstream and of the
 * ones listed inline under it, since those have no header of their own. A
 * workstream that returns for its pull requests hangs under its parent group,
 * and under a header drawn for that group when none is on screen. A pull
 * request whose workstream no longer exists falls under Other.
 */
import {
  nestGroups,
  sharedWorkstreamId,
  sortGroups,
  type GroupArrangement,
  type GroupSort,
  type WorkstreamNode,
  type WorkstreamTree,
} from "../../domain/groups.ts";
import {
  OTHER_ID,
  type Group,
  type WorkstreamThread,
} from "../../domain/project.ts";

/** Group id → the workstream ids whose pull requests it draws. */
export type PullRequestScopes = Readonly<Record<string, readonly string[]>>;

export type PlacedPullRequests<T extends WorkstreamThread> = {
  readonly arrangement: GroupArrangement<T>;
  readonly scopes: PullRequestScopes;
  /** Other holds a pull request, so it draws even with no thread. */
  readonly otherHasPullRequests: boolean;
};

const NONE: PullRequestScopes = {};

/** A node and every workstream below it, headers and inline ones alike. */
function* walk<T extends WorkstreamThread>(
  node: WorkstreamNode<T>,
): Generator<WorkstreamNode<T>> {
  yield node;
  for (const sub of node.workstreams) yield* walk(sub);
}

/** The workstreams a node draws without a header of their own. */
function inlineIds<T extends WorkstreamThread>(
  node: WorkstreamNode<T>,
): string[] {
  return node.workstreams
    .filter((sub) => sub.inline)
    .flatMap((sub) => [
      ...(sub.workstreamId ? [sub.workstreamId] : []),
      ...inlineIds(sub),
    ]);
}

export function placePullRequests<T extends WorkstreamThread>(input: {
  arrangement: GroupArrangement<T>;
  /** Workstream ids holding at least one tracked pull request. */
  workstreamIds: readonly string[];
  all: readonly Group<T>[];
  tree: WorkstreamTree | undefined;
  sort: GroupSort;
}): PlacedPullRequests<T> {
  const { arrangement, tree } = input;
  if (input.workstreamIds.length === 0 || !tree)
    return { arrangement, scopes: NONE, otherHasPullRequests: false };

  const wanted = new Set(input.workstreamIds);
  const scopes: Record<string, string[]> = {};
  const claim = (groupId: string, ids: readonly (string | null)[]) => {
    for (const id of ids) {
      if (!id || !wanted.has(id)) continue;
      wanted.delete(id);
      (scopes[groupId] ??= []).push(id);
    }
  };
  // Each pull request belongs to the first group, in the order the list draws
  // them, that draws its workstream, so a workstream shared by two sections
  // shows its pull requests once.
  const visit = (node: WorkstreamNode<T>) => {
    claim(node.id, [node.workstreamId, ...inlineIds(node)]);
    for (const sub of node.workstreams) if (!sub.inline) visit(sub);
  };
  for (const node of [
    ...arrangement.focused,
    ...arrangement.populated,
    ...arrangement.dormant,
  ])
    visit(node);

  // Workstreams drawn nowhere get their header back under the nearest ancestor
  // the list draws, with headers for the ancestors it doesn't, so a nested
  // workstream stays inside its group. A top-level one returns at the top.
  const known = new Map(tree.workstreams.map((w) => [w.id, w]));
  const nested = nestGroups(input.all, tree).flatMap((node) => [...walk(node)]);
  const drawn = new Set<string>();
  const markDrawn = (node: WorkstreamNode<T>) => {
    if (node.workstreamId) drawn.add(node.workstreamId);
    for (const sub of node.workstreams) if (!sub.inline) markDrawn(sub);
  };
  for (const node of [
    ...arrangement.focused,
    ...arrangement.populated,
    ...arrangement.dormant,
  ])
    markDrawn(node);

  /** Added nodes by the workstream they hang under; null is the top level. */
  const under = new Map<string | null, WorkstreamNode<T>[]>();
  const headers = new Map<string, WorkstreamNode<T>>();
  const attach = (node: WorkstreamNode<T>, workstreamId: string) => {
    const parentId = known.get(workstreamId)?.parentId ?? null;
    let at: string | null = null;
    if (parentId !== null && known.has(parentId)) {
      at = parentId;
      if (!drawn.has(parentId) && !headers.has(parentId)) {
        const header = emptyNode<T>(parentId, known.get(parentId)!.name);
        headers.set(parentId, header);
        attach(header, parentId);
      }
    }
    under.set(at, [...(under.get(at) ?? []), node]);
  };
  for (const id of [...wanted]) {
    const workstream = known.get(id);
    if (!workstream) continue;
    wanted.delete(id);
    const found = nested.find((node) => node.workstreamId === id);
    const node: WorkstreamNode<T> = found
      ? { ...found, workstreams: [], inline: false }
      : emptyNode<T>(id, workstream.name);
    attach(node, id);
    scopes[node.id] = [id];
  }
  const otherHasPullRequests = wanted.size > 0;
  if (otherHasPullRequests) scopes[OTHER_ID] = [...wanted];

  if (under.size === 0 && !otherHasPullRequests)
    return { arrangement, scopes, otherHasPullRequests };

  /** `node` with the nodes added under its workstream, headers finished first. */
  const complete = (node: WorkstreamNode<T>): WorkstreamNode<T> => {
    const extra = node.workstreamId ? under.get(node.workstreamId) : undefined;
    const subs = node.workstreams.map(complete);
    if (extra)
      return {
        ...node,
        workstreams: sortGroups([...subs, ...extra.map(complete)], input.sort),
      };
    return subs.every((sub, i) => sub === node.workstreams[i])
      ? node
      : { ...node, workstreams: subs };
  };
  const completed = (nodes: readonly WorkstreamNode<T>[]) => {
    const next = nodes.map(complete);
    return next.every((node, i) => node === nodes[i]) ? nodes : next;
  };
  const added = (under.get(null) ?? []).map(complete);
  const focused = added.filter((node) => node.focused);
  const rest = added.filter((node) => !node.focused);
  return {
    scopes,
    otherHasPullRequests,
    arrangement: {
      ...arrangement,
      focused: focused.length
        ? sortGroups(
            [...completed(arrangement.focused), ...focused],
            input.sort,
          )
        : completed(arrangement.focused),
      populated: rest.length
        ? sortGroups([...completed(arrangement.populated), ...rest], input.sort)
        : completed(arrangement.populated),
      dormant: completed(arrangement.dormant),
      tiered: arrangement.tiered || focused.length > 0,
      hasLower: arrangement.hasLower || rest.length > 0 || otherHasPullRequests,
    },
  };
}

/** A header for a workstream with no section and no thread. */
function emptyNode<T extends WorkstreamThread>(
  workstreamId: string,
  name: string,
): WorkstreamNode<T> {
  return {
    id: sharedWorkstreamId(workstreamId),
    name,
    rows: [],
    total: 0,
    needsYou: 0,
    lastActiveAt: 0,
    focused: false,
    workstreamId,
    label: name,
    parentWorkstreamId: null,
    hasSection: false,
    workstreams: [],
    sectionIds: [],
  };
}
