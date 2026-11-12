/**
 * What accepting an organizing suggestion would change, as review shows it:
 * a list of moves, each one path becoming another. Pure, so the server and
 * tests share one definition.
 *
 * A thread move goes from the topic holding its threads (null for Unfiled) to
 * the topic that would hold them, and lists them. A topic move (merge, move
 * under, rename, adopt into a new parent) goes from the topic's own path to
 * the path it would have, or for a merge to the topic it folds into; the
 * threads that come along are counted, not listed, except a merged topic's
 * own threads. A topic a suggestion creates on its own has no `from`.
 *
 * `changeDelta` states the same change as data, for drawing the sidebar after.
 */
import type { Split, TidyEdit } from "./tidy.ts";
import { assertTopicLevels, topicAncestors } from "./topics.ts";

type PathPart = {
  readonly name: string;
  /** Accepting the suggestion creates this topic. */
  readonly created: boolean;
};

/** Topic names from the top level down; empty for the top level. */
export type TopicPlace = readonly PathPart[];

export type ChangeMove = {
  /** Null for Unfiled threads, or for a topic that doesn't exist yet. */
  readonly from: TopicPlace | null;
  readonly to: TopicPlace;
  /** The threads making this move. */
  readonly threads: readonly { readonly id: string; readonly title: string }[];
  /** Further visible threads that move along with a moved topic. */
  readonly carried: number;
};

/**
 * `split` partitions a topic's threads into new subtopics; `file` moves the
 * threads a topic holds beside its subtopics into them.
 */
type ChangeOp =
  "refile" | "split" | "file" | "merge" | "reparent" | "rename" | "create";

export type SuggestionChange = {
  readonly op: ChangeOp;
  readonly moves: readonly ChangeMove[];
};

export type ChangeContext = {
  readonly topics: readonly {
    id: string;
    name: string;
    parentId: string | null;
    aliases?: readonly string[];
  }[];
  /**
   * Each filed root's topic, archived ones included; null for Unfiled. A
   * suggestion can name any of them.
   */
  readonly threadTopic: Readonly<Record<string, string | null>>;
  readonly title: (threadId: string) => string;
  /**
   * Whether a thread shows in the sidebar. The threads a merge or topic move
   * lists and counts are only these, since review describes what the user
   * sees move; archived assignments move too. Every thread, when absent.
   */
  readonly visible?: (threadId: string) => boolean;
  /**
   * Topics that waiting suggestions of the same tidy pass would create, by
   * lowercased name, so `new:` references read as their eventual paths.
   */
  readonly creates?: ReadonlyMap<
    string,
    { name: string; parent: string | null }
  >;
};

const normalize = (name: string) => name.trim().toLowerCase();

/**
 * Accepting a suggestion as data: the topics it creates, renames, moves or
 * removes, and the threads it files elsewhere, all by id. A client applies it
 * to the topics and filing it already holds (`applyDelta`) to see the tree
 * after accepting, so the server never needs to know how the client lays the
 * sidebar out.
 */
export type ChangeDelta = {
  /**
   * Topics the change creates, renames or moves, each as it would be
   * after. A topic the change creates has no id yet, so its id here starts
   * with `new:` and stands for it within this delta only.
   */
  readonly topics: readonly DeltaTopic[];
  /** Topics that no longer exist, such as a merged topic. */
  readonly removed: readonly string[];
  /**
   * Threads whose topic changes, archived and hidden ones included; null for
   * Unfiled. Only the threads a client draws matter to it.
   */
  readonly assignments: readonly {
    readonly threadId: string;
    readonly topicId: string | null;
  }[];
  /**
   * Every root filed, before the change, in a topic it touches: where a
   * thread is moving from, a topic that is renamed or merged, or a topic
   * threads arrive in. The client reads only the filing of the threads its
   * sidebar lists, so this is how it learns of the archived, hidden and
   * snoozed threads a change acts on.
   */
  readonly held: readonly {
    readonly threadId: string;
    readonly topicId: string;
  }[];
};

export type DeltaTopic = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
};

/** The id a delta gives a topic the change creates. */
export const newTopicId = (parentId: string | null, name: string) =>
  `new:${parentId ?? ""}/${normalize(name)}`;

/**
 * What accepting `body` would change, as data, or null when a topic or thread
 * it names no longer exists, it still needs a topic another suggestion
 * creates, or the result would break the two-level limit. It follows what the
 * topic store does for each kind of change, which a test holds it to.
 */
export function changeDelta(
  body: TidyEdit | Split,
  context: ChangeContext,
): ChangeDelta | null {
  try {
    return delta(body, context);
  } catch {
    return null;
  }
}

