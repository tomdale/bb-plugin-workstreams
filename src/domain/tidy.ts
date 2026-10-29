/**
 * Organizing suggestions: the two calls that propose changes to the topic
 * tree, their prompts, schemas, and parsers, and the partition rule's guards.
 * Pure, so the server, trace replays, and tests share one definition.
 *
 * - A split partitions a busy topic without subtopics into subgroups, every
 *   thread in exactly one (docs/organization.md). The same call repairs a
 *   topic that holds threads beside subtopics, filing each of its threads in
 *   a subgroup.
 * - A tidy pass proposes at most `TIDY_EDITS_MAX` edits that make the tree a
 *   clean, stable map of the work, each with a reason. It sees the
 *   decisions you made by hand and the suggestions you declined, so it
 *   doesn't reopen them.
 *
 * Nothing here changes anything: suggestions apply only when accepted.
 * Topics appear in prompts by slugs of their names (`fork-core`) and threads
 * by short IDs (`r1`), mapped back from the same input.
 */
import { z } from "zod";
import { HEADER, redact, stripFence, tagged } from "./analysis.ts";
import { placementIds } from "./placement.ts";
import { takesThreads, topicAncestors } from "./topics.ts";
import { SPLIT_ABOVE } from "./layout.ts";

export const TIDY_EDITS_MAX = 8;
/** A split makes at most this many subgroups. */
export const SUBGROUPS_MAX = 5;

export type TidyTopic = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentId: string | null;
  readonly aliases: readonly string[];
};

/** A thread as suggestions see it. */
export type SuggestThread = {
  readonly id: string;
  readonly title: string;
  readonly checkout: string | null;
  /** Its topic; null for Unfiled. */
  readonly topicId: string | null;
};

/** A topic created earlier in the same pass, referenced by name. */
export type NewRef = `new:${string}`;
export type TopicRef = string;

export type TidyEdit =
  | { op: "merge"; from: TopicRef; into: TopicRef }
  | { op: "reparent"; topic: TopicRef; parent: TopicRef | null }
  | { op: "rename"; topic: TopicRef; name: string }
  | {
      op: "create";
      name: string;
      description: string;
      parent: TopicRef | null;
      children: TopicRef[];
    }
  | { op: "move"; thread: string; topic: TopicRef };

export type Split = {
  readonly topicId: string;
  /** It files the threads of a topic that holds them beside subtopics. */
  readonly repair?: boolean;
  readonly subgroups: readonly {
    readonly name: string;
    readonly description: string;
    readonly threadIds: readonly string[];
  }[];
};

const isNew = (ref: string | null): ref is NewRef =>
  typeof ref === "string" && ref.startsWith("new:");

const line = (value: string, max: number) =>
  redact(value).replace(/\s+/g, " ").trim().slice(0, max);

const validName = (name: string) => {
  const clean = name.trim();
  return clean.length > 0 && clean.length <= 80 && !clean.includes(":");
};

/** Visible threads filed directly in each topic. */
export type Held = Readonly<Record<string, number>>;

function treeBlock(
  topics: readonly TidyTopic[],
  held: Held,
  ids: Map<string, string>,
): string {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const depth = (id: string) => {
    let n = 0;
    for (
      let at = byId.get(id)?.parentId ?? null;
      at && byId.has(at) && n < 20;
      at = byId.get(at)!.parentId
    )
      n++;
    return n;
  };
  const parents = new Set(topics.map((topic) => topic.parentId));
  const rows = [...ids].map(([id, short]) => {
    const topic = byId.get(id)!;
    const description = line(topic.description ?? "", 200);
    const count = held[id] ?? 0;
    const facts = [
      parents.has(id)
        ? count > 0
          ? `has subtopics and ${count} ${count === 1 ? "thread" : "threads"} beside them`
          : "has subtopics"
        : `${count} ${count === 1 ? "thread" : "threads"}`,
      topic.aliases.length
        ? `aliases: ${topic.aliases.map((a) => line(a, 60)).join(", ")}`
        : null,
    ].filter(Boolean);
    return `${"  ".repeat(depth(id))}- [${short}] ${line(topic.name, 80)}${description ? ` — ${description}` : ""} (${facts.join("; ")})`;
  });
  return rows.length ? rows.join("\n") : "(no topics yet)";
}

