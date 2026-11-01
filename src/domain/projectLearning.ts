import { topicAncestors, type Topic } from "./topics.ts";
import { topicProject } from "./topicProject.ts";

export type ProjectRoot = {
  id: string;
  name: string;
  projectId: string;
  topicId: string;
};

export type ProjectLearningDecision = {
  topicId: string;
  projectId: string | null;
  kind: "learn" | "correct";
  roots: ProjectRoot[];
};

export const PROJECT_LEARNING_ROOTS = 3;

/** Independent roots must agree; a parent's children must also agree. */
export function projectLearningPlan(
  topics: readonly Topic[],
  roots: readonly ProjectRoot[],
  available: ReadonlySet<string>,
): ProjectLearningDecision[] {
  const history = new Map<string, Map<string, ProjectRoot>>();
  for (const root of roots) {
    if (!topics.some((topic) => topic.id === root.topicId)) continue;
    for (const id of topicAncestors(root.topicId, topics)) {
      const members = history.get(id) ?? new Map();
      members.set(root.id, root);
      history.set(id, members);
    }
  }
  const ordered = [...topics].sort(
    (a, b) =>
      topicAncestors(b.id, topics).length -
        topicAncestors(a.id, topics).length || a.id.localeCompare(b.id),
  );
  const agreed = new Map<string, string | null>();
  const decisions: ProjectLearningDecision[] = [];
  for (const topic of ordered) {
    const members = [...(history.get(topic.id)?.values() ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const projects = new Set(members.map((root) => root.projectId));
    const only = projects.size === 1 ? [...projects][0]! : null;
    const children = topics.filter((child) => child.parentId === topic.id);
    const candidate =
      members.length >= PROJECT_LEARNING_ROOTS &&
      only &&
      available.has(only) &&
      children.every((child) => agreed.get(child.id) === only)
        ? only
        : null;
    const fixed =
      topic.projectSource === "manual" || topic.projectSource === "disabled";
    agreed.set(
      topic.id,
      topic.projectSource === "disabled"
        ? null
        : (topic.projectId ?? candidate),
    );
    if (fixed || members.length < PROJECT_LEARNING_ROOTS) continue;
    if (topic.projectSource === "learned" && topic.projectId) {
      if (
        candidate !== topic.projectId &&
        (projects.size > 1 ||
          only !== topic.projectId ||
          !available.has(topic.projectId))
      )
        decisions.push({
          topicId: topic.id,
          projectId: candidate,
          kind: "correct",
          roots: members,
        });
    } else if (
      !topic.projectId &&
      candidate &&
      topicProject(topic.parentId, topics) !== candidate
    ) {
      decisions.push({
        topicId: topic.id,
        projectId: candidate,
        kind: "learn",
        roots: members,
      });
    }
  }
  return decisions;
}
