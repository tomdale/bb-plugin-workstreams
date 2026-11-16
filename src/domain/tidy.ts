/*
 * Model contracts for reviewed workstream divisions and tidy edits. Validation
 * keeps assignments in leaf workstreams and resulting paths within two levels.
 * Contextual category inference uses categories.ts and separate collection state.
 * Prompt IDs map back through their input, so unsupported IDs never file work.
 */
import { z } from "zod";
import { HEADER, redact, stripFence, tagged } from "./analysis.ts";
import { promptIds } from "./placement.ts";
import { takesThreads, workstreamAncestors } from "./topics.ts";
import { startsWith } from "./layout.ts";
import { PATH_MARK } from "./topic-path.ts";

const TIDY_EDITS_MAX = 8;
const TIDY_THREADS_PER_WORKSTREAM = 12;

type TidyWorkstream = {
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
  /** Its workstream; null for Other. */
  readonly workstreamId: string | null;
};

/** A workstream created earlier in the same pass, referenced by name. */
type NewRef = `new:${string}`;
type WorkstreamRef = string;

export type TidyEdit =
  | { op: "merge"; from: WorkstreamRef; into: WorkstreamRef }
  | {
      op: "move-workstream";
      workstream: WorkstreamRef;
      parent: WorkstreamRef | null;
      /** Its name under the new parent, when that changes too. */
      name?: string;
    }
  | { op: "rename"; workstream: WorkstreamRef; name: string }
  | {
      op: "group";
      name: string;
      description: string;
      parent: WorkstreamRef | null;
      children: WorkstreamRef[];
    }
  | { op: "move-thread"; thread: string; workstream: WorkstreamRef };