function delta(body: TidyEdit | Split, context: ChangeContext): ChangeDelta {
  const before = new Map(
    context.topics.map((t) => [
      t.id,
      { id: t.id, name: t.name, parentId: t.parentId },
    ]),
  );
  const topics = new Map<string, DeltaTopic>(before);
  const filing = new Map(Object.entries(context.threadTopic));
  const topic = (ref: string | null) => {
    if (ref === null) return null;
    const found = topics.get(ref);
    if (!found) throw new Error("That topic is gone.");
    return found;
  };
  const edit = (id: string, change: Partial<DeltaTopic>) =>
    topics.set(id, { ...topic(id)!, ...change });
  const childrenOf = (id: string) =>
    [...topics.values()].filter((t) => t.parentId === id);
  const file = (threadId: string, to: string | null) => {
    if (!filing.has(threadId)) throw new Error("That thread is gone.");
    filing.set(threadId, to);
  };

  if ("subgroups" in body) {
    const parent = topic(body.topicId)!;
    for (const group of body.subgroups) {
      // A subgroup with no threads is not created.
      if (group.threadIds.length === 0) continue;
      const aliasesOf = (id: string) =>
        context.topics.find((t) => t.id === id)?.aliases ?? [];
      const existing = childrenOf(parent.id).find(
        (child) =>
          normalize(child.name) === normalize(group.name) ||
          aliasesOf(child.id).some(
            (alias) => normalize(alias) === normalize(group.name),
          ),
      );
      const id = existing?.id ?? newTopicId(parent.id, group.name);
      if (!existing)
        topics.set(id, {
          id,
          name: group.name.trim(),
          parentId: parent.id,
        });
      for (const threadId of group.threadIds) file(threadId, id);
    }
  } else {
    switch (body.op) {
      case "move":
        topic(body.topic);
        file(body.thread, body.topic);
        break;
      case "rename":
        edit(body.topic, { name: body.name.trim() });
        break;
      case "reparent":
        topic(body.parent);
        edit(body.topic, {
          parentId: body.parent,
          ...(body.name === undefined ? {} : { name: body.name.trim() }),
        });
        break;
      case "create": {
        topic(body.parent);
        const id = newTopicId(body.parent, body.name);
        topics.set(id, { id, name: body.name.trim(), parentId: body.parent });
        for (const child of body.children) edit(child, { parentId: id });
        break;
      }
      case "merge": {
        const into = topic(body.into)!;
        const from = topic(body.from)!;
        // A target inside the source takes the source's place first.
        if (topicAncestors(into.id, [...topics.values()]).includes(from.id))
          edit(into.id, { parentId: from.parentId });
        // The merged topic's threads and subtopics join the target's; a
        // subtopic whose name the target's own subtopic has merges into it.
        const fold = (source: string, target: string) => {
          for (const [threadId, at] of filing)
            if (at === source) filing.set(threadId, target);
          for (const child of childrenOf(source)) {
            if (child.id === target) continue;
            const twin = childrenOf(target).find(
              (other) =>
                other.id !== child.id &&
                normalize(other.name) === normalize(child.name),
            );
            if (twin) fold(child.id, twin.id);
            else edit(child.id, { parentId: target });
          }
          topics.delete(source);
        };
        fold(from.id, into.id);
        break;
      }
    }
  }
  assertTopicLevels([...topics.values()]);
  const changed = [...topics.values()].filter((t) => {
    const was = before.get(t.id);
    return !was || was.name !== t.name || was.parentId !== t.parentId;
  });
  const removed = [...before.keys()].filter((id) => !topics.has(id));
  const assignments = [...filing]
    .filter(([threadId, to]) => context.threadTopic[threadId] !== to)
    .map(([threadId, topicId]) => ({ threadId, topicId }));
  const touched = new Set([
    ...changed.map((t) => t.id),
    ...removed,
    ...assignments.flatMap(({ threadId, topicId }) => [
      context.threadTopic[threadId] ?? null,
      topicId,
    ]),
  ]);
  return {
    topics: changed,
    removed,
    assignments,
    held: Object.entries(context.threadTopic)
      .filter(
        (entry): entry is [string, string] =>
          entry[1] !== null && touched.has(entry[1]),
      )
      .map(([threadId, topicId]) => ({ threadId, topicId })),
  };
}

/**
 * The topics and filing after accepting: `delta` applied to `topics` and to
 * `filing`, each root thread's topic id (null for Unfiled).
 */
