/*
 * Categories arrange a topic's current root collection.
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

export type CategoryRoot = {
  id: string;
  title: string;
  work: string;
  /** Changes with substantive request evidence, not title or status updates. */
  workKey: string;
};

export type CategoryCollection = {
  topicId: string;
  label: string;
  roots: CategoryRoot[];
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
    [...collection.roots]
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

/** Departing roots leave immediately, even while inference is in flight. */
export function pruneCategories(
  generation: CategoryGeneration,
  roots: readonly { id: string }[],
): CategoryGeneration {
  const present = new Set(roots.map((root) => root.id));
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
const rootIds = (input: CategoryInput) =>
  new Map(input.roots.map((root, i) => [root.id, `r${i + 1}`]));
const categoryIds = (input: CategoryInput) =>
  new Map(
    (input.current?.categories ?? []).map((category, i) => [
      category.id,
      `c${i + 1}`,
    ]),
  );

export function categoryPrompt(input: CategoryInput): string {
  const roots = rootIds(input);
  const categories = categoryIds(input);
  return `${HEADER}

Organize the current collection of agent threads within one topic into useful sidebar categories. These categories describe this collection, not permanent product or feature identity.

Read every thread in context of the others. Choose clear distinctions that make the collection meaningfully easier to scan. A category groups threads that share one theme; use a singleton only for work that shares a theme with no other thread, and regroup an arrangement that is mostly singletons around the themes its threads share. Do not force equal sizes, matching names, or a General/Other catch-all. Choose the number of categories the collection supports. Use at least two when there are no current categories; an existing arrangement may contract to one category as its collection changes.

When current categories are supplied, file each thread they omit into the existing category whose theme it shares. Keep existing names and memberships unless changing them has a meaningful organizational benefit. Minor or superficial improvements do not justify changes. You may recategorize the whole collection when its work supports clearer boundaries. Reuse an existing category ID when its meaning survives; use null for a new category. A category's name states the one theme its members share, without repeating the topic's name or chaining themes with "and" or commas; rename a category whose name no longer covers its members. A thread's status or stage alone does not establish what it is about.

${tagged("current_topic", clean(input.label, 300))}

${tagged(
  "threads",
  input.roots
    .map(
      (root) =>
        `- [${roots.get(root.id)}] ${clean(root.title, 120)}${root.work ? ` — ${clean(root.work, 1200)}` : ""}`,
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
              .map((id) => roots.get(id))
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
              items: { type: "string", enum: [...rootIds(input).values()] },
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
  const expected = new Set(input.roots.map((root) => root.id));
  if (expected.size !== input.roots.length)
    throw new Error("The category collection repeats a root.");
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
  const roots = new Map([...rootIds(input)].map(([id, short]) => [short, id]));
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
        const root = roots.get(short);
        if (!root) throw new Error("The classifier named an unknown root.");
        return root;
      }),
    };
  });
  if (
    !isPartition(
      resolved.flatMap((category) => category.threadIds),
      expected,
    )
  )
    throw new Error("Categories must file every root exactly once.");
  return { ...decision, categories: resolved };
}
