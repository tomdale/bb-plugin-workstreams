/*
 * Categories arrange a workstream's current collection of threads.
 */
import { z } from "zod";
import { HEADER, redact, stripFence, tagged } from "./analysis.ts";

export const CATEGORY_CREATE_AT = 6;
export const CATEGORY_DISCARD_AT = 3;

export type Category = {
  id: string;
  name: string;
  threadIds: string[];
};

export type CategoryThread = {
  id: string;
  title: string;
  work: string;
  /** Changes with substantive request evidence, not title or status updates. */
  workKey: string;
};

export type CategoryCollection = {
  workstreamId: string;
  label: string;
  threads: CategoryThread[];
};

export const categoryGenerationSchema = z.object({
  id: z.string(),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      threadIds: z.array(z.string()),
    }),
  ),
});
export type CategoryGeneration = z.infer<typeof categoryGenerationSchema>;

export type CategoryInput = CategoryCollection & {
  current: CategoryGeneration | null;
};

export type CategoryDecision = {
  keep: boolean;
  reason: string;
  categories: Array<{
    id: string | null;
    name: string;
    threadIds: string[];
  }>;
};

/** Names and status are presentation; only membership and work trigger a call. */
export function categoryCollectionKey(collection: CategoryCollection): string {
  return JSON.stringify(
    [...collection.threads]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, workKey }) => [id, workKey]),
  );
}

export function categoryAction(
  generation: CategoryGeneration | null,
  count: number,
): "discard" | "classify" | "none" {
  if (count <= CATEGORY_DISCARD_AT) return "discard";
  if (generation || count >= CATEGORY_CREATE_AT) return "classify";
  return "none";
}

/** Departing threads leave immediately, even while inference is in flight. */
export function pruneCategories(
  generation: CategoryGeneration,
  threads: readonly { id: string }[],
): CategoryGeneration {
  const present = new Set(threads.map((thread) => thread.id));
  return {
    ...generation,
    categories: generation.categories
      .map((category) => ({
        ...category,
        threadIds: category.threadIds.filter((id) => present.has(id)),
      }))
      .filter((category) => category.threadIds.length > 0),
  };
}

const clean = (value: string, max: number) =>
  redact(value).replace(/\s+/g, " ").trim().slice(0, max);
const shortIds = (input: CategoryInput) =>
  new Map(input.threads.map((thread, i) => [thread.id, `r${i + 1}`]));
const categoryIds = (input: CategoryInput) =>
  new Map(
    (input.current?.categories ?? []).map((category, i) => [
      category.id,
      `c${i + 1}`,
    ]),
  );

export function categoryPrompt(input: CategoryInput): string {
  const shortOf = shortIds(input);
  const categories = categoryIds(input);
  return `${HEADER}

Organize the current collection of agent threads within one workstream into useful sidebar categories. These categories describe this collection, not permanent product or feature identity.

Read every thread in context of the others. Choose clear distinctions that make the collection meaningfully easier to scan. A category groups threads that share one theme; use a singleton only for work that shares a theme with no other thread, and regroup an arrangement that is mostly singletons around the themes its threads share. Do not force equal sizes, matching names, or a General/Other catch-all. Choose the number of categories the collection supports. Use at least two when there are no current categories; an existing arrangement may contract to one category as its collection changes.

When current categories are supplied, put each thread they omit into the existing category whose theme it shares. Keep existing names and memberships unless changing them has a meaningful organizational benefit. Minor or superficial improvements do not justify changes. You may recategorize the whole collection when its work supports clearer boundaries. Reuse an existing category ID when its meaning survives; use null for a new category. A category's name states the one theme its members share, without repeating the workstream's name or chaining distinct themes; join scopes within a theme with "&", never "and" or a comma. Rename a category whose name no longer covers its members. A thread's status or stage alone does not establish what it is about.

${tagged("current_workstream", clean(input.label, 300))}

${tagged(
  "threads",
  input.threads
    .map(
      (thread) =>
        `- [${shortOf.get(thread.id)}] ${clean(thread.title, 120)}${thread.work ? ` — ${clean(thread.work, 1200)}` : ""}`,
    )
    .join("\n"),
)}

${tagged(
  "group",
  input.current?.categories.length
    ? input.current.categories
        .map(
          (category) =>
            `- [${categories.get(category.id)}] ${clean(category.name, 80)}: ${category.threadIds
              .map((id) => shortOf.get(id))
              .filter(Boolean)
              .join(", ")}`,
        )
        .join("\n")
    : "(none)",
)}

Return {"keep": boolean, "reason": string, "categories": [{"id": string|null, "name": string, "threadIds": string[]}]}.
Use keep=true with categories=[] when keeping the current arrangement. This form requires the current categories to file every listed thread exactly once; explain the choice in reason. Otherwise return keep=false and the complete arrangement: every listed thread ID exactly once, with no empty categories. Give a short reason naming the useful distinction or why the current arrangement should stay.`;
}

