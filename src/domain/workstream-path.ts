import { compareGroupNames } from "./group-name-order.ts";
import type { Workstream } from "./workstreams.ts";

/**
 * Joins a workstream path in plain text: "bb › Workstreams Plugin". Names may
 * not contain the mark, so a path always splits back into its names.
 */
export const PATH_SEPARATOR = " › ";
export const PATH_MARK = "›";

/** "bb › Workstreams Plugin" → ["bb", "Workstreams Plugin"]. */
export const pathNames = (path: string): string[] =>
  path
    .split(PATH_MARK)
    .map((name) => name.trim())
    .filter(Boolean);

/** Full ancestry distinguishes same-named features in different component scopes. */
export function workstreamPath(
  id: string,
  workstreams: readonly Workstream[],
): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current) {
    if (seen.has(current)) throw new Error("A workstream is inside itself.");
    seen.add(current);
    const workstream = workstreams.find((e) => e.id === current);
    if (!workstream) throw new Error("Unknown workstream.");
    parts.unshift(workstream.name);
    current = workstream.parentId;
  }
  return parts.join(PATH_SEPARATOR);
}

export type IndexedWorkstream = {
  workstream: Workstream;
  path: string;
  /** Lowercase own and ancestor fields, matched separately as before. */
  searchText: readonly string[];
};

export type WorkstreamIndex = {
  byId: ReadonlyMap<string, Workstream>;
  /** Every assignable workstream, ordered by its full path. */
  leafWorkstreams: readonly IndexedWorkstream[];
  path: (id: string) => string;
  hasExactName: (lowercaseName: string) => boolean;
};

const indexes = new WeakMap<readonly Workstream[], WorkstreamIndex>();

/**
 * Indexes one immutable workstreams snapshot for every open row menu and
 * picker. Paths, leaf ordering, and search fields are shared rather than
 * recomputed for each row or keystroke.
 */
export function workstreamIndex(
  workstreams: readonly Workstream[],
): WorkstreamIndex {
  const cached = indexes.get(workstreams);
  if (cached) return cached;

  const byId = new Map(
    workstreams.map((workstream) => [workstream.id, workstream]),
  );
  // Only workstreams hold threads, so groups are not options.
  const parentIds = new Set<string>();
  for (const workstream of workstreams)
    if (workstream.parentId) parentIds.add(workstream.parentId);
  const paths = new Map<string, string>();
  const path = (id: string): string => {
    const cachedPath = paths.get(id);
    if (cachedPath !== undefined) return cachedPath;
    const parts: string[] = [];
    const seen = new Set<string>();
    let current: string | null = id;
    while (current) {
      if (seen.has(current)) throw new Error("A workstream is inside itself.");
      seen.add(current);
      const workstream = byId.get(current);
      if (!workstream) throw new Error("Unknown workstream.");
      parts.unshift(workstream.name);
      current = workstream.parentId;
    }
    const value = parts.join(PATH_SEPARATOR);
    paths.set(id, value);
    return value;
  };

  const entries = new Map<string, IndexedWorkstream>();
  for (const workstream of workstreams) {
    const searchFields = [
      workstream.name,
      workstream.description,
      ...workstream.aliases,
    ];
    let parentId = workstream.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      searchFields.push(parent.name, ...parent.aliases);
      parentId = parent.parentId;
    }
    entries.set(workstream.id, {
      workstream,
      path: path(workstream.id),
      searchText: searchFields.map((field) => field.toLowerCase()),
    });
  }
  const exactNames = new Set(
    workstreams.map((workstream) => workstream.name.toLowerCase()),
  );
  const index: WorkstreamIndex = {
    byId,
    leafWorkstreams: workstreams
      .filter((workstream) => !parentIds.has(workstream.id))
      .map((workstream) => entries.get(workstream.id)!)
      .sort((a, b) => compareGroupNames(a.path, b.path)),
    path,
    hasExactName: (lowercaseName) => exactNames.has(lowercaseName),
  };
  indexes.set(workstreams, index);
  return index;
}
