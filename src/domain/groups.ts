/**
 * How the workstream groups are arranged below Up Next, shared by the sidebar
 * and the phone Home screen: focused groups (stored as `focused`) lead,
 * the rest follow in the chosen order with populated ones before empty ones,
 * and Other and Dormant sit beside them. While any workstream is focused
 * the rest hide behind a "Show other workstreams" toggle. Pure, so both
 * surfaces agree.
 *
 * Workstreams nest by workstream. Each workstream is a BB section bound to one
 * workstream, and BB keeps sections flat, so the nesting comes from the layout the
 * organizer last applied (see `layoutGroups`): which workstreams list threads,
 * which only head workstreams, and the names dimmed before each header.
 * Focus, dormancy, and ordering apply to the top-level group as a whole.
 *
 * Subgroups keep their headers together or all list inline (see `GROUP_MIN`),
 * so a parent shows threads or workstream headers, never both. Top-level groups
 * always keep their own headers. Rows listed outside their own group's header
 * carry its name. A workstream with no visible thread disappears at once, at
 * any depth.
 */
import type { CategoryGeneration } from "./categories.ts";
import { layoutLabel, type LayoutNode } from "./layout.ts";
import type { Group, Projection, WorkstreamThread } from "./project.ts";
import { PATH_SEPARATOR } from "./workstream-path.ts";

/** How workstream groups are ordered: by name, by recent activity, or as dragged. */
export type GroupSort = "alphabetical" | "activity" | "manual";

/** The workstreams and groups, the workstream each workstream's section is bound to, and the layout. */
export type WorkstreamTree = {
  readonly workstreams: readonly {
    readonly id: string;
    readonly name: string;
    readonly parentId: string | null;
  }[];
  /** Section id → workstream id. */
  readonly bindings: Readonly<Record<string, string>>;
  /** The groups the organizer last applied; absent before its first pass. */
  readonly layout?: readonly LayoutNode[];
  readonly categories?: Readonly<Record<string, CategoryGeneration>>;
};

/**
 * A workstream group with the more specific workstreams nested under it. `rows`
 * are the threads in this workstream itself; `total`, `needsYou`, and
 * `lastActiveAt` cover the whole subtree, and the node is `focused` when any
 * workstream in it is focused.
 */
export type WorkstreamNode<T extends WorkstreamThread> = Group<T> & {
  /** The workstream it shows; null for a section bound to no known workstream. */
  readonly workstreamId: string | null;
  /**
   * The workstream name with its first-level container as a dimmed prefix.
   */
  readonly label: string;
  /**
   * The container workstream whose name that prefix shows, when the label has one.
   * Its color identifies the parent wherever its areas appear, so one parent
   * reads the same under each of them.
   */
  readonly parentWorkstreamId: string | null;
  /** False for a header that only heads workstreams, which no BB section backs. */
  readonly hasSection: boolean;
  readonly workstreams: readonly WorkstreamNode<T>[];
  /** Every section in the subtree, in the input order. */
  readonly sectionIds: readonly string[];
  /**
   * Drawn without a header: its rows, and its workstreams' rows, list in its
   * parent's list, each labeled with its name.
   */
  readonly inline?: boolean;
  readonly categories?: CategoryGeneration;
};

/**
 * Two workstreams showing this many threads keep headers for all their siblings.
 */
export const GROUP_MIN = 3;

/** A node with every group in it drawn inline, under its parent's header. */
const inlined = <T extends WorkstreamThread>(
  node: WorkstreamNode<T>,
): WorkstreamNode<T> => ({
  ...node,
  inline: true,
  workstreams: node.workstreams.map(inlined),
});

/**
 * Folds all workstreams into one thread list unless two reach `GROUP_MIN`.
 * Headers stay together so inline threads never sit beside workstream headers.
 * A parent with its own rows also draws all workstreams inline to preserve that rule.
 */
function foldSmall<T extends WorkstreamThread>(
  node: WorkstreamNode<T>,
): WorkstreamNode<T> {
  const big = node.workstreams.filter((sub) => sub.total >= GROUP_MIN);
  const keepHeaders = node.rows.length === 0 && big.length >= 2;
  return {
    ...node,
    workstreams: node.workstreams.map((sub) =>
      keepHeaders ? foldSmall(sub) : inlined(sub),
    ),
  };
}