const threadLine = (short: string, thread: SuggestThread) =>
  `- [${short}] ${line(thread.title, 90)}${thread.checkout ? ` (checkout ${line(thread.checkout, 80)})` : ""}`;

const memoryBlocks = (
  decisions: readonly string[],
  declined: readonly string[],
) =>
  [
    decisions.length
      ? `Decisions the user made by hand; keep them and build on them:\n${tagged("decisions", decisions.map((d) => `- ${line(d, 200)}`).join("\n"))}`
      : null,
    declined.length
      ? `Suggestions the user declined; don't propose them again, or anything that undoes the decisions above, unless the threads involved have changed:\n${tagged("declined", declined.map((d) => `- ${line(d, 200)}`).join("\n"))}`
      : null,
  ].filter(Boolean);

// Split -------------------------------------------------------------------

export type SplitInput = {
  readonly topics: readonly TidyTopic[];
  readonly held: Held;
  /** The topic to split, or to repair when it has subtopics already. */
  readonly topicId: string;
  readonly threads: readonly SuggestThread[];
  readonly decisions: readonly string[];
};

export const SUBGROUP_RULES = `Subgroups are the simplest, clearest groups a person would name without effort, each named for an area of work, never a task, pull request, bug, or repository. Clarity beats symmetry: a plain "PR Upkeep" beside "Alert Investigations" is better than a contrived name invented to keep siblings alike, and an "X & Y" name is usually a sign of contrivance. Put work about the whole group in a plainly named subgroup such as "Planning", never a catch-all like "General" or "Other". Prefer at least 2 threads per subgroup; keep a one-thread subgroup only for a genuinely distinct area. Name subgroups in Title Case, keeping product names' own spelling, and don't repeat the group's name in them ("Design", not "Automations Design"). Judge each thread by what it is about.`;

/** The group's subtopics a thread can be filed in: those without subtopics. */
const fileable = (input: Pick<SplitInput, "topics" | "topicId">) =>
  input.topics.filter(
    (t) => t.parentId === input.topicId && takesThreads(t.id, input.topics),
  );

const threadIds = (threads: readonly { id: string }[]) =>
  new Map(threads.map((thread, i) => [thread.id, `r${i + 1}`]));

export function splitPrompt(input: SplitInput): string {
  const ids = placementIds(input.topics);
  const rIds = threadIds(input.threads);
  const group = input.topics.find((t) => t.id === input.topicId)!;
  const path = topicAncestors(input.topicId, input.topics)
    .reverse()
    .map((id) => input.topics.find((t) => t.id === id)!.name)
    .join(" › ");
  const repair = input.topics.some((t) => t.parentId === input.topicId);
  const existing = fileable(input);
  const intro = repair
    ? `This group of agent threads holds threads beside its subgroups, and a group holds threads or subgroups, never both. File each of its own threads below in one of its subgroups${existing.length ? ` (${existing.map((t) => `"${line(t.name, 60)}"`).join(", ")})` : ""}, using a subgroup's exact name, or in a new subgroup when none fits. ${SUBGROUP_RULES}`
    : `This group of agent threads has grown past ${SPLIT_ABOVE} threads, so it is splitting into subgroups. Every thread must go into exactly one subgroup; none stays in the group itself. Propose 2–${SUBGROUPS_MAX} subgroups. ${SUBGROUP_RULES}`;
  return `${HEADER}

You organize someone's agent threads in a sidebar.

${intro}

The whole topic tree, for context:
${tagged("topic_tree", treeBlock(input.topics, input.held, ids))}

The group:
${tagged("group", `${line(path, 200)}${group.description ? ` — ${line(group.description, 300)}` : ""}`)}

Its threads:
${tagged("threads", input.threads.map((t) => threadLine(rIds.get(t.id)!, t)).join("\n"))}
${memoryBlocks(input.decisions, []).join("\n\n")}

Return {"reason": string, "subgroups": [{"name": string, "description": string}], "threads": [{"id": string, "subgroup": string}]}:
- reason: one sentence the user reads before accepting, saying what the subgroups separate.
- subgroups: ${repair ? "the subgroups the threads go into: existing ones by their exact names, and any new ones" : "the new subgroups"}, each with a one-sentence description of its scope.
- threads: every thread ID above exactly once, with the name of its subgroup.`;
}

