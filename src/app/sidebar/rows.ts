import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  UNFILED_NAME,
  type Group,
  type Projection,
  type Row,
} from "../../domain/project.ts";
import { groupRoots, type WorkstreamNode } from "../../domain/groups.ts";
import type { BandSort } from "./useBandOptions.ts";

export type ThreadRow = Row<PluginSidebarThread>;
export type Placement =
  "group" | "needs-you" | "pinned" | "recent" | "snoozed" | "archived";
type SnoozeOf = (
  thread: PluginSidebarThread,
) => { until: number | null } | undefined;

/**
 * What a placement changes about how its rows draw and what they offer. Every
 * row reads these from here, so a placement's behavior is one table entry
 * rather than a set of flags set at each call site.
 */
export type PlacementTraits = {
  /**
   * A flat band over the workstream list: each row is drawn at depth 0 with
   * its children, when expanded, indented relative to it, and its children
   * start folded.
   */
  readonly overlay: boolean;
  /** Up Next: every row needs the user, so rows read at full strength. */
  readonly attention: boolean;
  /** Up Next rows add a second line saying what the thread asks. */
  readonly subtitle: boolean;
  readonly showPin: boolean;
  readonly showArchive: boolean;
  /** Rows sit inside a workstream's group and indent from its header. */
  readonly inGroup: boolean;
  /** Rows can have child threads to fold. */
  readonly disclosure: boolean;
  /** The hover button after Archive: snooze, or wake while snoozed. */
  readonly snooze: "snooze" | "wake" | null;
};

const band = {
  overlay: true,
  attention: false,
  subtitle: false,
  showPin: false,
  showArchive: true,
  inGroup: false,
  disclosure: true,
  snooze: "snooze",
} as const satisfies PlacementTraits;

export const PLACEMENT_TRAITS: Record<Placement, PlacementTraits> = {
  group: {
    ...band,
    overlay: false,
    showPin: true,
    inGroup: true,
  },
  "needs-you": { ...band, attention: true, subtitle: true },
  pinned: band,
  recent: { ...band, disclosure: false },
  snoozed: { ...band, overlay: false, snooze: "wake" },
  archived: {
    ...band,
    overlay: false,
    showArchive: false,
    snooze: null,
  },
};

/** A row drawn outside any placement, such as a row in isolation. */
export const STANDALONE_TRAITS: PlacementTraits = {
  ...PLACEMENT_TRAITS.group,
  inGroup: false,
};

/** Overlay copies fold independently of the thread's workstream row. */
export const foldKey = (placement: Placement, id: string) =>
  placement === "group" ? `thread:${id}` : `${placement}:thread:${id}`;
export const foldDefault = (placement: Placement) =>
  PLACEMENT_TRAITS[placement].overlay;

/** A row as drawn: how deep it sits in its list, and its list key. */
export type RowEntry = {
  readonly row: ThreadRow;
  readonly depth: number;
  readonly key: string;
};

/**
 * The rows of one tree (its root first, then descendants in tree order) as a
 * placement draws them, skipping folded rows' descendants. An overlay rebases
 * depth on the root, and keys children under it because a child can also be a
 * row of its own in the same band.
 */
export function visibleEntries(
  tree: readonly ThreadRow[],
  placement: Placement,
  folded: (id: string) => boolean,
): RowEntry[] {
  const root = tree[0];
  if (!root) return [];
  const { overlay } = PLACEMENT_TRAITS[placement];
  return unfoldedRows(tree, folded).map((row) => ({
    row,
    depth: overlay ? row.depth - root.depth : row.depth,
    key:
      overlay && row !== root
        ? `${root.thread.id}/${row.thread.id}`
        : row.thread.id,
  }));
}

export function treesOf(rows: readonly ThreadRow[]): ThreadRow[][] {
  const trees: ThreadRow[][] = [];
  for (const row of rows) {
    if (row.depth === 0 || trees.length === 0) trees.push([row]);
    else trees.at(-1)!.push(row);
  }
  return trees;
}

/**
 * Every visible row in the projection's groups by thread id. An animated
 * list draws a row it still shows, such as one leaving Up Next, from here,
 * so the row's marks stay current while it moves.
 */
export function rowsById<T extends PluginSidebarThread>(
  projection: Pick<Projection<T>, "groups" | "unsorted" | "dormant">,
): Map<string, Row<T>> {
  return new Map(
    [...projection.groups, projection.unsorted, ...projection.dormant]
      .flatMap((group) => group.rows)
      .map((row) => [row.thread.id, row]),
  );
}

