/*
 * Model contracts for reviewed topic divisions and tidy edits. Validation
 * keeps assignments in leaf topics and resulting paths within two levels.
 * Contextual category inference uses categories.ts and separate collection state.
 * Prompt IDs map back through their input, so unsupported IDs never file work.
 */
import { z } from "zod";
import { HEADER, redact, stripFence, tagged } from "./analysis.ts";
import { placementIds } from "./placement.ts";
import { takesThreads, topicAncestors } from "./topics.ts";
import { startsWith } from "./layout.ts";

const TIDY_EDITS_MAX = 8;
const TIDY_THREADS_PER_TOPIC = 12;

type TidyTopic = {
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
  readonly work?: string;
  /** Its topic; null for Unfiled. */
  readonly topicId: string | null;
};

/** A topic created earlier in the same pass, referenced by name. */
type NewRef = `new:${string}`;
type TopicRef = string;

export type TidyEdit =
  | { op: "merge"; from: TopicRef; into: TopicRef }
  | {
      op: "reparent";
      topic: TopicRef;
      parent: TopicRef | null;
      /** Its name under the new parent, when that changes too. */
      name?: string;
    }
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
  readonly threadTitles?: Readonly<Record<string, string>>;
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
  `- [${short}] ${line(thread.title, 90)}${thread.work ? ` — ${line(thread.work, 1200)}` : ""}${thread.checkout ? ` (checkout ${line(thread.checkout, 80)})` : ""}`;

const memoryBlocks = (
  decisions: readonly string[],
  declined: readonly string[],
) =>
  [
    decisions.length
      ? `Decisions the user made by hand; keep them and build on them:\n${tagged("decisions", decisions.map((d) => `- ${line(d, 200)}`).join("\n"))}`
      : null,
    declined.length
      ? `Suggestions the user declined; don't propose them again or undo the decisions above:\n${tagged("declined", declined.map((d) => `- ${line(d, 200)}`).join("\n"))}`
      : null,
  ].filter(Boolean);

// Split -------------------------------------------------------------------

export type SplitInput = {
  readonly proposedScope?: {
    readonly name: string;
    readonly description: string;
  };
  readonly topics: readonly TidyTopic[];
  readonly held: Held;
  /** The topic to split, or to repair when it has subtopics already. */
  readonly topicId: string;
  readonly threads: readonly SuggestThread[];
  readonly decisions: readonly string[];
};

const SUBGROUP_RULES = `Child topics identify lasting products, capabilities, or maintained areas within a broad first-level topic. Each scope must be supported by the requests and independently assignable to a future thread without comparing it with other threads. A single-purpose tool covers its fixes, refactors, and reviews without children for those stages. Thread volume and recurring categories do not establish lasting scope. Name each child for its supported scope, rather than General or Other, so future filing follows the area instead of leftover membership. Give every listed thread one supported home and leave the division unapplied if a complete supported plan is unavailable. Topic identity has at most two levels total: these children are leaves. Name them in Title Case, preserving product spelling, without repeating their parent's name.`;

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
  const intro = repair
    ? `This group of agent threads holds threads beside its subgroups, and a group holds threads or subgroups, never both. File each of its own threads below in an existing immediate subgroup without subtopics, using its exact name from the tree, or in a new subgroup when none fits. ${SUBGROUP_RULES}`
    : `Consider whether this first-level topic has a supported division into two or more lasting child topics. Propose a complete filing plan for the user to review. ${SUBGROUP_RULES} For this first division, if no useful lasting division meets these tests, return empty subgroups and threads arrays and explain in reason why the topic should stay one level.`;
  return `${HEADER}

You organize someone's agent threads in a sidebar.

${intro}

The whole topic tree, for context:
${tagged("topic_tree", treeBlock(input.topics, input.held, ids))}

The group:
${tagged("group", `${line(path, 200)}${group.description ? ` — ${line(group.description, 300)}` : ""}`)}

${input.proposedScope ? `A newly identified area to assess, not an established division:\n${tagged("hint", `${line(input.proposedScope.name, 80)} — ${line(input.proposedScope.description, 300)}`)}\n` : ""}
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
  // A reason is prose; anything from a brace or tag on is the model writing
  // past it.
  reason: z
    .string()
    .transform((r) =>
      r
        .split(/[{}<]/)[0]!
        .replace(/[\s'",]+$/, "")
        .trim()
        .slice(0, 300),
    )
    .catch(""),
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
 * exactly one named child topic. An empty fresh plan means no lasting
 * division is supported; a proposed division needs at least two scopes.
 */
export function parseSplit(text: string, input: SplitInput): SplitOutput {
  const parsed = splitOutput.parse(JSON.parse(stripFence(text)));
  const parent = input.topics.find((topic) => topic.id === input.topicId);
  if (!parent || parent.parentId !== null)
    throw new Error("Only a first-level topic can gain child topics.");
  if (
    parsed.subgroups.length === 0 &&
    parsed.threads.length === 0 &&
    !input.topics.some((topic) => topic.parentId === input.topicId)
  )
    return {
      split: { topicId: input.topicId, subgroups: [] },
      reason: parsed.reason,
    };
  const byShort = new Map(
    [...threadIds(input.threads)].map(([id, short]) => [short, id]),
  );
  const existing = fileable(input).map((t) => t.name);
  const names = new Map<string, { name: string; description: string }>();
  for (const group of parsed.subgroups) {
    if (!validName(group.name) || /^(general|other)$/i.test(group.name))
      throw new Error(`Unsupported child topic name: ${group.name}`);
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

const TIDY_RULES = `You maintain the topic tree that groups someone's agent threads in a sidebar. Propose at most ${TIDY_EDITS_MAX} edits that make the tree a clean, stable map of their work, or none when it is already clean. Each edit is shown to the user with your reason, so make each one worth a click.