export function categorySchema(input: CategoryInput): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      keep: { type: "boolean" },
      reason: { type: "string" },
      categories: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: categoryIds(input).size
              ? {
                  anyOf: [
                    { type: "null" },
                    { type: "string", enum: [...categoryIds(input).values()] },
                  ],
                }
              : { type: "null" },
            name: { type: "string" },
            threadIds: {
              type: "array",
              items: { type: "string", enum: [...shortIds(input).values()] },
            },
          },
          required: ["id", "name", "threadIds"],
        },
      },
    },
    required: ["keep", "reason", "categories"],
  };
}

const decisionSchema = z.object({
  keep: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
  categories: z.array(
    z.object({
      id: z.string().nullable(),
      name: z.string().trim().min(1).max(80),
      threadIds: z.array(z.string()).min(1),
    }),
  ),
});

function isPartition(ids: readonly string[], expected: ReadonlySet<string>) {
  return (
    ids.length === expected.size &&
    new Set(ids).size === ids.length &&
    ids.every((id) => expected.has(id))
  );
}

export function parseCategories(
  text: string,
  input: CategoryInput,
): CategoryDecision {
  const decision = decisionSchema.parse(JSON.parse(stripFence(text)));
  const expected = new Set(input.threads.map((thread) => thread.id));
  if (expected.size !== input.threads.length)
    throw new Error("The category collection repeats a thread.");
  if (decision.keep) {
    if (
      !input.current ||
      decision.categories.length > 0 ||
      !isPartition(
        input.current.categories.flatMap((category) => category.threadIds),
        expected,
      )
    )
      throw new Error("The current categories do not cover the collection.");
    return decision;
  }
  if (decision.categories.length < (input.current ? 1 : 2))
    throw new Error(
      "A fresh category generation needs at least two categories.",
    );
  const idOf = new Map([...shortIds(input)].map(([id, short]) => [short, id]));
  const categories = new Map(
    [...categoryIds(input)].map(([id, short]) => [short, id]),
  );
  const names = new Set<string>();
  const used = new Set<string>();
  const resolved = decision.categories.map((category) => {
    const name = category.name.toLocaleLowerCase();
    if (names.has(name)) throw new Error("Category names must be distinct.");
    names.add(name);
    const id = category.id === null ? null : categories.get(category.id);
    if (id === undefined || (id !== null && used.has(id)))
      throw new Error("The classifier named an unsupported category.");
    if (id !== null) used.add(id);
    return {
      ...category,
      id,
      threadIds: category.threadIds.map((short) => {
        const threadId = idOf.get(short);
        if (!threadId)
          throw new Error("The classifier named an unknown thread.");
        return threadId;
      }),
    };
  });
  if (
    !isPartition(
      resolved.flatMap((category) => category.threadIds),
      expected,
    )
  )
    throw new Error("Categories must place every thread exactly once.");
  return { ...decision, categories: resolved };
}

// Fit check ---------------------------------------------------------------

/**
 * Whether an arrangement is mostly categories of one, which only a full
 * rearrangement can regroup: moving a newcomer into one of them would keep it.
 */
export function mostlySingletons(generation: CategoryGeneration): boolean {
  const singles = generation.categories.filter(
    (category) => category.threadIds.length === 1,
  ).length;
  return singles * 2 > generation.categories.length;
}

/**
 * A fit check: the current arrangement, and the threads that arrived or whose
 * work changed since it was last settled. Every other thread stays where it is.
 */
