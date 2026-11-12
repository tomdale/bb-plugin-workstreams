/**
 * The two small sidebars the organizing suggestions are reviewed on: every
 * workstream with a visible thread as it is now, and as it would be after
 * accepting one change, with the flows of threads that change moves.
 *
 * The after state is not sent by the server. The client applies the change's
 * delta (`applyDelta`) to the topics and filing it holds and runs the real
 * layout and arrangement on both states (`layoutGroups`, `projectWorkstreams`,
 * `arrangeGroups`, with the user's own sort), so the drawing agrees with the
 * sidebar about nesting, name prefixes and order. Pure, so tests can check it
 * without a browser.
 *
 * What differs from the sidebar, on purpose: every workstream with a visible
 * thread is drawn, including dormant ones and the ones hidden while another
 * is focused; categories are left out; threads that are not in the sidebar
 * (snoozed ones) are drawn as dashed ticks, but only in the workstreams the
 * change touches (the delta names them, in `held`); archived threads are never
 * drawn, since a topic can hold thousands, only counted; a workstream the
 * change touches is always drawn, with no ticks when it has no thread to show; a workstream draws at most `TICK_CAP`
 * ticks, shared out by each group's share of its threads; and under manual
 * order the after state puts a new workstream beside the one it grew from, so
 * a flow into it stays short.
 */
import {
  applyDelta,
  type ChangeDelta,
  type DeltaTopic,
} from "../../domain/suggestion-change.ts";
import { arrangeGroups, type GroupSort } from "../../domain/groups.ts";
import { layoutGroups } from "../../domain/layout.ts";
import {
  projectWorkstreams,
  UNFILED_NAME,
  UNSORTED_ID,
  type WorkstreamThread,
} from "../../domain/project.ts";
import {
  allocateChildColor,
  colorForWorkstream,
  type TopicColor,
} from "../../domain/workstreamColor.ts";
import { workstreamHue } from "../../domain/workstreamHue.ts";
import type { WorkstreamNode } from "../../domain/groups.ts";

/** Most ticks one workstream draws; larger ones share them by group. */
export const TICK_CAP = 12;

/** A visible root thread, as the miniatures need it. */
type MiniThread = {
  readonly id: string;
  readonly title: string;
  /** Its workstream's native section; null for Unfiled. */
  readonly sectionId: string | null;
  readonly activeAt: number;
  /** Not in the sidebar (snoozed): drawn dashed. */
  readonly hidden?: boolean;
  /** Holds a touched workstream open when it has no thread to show; no tick. */
  readonly ghost?: boolean;
};

/** The topic colors the sidebar draws workstreams in. */
type MiniColors = {
  readonly groups: Readonly<Record<string, string>>;
  readonly colors?: Readonly<Record<string, TopicColor>>;
};

/** A group of the sidebar's projection, as the miniatures read it. */
type MiniGroup = {
  readonly id: string;
  readonly rows: readonly {
    readonly depth: number;
    readonly thread: {
      readonly id: string;
      readonly title: string | null;
      readonly latestAttentionAt: number;
    };
  }[];
};

/** What the sidebar holds, which the miniatures start from. */
export type SidebarView = {
  readonly projection: {
    readonly all: readonly MiniGroup[];
    readonly unsorted: MiniGroup;
  };
  /** The topic tree, each root's topic, and the topic colors; absent until read. */
  readonly catalog:
    | (MiniColors & {
        readonly entities: readonly DeltaTopic[];
        readonly assignments: Readonly<
          Record<string, { readonly entityId: string | null }>
        >;
      })
    | undefined;
  readonly sort: GroupSort;
  /** The stored manual order of workstream sections. */
  readonly manualOrder: readonly string[];
  /** BB's sections, in its own order. */
  readonly sections: readonly { readonly id: string }[];
  readonly now: number;
};

/**
 * The sidebar's visible root threads, its topics and their filing, which
 * every suggestion's miniatures start from. Null before the topics are read.
 */
