/**
 * What accepting an organizing suggestion would change, as review shows it:
 * each thread or topic that moves, where it sits now, and where it would sit.
 * Pure, so the server and tests share one definition.
 *
 * Every row names a thread or topic and the topic that holds it before and
 * after, so a row reads "this item, where it is, where it goes". A thread
 * outside any topic is Unfiled (null); a topic at the top level sits in the
 * empty path; a merged topic goes to the topic it merges into. A rename is the
 * exception: its row shows the topic's own path before and after. Threads
 * that move only because their topic moves are counted on the topic's row,
 * not listed.
 */
import type { Split, TidyEdit } from "./tidy.ts";
import { topicAncestors } from "./topics.ts";

export type PathPart = {
  readonly name: string;
  /** Accepting the suggestion creates this topic. */
  readonly created: boolean;
};

/** Topic names from the top level down. */
export type TopicPlace = readonly PathPart[];

export type ChangeRow =
  | {
      readonly kind: "thread";
      readonly id: string;
      readonly title: string;
      /** The topic holding it now; null for Unfiled. */
      readonly from: TopicPlace | null;
      readonly to: TopicPlace;
    }
  | {
      readonly kind: "topic";
      readonly name: string;
      /** Accepting the suggestion creates it. */
      readonly created: boolean;
      /** The topic holding it now; null when it doesn't exist yet. */
      readonly from: TopicPlace | null;
      /** The topic holding it after, or that a merge folds it into. */
      readonly to: TopicPlace;
      /** Visible threads that move with it. */
      readonly threads: number;
    };

/**
 * `split` partitions a topic's threads into new subtopics; `file` moves the
 * threads a topic holds beside its subtopics into them.
 */
export type ChangeOp =
  "refile" | "split" | "file" | "merge" | "reparent" | "rename" | "create";

export type SuggestionChange = {
  readonly op: ChangeOp;
  readonly rows: readonly ChangeRow[];
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
 * The rows accepting `body` would change, or null when a topic or thread it
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

  const path = (id: string): TopicPlace =>
    topicAncestors(id, topics)
      .reverse()
      .map((at) => ({ name: byId.get(at)!.name, created: false }));
  /** A topic reference, which may name a topic its pass creates. */
  const place = (ref: string | null, depth = 0): TopicPlace => {
    if (ref === null) return [];
    if (!ref.startsWith("new:")) return path(ref);
    const name = ref.slice(4).trim();
    const create = context.creates?.get(normalize(name));
    if (depth > 10) throw new Error("Topic references loop.");
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

  /** The topic holding a topic. */
  const parent = (ref: string): TopicPlace => place(ref).slice(0, -1);
  const topic = (
    ref: string,
    from: TopicPlace | null,
    to: TopicPlace,
    threads = within(ref),
  ): ChangeRow => {
    const own = place(ref).at(-1)!;
    return {
      kind: "topic",
      name: own.name,
      created: own.created,
      from,
      to,
      threads,
    };
  };
  const thread = (id: string, to: TopicPlace): ChangeRow => {
    if (!(id in threadTopic)) throw new Error("That thread is gone.");
    const topic = threadTopic[id];
    return {
      kind: "thread",
      id,
      title: context.title(id),
      from: topic ? path(topic) : null,
      to,
    };
  };
  if ("subgroups" in body) {
    const group = path(body.topicId);
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
      rows: body.subgroups.flatMap((subgroup) => {
        const to = [
          ...group,
          { name: subgroup.name, created: !exists(subgroup.name) },
        ];
        return subgroup.threadIds.map((id) => thread(id, to));
      }),
    };
  }

  switch (body.op) {
    case "move":
      return {
        op: "refile",
        rows: [thread(body.thread, place(body.topic))],
      };
    case "merge": {
      const into = place(body.into);
      const own = Object.values(threadTopic).filter((t) => t === body.from);
      return {
        op: "merge",
        // Its subtopics' threads are counted on their own rows.
        rows: [
          topic(body.from, parent(body.from), into, own.length),
          ...topics
            .filter((t) => t.parentId === body.from)
            .map((t) => topic(t.id, place(body.from), into)),
        ],
      };
    }
    case "reparent":
      return {
        op: "reparent",
        rows: [topic(body.topic, parent(body.topic), place(body.parent))],
      };
    case "rename": {
      const own = place(body.topic);
      return {
        op: "rename",
        rows: [
          topic(body.topic, own, [
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
        rows: body.children.length
          ? body.children.map((child) => topic(child, parent(child), created))
          : [
              {
                kind: "topic",
                name: body.name,
                created: true,
                from: null,
                to: place(body.parent),
                threads: 0,
              },
            ],
      };
    }
  }
}

const placeText = (place: TopicPlace | null, unplaced: string) =>
  place === null
    ? unplaced
    : place.length === 0
      ? "Top level"
      : place
          .map((part) => `${part.name}${part.created ? " (new)" : ""}`)
          .join(" › ");

/** One plain line per row, for the CLI: "item: from → to". */
export function changeLines(change: SuggestionChange): string[] {
  return change.rows.map((row) =>
    row.kind === "thread"
      ? `“${row.title}”: ${placeText(row.from, "Unfiled")} → ${placeText(row.to, "Unfiled")}`
      : `Topic ${row.name}${row.created ? " (new)" : ""}${row.threads ? ` (${row.threads} ${row.threads === 1 ? "thread" : "threads"})` : ""}: ${placeText(row.from, "—")} → ${placeText(row.to, "—")}`,
  );
}
