/**
 * How the workstream groups are arranged below Up Next, shared by the sidebar
 * and the phone Home screen: focused groups (stored as `prioritized`) lead,
 * the rest follow in the chosen order with populated ones before empty ones,
 * and Unfiled and Dormant sit beside them. While any workstream is focused
 * the rest hide behind a "Show other workstreams" toggle. Pure, so both
 * surfaces agree.
 *
 * Workstreams nest by topic. Each workstream is a BB section bound to one
 * topic, and BB keeps sections flat, so the nesting comes from the layout the
 * organizer last applied (see `layoutGroups`): which topics list threads,
 * which only head subgroups, and the names dimmed before each header.
 * Focus, dormancy, and ordering apply to the top-level group as a whole.
 *
 * Subgroups keep their headers together or all list inline (see `GROUP_MIN`),
 * so a parent shows threads or subgroup headers, never both. Top-level groups
 * always keep their own headers. Rows listed outside their own group's header
 * carry its name. A workstream with no visible thread disappears at once, at
 * any depth.
 */
import type { CategoryGeneration } from "./categories.ts";
import { layoutLabel, type LayoutNode } from "./layout.ts";
import type { Group, Projection, WorkstreamThread } from "./project.ts";

/** How workstream groups are ordered: by name, by recent activity, or as dragged. */
export type GroupSort = "alphabetical" | "activity" | "manual";

/** The topic tree, the topic each workstream's section is bound to, and the layout. */
export type WorkstreamTopics = {
  readonly entities: readonly {
    readonly id: string;
    readonly name: string;
    readonly parentId: string | null;
  }[];
  /** Section id → topic id. */
  readonly bindings: Readonly<Record<string, string>>;
  /** The groups the organizer last applied; absent before its first pass. */
  readonly layout?: readonly LayoutNode[];
  readonly categories?: Readonly<Record<string, CategoryGeneration>>;
};

/**
 * A workstream group with the more specific workstreams nested under it.
 * `rows` are the threads filed in this workstream itself; `total`,
 * `needsYou`, and `lastActiveAt` cover the whole subtree, and the node is
 * `prioritized` when any workstream in it is focused.
 */
export type WorkstreamNode<T extends WorkstreamThread> = Group<T> & {
  /** The topic it shows; null for a section bound to no known topic. */
  readonly topicId: string | null;
  /**
   * The topic name with its first-level container as a dimmed prefix.
   */
  readonly label: string;
  /** False for a header that only heads subgroups, which no BB section backs. */
  readonly hasSection: boolean;
  readonly subgroups: readonly WorkstreamNode<T>[];
  /** Every section in the subtree, in the input order. */
  readonly sectionIds: readonly string[];
  /**
   * Drawn without a header: its rows, and its subgroups' rows, list in its
   * parent's list, each labeled with its name.
   */
  readonly inline?: boolean;
  readonly categories?: CategoryGeneration;
};

/**
 * Two subgroups showing this many threads keep headers for all their siblings.
 */
export const GROUP_MIN = 3;

/** A node with every group in it drawn inline, under its parent's header. */
const inlined = <T extends WorkstreamThread>(
  node: WorkstreamNode<T>,
): WorkstreamNode<T> => ({
  ...node,
  inline: true,
  subgroups: node.subgroups.map(inlined),
});

/**
 * Folds all subgroups into one thread list unless two reach `GROUP_MIN`.
 * Headers stay together so inline threads never sit beside subgroup headers.
 * A parent with its own rows also draws all subgroups inline to preserve that rule.
 */
function foldSmall<T extends WorkstreamThread>(
  node: WorkstreamNode<T>,
): WorkstreamNode<T> {
  const big = node.subgroups.filter((sub) => sub.total >= GROUP_MIN);
  const keepHeaders = node.rows.length === 0 && big.length >= 2;
  return {
    ...node,
    subgroups: node.subgroups.map((sub) =>
      keepHeaders ? foldSmall(sub) : inlined(sub),
    ),
  };
}

/** Id of a header drawn for a topic that has no section. */
export const sharedTopicId = (topicId: string) => `topic:${topicId}`;

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
    node.subgroups.length > 0
      ? {
          ...node,
          subgroups: sortTree(node.subgroups, sort),
        }
      : node,
  );
}

const leaf = <T extends WorkstreamThread>(
  group: Group<T>,
  topicId: string | null,
  label = group.name,
): WorkstreamNode<T> => ({
  ...group,
  topicId,
  label,
  hasSection: true,
  subgroups: [],
  sectionIds: [group.id],
});

/**
 * Nests workstreams by the organizer's layout. Top-level groups keep the
 * input order of their first workstream, and subgroups likewise within their
 * parent. A section the layout doesn't list (bound to an unknown topic, or
 * created since the last pass) stands alone.
 */
