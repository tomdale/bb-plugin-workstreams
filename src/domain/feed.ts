/**
 * The Workstreams page queue's threads: which roots it shows, and in what
 * order. Pure, so the page and tests share one definition.
 *
 * Up Next comes first, in the shared ranking (`selectUpNext`), with the
 * threads the sidebar trims behind Show more appended in their rank. Earlier
 * holds every other open root whose turn isn't underway, newest first, for
 * when Up Next is clear. Nested threads never come up on their own; they
 * follow their root.
 *
 * The page keeps the order it first showed (see `keepOrder`), so items never
 * jump while the user works through them.
 */
import { arrangeGroups, focusedSections } from "./groups.ts";
import type { GroupSort, WorkstreamNode, WorkstreamTopics } from "./groups.ts";
import { UNSORTED_ID, UNFILED_NAME, type Row } from "./project.ts";
import type { Projection } from "./project.ts";
import {
  isRunning,
  selectUpNext,
  type UpNextOptions,
  type UpNextThread,
} from "./upNext.ts";

/** Where a root is filed: its top-level workstream and the path to its own. */
type FeedPlace = {
  /** The top-level workstream's id, or {@link UNSORTED_ID} for Unfiled. */
  readonly topId: string;
  /** Names from the top-level workstream down to the root's own. */
  readonly path: readonly string[];
};

type FeedPlan<T extends UpNextThread> = {
  /** Up Next's rows, then the ones behind Show more, most urgent first. */
  readonly upNext: readonly Row<T>[];
  /** Every other open root, newest first. */
  readonly earlier: readonly Row<T>[];
  /** Each root's workstream. */
  readonly place: ReadonlyMap<string, FeedPlace>;
};

const byAttention = <T extends UpNextThread>(a: Row<T>, b: Row<T>) =>
  b.thread.latestAttentionAt - a.thread.latestAttentionAt ||
  a.thread.id.localeCompare(b.thread.id);

/** "Vercel Agent: Automations" → ["Vercel Agent", "Automations"]. */
const parts = (label: string) =>
  label
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);

export function planFeed<T extends UpNextThread>(
  projection: Projection<T>,
  options: UpNextOptions<T> & {
    /** Focused section ids (`ManualOrder.prioritized`). */
    readonly prioritized: ReadonlySet<string>;
    readonly groupSort: GroupSort;
    readonly topics?: WorkstreamTopics;
  },
): FeedPlan<T> {
  const arranged = arrangeGroups(projection, options.groupSort, options.topics);
  const selection = selectUpNext(projection, {
    kindOf: options.kindOf,
    now: options.now,
    prioritized: focusedSections(arranged, options.prioritized),
  });

  // Each section's place, from the nested groups the sidebar draws.
  const sectionPlace = new Map<string, FeedPlace>();
  const tops: WorkstreamNode<T>[] = [
    ...arranged.pinned,
    ...arranged.populated,
    ...arranged.dormant,
  ];
  const walk = (
    node: WorkstreamNode<T>,
    topId: string,
    above: readonly string[],
  ) => {
    const own = parts(node.label);
    // A second section bound to its parent's topic repeats the parent's name.
    const repeats =
      above.length >= own.length &&
      above.slice(above.length - own.length).join("\n") === own.join("\n");
    const path = repeats ? above : [...above, ...own];
    if (node.hasSection) sectionPlace.set(node.id, { topId, path });
    for (const sub of node.subgroups) walk(sub, topId, path);
  };
  for (const node of tops) walk(node, node.id, []);
  const unfiled: FeedPlace = { topId: UNSORTED_ID, path: [UNFILED_NAME] };
  const placeOf = (row: Row<T>) =>
    (row.workstreamId && sectionPlace.get(row.workstreamId)) || unfiled;

  const groups = [
    ...projection.groups,
    projection.unsorted,
    ...projection.dormant,
  ];
  const roots = groups.flatMap((group) =>
    group.rows.filter((row) => row.depth === 0),
  );

  const upNext = [...selection.rows, ...selection.more];
  const inUpNext = new Set(upNext.map((row) => row.thread.id));
  const earlier = roots
    .filter((row) => !inUpNext.has(row.thread.id) && !isRunning(row.thread))
    .sort(byAttention);
  const place = new Map<string, FeedPlace>();
  for (const row of roots) place.set(row.thread.id, placeOf(row));

  return { upNext, earlier, place };
}

/**
 * `live` in the order `kept` first showed it: ids already shown keep their
 * place, and ids new to the list follow in `live`'s order. Ids that left
 * `live` drop out. The page passes its previous result back in, so an item
 * keeps its place in the queue while the page is open.
 */
export function keepOrder(
  kept: readonly string[],
  live: readonly string[],
): string[] {
  const present = new Set(live);
  const known = new Set(kept);
  return [
    ...kept.filter((id) => present.has(id)),
    ...live.filter((id) => !known.has(id)),
  ];
}