export type Split = {
  readonly workstreamId: string;
  readonly threadTitles?: Readonly<Record<string, string>>;
  /** It files the threads of a workstream that holds them beside workstreams in a group. */
  readonly repair?: boolean;
  readonly workstreams: readonly {
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
  return clean.length > 0 && clean.length <= 80 && !clean.includes(PATH_MARK);
};

/** Visible threads filed directly in each workstream. */
export type Held = Readonly<Record<string, number>>;

function treeBlock(
  workstreams: readonly TidyWorkstream[],
  held: Held,
  ids: Map<string, string>,
): string {
  const byId = new Map(
    workstreams.map((workstream) => [workstream.id, workstream]),
  );
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
  const parents = new Set(workstreams.map((workstream) => workstream.parentId));
  const rows = [...ids].map(([id, short]) => {
    const workstream = byId.get(id)!;
    const description = line(workstream.description ?? "", 200);
    const count = held[id] ?? 0;
    const facts = [
      parents.has(id)
        ? count > 0
          ? `group, with ${count} ${count === 1 ? "thread" : "threads"} of its own beside its workstreams`
          : "group"
        : `${count} ${count === 1 ? "thread" : "threads"}`,
      workstream.aliases.length
        ? `aliases: ${workstream.aliases.map((a) => line(a, 60)).join(", ")}`
        : null,
    ].filter(Boolean);
    return `${"  ".repeat(depth(id))}- [${short}] ${line(workstream.name, 80)}${description ? ` — ${description}` : ""} (${facts.join("; ")})`;
  });
  return rows.length ? rows.join("\n") : "(no workstreams yet)";
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
  readonly workstreams: readonly TidyWorkstream[];
  readonly held: Held;
  /** The workstream to split, or to repair when it has workstreams in a group already. */
  readonly workstreamId: string;
  readonly threads: readonly SuggestThread[];
  readonly decisions: readonly string[];
};

const SPLIT_RULES = `The workstreams of a group identify lasting products, capabilities, or maintained areas within a broad product. Each scope must be supported by the requests and independently assignable to a future thread without comparing it with other threads. A single-purpose tool covers its fixes, refactors, and reviews without separate workstreams for those stages. Thread volume and recurring categories do not establish lasting scope. Name each workstream for its supported scope, rather than General or Other, so future threads follow the area instead of leftover membership. Give every listed thread one supported workstream and leave the split unapplied if no complete supported split is available. Workstreams go at most two levels deep: these workstreams sit inside the group and hold threads. Name them in Title Case, preserving product spelling, without repeating the group's name.`;

/** The group's workstreams in a group a thread can be filed in: those without workstreams in a group. */
const fileable = (input: Pick<SplitInput, "workstreams" | "workstreamId">) =>
  input.workstreams.filter(
    (t) =>
      t.parentId === input.workstreamId &&
      takesThreads(t.id, input.workstreams),
  );

const threadIds = (threads: readonly { id: string }[]) =>
  new Map(threads.map((thread, i) => [thread.id, `r${i + 1}`]));

export function splitPrompt(input: SplitInput): string {
  const ids = promptIds(input.workstreams);
  const rIds = threadIds(input.threads);
  const group = input.workstreams.find((t) => t.id === input.workstreamId)!;
  const path = workstreamAncestors(input.workstreamId, input.workstreams)
    .reverse()
    .map((id) => input.workstreams.find((t) => t.id === id)!.name)
    .join(" › ");
  const repair = input.workstreams.some(
    (t) => t.parentId === input.workstreamId,
  );
  const intro = repair
    ? `This group holds threads of its own beside its workstreams, but a group holds workstreams, never threads. Move each of its own threads below into one of its existing workstreams, using its exact name from the list, or into a new workstream when none fits. ${SPLIT_RULES}`
    : `Consider whether this top-level workstream has a supported split into two or more lasting workstreams, which would make it a group. Propose where each thread goes, for the user to review. ${SPLIT_RULES} For this first split, if no useful lasting split meets these tests, return empty workstreams and threads arrays and explain in reason why it should stay one workstream.`;
  return `${HEADER}

You organize someone's agent threads in a sidebar.

${intro}

Every workstream and group, for context:
${tagged("workstream_tree", treeBlock(input.workstreams, input.held, ids))}

${repair ? "The group" : "The workstream to split"}:
${tagged(repair ? "group" : "workstream", `${line(path, 200)}${group.description ? ` — ${line(group.description, 300)}` : ""}`)}

${input.proposedScope ? `A newly identified area to assess, not an established split:\n${tagged("hint", `${line(input.proposedScope.name, 80)} — ${line(input.proposedScope.description, 300)}`)}\n` : ""}
Its threads:
${tagged("threads", input.threads.map((t) => threadLine(rIds.get(t.id)!, t)).join("\n"))}
${memoryBlocks(input.decisions, []).join("\n\n")}

Return {"reason": string, "workstreams": [{"name": string, "description": string}], "threads": [{"id": string, "workstream": string}]}:
- reason: one sentence the user reads before accepting, saying what the workstreams separate.
- workstreams: ${repair ? "the workstreams the threads go into: existing ones by their exact names, and any new ones" : "the new workstreams"}, each with a one-sentence description of its scope.
- threads: every thread ID above exactly once, with the name of its workstream.`;
}

export function splitSchema(input: SplitInput): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reason: { type: "string" },
      workstreams: {
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
            workstream: { type: "string" },
          },
          required: ["id", "workstream"],
        },
      },
    },
    required: ["reason", "workstreams", "threads"],
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
  workstreams: z.array(
    z.object({
      name: z.string().trim(),
      description: z.string().trim().max(300).catch(""),
    }),
  ),
  threads: z.array(z.object({ id: z.string(), workstream: z.string().trim() })),
});

export type SplitOutput = { split: Split; reason: string };

/**
 * Checks a split against the threads it was asked about: every thread in
 * exactly one named workstream. An empty fresh plan means no lasting
 * division is supported; a proposed division needs at least two scopes.
 */
