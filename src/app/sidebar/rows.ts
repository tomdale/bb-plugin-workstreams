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

/** Overlay copies fold independently of the thread's workstream row. */
export const foldKey = (placement: Placement, id: string) =>
  placement === "group" ? `thread:${id}` : `${placement}:thread:${id}`;
export const foldDefault = (placement: Placement) =>
  placement === "needs-you" || placement === "pinned" || placement === "recent";

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

export const sortedBandRows = (
  rows: readonly ThreadRow[],
  sort: BandSort,
  snoozeOf: SnoozeOf,
) => [...rows].sort((a, b) => compareBandRows(a, b, sort, snoozeOf));

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
    const id = tree[0]!.workstreamId;
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

/** Archived children inherit their root's workstream, including across section changes. */
export function planArchived(
  threads: readonly PluginSidebarThread[],
  sections: readonly { id: string; name: string }[],
  show: boolean,
) {
  const visible = show
    ? threads.filter((t) => t.isArchived && !t.isHidden)
    : [];
  const byId = new Map(visible.map((t) => [t.id, t]));
  const workstreams = new Map<string, string | null>();
  for (const thread of visible) {
    let root = thread;
    const seen = new Set([thread.id]);
    while (root.parentThreadId && !seen.has(root.parentThreadId)) {
      const parent = byId.get(root.parentThreadId);
      if (!parent) break;
      seen.add(parent.id);
      root = parent;
    }
    workstreams.set(thread.id, root.sectionId);
  }
  const workstreamOf = (thread: PluginSidebarThread) =>
    workstreams.get(thread.id) ?? null;
  const buckets = new Map(
    sections.map((section) => [section.id, [] as PluginSidebarThread[]]),
  );
  const unfiled: PluginSidebarThread[] = [];
  const rows: ThreadRow[] = visible.map((thread) => {
    const workstreamId = workstreamOf(thread);
    const bucket =
      workstreamId === null ? undefined : buckets.get(workstreamId);
    if (bucket) bucket.push(thread);
    if (!workstreamId || !bucket) unfiled.push(thread);
    return {
      thread,
      depth: 0,
      hasChildren: false,
      workstreamId,
      needsYou: false,
    };
  });
  return {
    threads: visible,
    rows,
    workstreamOf,
    groups: sections
      .map((section) => ({
        ...section,
        threads: buckets.get(section.id)!,
      }))
      .filter((g) => g.threads.length),
    unfiled,
  };
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
