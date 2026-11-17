import type { Workstream } from "./workstreams.ts";

export function chosenProject(
  workstreamId: string | null | undefined,
  workstreams: readonly Workstream[],
): string | null {
  const byId = new Map(
    workstreams.map((workstream) => [workstream.id, workstream]),
  );
  const seen = new Set<string>();
  let id = workstreamId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const workstream = byId.get(id);
    if (!workstream || workstream.projectSource === "disabled") return null;
    if (workstream.projectId) return workstream.projectId;
    id = workstream.parentId;
  }
  return null;
}

/** BB's id for "Don't work in a project". */
export const NO_PROJECT = "proj_personal";

/**
 * The default project for new threads in this workstream. With none chosen
 * or learned, the default is No project.
 */
export function workstreamProject(
  workstreamId: string | null | undefined,
  workstreams: readonly Workstream[],
): string {
  return chosenProject(workstreamId, workstreams) ?? NO_PROJECT;
}

/**
 * Whether the composer's project differs from the workstream's default, so
 * the composer can offer to save it. This does not restrict the thread's
 * workstream or project.
 */
export function workstreamProjectConflict(
  workstreamId: string | null | undefined,
  workstreams: readonly Workstream[],
  threadProjectId: string | null | undefined,
): { workstreamProjectId: string } | null {
  if (!workstreamId || !threadProjectId) return null;
  const workstreamProjectId = workstreamProject(workstreamId, workstreams);
  return workstreamProjectId === threadProjectId
    ? null
    : { workstreamProjectId };
}