export function parseSplit(text: string, input: SplitInput): SplitOutput {
  const parsed = splitOutput.parse(JSON.parse(stripFence(text)));
  const parent = input.workstreams.find(
    (workstream) => workstream.id === input.workstreamId,
  );
  if (!parent || parent.parentId !== null)
    throw new Error("Only a top-level workstream can be split.");
  if (
    parsed.workstreams.length === 0 &&
    parsed.threads.length === 0 &&
    !input.workstreams.some(
      (workstream) => workstream.parentId === input.workstreamId,
    )
  )
    return {
      split: { workstreamId: input.workstreamId, workstreams: [] },
      reason: parsed.reason,
    };
  const byShort = new Map(
    [...threadIds(input.threads)].map(([id, short]) => [short, id]),
  );
  const existing = fileable(input).map((t) => t.name);
  const names = new Map<string, { name: string; description: string }>();
  for (const group of parsed.workstreams) {
    if (!validName(group.name) || /^(general|other)$/i.test(group.name))
      throw new Error(`Unsupported workstream name: ${group.name}`);
    const key = group.name.toLowerCase();
    if (!names.has(key)) names.set(key, group);
  }
  for (const name of existing)
    if (!names.has(name.toLowerCase()))
      names.set(name.toLowerCase(), { name, description: "" });
  const members = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const { id, workstream } of parsed.threads) {
    const threadId = byShort.get(id);
    const key = workstream.toLowerCase();
    if (!threadId || seen.has(threadId) || !names.has(key))
      throw new Error(
        "The split must put each thread in one named workstream.",
      );
    seen.add(threadId);
    members.set(key, [...(members.get(key) ?? []), threadId]);
  }
  if (seen.size !== input.threads.length)
    throw new Error("The split left a thread out.");
  const workstreams = [...members].map(([key, ids]) => ({
    name: names.get(key)!.name,
    description: names.get(key)!.description,
    threadIds: ids,
  }));
  const repair = input.workstreams.some(
    (t) => t.parentId === input.workstreamId,
  );
  if (!repair && workstreams.length < 2)
    throw new Error("A split needs at least two workstreams.");
  return {
    split: {
      workstreamId: input.workstreamId,
      ...(repair ? { repair } : {}),
      workstreams,
    },
    reason: parsed.reason,
  };
}

// Tidy --------------------------------------------------------------------

export type TidyInput = {
  readonly workstreams: readonly TidyWorkstream[];
  readonly held: Held;
  readonly threads: readonly SuggestThread[];
  /** Checkouts that coordinate work in other repositories. */
  readonly coordination: readonly string[];
  readonly decisions: readonly string[];
  readonly declined: readonly string[];
};

const TIDY_RULES = `You maintain the workstreams and groups that organize someone's agent threads in a sidebar. A workstream holds threads; a group holds workstreams. Propose at most ${TIDY_EDITS_MAX} edits that make them a clean, stable map of their work, or none when they are already clean. Each edit is shown to the user with your reason, so make each one worth a click.

Good organization: top-level entries are contexts (an employer, a personal toolbox, personal life) once there is evidence for at least two; below them, products or areas; below those, capabilities. Names are areas, never tasks, questions, pull requests, or bugs. One workstream per area: merge duplicates and near-duplicates. A workstream that belongs to a larger product goes into it. Workstreams side by side that are parts of one larger product or area get a new group: create it, listing them as its children. Move threads that sit under the wrong product. A repository or workspace used to route or coordinate work is not a product. Name workstreams and groups in Title Case, keeping product names' own spelling.

Prefer concise, meaningful names in context: avoid repeating information already conveyed by the group an entry is in. Preserve established names of products and tools even when they repeat context, and retain distinctions between workstreams. Suggest renames when they improve clarity without changing an entry's scope or group.

A workstream holds threads and a group holds workstreams, never both: never move an entry into a workstream that holds threads, never move a thread into a group, and never merge a workstream that holds threads with a group. A workstream that holds threads can still move into a group: to give it one home with a group, move it into that group, renamed for its area. Workstreams go at most two levels deep, counting top-level entries. Move an entry into another only when everything in it fits within that limit. Splitting a workstream into lasting areas requires a reviewed preview of where each thread goes; categories are separate, so do not propose a split merely because a workstream is busy.

Edits:
- merge {from, into}: move every thread and workstream of \`from\` into \`into\` and delete \`from\`
- move-workstream {workstream, parent, name}: move a workstream or group into another; parent null makes it top-level. name is its new name, or null to keep it. When its name repeats the new parent's, drop redundant words without changing an established product or tool name: "Beacon Code Review" in "Beacon" becomes "Code Review".
- rename {workstream, name}
- group {name, description, parent, children}: a new group, adopting existing workstreams as its children
- move-thread {thread, workstream}: move one thread into a workstream
Refer to workstreams, groups, and threads by the IDs inside the square brackets, without the brackets: [settings] is "settings" and [r12] is "r12". A group created earlier in the same list can be referenced as "new:<name>".`;