export function splitSchema(input: SplitInput): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reason: { type: "string" },
      subgroups: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            description: { type: "string" },
          },
          required: ["name", "description"],
        },
      },
      threads: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: {
              type: "string",
              enum: [...threadIds(input.threads).values()],
            },
            subgroup: { type: "string" },
          },
          required: ["id", "subgroup"],
        },
      },
    },
    required: ["reason", "subgroups", "threads"],
  };
}

const splitOutput = z.object({
  reason: z.string().trim().max(300).catch(""),
  subgroups: z.array(
    z.object({
      name: z.string().trim(),
      description: z.string().trim().max(300).catch(""),
    }),
  ),
  threads: z.array(z.object({ id: z.string(), subgroup: z.string().trim() })),
});

export type SplitOutput = { split: Split; reason: string };

/**
 * Checks a split against the threads it was asked about: every thread in
 * exactly one named subgroup, and, for a fresh split, at least two subgroups
 * in use. Throws on an answer that breaks either.
 */
export function parseSplit(text: string, input: SplitInput): SplitOutput {
  const parsed = splitOutput.parse(JSON.parse(stripFence(text)));
  const byShort = new Map(
    [...threadIds(input.threads)].map(([id, short]) => [short, id]),
  );
  const existing = fileable(input).map((t) => t.name);
  const names = new Map<string, { name: string; description: string }>();
  for (const group of parsed.subgroups) {
    if (!validName(group.name))
      throw new Error(`Unsupported subgroup name: ${group.name}`);
    const key = group.name.toLowerCase();
    if (!names.has(key)) names.set(key, group);
  }
  for (const name of existing)
    if (!names.has(name.toLowerCase()))
      names.set(name.toLowerCase(), { name, description: "" });
  const members = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const { id, subgroup } of parsed.threads) {
    const threadId = byShort.get(id);
    const key = subgroup.toLowerCase();
    if (!threadId || seen.has(threadId) || !names.has(key))
      throw new Error("The split must file each thread in one named subgroup.");
    seen.add(threadId);
    members.set(key, [...(members.get(key) ?? []), threadId]);
  }
  if (seen.size !== input.threads.length)
    throw new Error("The split left a thread out.");
  const subgroups = [...members].map(([key, ids]) => ({
    name: names.get(key)!.name,
    description: names.get(key)!.description,
    threadIds: ids,
  }));
  const repair = input.topics.some((t) => t.parentId === input.topicId);
  if (!repair && subgroups.length < 2)
    throw new Error("A split needs at least two subgroups.");
  if (subgroups.length > SUBGROUPS_MAX + existing.length)
    throw new Error("The split made too many subgroups.");
  return {
    split: { topicId: input.topicId, ...(repair ? { repair } : {}), subgroups },
    reason: parsed.reason,
  };
}

// Tidy --------------------------------------------------------------------

export type TidyInput = {
  readonly topics: readonly TidyTopic[];
  readonly held: Held;
  readonly threads: readonly SuggestThread[];
  /** Checkouts that coordinate work in other repositories. */
  readonly coordination: readonly string[];
  readonly decisions: readonly string[];
  readonly declined: readonly string[];
};

