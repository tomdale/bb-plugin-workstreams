/*
 * Workstreams project durable workstream identity into flat BB sections. Each leaf
 * workstream keeps its own section at every population size. A container's name is
 * shown as the prefix of its children's headers; categories organize rows
 * inside those sections without changing this layout.
 */
import { assertWorkstreamLevels } from "./topics.ts";
import { PATH_SEPARATOR } from "./topic-path.ts";

export type LayoutWorkstream = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
};

export type LayoutNode = {
  readonly workstreamId: string;
  readonly prefix: readonly string[];
  readonly name: string;
  readonly lists: boolean;
  readonly total: number;
  readonly children: readonly LayoutNode[];
};

export type Layout = {
  readonly nodes: readonly LayoutNode[];
  readonly listed: readonly string[];
};

export function layoutLabel(node: Pick<LayoutNode, "prefix" | "name">): string {
  return node.prefix.length
    ? `${node.prefix.join(" ")}${PATH_SEPARATOR}${node.name}`
    : node.name;
}

export const startsWith = (name: string, word: string) => {
  const a = name.toLowerCase();
  const b = word.toLowerCase();
  return a === b || a.startsWith(`${b} `);
};

export function layoutGroups(input: {
  readonly workstreams: readonly LayoutWorkstream[];
  readonly counts: Readonly<Record<string, number>>;
}): Layout {
  assertWorkstreamLevels(input.workstreams);
  const parents = new Set(
    input.workstreams.map((workstream) => workstream.parentId),
  );
  const byId = new Map(
    input.workstreams.map((workstream) => [workstream.id, workstream]),
  );
  const nodes: LayoutNode[] = [];
  for (const workstream of input.workstreams) {
    const count = input.counts[workstream.id] ?? 0;
    if (!Number.isFinite(count) || count <= 0) continue;
    if (parents.has(workstream.id))
      throw new Error(
        "A group can't hold threads; preview where its own threads go first.",
      );
    const parent = workstream.parentId ? byId.get(workstream.parentId) : null;
    nodes.push({
      workstreamId: workstream.id,
      prefix:
        parent && !startsWith(workstream.name, parent.name)
          ? [parent.name]
          : [],
      name: workstream.name,
      lists: true,
      total: Math.floor(count),
      children: [],
    });
  }
  nodes.sort(
    (a, b) =>
      layoutLabel(a).localeCompare(layoutLabel(b)) ||
      a.workstreamId.localeCompare(b.workstreamId),
  );
  return { nodes, listed: nodes.map((node) => node.workstreamId) };
}
