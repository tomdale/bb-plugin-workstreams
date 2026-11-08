import { compareGroupNames } from "./group-name-order.ts";
import type { Topic } from "./topics.ts";

/** Full ancestry distinguishes same-named features in different component scopes. */
export function topicPath(id: string, entities: readonly Topic[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current) {
    if (seen.has(current)) throw new Error("Topic tree contains a cycle.");
    seen.add(current);
    const entity = entities.find((e) => e.id === current);
    if (!entity) throw new Error("Unknown topic.");
    parts.unshift(entity.name);
    current = entity.parentId;
  }
  return parts.join(": ");
}

export type IndexedTopic = {
  entity: Topic;
  path: string;
  /** Lowercase own and ancestor fields, matched separately as before. */
  searchText: readonly string[];
};

export type TopicIndex = {
  byId: ReadonlyMap<string, Topic>;
  /** Every assignable topic, ordered by its full path. */
  leafTopics: readonly IndexedTopic[];
  path: (id: string) => string;
  hasExactName: (lowercaseName: string) => boolean;
};

const indexes = new WeakMap<readonly Topic[], TopicIndex>();

/**
 * Indexes one immutable entities snapshot for every open row menu and picker.
 * Paths, leaf ordering, and search fields are shared rather than recomputed
 * for each row or keystroke.
 */
export function topicIndex(entities: readonly Topic[]): TopicIndex {
  const cached = indexes.get(entities);
  if (cached) return cached;

  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  // A topic holds threads or subtopics, never both, so parents are not options.
  const parentIds = new Set<string>();
  for (const entity of entities)
    if (entity.parentId) parentIds.add(entity.parentId);
  const paths = new Map<string, string>();
  const path = (id: string): string => {
    const cachedPath = paths.get(id);
    if (cachedPath !== undefined) return cachedPath;
    const parts: string[] = [];
    const seen = new Set<string>();
    let current: string | null = id;
    while (current) {
      if (seen.has(current)) throw new Error("Topic tree contains a cycle.");
      seen.add(current);
      const entity = byId.get(current);
      if (!entity) throw new Error("Unknown topic.");
      parts.unshift(entity.name);
      current = entity.parentId;
    }
    const value = parts.join(": ");
    paths.set(id, value);
    return value;
  };

  const entries = new Map<string, IndexedTopic>();
  for (const entity of entities) {
    const searchFields = [entity.name, entity.description, ...entity.aliases];
    let parentId = entity.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      searchFields.push(parent.name, ...parent.aliases);
      parentId = parent.parentId;
    }
    entries.set(entity.id, {
      entity,
      path: path(entity.id),
      searchText: searchFields.map((field) => field.toLowerCase()),
    });
  }
  const exactNames = new Set(
    entities.map((entity) => entity.name.toLowerCase()),
  );
  const index: TopicIndex = {
    byId,
    leafTopics: entities
      .filter((entity) => !parentIds.has(entity.id))
      .map((entity) => entries.get(entity.id)!)
      .sort((a, b) => compareGroupNames(a.path, b.path)),
    path,
    hasExactName: (lowercaseName) => exactNames.has(lowercaseName),
  };
  indexes.set(entities, index);
  return index;
}
