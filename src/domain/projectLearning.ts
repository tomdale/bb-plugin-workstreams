import { workstreamAncestors, type Workstream } from "./topics.ts";
import { chosenProject } from "./topicProject.ts";

export type ProjectRoot = {
  id: string;
  name: string;
  projectId: string;
  workstreamId: string;
};

export type ProjectLearningDecision = {
  workstreamId: string;
  projectId: string | null;
  kind: "learn" | "correct";
  roots: ProjectRoot[];
};

const PROJECT_LEARNING_ROOTS = 3;

/** Independent roots must agree; a parent's children must also agree. */
export function projectLearningPlan(
  workstreams: readonly Workstream[],
  roots: readonly ProjectRoot[],
  available: ReadonlySet<string>,
): ProjectLearningDecision[] {
  const history = new Map<string, Map<string, ProjectRoot>>();
  for (const root of roots) {
    if (!workstreams.some((workstream) => workstream.id === root.workstreamId)) continue;
    for (const id of workstreamAncestors(root.workstreamId, workstreams)) {
      const members = history.get(id) ?? new Map();
      members.set(root.id, root);
      history.set(id, members);
    }
  }
  const ordered = [...workstreams].sort(
    (a, b) =>
      workstreamAncestors(b.id, workstreams).length -
        workstreamAncestors(a.id, workstreams).length || a.id.localeCompare(b.id),
  );
  const agreed = new Map<string, string | null>();
  const decisions: ProjectLearningDecision[] = [];
  for (const workstream of ordered) {
    const members = [...(history.get(workstream.id)?.values() ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const projects = new Set(members.map((root) => root.projectId));
    const only = projects.size === 1 ? [...projects][0]! : null;
    const children = workstreams.filter((child) => child.parentId === workstream.id);
    const candidate =
      members.length >= PROJECT_LEARNING_ROOTS &&
      only &&
      available.has(only) &&
      children.every((child) => agreed.get(child.id) === only)
        ? only
        : null;
    const fixed =
      workstream.projectSource === "manual" || workstream.projectSource === "disabled";
    agreed.set(
      workstream.id,
      workstream.projectSource === "disabled"
        ? null
        : (workstream.projectId ?? candidate),
    );
    if (fixed || members.length < PROJECT_LEARNING_ROOTS) continue;
    if (workstream.projectSource === "learned" && workstream.projectId) {
      if (
        candidate !== workstream.projectId &&
        (projects.size > 1 ||
          only !== workstream.projectId ||
          !available.has(workstream.projectId))
      )
        decisions.push({
          workstreamId: workstream.id,
          projectId: candidate,
          kind: "correct",
          roots: members,
        });
    } else if (
      !workstream.projectId &&
      candidate &&
      chosenProject(workstream.parentId, workstreams) !== candidate
    ) {
      decisions.push({
        workstreamId: workstream.id,
        projectId: candidate,
        kind: "learn",
        roots: members,
      });
    }
  }
  return decisions;
}