/**
 * Other as a node, so it draws like any workstream: it has no workstream, no
 * section, and no workstreams.
 */
export const otherNode = <T extends WorkstreamThread>(
  group: Group<T>,
): WorkstreamNode<T> => ({
  ...group,
  workstreamId: null,
  label: group.name,
  parentWorkstreamId: null,
  hasSection: false,
  workstreams: [],
  sectionIds: [],
});

/** Id of a header drawn for a workstream that has no section. */
export const sharedWorkstreamId = (workstreamId: string) =>
  `workstream:${workstreamId}`;

/** Sorts by the whole name, prefix first: "BB Fork & Core" before "BB Plugins". */
const labelOf = (group: { name: string; label?: string }) =>
  (group.label ?? group.name).replace(/:\s*/g, " ");

export function sortGroups<G extends Group<WorkstreamThread>>(
  groups: readonly G[],
  sort: GroupSort,
): G[] {
  if (sort === "manual") return [...groups];
  return [...groups].sort(
    (a, b) =>
      (sort === "activity"
        ? b.lastActiveAt - a.lastActiveAt
        : labelOf(a).localeCompare(labelOf(b))) ||
      labelOf(a).localeCompare(labelOf(b)),
  );
}

/** Sorts each level after the projection applies the shared empty-workstream budget. */
function sortTree<T extends WorkstreamThread>(
  nodes: readonly WorkstreamNode<T>[],
  sort: GroupSort,
): WorkstreamNode<T>[] {
  return sortGroups(nodes, sort).map((node) =>
    node.workstreams.length > 0
      ? {
          ...node,
          workstreams: sortTree(node.workstreams, sort),
        }
      : node,
  );
}

const leaf = <T extends WorkstreamThread>(
  group: Group<T>,
  workstreamId: string | null,
  label = group.name,
  parentWorkstreamId: string | null = null,
): WorkstreamNode<T> => ({
  ...group,
  workstreamId,
  label,
  parentWorkstreamId,
  hasSection: true,
  workstreams: [],
  sectionIds: [group.id],
});

/**
 * Nests workstreams by the organizer's layout. Top-level groups keep the
 * input order of their first workstream, and workstreams likewise within their
 * parent. A section the layout doesn't list (bound to an unknown workstream, or
 * created since the last pass) stands alone.
 */
