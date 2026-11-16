/**
 * Placement: the one call that chooses a root's workstream from its requests.
 * Pure, so the server, its trace replays, and the eval share one prompt and
 * parser.
 *
 * The choice is closed: only a workstream without workstreams in a group holds threads, so a
 * workstream with workstreams in a group is listed for context but can't be chosen. When no
 * workstream fits, the answer may propose one new workstream, named for a lasting area
 * of work. Quick's composer preview can propose a missing product and its
 * capability together; Placement supplies one new name and an existing parent.
 * Hints (continuations and checkouts) inform the choice without overriding it.
 *
 * Workstream IDs are long and opaque, so the prompt names workstreams by slugs of their
 * names (`fork-core`), and the parser maps them back from the same input.
 */
import { z } from "zod";
import { excerpt, HEADER, redact, stripFence, tagged } from "./analysis.ts";
import type { WorkstreamAnswer } from "./classify.ts";
import {
  assertProposalLevels,
  resolveProposal,
  takesThreads,
  workstreamAncestors,
} from "./topics.ts";
import { PATH_MARK, PATH_SEPARATOR } from "./topic-path.ts";

/** Requests are excerpted to this much each. */
const REQUEST_CHARS = 1200;
/**
 * At most this many workstreams are listed: the answer's ID enums stay within
 * structured-output limits.
 */
const CHOICE_WORKSTREAMS_MAX = 450;

type ChoiceWorkstream = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentId: string | null;
  readonly aliases: readonly string[];
};

export type WorkstreamChoiceInput = {
  /** The thread's generated title, when it has one. */
  readonly title: string | null;
  /** A user-chosen destination: choose an existing leaf inside this workstream only. */
  readonly within?: string;
  /** Substantive requests, oldest first: the first, second, and latest. */
  readonly requests: readonly string[];
  readonly project: string | null;
  readonly checkout: string | null;
  readonly workstreams: readonly ChoiceWorkstream[];
  /** Visible roots assigned to each workstream. */
  readonly counts?: Readonly<Record<string, number>>;
  /** Evidence about where it belongs: continuations, checkouts. */
  readonly hints: readonly string[];
  /** Its workstream now, when it has one. */
  readonly current: {
    readonly label: string;
    readonly inherited: boolean;
  } | null;
  /** The context digest the turn-end call settled for the thread, when it has one. */
  readonly digest?: string | null;
};

export type WorkstreamChoiceOutput = WorkstreamAnswer & { scopeShift: boolean };

/** A workstream name as a prompt ID: "Fork & Core" → "fork-core". */
const slug = (name: string) =>
  name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workstream";

/**
 * Workstream IDs in tree order, each with its prompt ID: the workstream's name as a
 * slug, which a model copies far more reliably than an opaque counter. A name
 * used twice takes its parent's slug first, then a number.
 */
export function promptIds(
  workstreams: readonly ChoiceWorkstream[],
): Map<string, string> {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  const known = new Set(workstreams.map((workstream) => workstream.id));
  const visit = (parentId: string | null, parentSlug: string | null) => {
    for (const workstream of workstreams
      .filter(
        (e) =>
          (parentId === null
            ? e.parentId === null || !known.has(e.parentId)
            : e.parentId === parentId) && !ids.has(e.id),
      )
      .sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      )) {
      let id = slug(workstream.name);
      if (taken.has(id) && parentSlug) id = `${parentSlug}-${id}`.slice(0, 60);
      for (let n = 2, base = id; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      ids.set(workstream.id, id);
      visit(workstream.id, id);
    }
  };
  visit(null, null);
  return ids;
}

const line = (value: string, max: number) =>
  redact(value).replace(/\s+/g, " ").trim().slice(0, max);