export function miniatureBase(
  sidebar: SidebarView,
): Omit<MiniatureInput, "delta"> | null {
  const { catalog, projection } = sidebar;
  if (!catalog) return null;
  const threads: MiniThread[] = [
    ...projection.all,
    projection.unsorted,
  ].flatMap((group) =>
    group.rows
      .filter((row) => row.depth === 0)
      .map((row) => ({
        id: row.thread.id,
        title: row.thread.title ?? "Untitled thread",
        sectionId: group.id === UNSORTED_ID ? null : group.id,
        activeAt: row.thread.latestAttentionAt,
      })),
  );
  return {
    threads,
    topics: catalog.entities.map(({ id, name, parentId }) => ({
      id,
      name,
      parentId,
    })),
    filing: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        catalog.assignments[thread.id]?.entityId ?? null,
      ]),
    ),
    colors: catalog,
    sort: sidebar.sort,
    sections: sidebar.sections.map((section) => section.id),
    manualOrder: sidebar.manualOrder,
    now: sidebar.now,
  };
}

export type MiniatureInput = {
  /** Visible root threads in the sidebar. */
  readonly threads: readonly MiniThread[];
  readonly topics: readonly DeltaTopic[];
  /** Each root thread's topic id; absent or null for Unfiled. */
  readonly filing: Readonly<Record<string, string | null>>;
  /** Native section id to topic id, and the topic colors. */
  readonly colors: MiniColors | undefined;
  readonly sort: GroupSort;
  /** BB's section ids in its own order, which manual order leaves unlisted ones in. */
  readonly sections: readonly string[];
  /** The stored manual order of workstream sections. */
  readonly manualOrder: readonly string[];
  readonly delta: ChangeDelta;
  readonly now: number;
};

type MiniTick = {
  /** The flow this tick's threads belong to; null when they stay. */
  readonly flow: number | null;
  /** The threads it stands for: one, or several in a capped workstream. */
  readonly threads: number;
  /** They are not in the sidebar. */
  readonly hidden: boolean;
  /** Relative length, from the first thread's title. */
  readonly width: number;
};

export type MiniWorkstream = {
  readonly key: string;
  /** The dimmed parent name before the colon, when the label has one. */
  readonly prefix: string | null;
  readonly name: string;
  /** The change touches it. */
  readonly hot: boolean;
  /** Its identity color; none for Unfiled. */
  readonly color: TopicColor | null;
  readonly ticks: readonly MiniTick[];
  readonly subs: readonly MiniWorkstream[];
};

export type MiniFlow = {
  readonly index: number;
  readonly color: TopicColor;
  /** The workstream the threads end up in (or the renamed one). */
  readonly to: { readonly prefix: string | null; readonly name: string };
  readonly threads: readonly { readonly id: string; readonly title: string }[];
};

export type Miniature = {
  /** Archived or hidden threads the change moves, which are not drawn. */
  readonly archived: number;
  readonly now: readonly MiniWorkstream[];
  readonly after: readonly MiniWorkstream[];
  readonly flows: readonly MiniFlow[];
};

type Section = { readonly id: string; readonly name: string };
type Synthetic = WorkstreamThread & { readonly title: string };

/** The section a topic's workstream is drawn from. */
const sectionKey = (topicId: string) => `miniature:${topicId}`;

type State = {
  readonly nodes: readonly WorkstreamNode<Synthetic>[];
  /** Each thread's workstream topic id and label. */
  readonly placeOf: ReadonlyMap<
    string,
    { topic: string | null; label: string }
  >;
  /** Section ids, top to bottom as drawn. */
  readonly order: readonly string[];
};