/** The displayed evidence bounds which threads an answer may move. */
function tidyThreadGroups(input: Pick<TidyInput, "workstreams" | "threads">) {
  const workstreams = new Set(promptIds(input.workstreams).keys());
  const groups = new Map<
    string | null,
    { shown: SuggestThread[]; total: number }
  >();
  for (const thread of input.threads) {
    if (thread.workstreamId !== null && !workstreams.has(thread.workstreamId))
      continue;
    const group = groups.get(thread.workstreamId) ?? { shown: [], total: 0 };
    group.total++;
    if (group.shown.length < TIDY_THREADS_PER_WORKSTREAM)
      group.shown.push(thread);
    groups.set(thread.workstreamId, group);
  }
  return groups;
}

export function tidyPrompt(input: TidyInput): string {
  const ids = promptIds(input.workstreams);
  const rIds = threadIds(input.threads);
  const byWorkstream = tidyThreadGroups(input);
  const listed = [...ids]
    .filter(([id]) => byWorkstream.has(id))
    .map(([id, short]) => {
      const { shown, total } = byWorkstream.get(id)!;
      return `[${short}] ${line(input.workstreams.find((t) => t.id === id)!.name, 80)}:\n${shown.map((t) => threadLine(rIds.get(t.id)!, t)).join("\n")}${total > shown.length ? `\n(+${total - shown.length} more)` : ""}`;
    });
  const other = byWorkstream.get(null)?.shown ?? [];
  if (other.length)
    listed.push(
      `No workstream:\n${other
        .map((t) => threadLine(rIds.get(t.id)!, t))
        .join("\n")}`,
    );
  const sections = [
    `The workstreams and groups, where indentation shows the group an entry is in:\n${tagged("workstream_tree", treeBlock(input.workstreams, input.held, ids))}`,
    `Threads by workstream:\n${tagged("threads", listed.join("\n\n") || "(none)")}`,
    input.coordination.length
      ? `These checkouts coordinate work in other repositories, so a workstream named after one isn't an area:\n${tagged("coordination", input.coordination.map((c) => `- ${line(c, 120)}`).join("\n"))}`
      : null,
    ...memoryBlocks(input.decisions, input.declined),
  ].filter(Boolean);
  return `${HEADER}

${TIDY_RULES}

${sections.join("\n\n")}

Return {"edits": [...]} where each edit is {"op", "from", "into", "workstream", "parent", "name", "description", "children", "thread", "reason"} and unused fields are null. reason is one sentence the user reads before accepting, about this edit's own workstreams and threads only.`;
}

const OPS = [
  "merge",
  "move-workstream",
  "rename",
  "group",
  "move-thread",
] as const;

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
          // chosen rather than steering which workstreams the edit names.
          properties: {
            op: { type: "string", enum: [...OPS] },
            from: ref,
            into: ref,
            workstream: ref,
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
            "workstream",
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
  workstream: z.string().nullish(),
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
 * Maps a tidy answer back to workstream and thread IDs, keeping each edit that
 * names what it needs and dropping the rest; at most `TIDY_EDITS_MAX`.
 */
export function parseTidy(text: string, input: TidyInput): ProposedEdit[] {
  const parsed = z
    .object({ edits: z.array(z.unknown()) })
    .parse(JSON.parse(stripFence(text)));
  const workstreamOf = new Map(
    [...promptIds(input.workstreams)].map(([id, short]) => [short, id]),
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
  /** A workstream: a short ID, or a workstream created earlier in this answer. */
  const ref = (value: string | null | undefined): string | null | undefined => {
    if (value === null || value === undefined) return value;
    if (isNew(value))
      return created.has(value.slice(4).trim().toLowerCase())
        ? `new:${value.slice(4).trim()}`
        : undefined;
    return resolveTidyId(value, workstreamOf);
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
    } else if (e.op === "move-workstream") {
      const workstream = ref(e.workstream);
      const parent =
        e.parent === null || e.parent === undefined ? null : ref(e.parent);
      // A rename to the name it has is no rename.
      const current = input.workstreams.find((t) => t.id === workstream)?.name;
      const name =
        e.name &&
        validName(e.name) &&
        e.name.toLowerCase() !== current?.toLowerCase()
          ? e.name
          : undefined;
      const stays =
        input.workstreams.find((t) => t.id === workstream)?.parentId === parent;
      // A move to where the workstream already is only renames it.
      if (workstream && stays && name)
        edit = { op: "rename", workstream, name };
      else if (workstream && parent !== undefined && workstream !== parent)
        edit = {
          op: "move-workstream",
          workstream,
          parent,
          ...(name ? { name } : {}),
        };
    } else if (e.op === "rename") {
      const workstream = ref(e.workstream);
      if (workstream && e.name && validName(e.name))
        edit = { op: "rename", workstream, name: e.name };
    } else if (e.op === "group") {
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
          op: "group",
          name: e.name,
          description: e.description ?? "",
          parent,
          children: children as string[],
        };
      }
    } else {
      const thread = e.thread ? resolveTidyId(e.thread, threadOf) : undefined;
      const workstream = ref(e.workstream);
      if (thread && workstream)
        edit = { op: "move-thread", thread, workstream };
    }
    if (edit) out.push({ edit, reason: e.reason });
    if (out.length === TIDY_EDITS_MAX) break;
  }
  return out;
}