function treeBlock(
  input: WorkstreamChoiceInput,
  ids: Map<string, string>,
): string {
  if (input.workstreams.length > CHOICE_WORKSTREAMS_MAX)
    throw new Error("There are too many workstreams for one prompt.");
  const byId = new Map(
    input.workstreams.map((workstream) => [workstream.id, workstream]),
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
  const rows = [...ids].map(([id, short]) => {
    const workstream = byId.get(id)!;
    const description = line(workstream.description ?? "", 240);
    const aliases = workstream.aliases.map((alias) => line(alias, 60));
    const count = input.counts?.[id] ?? 0;
    const facts = [
      takesThreads(id, input.workstreams)
        ? `${count} ${count === 1 ? "thread" : "threads"}`
        : "group",
      aliases.length ? `aliases: ${aliases.join(", ")}` : null,
    ].filter(Boolean);
    return `${"  ".repeat(depth(id))}- [${short}] ${line(workstream.name, 80)}${description ? ` — ${description}` : ""} (${facts.join("; ")})`;
  });
  return rows.length ? rows.join("\n") : "(no workstreams yet)";
}

const CHOICE_RULES = `Choose the workstream this thread's work belongs to: the most specific listed workstream whose scope genuinely covers it. Entries marked "group" hold workstreams, never threads, so they can't be chosen: choose one of their workstreams, or propose a new workstream of the same kind inside the group. A broad top-level workstream covers the product as a whole or work without a supported narrower area. When requests establish a distinct lasting capability within that broad product, propose a workstream inside it rather than using the broad product as the final identity. A single-purpose tool covers its fixes, refactors, and reviews without separate workstreams for those tasks. If no workstream covers the work, propose one new workstream: the product, area, or capability that later threads would also belong to, named for that area ("Billing", "Mobile app"), never for this thread's task, question, pull request, or bug, and never for a repository or workspace used to route or coordinate work. Workstreams go at most two levels deep: a top-level entry, then the workstreams inside it. Give a new workstream a parent only when that parent is top-level. Choose an existing second-level workstream for work on its finer areas. Use meaningful lasting areas rather than General or Other. Thread volume does not establish workstreams inside another.

A workstream about a different product is never a fit, however close: when the requests name the product, platform, or tool the work belongs to, a workstream beneath a different owner doesn't fit however closely its description matches, and a new workstream under the named owner is the answer. A tool used only as the method for otherwise unspecified work doesn't make the work about that tool, and a bare URL or reference supports at most a product the requests name; with no supported owner, give no workstream. When proposing a new top-level workstream, use the owner's recognizable product name, not that name joined to a capability or an implementation layer. In this call, propose supplies one new workstream; parent names an existing top-level entry or is null. When the product is absent, establish its recognizable product name at the top level first. Work on a product's SDK establishes that product first too, rather than a top-level workstream named for the product plus SDK. An independently named tool product keeps its whole name. Name new workstreams in Title Case, keeping product names' own spelling. Hints are evidence, not rules.`;

/**
 * Where an answer files the thread, as its listing names it: the chosen
 * workstream's path, or a proposal's name; null when it files nothing.
 */
export function chosenPath(
  answer: WorkstreamChoiceOutput,
  workstreams: readonly ChoiceWorkstream[],
): string | null {
  if (answer.workstreamId)
    return workstreamAncestors(answer.workstreamId, workstreams)
      .reverse()
      .map((id) => workstreams.find((e) => e.id === id)?.name)
      .filter(Boolean)
      .join(PATH_SEPARATOR);
  return answer.proposed?.name ?? null;
}

export type WorkstreamChoiceOptions = Pick<
  WorkstreamChoiceInput,
  "workstreams" | "within"
>;

/**
 * The workstreams that can hold the thread: the user's group choice constrains both
 * generation and parsing, not just the prompt.
 */
export function choosableWorkstreams(
  input: WorkstreamChoiceOptions,
): Set<string> {
  if (input.within && !input.workstreams.some((e) => e.id === input.within))
    throw new Error("The destination group is unavailable.");
  return new Set(
    input.workstreams
      .filter(
        (e) =>
          takesThreads(e.id, input.workstreams) &&
          workstreamAncestors(e.id, input.workstreams).length <= 2 &&
          (!input.within ||
            workstreamAncestors(e.id, input.workstreams).includes(
              input.within,
            )),
      )
      .map((e) => e.id),
  );
}

/**
 * The evidence blocks a workstream choice reads: the tree, the user's destination,
 * the thread's title, project, checkout, requests, hints, current workstream, and
 * digest. Calls that settle more than a workstream (a thread's start, a turn's end)
 * pass `title: false` and `requests: false` when they supply those blocks
 * themselves.
 */
export function choiceSections(
  input: WorkstreamChoiceInput,
  include: { title?: boolean; requests?: boolean; digest?: boolean } = {},
): string[] {
  const ids = promptIds(input.workstreams);
  const requests = input.requests.map((text, index) =>
    tagged(
      index === 0 ? "opening_request" : "user_request",
      excerpt(redact(text), REQUEST_CHARS),
    ),
  );
  return [
    `The workstreams and groups, where indentation shows the group an entry is in and each entry's ID is in square brackets:\n${tagged("workstream_tree", treeBlock(input, ids))}`,
    input.within
      ? `The user's destination group:\n${tagged(
          "group",
          line(
            workstreamAncestors(input.within, input.workstreams)
              .reverse()
              .map((id) => input.workstreams.find((e) => e.id === id)!.name)
              .join(PATH_SEPARATOR),
            300,
          ),
          { id: ids.get(input.within) },
        )}`
      : null,
    include.title !== false && input.title
      ? `The thread's generated title:\n${tagged("title", line(input.title, 120))}`
      : null,
    input.project
      ? `The project it runs in:\n${tagged("project", line(input.project, 100))}`
      : null,
    input.checkout
      ? `Its checkout:\n${tagged("checkout", line(input.checkout, 200))}`
      : null,
    include.requests !== false
      ? `Its requests, oldest first:\n${requests.join("\n")}`
      : null,
    input.hints.length
      ? `Hints:\n${input.hints.map((hint) => tagged("hint", line(hint, 300))).join("\n")}`
      : null,
    input.current
      ? `Its current workstream${input.current.inherited ? ", from the thread or workstream it was started from" : ""}:\n${tagged("current_workstream", line(input.current.label, 200))}`
      : null,
    include.digest !== false && input.digest
      ? `The thread's accumulated context, which a single later request refines more often than it replaces:\n${tagged("thread_digest", line(input.digest, 500))}`
      : null,
  ].filter((section): section is string => section !== null);
}

/** The workstream fields' rules: what `workstream`, `propose`, and `scopeShift` mean. */
export function choiceFields(input: WorkstreamChoiceOptions): string[] {
  return [
    `- workstream: the ID in square brackets of the chosen workstream${input.within ? " within the destination group." : ", or null."}`,
    `- propose: ${input.within ? "null; moves into a group choose only existing workstreams." : 'null, or {"name": string, "description": string, "parent": string|null} for one new workstream when none fits; parent is the ID of the top-level entry it belongs inside, or null.'}`,
    "- scopeShift: true only when the latest request moved the thread to work with a different primary owner than its current workstream; otherwise false.",
    input.within
      ? "Give an existing workstream inside the user's destination group and set propose to null."
      : "Give a workstream or a proposal, never both; both null when the work's owner is unknown.",
  ];
}

/** The workstream fields as they appear in a call's `Return {…}` line. */
export function choiceKeys(input: WorkstreamChoiceOptions): string[] {
  return input.within
    ? ['"workstream": string', '"propose": null', '"scopeShift": boolean']
    : [
        '"workstream": string|null',
        '"propose": object|null',
        '"scopeShift": boolean',
      ];
}

/** The user's destination, as placement's instruction. */
export function choiceRules(input: WorkstreamChoiceOptions): string {
  return input.within
    ? `The user moved this thread into the destination identified by the group block. Choose the existing workstream within that group whose scope best covers the thread's work. This destination is the user's decision: the old workstream, project, checkout, and hints cannot move it outside that group. Choose a workstream, never a group. Do not propose a new workstream or leave the thread in no workstream.`
    : CHOICE_RULES;
}

export function workstreamChoicePrompt(input: WorkstreamChoiceInput): string {
  return `${HEADER}

You choose the workstream for one agent thread, for someone who switches between dozens of threads.

${choiceRules(input)}

${choiceSections(input).join("\n\n")}

Return {${choiceKeys(input).join(", ")}}:
${choiceFields(input).join("\n")}`;
}

/** JSON Schema constrains IDs at generation as well as at parsing. */
export function workstreamChoiceSchema(
  input: WorkstreamChoiceOptions,
): Record<string, unknown> {
  const properties = choiceProperties(input);
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

/** The workstream fields' JSON Schema, for calls that settle more than a workstream. */
export function choiceProperties(
  input: WorkstreamChoiceOptions,
): Record<string, unknown> {
  const ids = promptIds(input.workstreams);
  const allowed = choosableWorkstreams(input);
  const choices = [...ids]
    .filter(([id]) => allowed.has(id))
    .map(([, short]) => short);
  return {
    workstream: input.within
      ? { type: "string", enum: choices }
      : { type: ["string", "null"], enum: [null, ...choices] },
    propose: input.within
      ? { type: "null" }
      : {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                parent: {
                  type: ["string", "null"],
                  enum: [
                    null,
                    ...[...ids]
                      .filter(
                        ([id]) =>
                          input.workstreams.find(
                            (workstream) => workstream.id === id,
                          )?.parentId === null,
                      )
                      .map(([, short]) => short),
                  ],
                },
              },
              required: ["name", "description", "parent"],
            },
          ],
        },
    scopeShift: { type: "boolean" },
  };
}