export function descendantsOf(
  lists: readonly (readonly ThreadRow[])[],
): Map<string, ThreadRow[]> {
  const out = new Map<string, ThreadRow[]>();
  for (const rows of lists)
    rows.forEach((row, index) => {
      const below: ThreadRow[] = [];
      for (let next = index + 1; next < rows.length; next++) {
        const child = rows[next]!;
        if (child.depth <= row.depth) break;
        below.push(child);
      }
      if (below.length) out.set(row.thread.id, below);
    });
  return out;
}

/** Hide descendants until the next sibling; input order is the projection's tree order. */
export function unfoldedRows(
  rows: readonly ThreadRow[],
  folded: (id: string) => boolean,
): ThreadRow[] {
  const out: ThreadRow[] = [];
  let hideBelow: number | null = null;
  for (const row of rows) {
    if (hideBelow !== null && row.depth > hideBelow) continue;
    hideBelow = null;
    out.push(row);
    if (folded(row.thread.id)) hideBelow = row.depth;
  }
  return out;
}

function compareBandRows(
  a: ThreadRow,
  b: ThreadRow,
  sort: BandSort,
  snoozeOf: SnoozeOf,
): number {
  let difference: number;
  if (sort === "title")
    difference = a.thread.displayTitle.localeCompare(b.thread.displayTitle);
  else if (sort === "wake")
    difference =
      (snoozeOf(a.thread)?.until ?? Infinity) -
      (snoozeOf(b.thread)?.until ?? Infinity);
  else if (sort === "archived")
    difference = (b.thread.archivedAt ?? 0) - (a.thread.archivedAt ?? 0);
  else difference = b.thread.latestAttentionAt - a.thread.latestAttentionAt;
  return difference || a.thread.id.localeCompare(b.thread.id);
}

/** Sort entire snoozed trees; their children stay with their roots even when grouped. */
export function planBandRows(
  rows: readonly ThreadRow[],
  placement: "recent" | "snoozed" | "archived",
  options: { sort: BandSort; grouped: boolean },
  snoozeOf: SnoozeOf,
  nameOf: ReadonlyMap<string, string>,
) {
  const trees =
    placement === "snoozed" ? treesOf(rows) : rows.map((row) => [row]);
  const ordered = [...trees].sort((a, b) =>
    compareBandRows(a[0]!, b[0]!, options.sort, snoozeOf),
  );
  if (!options.grouped) return [{ id: null, name: null, trees: ordered }];
  const groups = new Map<string | null, ThreadRow[][]>();
  for (const tree of ordered) {
    // A workstream the sidebar doesn't list files under Unfiled.
    const workstreamId = tree[0]!.workstreamId;
    const id = workstreamId && nameOf.has(workstreamId) ? workstreamId : null;
    const group = groups.get(id) ?? [];
    group.push(tree);
    groups.set(id, group);
  }
  const name = (id: string | null) =>
    id ? (nameOf.get(id) ?? UNFILED_NAME) : UNFILED_NAME;
  return [...groups]
    .sort(([a], [b]) => name(a).localeCompare(name(b)))
    .map(([id, trees]) => ({ id, name: name(id), trees }));
}

/**
 * The archived threads as flat rows. An archived child inherits its root's
 * workstream, even across section changes, and a workstream the sidebar
 * doesn't list files under none.
 */
export function planArchived(
  threads: readonly PluginSidebarThread[],
  sections: readonly { id: string }[],
  show: boolean,
) {
  const visible = show
    ? threads.filter((t) => t.isArchived && !t.isHidden)
    : [];
  const byId = new Map(visible.map((t) => [t.id, t]));
  const known = new Set(sections.map((section) => section.id));
  const rows: ThreadRow[] = visible.map((thread) => {
    let root = thread;
    const seen = new Set([thread.id]);
    while (root.parentThreadId && !seen.has(root.parentThreadId)) {
      const parent = byId.get(root.parentThreadId);
      if (!parent) break;
      seen.add(parent.id);
      root = parent;
    }
    return {
      thread,
      depth: 0,
      hasChildren: false,
      workstreamId:
        root.sectionId && known.has(root.sectionId) ? root.sectionId : null,
      needsYou: false,
    };
  });
  return { threads: visible, rows };
}

/** Count every displayed descendant, but send only roots to the subtree snooze operation. */
export function groupSnoozeRequest(
  group: Group<PluginSidebarThread> | WorkstreamNode<PluginSidebarThread>,
) {
  if (group.total === 0) return undefined;
  const count = `${group.total} ${group.total === 1 ? "thread" : "threads"}`;
  return {
    threads: groupRoots(group),
    subject: `${count} in ${group.name}`,
    label: `Snooze ${count}`,
  };
}