// Guards ------------------------------------------------------------------

/** The tree an edit is checked against. */
export type TreeState = {
  readonly workstreams: readonly {
    id: string;
    name: string;
    parentId: string | null;
  }[];
  readonly held: Held;
  /** Each thread's workstream. */
  readonly threadWorkstream: Readonly<Record<string, string | null>>;
};

/**
 * Why an edit would change nothing, now or ever: something it names is gone,
 * or the tree already has it. Workstreams created earlier in the pass (`new:`
 * references) can't be checked until they exist.
 */
export function mootEdit(edit: TidyEdit, state: TreeState): string | null {
  const byId = new Map(state.workstreams.map((t) => [t.id, t]));
  const exists = (ref: string | null) =>
    ref === null || isNew(ref) || byId.has(ref);
  switch (edit.op) {
    case "move-thread":
      if (!(edit.thread in state.threadWorkstream))
        return "That thread is gone.";
      if (!exists(edit.workstream)) return "That workstream is gone.";
      if (state.threadWorkstream[edit.thread] === edit.workstream)
        return "The thread is already there.";
      return null;
    case "group":
      if (!exists(edit.parent)) return "Its parent is gone.";
      if (edit.children.length && !edit.children.some(exists))
        return "The workstreams it would hold are gone.";
      return null;
    case "move-workstream":
      if (!exists(edit.workstream) || !exists(edit.parent))
        return "A workstream it names is gone.";
      if (
        !isNew(edit.workstream) &&
        byId.get(edit.workstream)?.parentId === edit.parent &&
        (edit.name === undefined ||
          byId.get(edit.workstream)?.name === edit.name)
      )
        return "The workstream is already there.";
      return null;
    case "merge":
      if (!exists(edit.from) || !exists(edit.into))
        return "A workstream it names is gone.";
      return null;
    case "rename":
      if (!exists(edit.workstream)) return "That workstream is gone.";
      if (
        !isNew(edit.workstream) &&
        byId.get(edit.workstream)?.name === edit.name.trim()
      )
        return "It already has that name.";
      return null;
  }
}

/**
 * Why an edit can't apply to `state`, or null when it can: it would change
 * nothing (`mootEdit`), or it would break a rule of the tree. Workstreams created
 * earlier in the pass (`new:` references) can't be checked until they exist.
 */