Good trees: top-level topics are contexts (an employer, a personal toolbox, personal life) once there is evidence for at least two; below them, products or areas; below those, capabilities. Names are areas, never tasks, questions, pull requests, or bugs. One home per area: merge duplicates and near-duplicates. A topic that belongs to a larger product goes under it. Topics side by side that are parts of one larger product or area get a new parent: create it, listing them as children. Refile threads that sit under the wrong product. A repository or workspace used to route or coordinate work is not a product. Name topics in Title Case, keeping product names' own spelling.

Prefer concise, meaningful names in context: avoid repeating information already conveyed by the topic's ancestry. Preserve established names of products and tools even when they repeat context, and retain distinctions between topics. Suggest renames when they improve clarity without changing the topic's scope or parent.

A topic holds threads or subtopics, never both: never move a topic under one that holds threads, never refile a thread into a topic with subtopics, and never merge a topic that holds threads with one that has subtopics. To give such a topic one home with a topic that has subtopics, move it under that topic instead, renamed for its area. Topic identity has at most two levels total, including roots. Move a topic beneath another only when its entire subtree fits within that limit. Topic divisions into lasting areas require a reviewed complete filing plan; volume-based categories are separate, so do not propose a division merely because a topic is busy.

Edits:
- merge {from, into}: move every thread and subtopic of \`from\` into \`into\` and delete \`from\`
- reparent {topic, parent, name}: move a topic under another; parent null makes it top-level. name is its new name, or null to keep it. When its name repeats the new parent's, drop redundant words without changing an established product or tool name: "Beacon Code Review" under "Beacon" becomes "Code Review".
- rename {topic, name}
- create {name, description, parent, children}: a new topic, adopting existing topics as its children
- move {thread, topic}: refile one thread
Refer to topics and threads by the IDs inside the square brackets, without the brackets: [settings] is "settings" and [r12] is "r12". A topic created earlier in the same list can be referenced as "new:<name>".`;

/** The displayed evidence bounds which threads an answer may move. */
function tidyThreadGroups(input: Pick<TidyInput, "topics" | "threads">) {
  const topics = new Set(placementIds(input.topics).keys());
  const groups = new Map<
    string | null,
    { shown: SuggestThread[]; total: number }
  >();
  for (const thread of input.threads) {
    if (thread.topicId !== null && !topics.has(thread.topicId)) continue;
    const group = groups.get(thread.topicId) ?? { shown: [], total: 0 };
    group.total++;
    if (group.shown.length < TIDY_THREADS_PER_TOPIC) group.shown.push(thread);
    groups.set(thread.topicId, group);
  }
  return groups;
}