export function applyDelta(
  topics: readonly DeltaTopic[],
  filing: Readonly<Record<string, string | null>>,
  change: ChangeDelta,
): { topics: DeltaTopic[]; filing: Record<string, string | null> } {
  const next = new Map(topics.map((t) => [t.id, t]));
  for (const id of change.removed) next.delete(id);
  for (const t of change.topics) next.set(t.id, t);
  const after = { ...filing };
  for (const { threadId, topicId } of change.assignments)
    after[threadId] = topicId;
  return { topics: [...next.values()], filing: after };
}

/**
 * The moves accepting `body` would make, or null when a topic or thread it
 * names no longer exists; the suggestion's problem then says why.
 */
export function suggestionChange(
  body: TidyEdit | Split,
  context: ChangeContext,
): SuggestionChange | null {
  try {
    return describe(body, context);
  } catch {
    return null;
  }
}

function describe(
  body: TidyEdit | Split,
  context: ChangeContext,
): SuggestionChange {
  const { topics, threadTopic } = context;
  const byId = new Map(topics.map((topic) => [topic.id, topic]));

  /** A topic's path; `new:` references name a topic the pass creates. */
  const place = (ref: string | null, depth = 0): TopicPlace => {
    if (ref === null) return [];
    if (!ref.startsWith("new:"))
      return topicAncestors(ref, topics)
        .reverse()
        .map((at) => ({ name: byId.get(at)!.name, created: false }));
    if (depth > 10) throw new Error("Topic references loop.");
    const name = ref.slice(4).trim();
    const create = context.creates?.get(normalize(name));
    return [
      ...(create ? place(create.parent, depth + 1) : []),
      { name: create?.name ?? name, created: true },
    ];
  };
  const thread = (id: string) => {
    if (!(id in threadTopic)) throw new Error("That thread is gone.");
    return { id, title: context.title(id) };
  };
  /** Visible threads filed in a topic or any topic below it. */
  const shown = Object.entries(threadTopic).filter(
    ([id]) => context.visible?.(id) ?? true,
  );
  const within = (ref: string) =>
    shown
      .filter(
        ([, topic]) =>
          topic !== null &&
          byId.has(topic) &&
          topicAncestors(topic, topics).includes(ref),
      )
      .map(([id]) => thread(id));
  const carry = (threads: ReturnType<typeof thread>[]) => ({
    carried: threads.length,
  });
  /** A topic moving from its own path to `to`, with its threads counted. */
  const topicMove = (ref: string, to: TopicPlace): ChangeMove => ({
    from: place(ref),
    to,
    threads: [],
    ...carry(within(ref)),
  });
  const under = (parent: TopicPlace, ref: string): TopicPlace => [
    ...parent,
    place(ref).at(-1)!,
  ];

  if ("subgroups" in body) {
    const group = place(body.topicId);
    const children = topics.filter((t) => t.parentId === body.topicId);
    const exists = (name: string) =>
      children.some(
        (child) =>
          normalize(child.name) === normalize(name) ||
          (child.aliases ?? []).some(
            (alias) => normalize(alias) === normalize(name),
          ),
      );
    return {
      op: body.repair ? "file" : "split",
      moves: body.subgroups.flatMap((subgroup) => {
        const to = [
          ...group,
          { name: subgroup.name, created: !exists(subgroup.name) },
        ];
        // A thread that left the topic since moves from where it is now,
        // and a gone one drops out; the suggestion's problem says so.
        const moves = new Map<string | null, ChangeMove>();
        for (const id of subgroup.threadIds) {
          if (!(id in threadTopic)) continue;
          const topic = threadTopic[id] ?? null;
          const move = moves.get(topic);
          moves.set(topic, {
            from: move?.from ?? (topic ? place(topic) : null),
            to,
            threads: [...(move?.threads ?? []), thread(id)],
            carried: 0,
          });
        }
        return moves.size
          ? [...moves.values()]
          : [{ from: group, to, threads: [], carried: 0 }];
      }),
    };
  }

  switch (body.op) {
    case "move": {
      const from = thread(body.thread);
      const topic = threadTopic[body.thread];
      return {
        op: "refile",
        moves: [
          {
            from: topic ? place(topic) : null,
            to: place(body.topic),
            threads: [from],
            carried: 0,
          },
        ],
      };
    }
    case "merge": {
      const into = place(body.into);
      return {
        op: "merge",
        moves: [
          {
            from: place(body.from),
            to: into,
            threads: shown
              .filter(([, topic]) => topic === body.from)
              .map(([id]) => thread(id)),
            carried: 0,
          },
          ...topics
            .filter((t) => t.parentId === body.from)
            .map((t) => topicMove(t.id, under(into, t.id))),
        ],
      };
    }
    case "reparent": {
      const to = under(place(body.parent), body.topic);
      return {
        op: "reparent",
        moves: [
          topicMove(
            body.topic,
            body.name === undefined
              ? to
              : [...to.slice(0, -1), { ...to.at(-1)!, name: body.name }],
          ),
        ],
      };
    }
    case "rename": {
      const own = place(body.topic);
      return {
        op: "rename",
        moves: [
          topicMove(body.topic, [
            ...own.slice(0, -1),
            { ...own.at(-1)!, name: body.name },
          ]),
        ],
      };
    }
    case "create": {
      const created = [
        ...place(body.parent),
        { name: body.name, created: true },
      ];
      return {
        op: "create",
        moves: body.children.length
          ? body.children.map((child) =>
              topicMove(child, under(created, child)),
            )
          : [{ from: null, to: created, threads: [], carried: 0 }],
      };
    }
  }
}