export function refusal(edit: TidyEdit, state: TreeState): string | null {
  const moot = mootEdit(edit, state);
  if (moot) return moot;
  const byId = new Map(state.workstreams.map((t) => [t.id, t]));
  const exists = (ref: string | null) =>
    ref === null || isNew(ref) || byId.has(ref);
  const hasKids = (id: string) =>
    state.workstreams.some((t) => t.parentId === id);
  const holds = (id: string | null) =>
    id !== null && !isNew(id) && (state.held[id] ?? 0) > 0;
  const within = (id: string, ancestor: string) =>
    !isNew(id) &&
    !isNew(ancestor) &&
    workstreamAncestors(id, state.workstreams).includes(ancestor);
  const depth = (id: string | null) =>
    id === null
      ? 0
      : byId.has(id)
        ? workstreamAncestors(id, state.workstreams).length
        : null;
  const height = (id: string) => {
    const base = depth(id);
    if (base === null) return 1;
    return Math.max(
      1,
      ...state.workstreams
        .filter((workstream) =>
          workstreamAncestors(workstream.id, state.workstreams).includes(id),
        )
        .map(
          (workstream) =>
            workstreamAncestors(workstream.id, state.workstreams).length -
            base +
            1,
        ),
    );
  };
  const tooDeep = (parent: string | null, subtreeHeight: number) => {
    const parentDepth = depth(parent);
    return parentDepth !== null && parentDepth + subtreeHeight > 2;
  };
  switch (edit.op) {
    case "move-thread":
      if (!isNew(edit.workstream) && hasKids(edit.workstream))
        return "That is a group, so it can't hold threads.";
      return null;
    case "group":
      if (!edit.children.every(exists)) return "A workstream it names is gone.";
      if (
        tooDeep(
          edit.parent,
          1 +
            (edit.children.length ? Math.max(...edit.children.map(height)) : 0),
        )
      )
        return "Workstreams go at most two levels deep.";
      if (holds(edit.parent))
        return "Its parent holds threads, so it can't hold workstreams.";
      if (
        edit.parent &&
        edit.children.some(
          (child) => child === edit.parent || within(edit.parent!, child),
        )
      )
        return "It would put a workstream inside itself.";
      return null;
    case "move-workstream":
      if (tooDeep(edit.parent, height(edit.workstream)))
        return "Workstreams go at most two levels deep.";
      if (holds(edit.parent))
        return "The new parent holds threads, so it can't hold workstreams.";
      if (
        edit.parent &&
        (edit.parent === edit.workstream ||
          within(edit.parent, edit.workstream))
      )
        return "It would put a workstream inside itself.";
      if (
        edit.name !== undefined &&
        state.workstreams.some(
          (t) =>
            t.parentId === edit.parent &&
            t.id !== edit.workstream &&
            t.name.toLowerCase() === edit.name!.trim().toLowerCase(),
        )
      )
        return `A workstream there is already named ${edit.name}.`;
      return null;
    case "merge": {
      const threads = (holds(edit.from) ? 1 : 0) + (holds(edit.into) ? 1 : 0);
      // `from` itself leaves `into`'s workstreams in a group when it merges into its parent.
      const kids =
        (!isNew(edit.from) && hasKids(edit.from)) ||
        (!isNew(edit.into) &&
          state.workstreams.some(
            (t) => t.parentId === edit.into && t.id !== edit.from,
          ));
      if (threads > 0 && kids)
        return "It would put threads beside workstreams.";
      const finalDepth = within(edit.into, edit.from)
        ? depth(edit.from)
        : depth(edit.into);
      if (kids && finalDepth !== null && finalDepth >= 2)
        return "Workstreams go at most two levels deep.";
      return null;
    }
    case "rename":
      return null;
  }
}

/**
 * Top-level workstreams named as if they belonged under another workstream: "Vercel
 * Agent Code Review" beside "Vercel Agent". Each becomes a move under the
 * workstream with workstreams in a group its name begins with (the longest, when several do),
 * renamed without the shared words. Workstreams already under a parent keep it; moves that would
 * break a rule of the tree aren't proposed. No model is asked, so these are
 * found whenever the tree changes.
 */
export function prefixMoves(state: TreeState): ProposedEdit[] {
  const out: ProposedEdit[] = [];
  for (const workstream of state.workstreams) {
    if (workstream.parentId !== null) continue;
    const parent = state.workstreams
      .filter(
        (other) =>
          other.id !== workstream.id &&
          other.name.length < workstream.name.length &&
          startsWith(workstream.name, other.name) &&
          state.workstreams.some((t) => t.parentId === other.id),
      )
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (!parent) continue;
    const name = workstream.name.slice(parent.name.length).trim();
    if (!validName(name)) continue;
    const edit: TidyEdit = {
      op: "move-workstream",
      workstream: workstream.id,
      parent: parent.id,
      name,
    };
    if (refusal(edit, state)) continue;
    out.push({
      edit,
      reason: `Its name begins with ${parent.name}, so it belongs in that group.`,
    });
  }
  return out;
}