export function tidyPrompt(input: TidyInput): string {
  const ids = placementIds(input.topics);
  const rIds = threadIds(input.threads);
  const byTopic = tidyThreadGroups(input);
  const listed = [...ids]
    .filter(([id]) => byTopic.has(id))
    .map(([id, short]) => {
      const { shown, total } = byTopic.get(id)!;
      return `[${short}] ${line(input.topics.find((t) => t.id === id)!.name, 80)}:\n${shown.map((t) => threadLine(rIds.get(t.id)!, t)).join("\n")}${total > shown.length ? `\n(+${total - shown.length} more)` : ""}`;
    });
  const unfiled = byTopic.get(null)?.shown ?? [];
  if (unfiled.length)
    listed.push(
      `Unfiled:\n${unfiled
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

Return {"edits": [...]} where each edit is {"op", "from", "into", "topic", "parent", "name", "description", "children", "thread", "reason"} and unused fields are null. reason is one sentence the user reads before accepting, about this edit's own topics and threads only.`;
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
          // The reason comes last, so it's written about the edit already
          // chosen rather than steering which topics the edit names.
          properties: {
            op: { type: "string", enum: [...OPS] },
            from: ref,
            into: ref,
            topic: ref,
            parent: ref,
            name: ref,
            description: ref,
            children: { type: ["array", "null"], items: { type: "string" } },
            thread: ref,
            reason: { type: "string" },
          },
          required: [
            "op",
            "from",
            "into",
            "topic",
            "parent",
            "name",
            "description",
            "children",
            "thread",
            "reason",
          ],
        },
      },
    },
    required: ["edits"],
  };
}

