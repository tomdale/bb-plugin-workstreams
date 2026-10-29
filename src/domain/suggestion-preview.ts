/**
 * How an organizing suggestion would change the sidebar: the affected groups
 * now and after accepting, each with its threads. Pure, so the server and
 * tests share one definition.
 *
 * The suggestion is applied to a copy of the topic tree (`simulate`, which
 * follows the topic store's rules, including a merge folding same-named
 * subtopics together). Groups whose threads, name, place, or existence change
 * are shown with their threads and their unchanged subgroups collapsed to a
 * count; their ancestors are shown only to place them. A suggestion that moves
 * no visible thread to a differently named group has no preview: it changes
 * only the topic tree, which decides where future threads are filed.
 */
import type { Split, TidyEdit } from "./tidy.ts";
import type { ChangeContext } from "./suggestion-change.ts";

export type PreviewThread = {
  readonly id: string;
  readonly title: string;
  /** Accepting moves it into or out of this group. */
  readonly moved: boolean;
};

export type PreviewGroup = {
  readonly name: string;
  /** Shown only to place the groups below it. */
  readonly context: boolean;
  /** Threads without a group, gathered for the preview. */
  readonly unfiled: boolean;
  /** Accepting creates it. */
  readonly created: boolean;
  /** Accepting removes it. */
  readonly removed: boolean;
  /** Accepting moves it under another group. */
  readonly moved: boolean;
  /** Its name now, when accepting renames it. */
  readonly renamedFrom: string | null;
  readonly threads: readonly PreviewThread[];
  /** Unchanged threads in it not listed. */
  readonly more: number;
  readonly groups: readonly PreviewGroup[];
  /** Unchanged subgroups with threads not listed. */
  readonly others: number;
  /** An unchanged group shown only by its visible thread count. */
  readonly collapsed: number | null;
};

export type SuggestionPreview = {
  readonly before: readonly PreviewGroup[];
  readonly after: readonly PreviewGroup[];
};

/** Unchanged threads listed in a changed group before "N more". */
const CONTEXT_THREADS = 3;
/** Unchanged subgroups listed in a changed group before "N others". */
const CONTEXT_GROUPS = 2;

type Topic = {
  id: string;
  name: string;
  parentId: string | null;
  aliases: readonly string[];
};
type Tree = {
  topics: Map<string, Topic>;
  threadTopic: Map<string, string | null>;
};

const normalize = (name: string) => name.trim().toLowerCase();

/**
 * The sidebar before and after accepting `body`, or null when no visible
 * thread would change groups, or when something it names is gone.
 */
export function suggestionPreview(
  body: TidyEdit | Split,
  context: ChangeContext,
): SuggestionPreview | null {
  const before: Tree = {
    topics: new Map(
      context.topics.map((t) => [
        t.id,
        {
          id: t.id,
          name: t.name,
          parentId: t.parentId,
          aliases: t.aliases ?? [],
        },
      ]),
    ),
    threadTopic: new Map(Object.entries(context.threadTopic)),
  };
  let after: Tree;
  try {
    after = simulate(body, before, context);
  } catch {
    return null;
  }

  const pathOf = (tree: Tree, id: string | null) => {
    const names: string[] = [];
    for (let at = id; at; at = tree.topics.get(at)?.parentId ?? null)
      names.unshift(tree.topics.get(at)?.name ?? "");
    return JSON.stringify(names);
  };
  const threads = [...before.threadTopic.keys()];
  const visible = threads.some(
    (id) =>
      pathOf(before, before.threadTopic.get(id) ?? null) !==
      pathOf(after, after.threadTopic.get(id) ?? null),
  );
  if (!visible) return null;

  const moved = new Set(
    threads.filter(
      (id) => before.threadTopic.get(id) !== after.threadTopic.get(id),
    ),
  );
  const changed = new Set<string>();
  for (const id of new Set([...before.topics.keys(), ...after.topics.keys()])) {
    const was = before.topics.get(id);
    const now = after.topics.get(id);
    if (!was || !now || was.name !== now.name || was.parentId !== now.parentId)
      changed.add(id);
  }
  for (const id of moved)
    for (const topic of [before.threadTopic.get(id), after.threadTopic.get(id)])
      if (topic) changed.add(topic);

  const render = (tree: Tree, side: "before" | "after"): PreviewGroup[] => {
    const other = side === "before" ? after : before;
    const children = (id: string | null) =>
      [...tree.topics.values()].filter((t) => t.parentId === id);
    const held = (id: string) =>
      [...tree.threadTopic]
        .filter(([, t]) => t === id)
        .map(([thread]) => thread);
    const within = (id: string): number =>
      held(id).length + children(id).reduce((n, c) => n + within(c.id), 0);
    const leads = (id: string): boolean =>
      changed.has(id) || children(id).some((c) => leads(c.id));
    const listed = (ids: string[]) => {
      const moving = ids.filter((id) => moved.has(id));
      const staying = ids.filter((id) => !moved.has(id));
      const shown = [...moving, ...staying.slice(0, CONTEXT_THREADS)];
      return {
        threads: shown.map((id) => ({
          id,
          title: context.title(id),
          moved: moved.has(id),
        })),
        more: ids.length - shown.length,
      };
    };
    const group = (topic: Topic, kind: "changed" | "context" | "collapsed") => {
      const was = other.topics.get(topic.id);
      return {
        name: topic.name,
        context: kind === "context",
        unfiled: false,
        created: side === "after" && !was,
        removed: side === "before" && !was,
        moved: !!was && was.parentId !== topic.parentId,
        renamedFrom:
          side === "after" && was && was.name !== topic.name ? was.name : null,
        ...(kind === "changed"
          ? listed(held(topic.id))
          : { threads: [], more: 0 }),
        ...(kind === "collapsed"
          ? { groups: [], others: 0 }
          : subgroups(topic.id, kind === "changed")),
        collapsed: kind === "collapsed" ? within(topic.id) : null,
      };
    };
    /**
     * The subgroups a group shows: those leading to a change, and for a
     * changed group a few unchanged ones with threads, as the sidebar would.
     */
    const subgroups = (id: string, changedGroup: boolean) => {
      const leading = children(id).filter((c) => leads(c.id));
      const quiet = changedGroup
        ? children(id).filter((c) => !leads(c.id) && within(c.id) > 0)
        : [];
      const shown = new Set([...leading, ...quiet.slice(0, CONTEXT_GROUPS)]);
      return {
        groups: children(id)
          .filter((c) => shown.has(c))
          .map((c) => node(c)),
        others: quiet.length - Math.min(quiet.length, CONTEXT_GROUPS),
      };
    };
    const node = (topic: Topic): PreviewGroup =>
      group(
        topic,
        changed.has(topic.id)
          ? "changed"
          : leads(topic.id)
            ? "context"
            : "collapsed",
      );
    const unfiled = threads.filter(
      (id) => moved.has(id) && tree.threadTopic.get(id) === null,
    );
    return [
      ...children(null)
        .filter((t) => leads(t.id))
        .map(node),
      ...(unfiled.length
        ? [
            {
              name: "Unfiled",
              context: false,
              unfiled: true,
              created: false,
              removed: false,
              moved: false,
              renamedFrom: null,
              threads: unfiled.map((id) => ({
                id,
                title: context.title(id),
                moved: true,
              })),
              more: 0,
              groups: [],
              others: 0,
              collapsed: null,
            },
          ]
        : []),
    ];
  };
  return { before: render(before, "before"), after: render(after, "after") };
}