export function nestGroups<T extends WorkstreamThread>(
  groups: readonly Group<T>[],
  topics?: WorkstreamTopics,
): WorkstreamNode<T>[] {
  const index = new Map(groups.map((group, i) => [group.id, i]));
  const sectionsOf = new Map<string, Group<T>[]>();
  if (topics)
    for (const group of groups) {
      const topicId = topics.bindings[group.id];
      if (!topicId) continue;
      sectionsOf.set(topicId, [...(sectionsOf.get(topicId) ?? []), group]);
    }
  const byId = new Map((topics?.entities ?? []).map((e) => [e.id, e]));
  const pathName = (topicId: string) => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let at: string | null = topicId; at && !seen.has(at);) {
      seen.add(at);
      const entity = byId.get(at);
      if (!entity) break;
      names.unshift(entity.name);
      at = entity.parentId;
    }
    return names.join(": ");
  };
  // A section the layout doesn't list (one emptied or created since the last
  // pass) nests under the nearest topic the layout draws above its own, so it
  // stays in its group.
  const drawn = new Set<string>();
  const listed = new Set<string>();
  const walk = (nodes: readonly LayoutNode[]) => {
    for (const node of nodes) {
      drawn.add(node.topicId);
      if (node.lists) listed.add(node.topicId);
      walk(node.children);
    }
  };
  walk(topics?.layout ?? []);
  const strays = new Map<string, Group<T>[]>();
  for (const group of groups) {
    const topicId = topics?.bindings[group.id];
    if (!topicId || listed.has(topicId)) continue;
    const seen = new Set<string>();
    for (let at: string | null = topicId; at && !seen.has(at);) {
      seen.add(at);
      if (drawn.has(at)) {
        strays.set(at, [...(strays.get(at) ?? []), group]);
        break;
      }
      at = byId.get(at)?.parentId ?? null;
    }
  }
  /** A topic's name below `ancestor`: "Alert Investigations", "CLI: Commands". */
  const relative = (topicId: string, ancestor: string) => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (
      let at: string | null = topicId;
      at && at !== ancestor && !seen.has(at);
    ) {
      seen.add(at);
      const entity = byId.get(at);
      if (!entity) break;
      names.unshift(entity.name);
      at = entity.parentId;
    }
    return names.join(": ");
  };
  const used = new Set<string>();
  const first = (node: WorkstreamNode<T>) =>
    Math.min(
      ...node.sectionIds.map((id) => index.get(id) ?? Infinity),
      Infinity,
    );

  const build = (node: LayoutNode): WorkstreamNode<T> | null => {
    const label = layoutLabel(node);
    const own = node.lists ? (sectionsOf.get(node.topicId) ?? []) : [];
    for (const group of own) used.add(group.id);
    const stray = (strays.get(node.topicId) ?? []).map((group) => {
      used.add(group.id);
      const topicId = topics!.bindings[group.id]!;
      return leaf(
        group,
        topicId,
        topicId === node.topicId ? label : relative(topicId, node.topicId),
      );
    });
    const children = [
      ...node.children
        .map(build)
        .filter((child): child is WorkstreamNode<T> => child !== null),
      ...stray,
    ].sort((a, b) => first(a) - first(b));
    // A second section bound to the same topic nests as its sibling, not
    // its replacement, so none of its threads disappear.
    const [section, ...extra] = own;
    const subgroups = [
      ...extra.map((group) => leaf(group, node.topicId, label)),
      ...children,
    ];
    if (!section && subgroups.length === 0) return null;
    return {
      id: section?.id ?? sharedTopicId(node.topicId),
      name: section?.name ?? pathName(node.topicId),
      rows: section?.rows ?? [],
      total:
        (section?.total ?? 0) +
        subgroups.reduce((sum, sub) => sum + sub.total, 0),
      needsYou:
        (section?.needsYou ?? 0) +
        subgroups.reduce((sum, sub) => sum + sub.needsYou, 0),
      lastActiveAt: Math.max(
        section?.lastActiveAt ?? 0,
        ...subgroups.map((sub) => sub.lastActiveAt),
      ),
      prioritized:
        (section?.prioritized ?? false) ||
        subgroups.some((sub) => sub.prioritized),
      topicId: node.topicId,
      label,
      hasSection: section !== undefined,
      subgroups,
      sectionIds: [
        ...own.map((group) => group.id),
        ...children.flatMap((child) => child.sectionIds),
      ],
    };
  };

  const nested = (topics?.layout ?? [])
    .map(build)
    .filter((node): node is WorkstreamNode<T> => node !== null);
  const alone = groups
    .filter((group) => !used.has(group.id))
    .map((group) =>
      leaf(
        group,
        topics?.bindings[group.id] && byId.has(topics.bindings[group.id]!)
          ? topics.bindings[group.id]!
          : null,
      ),
    );
  const withCategories = (node: WorkstreamNode<T>): WorkstreamNode<T> => ({
    ...node,
    categories: node.topicId ? topics?.categories?.[node.topicId] : undefined,
    subgroups: node.subgroups.map(withCategories),
  });
  return [...nested, ...alone]
    .sort((a, b) => first(a) - first(b))
    .map(withCategories);
}

