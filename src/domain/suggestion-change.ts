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
 */
import type { Split, TidyEdit } from "./tidy.ts";
import { topicAncestors } from "./topics.ts";

export type PathPart = {
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
export type ChangeOp =
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
  /** Each visible root's topic; null for Unfiled. */
  readonly threadTopic: Readonly<Record<string, string | null>>;
  readonly title: (threadId: string) => string;
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
  /** Visible threads filed in a topic or any topic below it. */
  const within = (ref: string) =>
    Object.values(threadTopic).filter(
      (topic) =>
        topic !== null &&
        byId.has(topic) &&
        topicAncestors(topic, topics).includes(ref),
    ).length;
  const thread = (id: string) => {
    if (!(id in threadTopic)) throw new Error("That thread is gone.");
    return { id, title: context.title(id) };
  };
  /** A topic moving from its own path to `to`, with its threads counted. */
  const topicMove = (ref: string, to: TopicPlace): ChangeMove => ({
    from: place(ref),
    to,
    threads: [],
    carried: within(ref),
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
            threads: Object.entries(threadTopic)
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
    case "reparent":
      return {
        op: "reparent",
        moves: [topicMove(body.topic, under(place(body.parent), body.topic))],
      };
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
const count = (n: number, noun: string) =>
  n === 0 ? `${noun}s` : `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * What a suggestion does, as a sentence of groups and threads: "Split
 * Automations into 2 subgroups", "Move Workforest under bb".
 */
export function changeHeadline(change: SuggestionChange): string {
  const [first] = change.moves;
  if (!first) return "Change groups";
  const threads = change.moves.reduce((n, m) => n + m.threads.length, 0);
  const group = leaf(first.to.slice(0, -1));
  switch (change.op) {
    case "refile":
      return `Move ${count(threads, "thread")} to ${leaf(first.to)}`;
    case "split":
      return `Split ${group} into ${count(new Set(change.moves.map((m) => leaf(m.to))).size, "subgroup")}`;
    case "file":
      return `Move ${count(threads, "thread")} in ${group} into subgroups`;
    case "merge":
      return `Merge ${leaf(first.from ?? [])} into ${leaf(first.to)}`;
    case "reparent":
      return first.to.length > 1
        ? `Move ${leaf(first.to)} under ${group}`
        : `Move ${leaf(first.to)} to the top level`;
    case "rename":
      return `Rename ${leaf(first.from ?? [])} to ${leaf(first.to)}`;
    case "create": {
      if (!first.from)
        return `Create ${leaf(first.to)}${first.to.length > 1 ? ` under ${group}` : ""}`;
      const names = change.moves.map((m) => leaf(m.to));
      return `Group ${names.length > 2 ? `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}` : names.join(" and ")} under a new ${group}`;
    }
  }
}