export function nestGroups<T extends WorkstreamThread>(
  groups: readonly Group<T>[],
  tree?: WorkstreamTree,
): WorkstreamNode<T>[] {
  const index = new Map(groups.map((group, i) => [group.id, i]));
  const sectionsOf = new Map<string, Group<T>[]>();
  if (tree)
    for (const group of groups) {
      const workstreamId = tree.bindings[group.id];
      if (!workstreamId) continue;
      sectionsOf.set(workstreamId, [
        ...(sectionsOf.get(workstreamId) ?? []),
        group,
      ]);
    }
  const byId = new Map((tree?.workstreams ?? []).map((e) => [e.id, e]));
  const pathName = (workstreamId: string) => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let at: string | null = workstreamId; at && !seen.has(at);) {
      seen.add(at);
      const workstream = byId.get(at);
      if (!workstream) break;
      names.unshift(workstream.name);
      at = workstream.parentId;
    }
    return names.join(PATH_SEPARATOR);
  };
  // A section the layout doesn't list (one emptied or created since the last
  // pass) nests under the nearest workstream the layout draws above its own, so it
  // stays in its group.
  const drawn = new Set<string>();
  const listed = new Set<string>();
  const walk = (nodes: readonly LayoutNode[]) => {
    for (const node of nodes) {
      drawn.add(node.workstreamId);
      if (node.lists) listed.add(node.workstreamId);
      walk(node.children);
    }
  };
  walk(tree?.layout ?? []);
  const strays = new Map<string, Group<T>[]>();
  for (const group of groups) {
    const workstreamId = tree?.bindings[group.id];
    if (!workstreamId || listed.has(workstreamId)) continue;
    const seen = new Set<string>();
    for (let at: string | null = workstreamId; at && !seen.has(at);) {
      seen.add(at);
      if (drawn.has(at)) {
        strays.set(at, [...(strays.get(at) ?? []), group]);
        break;
      }
      at = byId.get(at)?.parentId ?? null;
    }
  }
  /** A workstream's name below `ancestor`: "Alert Investigations", "CLI › Commands". */
  const relative = (workstreamId: string, ancestor: string) => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (
      let at: string | null = workstreamId;
      at && at !== ancestor && !seen.has(at);
    ) {
      seen.add(at);
      const workstream = byId.get(at);
      if (!workstream) break;
      names.unshift(workstream.name);
      at = workstream.parentId;
    }
    return names.join(PATH_SEPARATOR);
  };
  const used = new Set<string>();
  const first = (node: WorkstreamNode<T>) =>
    Math.min(
      ...node.sectionIds.map((id) => index.get(id) ?? Infinity),
      Infinity,
    );

  const build = (node: LayoutNode): WorkstreamNode<T> | null => {
    const label = layoutLabel(node);
    /** The container the label's prefix names, which is the workstream's parent. */
    const parentWorkstreamId =
      node.prefix.length > 0
        ? (byId.get(node.workstreamId)?.parentId ?? null)
        : null;
    const own = node.lists ? (sectionsOf.get(node.workstreamId) ?? []) : [];
    for (const group of own) used.add(group.id);
    const stray = (strays.get(node.workstreamId) ?? []).map((group) => {
      used.add(group.id);
      const workstreamId = tree!.bindings[group.id]!;
      const ownWorkstream = workstreamId === node.workstreamId;
      return leaf(
        group,
        workstreamId,
        ownWorkstream ? label : relative(workstreamId, node.workstreamId),
        ownWorkstream ? parentWorkstreamId : null,
      );
    });
    const children = [
      ...node.children
        .map(build)
        .filter((child): child is WorkstreamNode<T> => child !== null),
      ...stray,
    ].sort((a, b) => first(a) - first(b));
    // A second section bound to the same workstream nests as its sibling, not
    // its replacement, so none of its threads disappear.
    const [section, ...extra] = own;
    const workstreams = [
      ...extra.map((group) =>
        leaf(group, node.workstreamId, label, parentWorkstreamId),
      ),
      ...children,
    ];
    if (!section && workstreams.length === 0) return null;
    return {
      id: section?.id ?? sharedWorkstreamId(node.workstreamId),
      name: section?.name ?? pathName(node.workstreamId),
      rows: section?.rows ?? [],
      total:
        (section?.total ?? 0) +
        workstreams.reduce((sum, sub) => sum + sub.total, 0),
      needsYou:
        (section?.needsYou ?? 0) +
        workstreams.reduce((sum, sub) => sum + sub.needsYou, 0),
      lastActiveAt: Math.max(
        section?.lastActiveAt ?? 0,
        ...workstreams.map((sub) => sub.lastActiveAt),
      ),
      focused:
        (section?.focused ?? false) || workstreams.some((sub) => sub.focused),
      workstreamId: node.workstreamId,
      label,
      parentWorkstreamId,
      hasSection: section !== undefined,
      workstreams,
      sectionIds: [
        ...own.map((group) => group.id),
        ...children.flatMap((child) => child.sectionIds),
      ],
    };
  };

  const nested = (tree?.layout ?? [])
    .map(build)
    .filter((node): node is WorkstreamNode<T> => node !== null);
  const alone = groups
    .filter((group) => !used.has(group.id))
    .map((group) =>
      leaf(
        group,
        tree?.bindings[group.id] && byId.has(tree.bindings[group.id]!)
          ? tree.bindings[group.id]!
          : null,
      ),
    );
  const withCategories = (node: WorkstreamNode<T>): WorkstreamNode<T> => ({
    ...node,
    categories: node.workstreamId
      ? tree?.categories?.[node.workstreamId]
      : undefined,
    workstreams: node.workstreams.map(withCategories),
  });
  return [...nested, ...alone]
    .sort((a, b) => first(a) - first(b))
    .map(withCategories);
}