const outputSchema = z.object({
  workstream: z.string().nullish(),
  propose: z
    .object({
      name: z.string().trim().min(1).max(80),
      description: z
        .string()
        .trim()
        .max(300)
        .nullish()
        .transform((d) => d ?? ""),
      parent: z.string().nullish(),
    })
    .nullish(),
  scopeShift: z.boolean().catch(false).optional(),
});

/**
 * Checks an answer against the tree it was asked about. A chosen workstream must
 * hold threads; a proposal that names an existing workstream becomes that workstream.
 */
export function parseWorkstreamChoice(
  text: string,
  input: WorkstreamChoiceOptions,
): WorkstreamChoiceOutput {
  return parseChoiceFields(JSON.parse(stripFence(text)), input);
}

/** Checks the workstream fields of an already-decoded answer (see `parsePlacement`). */
export function parseChoiceFields(
  raw: unknown,
  input: WorkstreamChoiceOptions,
): WorkstreamChoiceOutput {
  const parsed = outputSchema.parse(raw);
  if (parsed.workstream != null && parsed.propose != null)
    throw new Error("Choose a workstream or a proposal, never both.");
  const allowed = choosableWorkstreams(input);
  if (input.within && (!parsed.workstream || parsed.propose))
    throw new Error(
      "The model did not choose an existing workstream within the destination.",
    );
  const byShort = new Map(
    [...promptIds(input.workstreams)].map(([id, short]) => [short, id]),
  );
  const scopeShift = parsed.scopeShift ?? false;
  if (parsed.workstream) {
    const id = byShort.get(parsed.workstream);
    if (!id || !allowed.has(id))
      throw new Error("The model chose a group, which can't hold threads.");
    return { workstreamId: id, proposed: null, scopeShift };
  }
  if (!parsed.propose)
    return { workstreamId: null, proposed: null, scopeShift };
  const { name, description, parent } = parsed.propose;
  const parentId = parent ? byShort.get(parent) : null;
  if (parentId === undefined || name.includes(PATH_MARK))
    throw new Error("The model proposed an unsupported workstream.");
  const resolved = resolveProposal(
    { name, description, parentId },
    input.workstreams,
  );
  // A proposal that names an existing workstream is that workstream. One with
  // workstreams in a group can't hold the thread; applying it keeps the thread's workstream.
  if (resolved.workstreamId !== null) {
    if (!allowed.has(resolved.workstreamId))
      throw new Error("The model chose a group, which can't hold threads.");
    return { workstreamId: resolved.workstreamId, proposed: null, scopeShift };
  }
  assertProposalLevels(resolved.proposed, input.workstreams);
  if (
    resolved.proposed.parentId &&
    /^(general|other)$/i.test(resolved.proposed.name)
  )
    throw new Error("A workstream in a group needs a meaningful area name.");
  return { workstreamId: null, proposed: resolved.proposed, scopeShift };
}