/**
 * The threads that snoozing a workstream row snoozes: the root of every
 * thread tree the row lists, its subgroups' included, whether or not the row
 * or its trees are collapsed. A snoozed root takes its child threads along
 * (see `projectWorkstreams`), so every thread the row counts leaves it, and
 * each tree wakes whole, just as if each root had been snoozed by itself.
 */
export function groupRoots<T extends WorkstreamThread>(
  group: Group<T> & { readonly subgroups?: readonly WorkstreamNode<T>[] },
): T[] {
  return [
    ...group.rows.filter((row) => row.depth === 0).map((row) => row.thread),
    ...(group.subgroups ?? []).flatMap((sub) => groupRoots(sub)),
  ];
}

type GroupArrangement<T extends WorkstreamThread> = {
  /** Focused workstreams, which pin below Up Next. */
  readonly pinned: readonly WorkstreamNode<T>[];
  /** Every other workstream shown: the ones holding a visible thread. */
  readonly populated: readonly WorkstreamNode<T>[];
  /** Workstreams with no recent activity, in the projection's order. */
  readonly dormant: readonly WorkstreamNode<T>[];
  /** The virtual group of threads in no workstream. */
  readonly unfiled: Group<T>;
  /** Some workstream is focused, so the rest hide behind a toggle. */
  readonly tiered: boolean;
  /** There is anything below the focused groups to reveal. */
  readonly hasLower: boolean;
  /** Counts on the hidden groups' headers, including Unfiled and Dormant. */
  readonly lowerCounts: { readonly needsYou: number; readonly total: number };
};

/**
 * The sections whose threads count as focused (see `selectUpNext`): every
 * section in a top-level group that holds a focused one, so focusing a group
 * covers its subgroups.
 */
export function focusedSections<T extends WorkstreamThread>(
  arrangement: GroupArrangement<T>,
  prioritized: ReadonlySet<string>,
): Set<string> {
  return new Set(
    [...arrangement.pinned, ...arrangement.populated, ...arrangement.dormant]
      .filter((node) => node.sectionIds.some((id) => prioritized.has(id)))
      .flatMap((node) => node.sectionIds),
  );
}

export function arrangeGroups<T extends WorkstreamThread>(
  projection: Projection<T>,
  sort: GroupSort,
  topics?: WorkstreamTopics,
): GroupArrangement<T> {
  // The projection decides dormancy per section from the clock; a nested
  // group is dormant only when nothing in it is still active.
  const active = new Set(projection.groups.map((group) => group.id));
  // A workstream with no visible thread draws nothing, at any depth, so it can
  // never keep its own header or an ancestor's header on screen.
  const prune = (node: WorkstreamNode<T>): WorkstreamNode<T> => ({
    ...node,
    subgroups: node.subgroups.filter((sub) => sub.total > 0).map(prune),
  });
  const nodes = nestGroups(projection.all, topics)
    .filter((node) => node.total > 0)
    .map(prune)
    .map(foldSmall);
  const pinnedNodes: WorkstreamNode<T>[] = [];
  const otherNodes: WorkstreamNode<T>[] = [];
  const dormant: WorkstreamNode<T>[] = [];
  for (const node of nodes) {
    if (node.prioritized) pinnedNodes.push(node);
    else if (!node.sectionIds.some((sectionId) => active.has(sectionId)))
      dormant.push(node);
    else otherNodes.push(node);
  }
  const pinned = sortTree(pinnedNodes, sort);
  const other = sortTree(otherNodes, sort);
  const lowerCounts = [...other, ...dormant, projection.unsorted].reduce(
    (counts, group) => ({
      needsYou: counts.needsYou + group.needsYou,
      total: counts.total + group.total,
    }),
    { needsYou: 0, total: 0 },
  );
  return {
    pinned,
    populated: other,
    dormant: sortTree(dormant, "manual"),
    unfiled: projection.unsorted,
    tiered: pinned.length > 0,
    lowerCounts,
    hasLower:
      other.length > 0 || projection.unsorted.total > 0 || dormant.length > 0,
  };
}