/** A copy of `tree` with `body` applied, as the topic store would. */
function simulate(
  body: TidyEdit | Split,
  tree: Tree,
  context: ChangeContext,
): Tree {
  const topics = new Map<string, Topic>(
    [...tree.topics].map(([id, t]) => [id, { ...t }]),
  );
  const threadTopic = new Map(tree.threadTopic);
  const get = (id: string) => {
    const topic = topics.get(id);
    if (!topic) throw new Error("That topic is gone.");
    return topic;
  };
  const add = (name: string, parentId: string | null) => {
    const id = `new:${parentId ?? ""}/${normalize(name)}`;
    if (!topics.has(id))
      topics.set(id, { id, name: name.trim(), parentId, aliases: [] });
    return id;
  };
  /** A topic reference; `new:` names a topic its pass creates. */
  const ref = (value: string | null, depth = 0): string | null => {
    if (value === null) return null;
    if (!value.startsWith("new:")) return get(value).id;
    if (depth > 10) throw new Error("Topic references loop.");
    const name = value.slice(4).trim();
    const create = context.creates?.get(normalize(name));
    return add(
      create?.name ?? name,
      create ? ref(create.parent, depth + 1) : null,
    );
  };
  const children = (id: string) =>
    [...topics.values()].filter((t) => t.parentId === id);
  const file = (thread: string, topic: string | null) => {
    if (!threadTopic.has(thread)) throw new Error("That thread is gone.");
    threadTopic.set(thread, topic);
  };

  if ("subgroups" in body) {
    const group = get(body.topicId).id;
    for (const subgroup of body.subgroups) {
      const existing = children(group).find(
        (c) =>
          normalize(c.name) === normalize(subgroup.name) ||
          c.aliases.some((a) => normalize(a) === normalize(subgroup.name)),
      );
      const target = existing?.id ?? add(subgroup.name, group);
      // A thread gone since drops out; the suggestion's problem says so.
      for (const thread of subgroup.threadIds)
        if (threadTopic.has(thread)) threadTopic.set(thread, target);
    }
    return { topics, threadTopic };
  }

  switch (body.op) {
    case "move":
      file(body.thread, ref(body.topic));
      break;
    case "merge": {
      const source = get(ref(body.from)!);
      const target = get(ref(body.into)!);
      let at: string | null = target.parentId;
      for (let n = 0; at && n < 50; at = topics.get(at)?.parentId ?? null, n++)
        if (at === source.id) target.parentId = source.parentId;
      const fold = (src: Topic, dst: Topic) => {
        for (const [thread, topic] of threadTopic)
          if (topic === src.id) threadTopic.set(thread, dst.id);
        for (const child of children(src.id)) {
          if (child.id === dst.id) continue;
          const twin = children(dst.id).find(
            (c) =>
              c.id !== child.id && normalize(c.name) === normalize(child.name),
          );
          if (twin) fold(child, twin);
          else child.parentId = dst.id;
        }
        topics.delete(src.id);
      };
      fold(source, target);
      break;
    }
    case "reparent":
      get(ref(body.topic)!).parentId = ref(body.parent);
      break;
    case "rename":
      get(ref(body.topic)!).name = body.name;
      break;
    case "create": {
      const created = add(body.name, ref(body.parent));
      for (const child of body.children) get(ref(child)!).parentId = created;
      break;
    }
  }
  return { topics, threadTopic };
}
