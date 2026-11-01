/**
 * Placement: the one call that chooses a root's topic from its requests.
 * Pure, so the server, its trace replays, and the eval share one prompt and
 * parser.
 *
 * The choice is closed: only a topic without subtopics holds threads, so a
 * topic with subtopics is listed for context but can't be chosen. When no
 * topic fits, the answer may propose one new topic, named for a lasting area
 * of work. Hints (the topic of the thread this one continues, the checkout's
 * usual topic) are evidence the model weighs, never overrides.
 *
 * Topic IDs are long and opaque, so the prompt names topics by slugs of their
 * names (`fork-core`), and the parser maps them back from the same input.
 */
import { z } from "zod";
import { excerpt, HEADER, redact, stripFence, tagged } from "./analysis.ts";
import type { TopicAnswer } from "./classify.ts";
import { resolveProposal, takesThreads, topicAncestors } from "./topics.ts";

/** Requests are excerpted to this much each. */
const REQUEST_CHARS = 1200;
/**
 * At most this many topics are listed: the answer's ID enums stay within
 * structured-output limits.
 */
export const PLACEMENT_TOPICS_MAX = 450;

export type PlacementTopic = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentId: string | null;
  readonly aliases: readonly string[];
};

export type PlacementInput = {
  /** The thread's generated title, when it has one. */
  readonly title: string | null;
  /** A user-chosen destination: choose an existing leaf inside this topic only. */
  readonly within?: string;
  /** Substantive requests, oldest first: the first, second, and latest. */
  readonly requests: readonly string[];
  readonly project: string | null;
  readonly checkout: string | null;
  readonly entities: readonly PlacementTopic[];
  /** Visible roots assigned to each topic. */
  readonly counts?: Readonly<Record<string, number>>;
  /** Evidence about where it belongs: continuations, checkouts. */
  readonly hints: readonly string[];
  /** Its topic now, when it has one. */
  readonly current: {
    readonly label: string;
    readonly inherited: boolean;
  } | null;
};

export type PlacementOutput = TopicAnswer & { scopeShift: boolean };

/** A topic name as a prompt ID: "Fork & Core" → "fork-core". */
const slug = (name: string) =>
  name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "topic";

/**
 * Topic IDs in tree order, each with its prompt ID: the topic's name as a
 * slug, which a model copies far more reliably than an opaque counter. A name
 * used twice takes its parent's slug first, then a number.
 */
export function placementIds(
  entities: readonly PlacementTopic[],
): Map<string, string> {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  const known = new Set(entities.map((entity) => entity.id));
  const visit = (parentId: string | null, parentSlug: string | null) => {
    for (const entity of entities
      .filter(
        (e) =>
          (parentId === null
            ? e.parentId === null || !known.has(e.parentId)
            : e.parentId === parentId) && !ids.has(e.id),
      )
      .sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      )) {
      let id = slug(entity.name);
      if (taken.has(id) && parentSlug) id = `${parentSlug}-${id}`.slice(0, 60);
      for (let n = 2, base = id; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      ids.set(entity.id, id);
      visit(entity.id, id);
    }
  };
  visit(null, null);
  return ids;
}

const line = (value: string, max: number) =>
  redact(value).replace(/\s+/g, " ").trim().slice(0, max);

function treeBlock(input: PlacementInput, ids: Map<string, string>): string {
  if (input.entities.length > PLACEMENT_TOPICS_MAX)
    throw new Error("The topic tree is too large for one prompt.");
  const byId = new Map(input.entities.map((entity) => [entity.id, entity]));
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
    const entity = byId.get(id)!;
    const description = line(entity.description ?? "", 240);
    const aliases = entity.aliases.map((alias) => line(alias, 60));
    const count = input.counts?.[id] ?? 0;
    const facts = [
      takesThreads(id, input.entities)
        ? `${count} ${count === 1 ? "thread" : "threads"}`
        : "has subtopics",
      aliases.length ? `aliases: ${aliases.join(", ")}` : null,
    ].filter(Boolean);
    return `${"  ".repeat(depth(id))}- [${short}] ${line(entity.name, 80)}${description ? ` — ${description}` : ""} (${facts.join("; ")})`;
  });
  return rows.length ? rows.join("\n") : "(no topics yet)";
}

export const PLACEMENT_RULES = `Choose the topic this thread's work belongs to: the most specific listed topic whose scope genuinely covers it. Topics marked "has subtopics" hold subtopics, never threads, so they can't be chosen: choose one of their subtopics, or propose a new subtopic of the same kind inside them. If no topic covers the work, propose one new topic: the product, area, or capability that later threads would also belong to, named for that area ("Billing", "Mobile app"), never for this thread's task, question, pull request, or bug, and never for a repository or workspace used to route or coordinate work. Give it a parent when it belongs inside an existing topic.

A topic about a different product is never a fit, however close: when the requests name the product, platform, or tool the work belongs to, a topic beneath a different owner doesn't fit however closely its description matches, and a new topic under the named owner is the answer. A tool used only as the method for otherwise unspecified work doesn't make the work about that tool, and a bare URL or reference supports at most a product the requests name; with no supported owner, give no topic. Name new topics in Title Case, keeping product names' own spelling. Hints are evidence, not rules.`;

type PlacementChoices = Pick<PlacementInput, "entities" | "within">;

