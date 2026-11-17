import { workstreamAncestors } from "./workstreams.ts";

/**
 * The nearest active workstream record's ID, checking the workstream itself
 * before its ancestors (see `layoutGroups`).
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