const rawEdit = z.object({
  op: z.enum(OPS),
  // A reason is prose; anything from a brace or tag on is the model writing
  // past it.
  reason: z
    .string()
    .transform((r) =>
      r
        .split(/[{}<]/)[0]!
        .replace(/[\s'",]+$/, "")
        .trim()
        .slice(0, 300),
    )
    .catch(""),
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

function resolveTidyId(
  value: string,
  known: ReadonlyMap<string, string>,
): string | undefined {
  const exact = known.get(value);
  if (exact !== undefined) return exact;
  if (value.startsWith("[") && value.endsWith("]"))
    return known.get(value.slice(1, -1));
  return undefined;
}

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
  const shown = new Set(
    [...tidyThreadGroups(input).values()].flatMap((group) =>
      group.shown.map((thread) => thread.id),
    ),
  );
  const threadOf = new Map(
    [...threadIds(input.threads)]
      .filter(([id]) => shown.has(id))
      .map(([id, short]) => [short, id]),
  );
  const created = new Set<string>();
  /** A topic: a short ID, or a topic created earlier in this answer. */
  const ref = (value: string | null | undefined): string | null | undefined => {
    if (value === null || value === undefined) return value;
    if (isNew(value))
      return created.has(value.slice(4).trim().toLowerCase())
        ? `new:${value.slice(4).trim()}`
        : undefined;
    return resolveTidyId(value, topicOf);
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
      // A rename to the name it has is no rename.
      const current = input.topics.find((t) => t.id === topic)?.name;
      const name =
        e.name &&
        validName(e.name) &&
        e.name.toLowerCase() !== current?.toLowerCase()
          ? e.name
          : undefined;
      const stays =
        input.topics.find((t) => t.id === topic)?.parentId === parent;
      // A move to where the topic already is only renames it.
      if (topic && stays && name) edit = { op: "rename", topic, name };
      else if (topic && parent !== undefined && topic !== parent)
        edit = { op: "reparent", topic, parent, ...(name ? { name } : {}) };
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
      const thread = e.thread ? resolveTidyId(e.thread, threadOf) : undefined;
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
 * Why an edit would change nothing, now or ever: something it names is gone,
 * or the tree already has it. Topics created earlier in the pass (`new:`
 * references) can't be checked until they exist.
 */
export function mootEdit(edit: TidyEdit, state: TreeState): string | null {
  const byId = new Map(state.topics.map((t) => [t.id, t]));
  const exists = (ref: string | null) =>
    ref === null || isNew(ref) || byId.has(ref);
  switch (edit.op) {
    case "move":
      if (!(edit.thread in state.threadTopic)) return "That thread is gone.";
      if (!exists(edit.topic)) return "That topic is gone.";
      if (state.threadTopic[edit.thread] === edit.topic)
        return "The thread is already there.";
      return null;
    case "create":
      if (!exists(edit.parent)) return "Its parent is gone.";
      if (edit.children.length && !edit.children.some(exists))
        return "The topics it would hold are gone.";
      return null;
    case "reparent":
      if (!exists(edit.topic) || !exists(edit.parent))
        return "A topic it names is gone.";
      if (
        !isNew(edit.topic) &&
        byId.get(edit.topic)?.parentId === edit.parent &&
        (edit.name === undefined || byId.get(edit.topic)?.name === edit.name)
      )
        return "The topic is already there.";
      return null;
    case "merge":
      if (!exists(edit.from) || !exists(edit.into))
        return "A topic it names is gone.";
      return null;
    case "rename":
      if (!exists(edit.topic)) return "That topic is gone.";
      if (!isNew(edit.topic) && byId.get(edit.topic)?.name === edit.name.trim())
        return "It already has that name.";
      return null;
  }
}

/**
 * Why an edit can't apply to `state`, or null when it can: it would change
 * nothing (`mootEdit`), or it would break a rule of the tree. Topics created
 * earlier in the pass (`new:` references) can't be checked until they exist.
 */
export function refusal(edit: TidyEdit, state: TreeState): string | null {
  const moot = mootEdit(edit, state);
  if (moot) return moot;
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
  const depth = (id: string | null) =>
    id === null
      ? 0
      : byId.has(id)
        ? topicAncestors(id, state.topics).length
        : null;
  const height = (id: string) => {
    const base = depth(id);
    if (base === null) return 1;
    return Math.max(
      1,
      ...state.topics
        .filter((topic) => topicAncestors(topic.id, state.topics).includes(id))
        .map(
          (topic) => topicAncestors(topic.id, state.topics).length - base + 1,
        ),
    );
  };
  const tooDeep = (parent: string | null, subtreeHeight: number) => {
    const parentDepth = depth(parent);
    return parentDepth !== null && parentDepth + subtreeHeight > 2;
  };
  switch (edit.op) {
    case "move":
      if (!isNew(edit.topic) && hasKids(edit.topic))
        return "That topic has subtopics, so it can't hold threads.";
      return null;
    case "create":
      if (!edit.children.every(exists)) return "A topic it names is gone.";
      if (
        tooDeep(
          edit.parent,
          1 +
            (edit.children.length ? Math.max(...edit.children.map(height)) : 0),
        )
      )
        return "Topic identity has at most two levels.";
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
      if (tooDeep(edit.parent, height(edit.topic)))
        return "Topic identity has at most two levels.";
      if (holds(edit.parent))
        return "The new parent holds threads, so it can't take subtopics.";
      if (
        edit.parent &&
        (edit.parent === edit.topic || within(edit.parent, edit.topic))
      )
        return "It would put a topic inside itself.";
      if (
        edit.name !== undefined &&
        state.topics.some(
          (t) =>
            t.parentId === edit.parent &&
            t.id !== edit.topic &&
            t.name.toLowerCase() === edit.name!.trim().toLowerCase(),
        )
      )
        return `A topic there is already named ${edit.name}.`;
      return null;
    case "merge": {
      const threads = (holds(edit.from) ? 1 : 0) + (holds(edit.into) ? 1 : 0);
      // `from` itself leaves `into`'s subtopics when it merges into its parent.
      const kids =
        (!isNew(edit.from) && hasKids(edit.from)) ||
        (!isNew(edit.into) &&
          state.topics.some(
            (t) => t.parentId === edit.into && t.id !== edit.from,
          ));
      if (threads > 0 && kids) return "It would put threads beside subtopics.";
      const finalDepth = within(edit.into, edit.from)
        ? depth(edit.from)
        : depth(edit.into);
      if (kids && finalDepth !== null && finalDepth >= 2)
        return "Topic identity has at most two levels.";
      return null;
    }
    case "rename":
      return null;
  }
}

/**
 * Top-level topics named as if they belonged under another topic: "Vercel
 * Agent Code Review" beside "Vercel Agent". Each becomes a move under the
 * topic with subtopics its name begins with (the longest, when several do),
 * renamed without the shared words. Topics already under a parent keep it; moves that would
 * break a rule of the tree aren't proposed. No model is asked, so these are
 * found whenever the tree changes.
 */
export function prefixMoves(state: TreeState): ProposedEdit[] {
  const out: ProposedEdit[] = [];
  for (const topic of state.topics) {
    if (topic.parentId !== null) continue;
    const parent = state.topics
      .filter(
        (other) =>
          other.id !== topic.id &&
          other.name.length < topic.name.length &&
          startsWith(topic.name, other.name) &&
          state.topics.some((t) => t.parentId === other.id),
      )
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (!parent) continue;
    const name = topic.name.slice(parent.name.length).trim();
    if (!validName(name)) continue;
    const edit: TidyEdit = {
      op: "reparent",
      topic: topic.id,
      parent: parent.id,
      name,
    };
    if (refusal(edit, state)) continue;
    out.push({
      edit,
      reason: `Its name begins with ${parent.name}, so it belongs under that topic.`,
    });
  }
  return out;
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
    // A move is the same suggestion whatever it renames the topic to.
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
      return `${
        edit.parent
          ? `Move ${names.topic(edit.topic)} under ${names.topic(edit.parent)}`
          : `Move ${names.topic(edit.topic)} to the top level`
      }${edit.name === undefined ? "" : ` as ${edit.name}`}`;
    case "rename":
      return `Rename ${names.topic(edit.topic)} to ${edit.name}`;
    case "create":
      return `Create ${edit.name}${edit.parent ? ` under ${names.topic(edit.parent)}` : ""}${edit.children.length ? `, holding ${edit.children.map(names.topic).join(", ")}` : ""}`;
    case "move":
      return `Refile “${names.thread(edit.thread)}” into ${names.topic(edit.topic)}`;
  }
}

/** A split as it would apply to the tree now. */
type SplitNow = {
  /**
   * The split without threads that left the group or closed since, and
   * without the new subgroups that left it empty.
   */
  readonly split: Split;
  /** Threads that joined the group since, which accepting must also file. */
  readonly arrivals: readonly string[];
  /** Why it no longer makes sense or can't apply; null when it can. */
  readonly problem: string | null;
  /** It would change nothing, now or ever: its group or threads are gone. */
  readonly moot: boolean;
};

/**
 * Fits a split to the group as it is now. Threads moving or closing since
 * don't stop it: the rest are filed as proposed, and threads that joined
 * are filed too when it's accepted. It stops only when what it proposed no
 * longer holds: the group is gone, none of its threads remain, more threads
 * joined than remain, or a split would leave only one subgroup with threads.
 */
export function splitNow(split: Split, state: TreeState): SplitNow {
  const group = state.topics.find((t) => t.id === split.topicId);
  const stop = (problem: string): SplitNow => ({
    split,
    arrivals: [],
    problem,
    moot: true,
  });
  if (!group) return stop("Its group is gone.");
  const inGroup = new Set(
    Object.entries(state.threadTopic)
      .filter(([, topic]) => topic === split.topicId)
      .map(([id]) => id),
  );
  const existing = new Set(
    state.topics
      .filter((t) => t.parentId === split.topicId)
      .map((t) => t.name.trim().toLowerCase()),
  );
  const subgroups = split.subgroups
    .map((g) => ({
      ...g,
      threadIds: g.threadIds.filter((id) => inGroup.has(id)),
    }))
    .filter(
      (g) =>
        g.threadIds.length > 0 || existing.has(g.name.trim().toLowerCase()),
    );
  const kept = subgroups.reduce((n, g) => n + g.threadIds.length, 0);
  const listed = new Set(split.subgroups.flatMap((g) => g.threadIds));
  const arrivals = [...inGroup].filter((id) => !listed.has(id));
  const now = { ...split, subgroups };
  if (kept === 0)
    return stop(
      split.repair && inGroup.size === 0
        ? `${group.name} no longer holds threads beside its subgroups.`
        : `None of its threads are in ${group.name} anymore.`,
    );
  if (arrivals.length > kept)
    return {
      split: now,
      arrivals,
      problem: `${arrivals.length} threads joined ${group.name} since; ask again to include them.`,
      moot: false,
    };
  if (
    !split.repair &&
    subgroups.filter((g) => g.threadIds.length > 0).length < 2
  )
    return {
      split: now,
      arrivals,
      problem: "Only one of its subgroups still has threads.",
      moot: false,
    };
  return { split: now, arrivals, problem: null, moot: false };
}
