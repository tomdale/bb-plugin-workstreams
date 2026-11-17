import { workstreamAncestors, type Workstream } from "./workstreams.ts";
import { chosenProject } from "./workstreamProject.ts";

export type ProjectThread = {
  id: string;
  name: string;
  projectId: string;
  workstreamId: string;
};

export type ProjectLearningDecision = {
  workstreamId: string;
  projectId: string | null;
  kind: "learn" | "correct";
  threads: ProjectThread[];
};

const PROJECT_LEARNING_THREADS = 3;

/** Independent top-level threads must agree; so must a parent's children. */
export function projectLearningPlan(
  workstreams: readonly Workstream[],
  threads: readonly ProjectThread[],
  available: ReadonlySet<string>,
): ProjectLearningDecision[] {
  const history = new Map<string, Map<string, ProjectThread>>();
  for (const thread of threads) {
    if (
      !workstreams.some((workstream) => workstream.id === thread.workstreamId)
    )
      continue;
    for (const id of workstreamAncestors(thread.workstreamId, workstreams)) {
      const members = history.get(id) ?? new Map();
      members.set(thread.id, thread);
      history.set(id, members);
    }
  }
  const ordered = [...workstreams].sort(
    (a, b) =>
      workstreamAncestors(b.id, workstreams).length -
        workstreamAncestors(a.id, workstreams).length ||
      a.id.localeCompare(b.id),
  );
  const agreed = new Map<string, string | null>();
  const decisions: ProjectLearningDecision[] = [];
  for (const workstream of ordered) {
    const members = [...(history.get(workstream.id)?.values() ?? [])].sort(
      (a, b) => a.id.localeCompare(b.id),
    );
    const projects = new Set(members.map((thread) => thread.projectId));
    const only = projects.size === 1 ? [...projects][0]! : null;
    const children = workstreams.filter(
      (child) => child.parentId === workstream.id,
    );
    const candidate =
      members.length >= PROJECT_LEARNING_THREADS &&
      only &&
      available.has(only) &&
      children.every((child) => agreed.get(child.id) === only)
        ? only
        : null;
    const fixed =
      workstream.projectSource === "manual" ||
      workstream.projectSource === "disabled";
    agreed.set(
      workstream.id,
      workstream.projectSource === "disabled"
        ? null
        : (workstream.projectId ?? candidate),
    );
    if (fixed || members.length < PROJECT_LEARNING_THREADS) continue;
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
          threads: members,
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
        threads: members,
      });
    }
  }
  return decisions;
}
