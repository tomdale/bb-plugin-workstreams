import type { Topic } from "./topics.ts";

export function topicProject(
  topicId: string | null | undefined,
  entities: readonly Topic[],
): string | null {
  const byId = new Map(entities.map((topic) => [topic.id, topic]));
  const seen = new Set<string>();
  let id = topicId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const topic = byId.get(id);
    if (!topic || topic.projectSource === "disabled") return null;
    if (topic.projectId) return topic.projectId;
    id = topic.parentId;
  }
  return null;
}