export const TIDY_RULES = `You maintain the topic tree that groups someone's agent threads in a sidebar. Propose at most ${TIDY_EDITS_MAX} edits that make the tree a clean, stable map of their work, or none when it is already clean. Each edit is shown to the user with your reason, so make each one worth a click.

Good trees: top-level topics are contexts (an employer, a personal toolbox, personal life) once there is evidence for at least two; below them, products or areas; below those, capabilities. Names are areas, never tasks, questions, pull requests, or bugs. One home per area: merge duplicates and near-duplicates. A topic that belongs to a larger product goes under it. Topics side by side that are parts of one larger product or area get a new parent: create it, listing them as children. Refile threads that sit under the wrong product. A repository or workspace used to route or coordinate work is not a product. Name topics in Title Case, keeping product names' own spelling.

A topic holds threads or subtopics, never both: never move a topic under one that holds threads, never refile a thread into a topic with subtopics, and never merge a topic that holds threads with one that has subtopics. Busy topics split into subgroups on their own, so don't propose splits.

Edits:
- merge {from, into}: move every thread and subtopic of \`from\` into \`into\` and delete \`from\`
- reparent {topic, parent}: move a topic under another; parent null makes it top-level
- rename {topic, name}
- create {name, description, parent, children}: a new topic, adopting existing topics as its children
- move {thread, topic}: refile one thread
Refer to topics and threads by their IDs in square brackets. A topic created earlier in the same list can be referenced as "new:<name>".`;

export function tidyPrompt(input: TidyInput): string {
  const ids = placementIds(input.topics);
  const rIds = threadIds(input.threads);
  const byTopic = new Map<string | null, SuggestThread[]>();
  for (const thread of input.threads)
    byTopic.set(thread.topicId, [
      ...(byTopic.get(thread.topicId) ?? []),
      thread,
    ]);
  const listed = [...ids]
    .filter(([id]) => byTopic.has(id))
    .map(([id, short]) => {
      const threads = byTopic.get(id)!;
      const shown = threads.slice(0, 12);
      return `[${short}] ${line(input.topics.find((t) => t.id === id)!.name, 80)}:\n${shown.map((t) => threadLine(rIds.get(t.id)!, t)).join("\n")}${threads.length > shown.length ? `\n(+${threads.length - shown.length} more)` : ""}`;
    });
  const unfiled = byTopic.get(null) ?? [];
  if (unfiled.length)
    listed.push(
      `Unfiled:\n${unfiled
        .slice(0, 12)
        .map((t) => threadLine(rIds.get(t.id)!, t))
        .join("\n")}`,
    );
  const sections = [
    `The tree, where indentation expresses parentage:\n${tagged("topic_tree", treeBlock(input.topics, input.held, ids))}`,
    `Threads by topic:\n${tagged("threads", listed.join("\n\n") || "(none)")}`,
    input.coordination.length
      ? `These checkouts coordinate work in other repositories, so a topic named after one isn't an area:\n${tagged("coordination", input.coordination.map((c) => `- ${line(c, 120)}`).join("\n"))}`
      : null,
    ...memoryBlocks(input.decisions, input.declined),
  ].filter(Boolean);
  return `${HEADER}

${TIDY_RULES}

${sections.join("\n\n")}

Return {"edits": [...]} where each edit is {"op", "reason", "from", "into", "topic", "parent", "name", "description", "children", "thread"} and unused fields are null. reason is one sentence the user reads before accepting.`;
}

const OPS = ["merge", "reparent", "rename", "create", "move"] as const;

export function tidySchema(): Record<string, unknown> {
  const ref = { type: ["string", "null"] };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            op: { type: "string", enum: [...OPS] },
            reason: { type: "string" },
            from: ref,
            into: ref,
            topic: ref,
            parent: ref,
            name: ref,
            description: ref,
            children: { type: ["array", "null"], items: { type: "string" } },
            thread: ref,
          },
          required: [
            "op",
            "reason",
            "from",
            "into",
            "topic",
            "parent",
            "name",
            "description",
            "children",
            "thread",
          ],
        },
      },
    },
    required: ["edits"],
  };
}

const rawEdit = z.object({
  op: z.enum(OPS),
  reason: z.string().trim().max(300).catch(""),
  from: z.string().nullish(),
  into: z.string().nullish(),
  topic: z.string().nullish(),
  parent: z.string().nullish(),
  name: z.string().trim().nullish(),
  description: z.string().trim().max(300).nullish(),
  children: z.array(z.string()).nullish(),
  thread: z.string().nullish(),
});

export type ProposedEdit = { edit: TidyEdit; reason: string };