/**
 * The threads that snoozing a workstream row snoozes: the top thread of every
 * thread tree the row lists, its workstreams' included, whether or not the row
 * or its trees are collapsed. A snoozed thread takes its child threads along
 * (see `projectWorkstreams`), so every thread the row counts leaves it, and
 * each tree wakes whole, just as if each top thread had been snoozed by itself.
 */
export function groupThreads<T extends WorkstreamThread>(
  group: Group<T> & { readonly workstreams?: readonly WorkstreamNode<T>[] },
): T[] {
  return [
    ...group.rows.filter((row) => row.depth === 0).map((row) => row.thread),
    ...(group.workstreams ?? []).flatMap((sub) => groupThreads(sub)),
  ];
}

/**
 * The workstream groups split into the lists the sidebar draws them in, with
 * Other and the counts for the groups hidden behind the lower toggle.
 */
export type GroupArrangement<T extends WorkstreamThread> = {
  /** Focused workstreams, which pin below Up Next. */
  readonly focused: readonly WorkstreamNode<T>[];
  /** Every other workstream shown: the ones holding a visible thread. */
  readonly populated: readonly WorkstreamNode<T>[];
  /** Workstreams with no recent activity, in the projection's order. */
  readonly dormant: readonly WorkstreamNode<T>[];
  /** The virtual group of threads in no workstream. */
  readonly other: WorkstreamNode<T>;
  /** Some workstream is focused, so the rest hide behind a toggle. */
  readonly tiered: boolean;
  /** There is anything below the focused groups to reveal. */
  readonly hasLower: boolean;
  /** Counts on the hidden groups' headers, including Other and Dormant. */
  readonly lowerCounts: { readonly needsYou: number; readonly total: number };
};

/**
 * The sections whose threads count as focused (see `selectUpNext`): every
 * section in a top-level group that holds a focused one, so focusing a group
 * covers its workstreams.
 */
export function focusedSections<T extends WorkstreamThread>(
  arrangement: GroupArrangement<T>,
  focused: ReadonlySet<string>,
): Set<string> {
  return new Set(
    [...arrangement.focused, ...arrangement.populated, ...arrangement.dormant]
      .filter((node) => node.sectionIds.some((id) => focused.has(id)))
      .flatMap((node) => node.sectionIds),
  );
}

export function arrangeGroups<T extends WorkstreamThread>(
  projection: Projection<T>,
  sort: GroupSort,
  tree?: WorkstreamTree,
): GroupArrangement<T> {
  // The projection decides dormancy per section from the clock; a nested
  // group is dormant only when nothing in it is still active.
  const active = new Set(projection.groups.map((group) => group.id));
  // A workstream with no visible thread draws nothing, at any depth, so it can
  // never keep its own header or an ancestor's header on screen.
  const prune = (node: WorkstreamNode<T>): WorkstreamNode<T> => ({
    ...node,
    workstreams: node.workstreams.filter((sub) => sub.total > 0).map(prune),
  });
  const nodes = nestGroups(projection.all, tree)
    .filter((node) => node.total > 0)
    .map(prune)
    .map(foldSmall);
  const focusedNodes: WorkstreamNode<T>[] = [];
  const otherNodes: WorkstreamNode<T>[] = [];
  const dormant: WorkstreamNode<T>[] = [];
  for (const node of nodes) {
    if (node.focused) focusedNodes.push(node);
    else if (!node.sectionIds.some((sectionId) => active.has(sectionId)))
      dormant.push(node);
    else otherNodes.push(node);
  }
  const focused = sortTree(focusedNodes, sort);
  const other = sortTree(otherNodes, sort);
  const lowerCounts = [...other, ...dormant, projection.other].reduce(
    (counts, group) => ({
      needsYou: counts.needsYou + group.needsYou,
      total: counts.total + group.total,
    }),
    { needsYou: 0, total: 0 },
  );
  return {
    focused,
    populated: other,
    dormant: sortTree(dormant, "manual"),
    other: otherNode(projection.other),
    tiered: focused.length > 0,
    lowerCounts,
    hasLower:
      other.length > 0 || projection.other.total > 0 || dormant.length > 0,
  };
}