function arrange(
  input: MiniatureInput,
  topics: readonly DeltaTopic[],
  filing: Readonly<Record<string, string | null>>,
  realSection: ReadonlyMap<string, string>,
  manualOrder: readonly string[],
  touched: ReadonlySet<string>,
): State {
  const known = new Set(topics.map((t) => t.id));
  const parents = new Set(topics.map((t) => t.parentId));
  const topicOf = (thread: MiniThread) => {
    const id = filing[thread.id] ?? null;
    return id && known.has(id) ? id : null;
  };
  // Work outside the sidebar is drawn only in a topic the change touches, and
  // never in one that holds subtopics, whose threads no layout can place.
  const shown = input.threads.filter((thread) => {
    if (!thread.hidden) return true;
    const topic = topicOf(thread);
    return topic !== null && touched.has(topic) && !parents.has(topic);
  });
  const counts: Record<string, number> = {};
  for (const thread of shown) {
    const id = topicOf(thread);
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  }
  // A workstream the change touches is drawn even with no thread to show, as a
  // name alone, so a change to work that is all archived still shows.
  const ghosts = [...touched].filter(
    (id) => known.has(id) && !parents.has(id) && !counts[id],
  );
  for (const id of ghosts) counts[id] = 1;
  const layout = layoutGroups({ topics, counts });
  const byId = new Map(topics.map((t) => [t.id, t]));
  const sectionOf = (topicId: string) =>
    realSection.get(topicId) ?? sectionKey(topicId);
  const bindings: Record<string, string> = {};
  const sections: Section[] = [];
  const rank = (section: string) => {
    const at = input.sections.indexOf(section);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  for (const id of Object.keys(counts).sort(
    (a, b) => rank(sectionOf(a)) - rank(sectionOf(b)) || a.localeCompare(b),
  )) {
    const section = sectionOf(id);
    bindings[section] = id;
    sections.push({ id: section, name: byId.get(id)!.name });
  }
  const ghostThreads: Synthetic[] = ghosts.map((id) => ({
    id: `ghost:${id}`,
    title: "",
    parentThreadId: null,
    sectionId: sectionOf(id),
    isHidden: false,
    isArchived: false,
    isPinned: false,
    hasPendingInteraction: false,
    latestAttentionAt: 0,
    createdAt: 0,
  }));
  const threads: Synthetic[] = shown.map((thread) => {
    const topic = topicOf(thread);
    return {
      id: thread.id,
      title: thread.title,
      parentThreadId: null,
      sectionId: topic ? sectionOf(topic) : null,
      isHidden: false,
      isArchived: false,
      isPinned: false,
      hasPendingInteraction: false,
      latestAttentionAt: thread.activeAt,
      createdAt: thread.activeAt,
    };
  });
  const projection = projectWorkstreams(
    [...threads, ...ghostThreads],
    sections,
    {
      now: input.now,
      // Dormant workstreams are drawn too.
      dormantAfterMs: Number.MAX_SAFE_INTEGER,
      order: { workstreams: manualOrder, threads: {}, prioritized: [] },
    },
  );
  const arranged = arrangeGroups(projection, input.sort, {
    entities: topics,
    bindings,
    layout: layout.nodes,
  });
  const nodes = [
    ...arranged.populated,
    ...(arranged.unfiled.total > 0 ? [arranged.unfiled] : []),
  ];
  const placeOf = new Map<string, { topic: string | null; label: string }>();
  const walk = (node: WorkstreamNode<Synthetic>) => {
    for (const row of node.rows)
      if (!row.thread.id.startsWith("ghost:"))
        placeOf.set(row.thread.id, {
          topic: node.topicId,
          label: node.label,
        });
    node.subgroups.forEach(walk);
  };
  nodes.forEach(walk);
  return {
    nodes,
    placeOf,
    order: nodes.flatMap((node) => node.sectionIds),
  };
}

const split = (label: string, hasParent: boolean) => {
  const at = hasParent ? label.indexOf(": ") : -1;
  return at < 0
    ? { prefix: null, name: label }
    : { prefix: label.slice(0, at), name: label.slice(at + 2) };
};

const tickWidth = (title: string) =>
  Math.max(36, Math.min(124, Math.round(title.length * 3.4)));

/**
 * One tick per thread up to `TICK_CAP`; beyond that the ticks are shared out
 * among the groups (those that stay, and each flow, with threads outside the
 * sidebar apart) by their number of threads, at least one each, so a ribbon's
 * thickness is its real share. Groups keep their threads together, staying
 * threads first, so a flow's ribbon spans one run of ticks.
 */
function ticksOf(
  threads: readonly { title: string; flow: number | null; hidden: boolean }[],
): MiniTick[] {
  type Member = (typeof threads)[number];
  const key = (t: Member) => `${t.flow ?? -1}:${t.hidden ? 1 : 0}`;
  const groups = new Map<string, Member[]>();
  for (const thread of [...threads].sort(
    (a, b) =>
      (a.flow ?? -1) - (b.flow ?? -1) || Number(a.hidden) - Number(b.hidden),
  ))
    groups.set(key(thread), [...(groups.get(key(thread)) ?? []), thread]);
  const ordered = [...groups.values()];
  const width = (m: Member) => (m.hidden ? 60 : tickWidth(m.title));
  const total = threads.length;
  if (total <= TICK_CAP)
    return ordered.flatMap((members) =>
      members.map((m) => ({
        flow: m.flow,
        hidden: m.hidden,
        threads: 1,
        width: width(m),
      })),
    );
  // Largest remainder, with one tick guaranteed to each group.
  const slots = Math.max(TICK_CAP, ordered.length);
  const quota = ordered.map((members) => (members.length * slots) / total);
  const given = quota.map((q) => Math.max(1, Math.floor(q)));
  let spare = slots - given.reduce((a, b) => a + b, 0);
  const byRemainder = quota
    .map((q, i) => ({ i, rest: q - Math.floor(q) }))
    .sort((a, b) => b.rest - a.rest);
  for (let k = 0; spare > 0; k = (k + 1) % byRemainder.length, spare--)
    given[byRemainder[k]!.i]!++;
  // A group can hold fewer threads than ticks it was given.
  return ordered.flatMap((members, g) => {
    const n = Math.min(given[g]!, members.length);
    return Array.from({ length: n }, (_, tick) => {
      const from = Math.floor((tick * members.length) / n);
      const to = Math.floor(((tick + 1) * members.length) / n);
      return {
        flow: members[from]!.flow,
        hidden: members[from]!.hidden,
        threads: to - from,
        width: width(members[from]!),
      };
    });
  });
}

/**
 * The miniatures for one change, or null when the sidebar cannot be laid out
 * with it applied (a topic would hold threads beside subtopics).
 */
export function miniature(input: MiniatureInput): Miniature | null {
  try {
    return draw(input);
  } catch {
    return null;
  }
}

function draw(shown: MiniatureInput): Miniature {
  // The delta names the threads the change acts on that the sidebar does not
  // list; they are drawn, dashed, where the change touches.
  const listed = new Set(shown.threads.map((t) => t.id));
  const unlisted = shown.delta.held.filter((h) => !listed.has(h.threadId));
  const input: MiniatureInput = {
    ...shown,
    threads: [
      ...shown.threads,
      ...unlisted.map(({ threadId, title }) => ({
        id: threadId,
        title,
        sectionId: null,
        activeAt: 0,
        hidden: true,
      })),
    ],
    filing: {
      ...shown.filing,
      ...Object.fromEntries(unlisted.map((h) => [h.threadId, h.topicId])),
    },
  };
  const realSection = new Map<string, string>();
  for (const [section, topic] of Object.entries(input.colors?.groups ?? {}))
    if (!realSection.has(topic)) realSection.set(topic, section);
  // The topics a change touches, whose threads outside the sidebar are drawn.
  const touchedTopics = new Set([
    ...input.delta.touched,
    ...input.delta.removed,
    ...input.delta.topics.map((t) => t.id),
  ]);
  for (const { threadId, topicId } of input.delta.assignments) {
    const was = input.filing[threadId];
    if (was) touchedTopics.add(was);
    if (topicId) touchedTopics.add(topicId);
  }
  const now = arrange(
    input,
    input.topics,
    input.filing,
    realSection,
    input.manualOrder,
    touchedTopics,
  );
  const next = applyDelta(input.topics, input.filing, input.delta);
  const nextTopics = new Map(next.topics.map((t) => [t.id, t]));
  const nowTopics = new Map(input.topics.map((t) => [t.id, t]));

  // Under manual order a workstream the change creates sits beside the one
  // its threads come from, rather than at the bottom of the list.
  let manual = input.manualOrder;
  if (input.sort === "manual") {
    manual = [...now.order];
    const sectionAfter = (topicId: string) =>
      realSection.get(topicId) ?? sectionKey(topicId);
    /** The last workstream placed after each anchor, so new ones keep order. */
    const placed = new Map<string, string>();
    for (const thread of input.threads) {
      const to = next.filing[thread.id] ?? null;
      if (!to || !nextTopics.has(to)) continue;
      const section = sectionAfter(to);
      if (manual.includes(section)) continue;
      const parent = nextTopics.get(to)?.parentId;
      const anchor = [
        parent ? realSection.get(parent) : undefined,
        thread.sectionId ?? undefined,
      ].find((a): a is string => !!a && manual.includes(a));
      const at = anchor
        ? manual.indexOf(placed.get(anchor) ?? anchor) + 1
        : manual.length;
      manual = [...manual.slice(0, at), section, ...manual.slice(at)];
      if (anchor) placed.set(anchor, section);
    }
  }
  const after = arrange(
    input,
    next.topics,
    next.filing,
    realSection,
    manual,
    touchedTopics,
  );

  // A thread flows when its workstream or its workstream's name changes.
  // Flows run in the order of their destinations in the after state, so
  // ribbons leaving one workstream do not cross.
  const position = new Map<string, number>();
  after.nodes.forEach((node, at) => position.set(node.topicId ?? "", at));
  type Pending = {
    topic: string | null;
    label: string;
    threads: { id: string; title: string }[];
  };
  const pending = new Map<string, Pending>();
  for (const thread of input.threads) {
    const was = now.placeOf.get(thread.id);
    const will = after.placeOf.get(thread.id);
    if (!was || !will) continue;
    if (was.topic === will.topic && was.label === will.label) continue;
    const key = `${was.topic}\u0000${will.topic}\u0000${will.label}`;
    const flow = pending.get(key) ?? { ...will, threads: [] };
    flow.threads.push({ id: thread.id, title: thread.title });
    pending.set(key, flow);
  }
  const ordered = [...pending.values()].sort(
    (a, b) =>
      (position.get(a.topic ?? "") ?? 0) - (position.get(b.topic ?? "") ?? 0),
  );
  const flowOf = new Map<string, number>();
  ordered.forEach((flow, index) => {
    for (const thread of flow.threads) flowOf.set(thread.id, index);
  });
  // Colors as the sidebar would give them: the topic's own, else, for a
  // topic the change creates, one the server would allocate beside its
  // siblings from its parent's.
  const colors = input.colors?.colors ?? {};
  const taken = new Map<string, TopicColor>();
  const colorOf = (topicId: string | null): TopicColor => {
    if (!topicId) return { hue: workstreamHue(UNSORTED_ID), level: 0 };
    const own = colors[topicId] ?? taken.get(topicId);
    if (own) return own;
    const topic = nextTopics.get(topicId) ?? nowTopics.get(topicId);
    const parent = topic?.parentId ? colors[topic.parentId] : undefined;
    const color = parent
      ? allocateChildColor(
          parent,
          [...nextTopics.values()]
            .filter((t) => t.parentId === topic!.parentId)
            .flatMap((t) => {
              const c = colors[t.id] ?? taken.get(t.id);
              return c ? [c] : [];
            }),
          [...Object.values(colors), ...taken.values()],
        )
      : colorForWorkstream(sectionKey(topicId), undefined, null);
    taken.set(topicId, color);
    return color;
  };
  const flows: MiniFlow[] = ordered.map((flow, index) => ({
    index,
    color: colorOf(flow.topic),
    to: split(flow.label, flow.label.includes(": ")),
    threads: flow.threads,
  }));

  const hotNow = new Set<string>();
  const hotAfter = new Set<string>();
  for (const thread of input.threads) {
    if (!flowOf.has(thread.id)) continue;
    // Both ends are marked in both states: where threads leave, and where
    // they land.
    for (const topic of [
      now.placeOf.get(thread.id)!.topic ?? "",
      after.placeOf.get(thread.id)!.topic ?? "",
    ]) {
      hotNow.add(topic);
      hotAfter.add(topic);
    }
  }
  const title = new Map(input.threads.map((t) => [t.id, t.title]));
  const hiddenIds = new Set(
    input.threads.filter((t) => t.hidden).map((t) => t.id),
  );
  const convert = (
    node: WorkstreamNode<Synthetic>,
    hot: ReadonlySet<string>,
  ): MiniWorkstream => {
    const parts = split(node.label, node.parentTopicId !== null);
    return {
      key: node.topicId ?? UNSORTED_ID,
      prefix: parts.prefix,
      name: node.topicId === null ? UNFILED_NAME : parts.name,
      color: node.topicId === null ? null : colorOf(node.topicId),
      hot:
        hot.has(node.topicId ?? "") ||
        (node.topicId !== null && touchedTopics.has(node.topicId)),
      ticks: ticksOf(
        node.rows
          .filter((row) => !row.thread.id.startsWith("ghost:"))
          .map((row) => ({
            title: title.get(row.thread.id) ?? "",
            flow: flowOf.get(row.thread.id) ?? null,
            hidden: hiddenIds.has(row.thread.id),
          })),
      ),
      subs: node.subgroups.map((sub) => convert(sub, hot)),
    };
  };
  return {
    archived: input.delta.archived,
    now: now.nodes.map((node) => convert(node, hotNow)),
    after: after.nodes.map((node) => convert(node, hotAfter)),
    flows,
  };
}