/**
 * Maps a tidy answer back to topic and thread IDs, keeping each edit that
 * names what it needs and dropping the rest; at most `TIDY_EDITS_MAX`.
 */
export function parseTidy(text: string, input: TidyInput): ProposedEdit[] {
  const parsed = z
    .object({ edits: z.array(z.unknown()) })
    .parse(JSON.parse(stripFence(text)));
  const topicOf = new Map(
    [...placementIds(input.topics)].map(([id, short]) => [short, id]),
  );
  const threadOf = new Map(
    [...threadIds(input.threads)].map(([id, short]) => [short, id]),
  );
  const created = new Set<string>();
  /** A topic: a short ID, or a topic created earlier in this answer. */
  const ref = (value: string | null | undefined): string | null | undefined => {
    if (value === null || value === undefined) return value;
    if (isNew(value))
      return created.has(value.slice(4).trim().toLowerCase())
        ? `new:${value.slice(4).trim()}`
        : undefined;
    return topicOf.get(value);
  };
  const out: ProposedEdit[] = [];
  for (const item of parsed.edits) {
    const result = rawEdit.safeParse(item);
    if (!result.success) continue;
    const e = result.data;
    let edit: TidyEdit | null = null;
    if (e.op === "merge") {
      const from = ref(e.from);
      const into = ref(e.into);
      if (from && into && from !== into) edit = { op: "merge", from, into };
    } else if (e.op === "reparent") {
      const topic = ref(e.topic);
      const parent =
        e.parent === null || e.parent === undefined ? null : ref(e.parent);
      if (topic && parent !== undefined && topic !== parent)
        edit = { op: "reparent", topic, parent };
    } else if (e.op === "rename") {
      const topic = ref(e.topic);
      if (topic && e.name && validName(e.name))
        edit = { op: "rename", topic, name: e.name };
    } else if (e.op === "create") {
      const parent =
        e.parent === null || e.parent === undefined ? null : ref(e.parent);
      const children = (e.children ?? []).map(ref);
      if (
        e.name &&
        validName(e.name) &&
        parent !== undefined &&
        children.every((child): child is string => typeof child === "string")
      ) {
        created.add(e.name.toLowerCase());
        edit = {
          op: "create",
          name: e.name,
          description: e.description ?? "",
          parent,
          children: children as string[],
        };
      }
    } else {
      const thread = e.thread ? threadOf.get(e.thread) : undefined;
      const topic = ref(e.topic);
      if (thread && topic) edit = { op: "move", thread, topic };
    }
    if (edit) out.push({ edit, reason: e.reason });
    if (out.length === TIDY_EDITS_MAX) break;
  }
  return out;
}

// Guards ------------------------------------------------------------------

/** The tree an edit is checked against. */
export type TreeState = {
  readonly topics: readonly {
    id: string;
    name: string;
    parentId: string | null;
  }[];
  readonly held: Held;
  /** Each thread's topic. */
  readonly threadTopic: Readonly<Record<string, string | null>>;
};

/**
 * Why an edit can't apply to `state`, or null when it can. Topics created
 * earlier in the pass (`new:` references) can't be checked until they exist.
 */