export type CategoryFitInput = CategoryInput & {
  current: CategoryGeneration;
  /** Thread IDs to place: arrivals and threads whose work changed. */
  changed: string[];
};

/** Each changed thread's category, or null when the arrangement must change. */
export type CategoryFit = { [threadId: string]: string | null };

export function categoryFitPrompt(input: CategoryFitInput): string {
  const shortOf = shortIds(input);
  const categories = categoryIds(input);
  const changed = new Set(input.changed);
  const members = (category: Category) =>
    input.threads.filter(
      (thread) =>
        category.threadIds.includes(thread.id) && !changed.has(thread.id),
    );
  return `${HEADER}

A workstream's current agent threads are arranged into sidebar categories. Some threads are new to the workstream or their work changed. Decide whether each of them fits an existing category as it stands.

A thread fits a category when it shares the one theme the category's name and members share. Choose null when no category's theme covers it, when it would fit only by stretching a category's theme, or when it shares a theme with another listed thread that no category covers. A thread's status or stage alone does not establish what it is about.

${tagged("current_workstream", clean(input.label, 300))}

The current categories and the threads that stay in them:
${tagged(
  "group",
  input.current.categories
    .map(
      (category) =>
        `- [${categories.get(category.id)}] ${clean(category.name, 80)}: ${
          members(category)
            .map((thread) => clean(thread.title, 120))
            .join("; ") || "(no other threads)"
        }`,
    )
    .join("\n"),
)}

The threads to file:
${tagged(
  "threads",
  input.threads
    .filter((thread) => changed.has(thread.id))
    .map(
      (thread) =>
        `- [${shortOf.get(thread.id)}] ${clean(thread.title, 120)}${thread.work ? ` — ${clean(thread.work, 1200)}` : ""}`,
    )
    .join("\n"),
)}

Return {"threads": [{"thread": string, "category": string|null}]}: every thread to file exactly once, with the ID of the category it fits, or null.`;
}

export function categoryFitSchema(
  input: CategoryFitInput,
): Record<string, unknown> {
  const shortOf = shortIds(input);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      threads: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            thread: {
              type: "string",
              enum: input.changed.map((id) => shortOf.get(id)!),
            },
            category: {
              anyOf: [
                { type: "null" },
                { type: "string", enum: [...categoryIds(input).values()] },
              ],
            },
          },
          required: ["thread", "category"],
        },
      },
    },
    required: ["threads"],
  };
}

const fitSchema = z.object({
  threads: z.array(
    z.object({ thread: z.string(), category: z.string().nullable() }),
  ),
});

/** Checks that every changed thread got exactly one known answer. */
export function parseCategoryFit(
  text: string,
  input: CategoryFitInput,
): CategoryFit {
  const parsed = fitSchema.parse(JSON.parse(stripFence(text)));
  const idOf = new Map([...shortIds(input)].map(([id, short]) => [short, id]));
  const categories = new Map(
    [...categoryIds(input)].map(([id, short]) => [short, id]),
  );
  const fit: CategoryFit = {};
  for (const answer of parsed.threads) {
    const id = idOf.get(answer.thread);
    if (!id || !input.changed.includes(id) || id in fit)
      throw new Error("The fit check named an unexpected thread.");
    const category =
      answer.category === null ? null : categories.get(answer.category);
    if (category === undefined)
      throw new Error("The fit check named an unknown category.");
    fit[id] = category;
  }
  if (input.changed.some((id) => !(id in fit)))
    throw new Error("The fit check left a thread out.");
  return fit;
}

/**
 * The arrangement with every changed thread moved where the check put it, or
 * null when one doesn't fit and the collection needs rearranging.
 */
export function applyCategoryFit(
  input: CategoryFitInput,
  fit: CategoryFit,
): CategoryGeneration | null {
  if (input.changed.some((id) => !fit[id])) return null;
  const changed = new Set(input.changed);
  return {
    ...input.current,
    categories: input.current.categories
      .map((category) => ({
        ...category,
        threadIds: [
          ...category.threadIds.filter((id) => !changed.has(id)),
          ...input.changed.filter((id) => fit[id] === category.id),
        ].sort(),
      }))
      .filter((category) => category.threadIds.length > 0),
  };
}
