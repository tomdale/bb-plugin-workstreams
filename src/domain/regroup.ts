import { topicAncestors } from "./topics.ts";

/**
 * The workstream topic a topic's roots file under: its nearest self-or-ancestor
 * that lists threads (see `layoutGroups`).
 */
export function activeHome(
  id: string,
  active: readonly string[],
  entities: readonly { id: string; parentId: string | null }[],
) {
  return (
    topicAncestors(id, entities).find((parent) => active.includes(parent)) ??
    null
  );
}
