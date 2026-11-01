/*
 * Workstreams project durable topic identity into flat BB sections. Each leaf
 * topic keeps its own section at every population size. A container's name is
 * shown as the prefix of its children's headers; categories organize rows
 * inside those sections without changing this layout.
 */
import { assertTopicLevels } from "./topics.ts";

export type LayoutTopic = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
};

export type LayoutNode = {
  readonly topicId: string;
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
    ? `${node.prefix.join(" ")}: ${node.name}`
    : node.name;
}

export const startsWith = (name: string, word: string) => {
  const a = name.toLowerCase();
  const b = word.toLowerCase();
  return a === b || a.startsWith(`${b} `);
};

export function layoutGroups(input: {
  readonly topics: readonly LayoutTopic[];
  readonly counts: Readonly<Record<string, number>>;
}): Layout {
  assertTopicLevels(input.topics);
  const parents = new Set(input.topics.map((topic) => topic.parentId));
  const byId = new Map(input.topics.map((topic) => [topic.id, topic]));
  const nodes: LayoutNode[] = [];
  for (const topic of input.topics) {
    const count = input.counts[topic.id] ?? 0;
    if (!Number.isFinite(count) || count <= 0) continue;
    if (parents.has(topic.id))
      throw new Error(
        "A topic with children needs a reviewed filing plan for its own threads.",
      );
    const parent = topic.parentId ? byId.get(topic.parentId) : null;
    nodes.push({
      topicId: topic.id,
      prefix:
        parent && !startsWith(topic.name, parent.name) ? [parent.name] : [],
      name: topic.name,
      lists: true,
      total: Math.floor(count),
      children: [],
    });
  }
  nodes.sort(
    (a, b) =>
      layoutLabel(a).localeCompare(layoutLabel(b)) ||
      a.topicId.localeCompare(b.topicId),
  );
  return { nodes, listed: nodes.map((node) => node.topicId) };
}
