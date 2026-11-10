/**
 * What accepting an organizing suggestion does to the sidebar, as two small
 * slices of it: the rows it touches as they are, and as they would be. The
 * sidebar's suggestions draw them side by side with an arrow between. Pure,
 * so the server and tests share one definition.
 *
 * Rows are topics, threads, or a topic's own threads as one bundle, at depth
 * 0 or 1, since topic identity has at most two levels. A row marked `gone`
 * leaves (crossed out before), one marked `new` lands, appears, or changes
 * (after); `same` rows are context. Counts are visible threads: a leaf
 * topic's own, or everything a moving topic takes along. Parents in context
 * carry no count, because a topic with subtopics holds no threads itself.
 * A landing row names the topic whose color it takes.
 */
import type { ChangeContext } from "./suggestion-change.ts";
import type { Split, TidyEdit } from "./tidy.ts";
import { UNFILED_NAME } from "./project.ts";

type Thread = { readonly id: string; readonly title: string };

export type PreviewRow = {
  readonly kind: "topic" | "thread" | "threads" | "more";
  /** The topic's name or thread's title; empty for a bundle or "more" row. */
  readonly name: string;
  readonly depth: 0 | 1;
  readonly mark: "same" | "gone" | "new";
  /** Visible threads it holds or takes along; absent for a parent. */
  readonly count?: number;
  /** Accepting creates this topic. */
  readonly created?: boolean;
  /** The parent's name, for a nested topic drawn without its parent. */
  readonly within?: string;
  /** The threads that arrive in this row's topic, for listing on request. */
  readonly arriving?: readonly Thread[];
  /**
   * The topic whose color the row takes when it lands: its own, a created
   * topic's nearest existing parent, or a moving thread's destination.
   */
  readonly colorTopicId?: string;
};

export type SuggestionPreview = {
  readonly before: readonly PreviewRow[];
  readonly after: readonly PreviewRow[];
};

/** Context siblings drawn beside a created topic before the rest fold. */
const SIBLINGS_SHOWN = 2;

const normalize = (name: string) => name.trim().toLowerCase();

/**
 * The two slices for `body`, or null when a topic or thread it names no
 * longer exists; the suggestion's problem then says why.
 */
export function suggestionPreview(
  body: TidyEdit | Split,
  context: ChangeContext,
): SuggestionPreview | null {
  try {
    return describe(body, context);
  } catch {
    return null;
  }
}

/** A topic, or one a suggestion of the same pass would create. */
type Node = {
  readonly id: string | null;
  readonly name: string;
  readonly created: boolean;
  readonly parent: Node | null;
};

