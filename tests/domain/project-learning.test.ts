import { expect, it } from "vitest";
import {
  projectLearningPlan,
  type ProjectRoot,
} from "../../src/domain/projectLearning.ts";
import type { Topic } from "../../src/domain/topics.ts";

const topic = (
  id: string,
  parentId: string | null = null,
  patch: Partial<Topic> = {},
): Topic => ({
  id,
  parentId,
  name: id,
  description: "",
  aliases: [],
  ...patch,
});
const roots = (topicId: string, projectId = "p1", n = 3): ProjectRoot[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${topicId}-${projectId}-${i}`,
    name: "Root",
    topicId,
    projectId,
  }));
const available = new Set(["p1", "p2"]);

it("requires three distinct roots agreeing on one available project", () => {
  const t = topic("a");
  expect(projectLearningPlan([t], roots("a", "p1", 2), available)).toEqual([]);
  expect(
    projectLearningPlan(
      [t],
      [...roots("a", "p1", 2), roots("a")[0]!],
      available,
    ),
  ).toEqual([]);
  expect(projectLearningPlan([t], roots("a"), available)).toMatchObject([
    { kind: "learn", projectId: "p1" },
  ]);
  expect(
    projectLearningPlan(
      [t],
      [...roots("a"), ...roots("a", "p2", 1)],
      available,
    ),
  ).toEqual([]);
  expect(projectLearningPlan([t], roots("a", "missing"), available)).toEqual(
    [],
  );
});

it("learns narrow topics first and associates parents only when all children agree", () => {
  const topics = [topic("parent"), topic("a", "parent"), topic("b", "parent")];
  expect(
    projectLearningPlan(topics, roots("a"), available).map((d) => d.topicId),
  ).toEqual(["a"]);
  expect(
    projectLearningPlan(topics, [...roots("a"), ...roots("b")], available).map(
      (d) => d.topicId,
    ),
  ).toEqual(["a", "b", "parent"]);
  expect(
    projectLearningPlan(
      topics,
      [...roots("a"), ...roots("b", "p2")],
      available,
    ).map((d) => d.topicId),
  ).toEqual(["a", "b"]);
});

it("preserves manual choices and disabled learning, including a parent's explicit exception", () => {
  for (const projectSource of ["manual", "disabled"] as const)
    expect(
      projectLearningPlan(
        [topic("a", null, { projectId: "p2", projectSource })],
        roots("a"),
        available,
      ),
    ).toEqual([]);
  expect(
    projectLearningPlan(
      [
        topic("parent"),
        topic("a", "parent"),
        topic("b", "parent", { projectSource: "disabled" }),
      ],
      [...roots("a"), ...roots("b")],
      available,
    ).map((d) => d.topicId),
  ).toEqual(["a"]);
});

it("suggests replacements for consistent alternative history and removal for mixed history", () => {
  const t = topic("a", null, { projectId: "p1", projectSource: "learned" });
  expect(projectLearningPlan([t], roots("a", "p2"), available)).toMatchObject([
    { kind: "correct", projectId: "p2" },
  ]);
  expect(
    projectLearningPlan(
      [t],
      [...roots("a"), ...roots("a", "p2", 1)],
      available,
    ),
  ).toMatchObject([{ kind: "correct", projectId: null }]);
  expect(projectLearningPlan([t], roots("a"), available)).toEqual([]);
});