export function refusal(edit: TidyEdit, state: TreeState): string | null {
  const byId = new Map(state.topics.map((t) => [t.id, t]));
  const exists = (ref: string | null) =>
    ref === null || isNew(ref) || byId.has(ref);
  const hasKids = (id: string) => state.topics.some((t) => t.parentId === id);
  const holds = (id: string | null) =>
    id !== null && !isNew(id) && (state.held[id] ?? 0) > 0;
  const within = (id: string, ancestor: string) =>
    !isNew(id) &&
    !isNew(ancestor) &&
    topicAncestors(id, state.topics).includes(ancestor);
  switch (edit.op) {
    case "move":
      if (!(edit.thread in state.threadTopic)) return "That thread is gone.";
      if (!exists(edit.topic)) return "That topic is gone.";
      if (!isNew(edit.topic) && hasKids(edit.topic))
        return "That topic has subtopics, so it can't hold threads.";
      if (state.threadTopic[edit.thread] === edit.topic)
        return "The thread is already there.";
      return null;
    case "create":
      if (!exists(edit.parent) || !edit.children.every(exists))
        return "A topic it names is gone.";
      if (holds(edit.parent))
        return "Its parent holds threads, so it can't take subtopics.";
      if (
        edit.parent &&
        edit.children.some(
          (child) => child === edit.parent || within(edit.parent!, child),
        )
      )
        return "It would put a topic inside itself.";
      return null;
    case "reparent":
      if (!exists(edit.topic) || !exists(edit.parent))
        return "A topic it names is gone.";
      if (holds(edit.parent))
        return "The new parent holds threads, so it can't take subtopics.";
      if (
        edit.parent &&
        (edit.parent === edit.topic || within(edit.parent, edit.topic))
      )
        return "It would put a topic inside itself.";
      if (!isNew(edit.topic) && byId.get(edit.topic)?.parentId === edit.parent)
        return "The topic is already there.";
      return null;
    case "merge": {
      if (!exists(edit.from) || !exists(edit.into))
        return "A topic it names is gone.";
      const threads = (holds(edit.from) ? 1 : 0) + (holds(edit.into) ? 1 : 0);
      // `from` itself leaves `into`'s subtopics when it merges into its parent.
      const kids =
        (!isNew(edit.from) && hasKids(edit.from)) ||
        (!isNew(edit.into) &&
          state.topics.some(
            (t) => t.parentId === edit.into && t.id !== edit.from,
          ));
      if (threads > 0 && kids) return "It would put threads beside subtopics.";
      return null;
    }
    case "rename":
      if (!exists(edit.topic)) return "That topic is gone.";
      if (!isNew(edit.topic) && byId.get(edit.topic)?.name === edit.name.trim())
        return "It already has that name.";
      return null;
  }
}

/** A stable identity for an edit, so a declined one isn't proposed again. */
export function editKey(edit: TidyEdit | Split): string {
  if ("subgroups" in edit)
    return JSON.stringify([
      "split",
      edit.topicId,
      edit.subgroups.map((g) => [
        g.name.toLowerCase(),
        [...g.threadIds].sort(),
      ]),
    ]);
  switch (edit.op) {
    case "merge":
      return JSON.stringify([edit.op, edit.from, edit.into]);
    case "reparent":
      return JSON.stringify([edit.op, edit.topic, edit.parent]);
    case "rename":
      return JSON.stringify([edit.op, edit.topic, edit.name.toLowerCase()]);
    case "create":
      return JSON.stringify([
        edit.op,
        edit.name.toLowerCase(),
        edit.parent,
        [...edit.children].sort(),
      ]);
    case "move":
      return JSON.stringify([edit.op, edit.thread, edit.topic]);
  }
}

/** A one-line description of an edit, for review and for tidy's memory. */
export function describeEdit(
  edit: TidyEdit | Split,
  names: {
    topic: (ref: string | null) => string;
    thread: (id: string) => string;
  },
): string {
  if ("subgroups" in edit)
    return edit.repair
      ? `File ${names.topic(edit.topicId)}'s own threads in ${edit.subgroups.map((g) => g.name).join(", ")}`
      : `Split ${names.topic(edit.topicId)} into ${edit.subgroups.map((g) => g.name).join(", ")}`;
  switch (edit.op) {
    case "merge":
      return `Merge ${names.topic(edit.from)} into ${names.topic(edit.into)}`;
    case "reparent":
      return edit.parent
        ? `Move ${names.topic(edit.topic)} under ${names.topic(edit.parent)}`
        : `Move ${names.topic(edit.topic)} to the top level`;
    case "rename":
      return `Rename ${names.topic(edit.topic)} to ${edit.name}`;
    case "create":
      return `Create ${edit.name}${edit.parent ? ` under ${names.topic(edit.parent)}` : ""}${edit.children.length ? `, holding ${edit.children.map(names.topic).join(", ")}` : ""}`;
    case "move":
      return `Refile “${names.thread(edit.thread)}” into ${names.topic(edit.topic)}`;
  }
}