/** The user's group choice constrains both generation and parsing, not just the prompt. */
function choosable(input: PlacementChoices): Set<string> {
  if (input.within && !input.entities.some((e) => e.id === input.within))
    throw new Error("The destination topic is unavailable.");
  return new Set(
    input.entities
      .filter(
        (e) =>
          takesThreads(e.id, input.entities) &&
          (!input.within ||
            topicAncestors(e.id, input.entities).includes(input.within)),
      )
      .map((e) => e.id),
  );
}

export function placementPrompt(input: PlacementInput): string {
  const ids = placementIds(input.entities);
  const requests = input.requests.map((text, index) =>
    tagged(
      index === 0 ? "opening_request" : "user_request",
      excerpt(redact(text), REQUEST_CHARS),
    ),
  );
  const sections = [
    `The topic tree, where indentation expresses parentage and each topic's ID is in square brackets:\n${tagged("topic_tree", treeBlock(input, ids))}`,
    input.title
      ? `The thread's generated title:\n${tagged("title", line(input.title, 120))}`
      : null,
    input.project
      ? `The project it runs in:\n${tagged("project", line(input.project, 100))}`
      : null,
    input.checkout
      ? `Its checkout:\n${tagged("checkout", line(input.checkout, 200))}`
      : null,
    `Its requests, oldest first:\n${requests.join("\n")}`,
    input.hints.length
      ? `Hints:\n${input.hints.map((hint) => tagged("hint", line(hint, 300))).join("\n")}`
      : null,
    input.current
      ? `Its current topic${input.current.inherited ? ", from the thread or workstream it was started from" : ""}:\n${tagged("current_topic", line(input.current.label, 200))}`
      : null,
  ].filter(Boolean);
  return `${HEADER}

You file one agent thread under a topic, for someone who switches between dozens of threads.

${
  input.within
    ? `The user moved this thread into ${line(
        topicAncestors(input.within, input.entities)
          .reverse()
          .map((id) => input.entities.find((e) => e.id === id)!.name)
          .join(": "),
        300,
      )}. Choose the existing topic within that group whose scope best covers the thread's work. This destination is the user's decision: the old topic, project, checkout, and hints cannot move it outside that group. Choose a topic without subtopics. Do not propose a new topic or leave the thread unfiled.`
    : PLACEMENT_RULES
}

${sections.join("\n\n")}

Return ${input.within ? '{"topic": string, "propose": null, "scopeShift": boolean}' : '{"topic": string|null, "propose": object|null, "scopeShift": boolean}'}:
- topic: the ID in square brackets of the chosen topic${input.within ? " within the destination group." : ", or null."}
- propose: ${input.within ? "null; group moves choose only existing topics." : 'null, or {"name": string, "description": string, "parent": string|null} for one new topic when none fits; parent is the ID of the topic it belongs inside, or null.'}
- scopeShift: true only when the latest request moved the thread to work with a different primary owner than its current topic; otherwise false.
${input.within ? "Give an existing topic inside the user's destination group and set propose to null." : "Give a topic or a proposal, never both; both null when the work's owner is unknown."}`;
}

/** JSON Schema constrains IDs at generation as well as at parsing. */
export function placementSchema(
  input: PlacementChoices,
): Record<string, unknown> {
  const ids = placementIds(input.entities);
  const allowed = choosable(input);
  const choices = [...ids]
    .filter(([id]) => allowed.has(id))
    .map(([, short]) => short);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: input.within
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
                    enum: [null, ...ids.values()],
                  },
                },
                required: ["name", "description", "parent"],
              },
            ],
          },
      scopeShift: { type: "boolean" },
    },
    required: ["topic", "propose", "scopeShift"],
  };
}

const outputSchema = z.object({
  topic: z.string().nullish(),
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
 * Checks an answer against the tree it was asked about. A chosen topic must
 * hold threads; a proposal that names an existing topic becomes that topic.
 */
export function parsePlacement(
  text: string,
  input: PlacementChoices,
): PlacementOutput {
  const parsed = outputSchema.parse(JSON.parse(stripFence(text)));
  const allowed = choosable(input);
  if (input.within && (!parsed.topic || parsed.propose))
    throw new Error(
      "The model did not choose an existing topic within the destination.",
    );
  const byShort = new Map(
    [...placementIds(input.entities)].map(([id, short]) => [short, id]),
  );
  const scopeShift = parsed.scopeShift ?? false;
  if (parsed.topic) {
    const id = byShort.get(parsed.topic);
    if (!id || !allowed.has(id))
      throw new Error("The model chose a topic that can't hold threads.");
    return { subjectId: id, proposed: null, scopeShift };
  }
  if (!parsed.propose) return { subjectId: null, proposed: null, scopeShift };
  const { name, description, parent } = parsed.propose;
  const parentId = parent ? byShort.get(parent) : null;
  if (parentId === undefined || name.includes(":"))
    throw new Error("The model proposed an unsupported topic.");
  const resolved = resolveProposal(
    { name, description, parentId },
    input.entities,
  );
  // A proposal that names an existing topic is that topic. One with
  // subtopics can't hold the thread; applying it keeps the thread's topic.
  if (resolved.subjectId !== null)
    return { subjectId: resolved.subjectId, proposed: null, scopeShift };
  return { subjectId: null, proposed: resolved.proposed, scopeShift };
}
