/**
 * The shape of the workstream groups: which topics list threads (one
 * workstream each), which only head subgroups, how they nest, and the names
 * dimmed before each header. Pure, so the organizer derives workstreams from
 * it and the sidebar and Home draw the same result. See
 * docs/organization.md for the rules in prose.
 *
 * - Partition. A group shows its subtopics as subgroups once it covers more
 *   than `SPLIT_ABOVE` visible roots, and one list again at `MERGE_AT` or
 *   fewer. The gap keeps a group from flipping back and forth, so the
 *   previous result's `state` is an input.
 * - Contexts. A root topic with subtopics and no threads of its own never
 *   gets a header; its name is dimmed before its children's ("[Vercel]
 *   Inside Vercel").
 * - Families. A topic with no threads of its own and two or three subtopics
 *   with threads collapses the same way ("[Vercel Agent] Automations",
 *   "[Vercel Agent] Code Review"). A partitioned topic, whose subtopics a
 *   volume split created, is never a family: it keeps its header.
 * - Only children. A topic with no threads of its own and one subtopic with
 *   threads shows that subtopic under its own name, the parent dimmed first.
 * - Prefix words. A dimmed name that the next name starts with is dropped,
 *   so "Vercel" + "Vercel Agent" reads "Vercel Agent".
 * - Promotion. A group showing subgroups that covers `PROMOTE_AT` of its
 *   parent's visible roots moves to the top level, its ancestors dimmed
 *   before its name ("[BB Plugins] Workstreams"), and its roots leave the
 *   parent's count. It moves back below `DEMOTE_BELOW`, or when it shows one
 *   list again. Only a parent that shows its own header can promote.
 * - Depth. At most `MAX_LEVELS` header levels; a group that would show
 *   subgroups at the last level is promoted whatever its share.
 *
 * A legacy topic that holds threads beside subtopics lists its own threads
 * and still shows its subgroups, so no thread disappears; tidying repairs it.
 */

export const SPLIT_ABOVE = 5;
const MERGE_AT = 3;
const PROMOTE_AT = 0.4;
const DEMOTE_BELOW = 0.3;
const MAX_LEVELS = 3;

export type LayoutTopic = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  /** Its subtopics came from a volume split, so it always keeps its header. */
  readonly partitioned?: boolean;
};

/** What the previous layout decided, for the thresholds' gaps. */
export type LayoutState = {
  /** Topics showing their subtopics as subgroups. */
  readonly split: readonly string[];
  /** Topics moved to the top level. */
  readonly promoted: readonly string[];
};

export const EMPTY_LAYOUT_STATE: LayoutState = { split: [], promoted: [] };

export type LayoutNode = {
  readonly topicId: string;
  /** Names dimmed before `name`, outermost first. */
  readonly prefix: readonly string[];
  readonly name: string;
  /**
   * It lists threads, so a workstream backs it: every visible root at or
   * beneath it that no subgroup or promoted group shows, or, while it shows
   * subgroups, the roots assigned to it directly (a legacy topic).
   */
  readonly lists: boolean;
  /** Visible roots it covers, its subgroups' included. */
  readonly total: number;
  readonly children: readonly LayoutNode[];
};

export type Layout = {
  /** Top-level groups, by their names with prefixes. */
  readonly nodes: readonly LayoutNode[];
  /** Topics that list threads, each backed by one workstream. */
  readonly listed: readonly string[];
  readonly state: LayoutState;
};

/** A header's name with its dimmed prefix, "Prefix: Name" (see `WorkstreamName`). */
export function layoutLabel(node: Pick<LayoutNode, "prefix" | "name">): string {
  return node.prefix.length
    ? `${node.prefix.join(" ")}: ${node.name}`
    : node.name;
}

/** Orders top-level groups by their whole name, prefix first. */
const sortKey = (node: LayoutNode) => [...node.prefix, node.name].join(" ");

/** Whether `name` begins with `word`, at a word boundary, ignoring case. */
export const startsWith = (name: string, word: string) => {
  const a = name.toLowerCase();
  const b = word.toLowerCase();
  return a === b || a.startsWith(`${b} `);
};

function joinPrefix(prefix: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (const part of prefix) {
    const last = out.at(-1);
    if (last !== undefined && startsWith(part, last))
      out[out.length - 1] = part;
    else out.push(part);
  }
  const last = out.at(-1);
  if (last !== undefined && startsWith(name, last)) out.pop();
  return out;
}