function describe(
  body: TidyEdit | Split,
  context: ChangeContext,
): SuggestionPreview {
  const { topics, threadTopic } = context;
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const shown = Object.entries(threadTopic).filter(
    ([id]) => context.visible?.(id) ?? true,
  );
  const thread = (id: string): Thread => {
    if (!(id in threadTopic)) throw new Error("That thread is gone.");
    return { id, title: context.title(id) };
  };
  const node = (ref: string | null, depth = 0): Node | null => {
    if (ref === null) return null;
    if (ref.startsWith("new:")) {
      if (depth > 10) throw new Error("Topic references loop.");
      const name = ref.slice(4).trim();
      const create = context.creates?.get(normalize(name));
      return {
        id: null,
        name: create?.name ?? name,
        created: true,
        parent: node(create?.parent ?? null, depth + 1),
      };
    }
    const topic = byId.get(ref);
    if (!topic) throw new Error("That topic is gone.");
    return {
      id: topic.id,
      name: topic.name,
      created: false,
      parent: node(topic.parentId, depth + 1),
    };
  };
  const children = (id: string | null) =>
    id === null ? [] : topics.filter((topic) => topic.parentId === id);
  /** Visible threads filed in the topic itself. */
  const own = (id: string | null) =>
    id === null
      ? []
      : shown.filter(([, topic]) => topic === id).map(([tid]) => thread(tid));
  /** Visible threads in the topic and every topic below it. */
  const all = (id: string | null): Thread[] =>
    id === null
      ? []
      : [...own(id), ...children(id).flatMap((child) => all(child.id))];
  /** Its own threads for a leaf; nothing for a parent. */
  const leafCount = (n: Node) =>
    n.id === null ? 0 : children(n.id).length ? undefined : own(n.id).length;
  /** The nearest existing topic at or above `n`, for its color. */
  const colorOf = (n: Node | null): { colorTopicId?: string } => {
    for (let at = n; at; at = at.parent)
      if (at.id) return { colorTopicId: at.id };
    return {};
  };
  const topicRow = (
    n: Node,
    depth: 0 | 1,
    mark: PreviewRow["mark"],
    extra: Partial<PreviewRow> = {},
  ): PreviewRow => ({
    kind: "topic",
    name: n.name,
    depth,
    mark,
    ...colorOf(n),
    ...(n.created ? { created: true } : {}),
    ...(depth === 0 && n.parent ? { within: n.parent.name } : {}),
    ...extra,
  });
  /** A context row; its count, when it is a leaf. */
  const context0 = (n: Node, depth: 0 | 1 = 0): PreviewRow => {
    const count = leafCount(n);
    return topicRow(n, depth, "same", count === undefined ? {} : { count });
  };
  const counted = (threads: readonly Thread[]) => ({ count: threads.length });
  const landing = (threads: readonly Thread[]) =>
    threads.length ? { arriving: threads } : {};

  if ("subgroups" in body) {
    const group = node(body.topicId)!;
    const existing = children(body.topicId);
    const named = (name: string) =>
      existing.find(
        (child) =>
          normalize(child.name) === normalize(name) ||
          (child.aliases ?? []).some(
            (alias) => normalize(alias) === normalize(name),
          ),
      );
    const arriving = new Map<string, Thread[]>();
    const fresh: string[] = [];
    for (const subgroup of body.subgroups) {
      const target = named(subgroup.name);
      const key = target?.id ?? `new:${normalize(subgroup.name)}`;
      if (!target && !fresh.includes(subgroup.name)) fresh.push(subgroup.name);
      arriving.set(key, [
        ...(arriving.get(key) ?? []),
        ...subgroup.threadIds
          .filter((id) => id in threadTopic && (context.visible?.(id) ?? true))
          .map(thread),
      ]);
    }
    const loose = own(body.topicId);
    const before: PreviewRow[] = existing.length
      ? [
          topicRow(group, 0, "same"),
          ...(loose.length
            ? [
                {
                  kind: "threads" as const,
                  name: "",
                  depth: 1 as const,
                  mark: "gone" as const,
                  count: loose.length,
                },
              ]
            : []),
          ...existing.map((child) => context0(node(child.id)!, 1)),
        ]
      : [topicRow(group, 0, "same", counted(loose))];
    const after: PreviewRow[] = [
      topicRow(group, 0, "same"),
      ...existing.map((child) => {
        const landed = arriving.get(child.id) ?? [];
        const count = leafCount(node(child.id)!);
        return topicRow(node(child.id)!, 1, landed.length ? "new" : "same", {
          ...(count === undefined ? {} : { count: count + landed.length }),
          ...landing(landed),
        });
      }),
      ...fresh.map((name) => {
        const landed = arriving.get(`new:${normalize(name)}`) ?? [];
        return topicRow(
          { id: null, name, created: true, parent: group },
          1,
          "new",
          { ...counted(landed), ...landing(landed) },
        );
      }),
    ];
    return { before, after };
  }

  switch (body.op) {
    case "rename": {
      const topic = node(body.topic)!;
      const count = leafCount(topic);
      const counts = count === undefined ? {} : { count };
      const renamed: Node = { ...topic, name: body.name };
      return topic.parent
        ? {
            before: [
              context0(topic.parent),
              topicRow(topic, 1, "gone", counts),
            ],
            after: [
              context0(topic.parent),
              topicRow(renamed, 1, "new", counts),
            ],
          }
        : {
            before: [topicRow(topic, 0, "gone", counts)],
            after: [topicRow(renamed, 0, "new", counts)],
          };
    }
    case "reparent": {
      const topic = node(body.topic)!;
      const from = topic.parent;
      const to = node(body.parent);
      const moving = all(topic.id);
      const moved: Node = {
        ...topic,
        name: body.name ?? topic.name,
        parent: to,
      };
      const before: PreviewRow[] = [
        ...(to && to.id !== from?.id ? [context0(to)] : []),
        ...(from
          ? [context0(from), topicRow(topic, 1, "gone", counted(moving))]
          : [topicRow(topic, 0, "gone", counted(moving))]),
      ];
      const after: PreviewRow[] = to
        ? [
            context0(to),
            topicRow(moved, 1, "new", {
              ...counted(moving),
              ...landing(moving),
            }),
          ]
        : [
            ...(from ? [context0(from)] : []),
            topicRow(moved, 0, "new", {
              ...counted(moving),
              ...landing(moving),
            }),
          ];
      return { before, after };
    }
    case "merge": {
      const from = node(body.from)!;
      const into = node(body.into)!;
      const subtopics = children(body.from);
      const arriving = own(body.from);
      const intoCount = leafCount(into);
      return {
        before: [
          context0(into),
          topicRow(from, 0, "gone", counted(all(body.from))),
          ...subtopics.map((child) => context0(node(child.id)!, 1)),
        ],
        after: [
          topicRow(into, 0, "new", {
            ...(intoCount === undefined
              ? {}
              : { count: intoCount + arriving.length }),
            ...landing(arriving),
          }),
          ...subtopics.map((child) => {
            const landed = all(child.id);
            return topicRow({ ...node(child.id)!, parent: into }, 1, "new", {
              ...counted(landed),
              ...landing(landed),
            });
          }),
        ],
      };
    }
    case "create": {
      const parent = node(body.parent);
      const made: Node = {
        id: null,
        name: body.name,
        created: true,
        parent,
      };
      if (body.children.length) {
        const adopted = body.children.map((ref) => node(ref)!);
        return {
          before: adopted.map((child) => {
            const count = all(child.id).length;
            return topicRow(child, 0, "same", { count });
          }),
          after: [
            topicRow(made, 0, "new"),
            ...adopted.map((child) => {
              const landed = all(child.id);
              return topicRow({ ...child, parent: made }, 1, "new", {
                ...counted(landed),
                ...landing(landed),
              });
            }),
          ],
        };
      }
      if (!parent) return { before: [], after: [topicRow(made, 0, "new")] };
      const siblings = children(parent.id);
      const slice: PreviewRow[] = [
        context0(parent),
        ...siblings
          .slice(0, SIBLINGS_SHOWN)
          .map((child) => context0(node(child.id)!, 1)),
        ...(siblings.length > SIBLINGS_SHOWN
          ? [
              {
                kind: "more" as const,
                name: "",
                depth: 1 as const,
                mark: "same" as const,
                count: siblings.length - SIBLINGS_SHOWN,
              },
            ]
          : []),
      ];
      return {
        before: slice,
        after: [...slice, topicRow(made, 1, "new")],
      };
    }
    case "move": {
      const moving = thread(body.thread);
      const fromId = threadTopic[body.thread] ?? null;
      const from = node(fromId);
      const to = node(body.topic)!;
      const threadRow = (mark: PreviewRow["mark"]): PreviewRow => ({
        kind: "thread",
        name: moving.title,
        depth: 1,
        mark,
        ...(mark === "new" ? colorOf(to) : {}),
      });
      return {
        before: [
          from
            ? topicRow(from, 0, "same")
            : { kind: "topic", name: UNFILED_NAME, depth: 0, mark: "same" },
          threadRow("gone"),
        ],
        after: [topicRow(to, 0, "same"), threadRow("new")],
      };
    }
  }
}