/** A stable identity for an edit, so a declined one isn't proposed again. */
export function editKey(edit: TidyEdit | Split): string {
  if ("workstreams" in edit)
    return JSON.stringify([
      "split",
      edit.workstreamId,
      edit.workstreams.map((g) => [
        g.name.toLowerCase(),
        [...g.threadIds].sort(),
      ]),
    ]);
  switch (edit.op) {
    case "merge":
      return JSON.stringify([edit.op, edit.from, edit.into]);
    // A move is the same suggestion whatever it renames the workstream to.
    case "move-workstream":
      return JSON.stringify([edit.op, edit.workstream, edit.parent]);
    case "rename":
      return JSON.stringify([
        edit.op,
        edit.workstream,
        edit.name.toLowerCase(),
      ]);
    case "group":
      return JSON.stringify([
        edit.op,
        edit.name.toLowerCase(),
        edit.parent,
        [...edit.children].sort(),
      ]);
    case "move-thread":
      return JSON.stringify([edit.op, edit.thread, edit.workstream]);
  }
}

/** A one-line description of an edit, for review and for tidy's memory. */
export function describeEdit(
  edit: TidyEdit | Split,
  names: {
    workstream: (ref: string | null) => string;
    thread: (id: string) => string;
  },
): string {
  if ("workstreams" in edit)
    return edit.repair
      ? `Move ${names.workstream(edit.workstreamId)}'s own threads into ${edit.workstreams.map((g) => g.name).join(", ")}`
      : `Split ${names.workstream(edit.workstreamId)} into ${edit.workstreams.map((g) => g.name).join(", ")}`;
  switch (edit.op) {
    case "merge":
      return `Merge ${names.workstream(edit.from)} into ${names.workstream(edit.into)}`;
    case "move-workstream":
      return `${
        edit.parent
          ? `Move ${names.workstream(edit.workstream)} into ${names.workstream(edit.parent)}`
          : `Move ${names.workstream(edit.workstream)} out of its group`
      }${edit.name === undefined ? "" : ` as ${edit.name}`}`;
    case "rename":
      return `Rename ${names.workstream(edit.workstream)} to ${edit.name}`;
    case "group":
      return `Group ${edit.children.map(names.workstream).join(", ")} under a new group, ${edit.name}${edit.parent ? `, in ${names.workstream(edit.parent)}` : ""}`;
    case "move-thread":
      return `Move “${names.thread(edit.thread)}” to ${names.workstream(edit.workstream)}`;
  }
}

/** A split as it would apply to the tree now. */
type SplitNow = {
  /**
   * The split without threads that left the group or closed since, and
   * without the new workstreams that left it empty.
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
 * joined than remain, or a split would leave only one workstream with threads.
 */
export function splitNow(split: Split, state: TreeState): SplitNow {
  const group = state.workstreams.find((t) => t.id === split.workstreamId);
  const stop = (problem: string): SplitNow => ({
    split,
    arrivals: [],
    problem,
    moot: true,
  });
  if (!group) return stop("Its group is gone.");
  const inGroup = new Set(
    Object.entries(state.threadWorkstream)
      .filter(([, workstream]) => workstream === split.workstreamId)
      .map(([id]) => id),
  );
  const existing = new Set(
    state.workstreams
      .filter((t) => t.parentId === split.workstreamId)
      .map((t) => t.name.trim().toLowerCase()),
  );
  const workstreams = split.workstreams
    .map((g) => ({
      ...g,
      threadIds: g.threadIds.filter((id) => inGroup.has(id)),
    }))
    .filter(
      (g) =>
        g.threadIds.length > 0 || existing.has(g.name.trim().toLowerCase()),
    );
  const kept = workstreams.reduce((n, g) => n + g.threadIds.length, 0);
  const listed = new Set(split.workstreams.flatMap((g) => g.threadIds));
  const arrivals = [...inGroup].filter((id) => !listed.has(id));
  const now = { ...split, workstreams };
  if (kept === 0)
    return stop(
      split.repair && inGroup.size === 0
        ? `${group.name} no longer holds threads beside its workstreams.`
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
    workstreams.filter((g) => g.threadIds.length > 0).length < 2
  )
    return {
      split: now,
      arrivals,
      problem: "Only one of its workstreams still has threads.",
      moot: false,
    };
  return { split: now, arrivals, problem: null, moot: false };
}