export function layoutGroups(input: {
  readonly topics: readonly LayoutTopic[];
  /** Visible roots assigned directly to each topic. */
  readonly counts: Readonly<Record<string, number>>;
  readonly previous?: LayoutState | null;
}): Layout {
  const byId = new Map(input.topics.map((topic) => [topic.id, topic]));
  // An unknown parent makes a topic a root, and so does a parent chain that
  // leads back to the topic, so no input can loop the walks below.
  const parentOf = new Map<string, string | null>();
  for (const topic of input.topics) {
    let parent =
      topic.parentId && byId.has(topic.parentId) ? topic.parentId : null;
    const seen = new Set<string>();
    for (let at = parent; at; at = byId.get(at)?.parentId ?? null) {
      if (at === topic.id) parent = null;
      if (at === topic.id || seen.has(at)) break;
      seen.add(at);
    }
    parentOf.set(topic.id, parent);
  }
  const name = (id: string) => byId.get(id)!.name;
  const byName = (a: string, b: string) =>
    name(a).localeCompare(name(b)) || a.localeCompare(b);
  const kids = new Map<string | null, string[]>();
  for (const topic of input.topics) {
    const parent = parentOf.get(topic.id)!;
    kids.set(parent, [...(kids.get(parent) ?? []), topic.id]);
  }
  for (const list of kids.values()) list.sort(byName);
  const childrenOf = (id: string | null) => kids.get(id) ?? [];
  const own = (id: string) => {
    const n = input.counts[id] ?? 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const partitioned = (id: string) => byId.get(id)!.partitioned === true;

  /** Roots at or beneath `id`, less promoted subtrees. */
  const cover = (id: string, promoted: ReadonlySet<string>): number =>
    own(id) +
    childrenOf(id)
      .filter((child) => !promoted.has(child))
      .reduce((sum, child) => sum + cover(child, promoted), 0);
  const live = (id: string, promoted: ReadonlySet<string>) =>
    childrenOf(id).filter(
      (child) => !promoted.has(child) && cover(child, promoted) > 0,
    );
  const isContext = (id: string) =>
    parentOf.get(id) === null &&
    !partitioned(id) &&
    childrenOf(id).length > 0 &&
    own(id) === 0;
  const isFamily = (id: string, promoted: ReadonlySet<string>) => {
    if (partitioned(id) || own(id) > 0) return false;
    const n = live(id, promoted).length;
    return n >= 2 && n <= 3;
  };
  const isOnlyChildParent = (id: string, promoted: ReadonlySet<string>) =>
    !partitioned(id) && own(id) === 0 && live(id, promoted).length === 1;
  const headed = (id: string, promoted: ReadonlySet<string>) =>
    !isContext(id) &&
    !isFamily(id, promoted) &&
    !isOnlyChildParent(id, promoted);

  const wasSplit = new Set(input.previous?.split ?? []);
  const wasPromoted = new Set(input.previous?.promoted ?? []);
  const splits = (id: string, n: number) =>
    childrenOf(id).length > 0 &&
    (wasSplit.has(id) ? n > MERGE_AT : n > SPLIT_ABOVE);

  // Promotion reads full counts, so a group's share doesn't depend on
  // which of its siblings moved up.
  const none = new Set<string>();
  const promoted = new Set<string>();
  for (const topic of input.topics) {
    const id = topic.id;
    const parent = parentOf.get(id)!;
    if (!parent || !splits(id, cover(id, none)) || !headed(parent, none))
      continue;
    const share = cover(id, none) / Math.max(1, cover(parent, none));
    if (share >= (wasPromoted.has(id) ? DEMOTE_BELOW : PROMOTE_AT))
      promoted.add(id);
  }

  // Each round settles promotions against the previous round's counts: a
  // group whose subgroups all moved up, or that no longer shows subgroups,
  // moves back, and one too deep moves up. A group that moves back no longer
  // shows subgroups, so it never moves up again, and the rounds end.
  for (let round = 0; ; round++) {
    // A promoted group's roots leave its ancestors' counts.
    const split = new Set(
      input.topics
        .map((topic) => topic.id)
        .filter((id) => splits(id, cover(id, promoted))),
    );
    const back = [...promoted].filter(
      (id) => !split.has(id) || cover(id, promoted) === 0,
    );
    if (back.length > 0 && round <= input.topics.length) {
      for (const id of back) promoted.delete(id);
      continue;
    }
    const tooDeep = new Set<string>();
    const listed: string[] = [];
    const draw = (
      id: string,
      prefix: readonly string[],
      depth: number,
    ): LayoutNode[] => {
      const shown = live(id, promoted);
      if (isContext(id) || isFamily(id, promoted))
        return shown.flatMap((child) =>
          draw(child, [...prefix, name(id)], depth),
        );
      if (isOnlyChildParent(id, promoted))
        return draw(shown[0]!, [...prefix, name(id)], depth);
      let subgroups = shown.length > 0 && split.has(id);
      if (subgroups && depth >= MAX_LEVELS - 1) {
        tooDeep.add(id);
        subgroups = false;
      }
      const lists = own(id) > 0 || !subgroups;
      if (lists) listed.push(id);
      return [
        {
          topicId: id,
          prefix: joinPrefix(prefix, name(id)),
          name: name(id),
          lists,
          total: cover(id, promoted),
          children: subgroups
            ? shown.flatMap((child) => draw(child, [], depth + 1))
            : [],
        },
      ];
    };
    const ancestors = (id: string) => {
      const out: string[] = [];
      for (let at = parentOf.get(id)!; at; at = parentOf.get(at)!)
        out.unshift(name(at));
      return out;
    };
    const nodes = [
      ...childrenOf(null)
        .filter((id) => cover(id, promoted) > 0)
        .flatMap((id) => draw(id, [], 0)),
      ...[...promoted].sort(byName).flatMap((id) => draw(id, ancestors(id), 0)),
    ].sort(
      (a, b) =>
        sortKey(a).localeCompare(sortKey(b)) ||
        a.topicId.localeCompare(b.topicId),
    );
    if (tooDeep.size > 0 && round <= input.topics.length) {
      for (const id of tooDeep) promoted.add(id);
      continue;
    }
    return {
      nodes,
      listed,
      state: {
        split: [...split].sort(),
        promoted: [...promoted].sort(),
      },
    };
  }
}