const placeText = (place: TopicPlace) =>
  place.length === 0
    ? "Top level"
    : place
        .map((part) => `${part.name}${part.created ? " (new)" : ""}`)
        .join(" › ");

/**
 * Plain lines for the CLI: each move as "from → to", its threads indented
 * below it.
 */
export function changeLines(change: SuggestionChange): string[] {
  return change.moves.flatMap((move) => [
    `${
      move.from
        ? `${placeText(move.from)} → `
        : move.threads.length
          ? "Unfiled → "
          : ""
    }${placeText(move.to)}${move.carried ? ` (with ${move.carried} ${move.carried === 1 ? "thread" : "threads"})` : ""}`,
    ...move.threads.map((t) => `  “${t.title}”`),
  ]);
}

const leaf = (place: TopicPlace) => place.at(-1)?.name ?? "the top level";
const list = (names: readonly string[]) => names.join(" and ");

/**
 * Names in a headline, which is one line: two read as themselves, and three
 * or more as their count. The drawing beside a headline shows every one of
 * them, and a list of five only wraps.
 */
const namedOrCounted = (all: readonly string[], noun: string) =>
  all.length > 2 ? `${all.length} ${noun}` : list(all);

/** Whether accepting moves any visible thread, by itself or with its group. */
export function movesThreads(change: SuggestionChange): boolean {
  return change.moves.some((m) => m.threads.length > 0 || m.carried > 0);
}

/**
 * What a suggestion does, as verb, subject, and destination: "Split
 * Automations into PR Upkeep and Design", "Move “Fix CI” to Evals", "Move
 * Workforest under bb". The destination is always named, so a list of
 * headlines reads as a list of changes; a spread of three or more
 * destinations is their count, as the drawing shows each one.
 */
export function changeHeadline(change: SuggestionChange): string {
  const [first] = change.moves;
  if (!first) return "Change groups";
  const threads = change.moves.flatMap((m) => m.threads);
  const group = leaf(first.to.slice(0, -1));
  const destinations = [...new Set(change.moves.map((m) => leaf(m.to)))];
  // A suggestion whose threads are gone since names no count.
  const count = threads.length ? `${threads.length} ` : "";
  switch (change.op) {
    case "refile":
    case "split":
    case "file":
      if (change.op === "split" && destinations.length > 1)
        return `Split ${group} into ${namedOrCounted(destinations, "workstreams")}`;
      if (destinations.length > 1)
        return `Move ${count}${group} ${threads.length === 1 ? "thread" : "threads"} into ${namedOrCounted(destinations, "workstreams")}`;
      return threads.length === 1
        ? `Move “${threads[0]!.title}” to ${destinations[0]}`
        : `Move ${count}threads to ${destinations[0]}`;
    case "merge":
      return `Merge ${leaf(first.from ?? [])} into ${leaf(first.to)}`;
    case "reparent": {
      const name = leaf(first.from ?? first.to);
      const as = name === leaf(first.to) ? "" : ` as ${leaf(first.to)}`;
      return first.to.length > 1
        ? `Move ${name} under ${group}${as}`
        : `Move ${name} to the top level${as}`;
    }
    case "rename":
      return `Rename ${leaf(first.from ?? [])} to ${leaf(first.to)}`;
    case "create":
      return first.from
        ? `Group ${namedOrCounted(
            change.moves.map((m) => leaf(m.to)),
            "topics",
          )} under a new ${group}`
        : `Create ${leaf(first.to)}${first.to.length > 1 ? ` under ${group}` : ""}`;
  }
}
