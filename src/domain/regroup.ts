import { workstreamAncestors } from "./workstreams.ts";

/**
 * The workstream a workstream's threads are listed under: its nearest
 * self-or-ancestor that lists threads (see `layoutGroups`).
 */
export function activeHome(
  id: string,
  active: readonly string[],
  workstreams: readonly { id: string; parentId: string | null }[],
) {
  return (
    workstreamAncestors(id, workstreams).find((parent) =>
      active.includes(parent),
    ) ?? null
  );
}
