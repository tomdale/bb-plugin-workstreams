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

/** BB's id for "Don't work in a project". */
export const NO_PROJECT = "proj_personal";

/**
 * The project a topic's workstream belongs to. A workstream always has one:
 * with none chosen or learned it is No project, never "any project".
 */
export function workstreamProject(
  topicId: string | null | undefined,
  entities: readonly Topic[],
): string {
  return topicProject(topicId, entities) ?? NO_PROJECT;
}

/**
 * Whether a new thread would start in a project unrelated to its workstream.
 * Only a destination that names a topic can conflict; a thread with no topic
 * belongs to no workstream.
 */
export function workstreamProjectConflict(
  topicId: string | null | undefined,
  entities: readonly Topic[],
  threadProjectId: string | null | undefined,
): { workstreamProjectId: string } | null {
  if (!topicId || !threadProjectId) return null;
  const workstreamProjectId = workstreamProject(topicId, entities);
  return workstreamProjectId === threadProjectId
    ? null
    : { workstreamProjectId };
}
