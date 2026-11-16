import { expect, it } from "vitest";
import {
  projectLearningPlan,
  type ProjectThread,
} from "../../src/domain/projectLearning.ts";
import type { Workstream } from "../../src/domain/workstreams.ts";

const workstream = (
  id: string,
  parentId: string | null = null,
  patch: Partial<Workstream> = {},
): Workstream => ({
  id,
  parentId,
  name: id,
  description: "",
  aliases: [],
  ...patch,
});
const threads = (
  workstreamId: string,
  projectId = "p1",
  n = 3,
): ProjectThread[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${workstreamId}-${projectId}-${i}`,
    name: "Root",
    workstreamId,
    projectId,
  }));
const available = new Set(["p1", "p2"]);

it("requires three distinct roots agreeing on one available project", () => {
  const t = workstream("a");
  expect(projectLearningPlan([t], threads("a", "p1", 2), available)).toEqual(
    [],
  );
  expect(
    projectLearningPlan(
      [t],
      [...threads("a", "p1", 2), threads("a")[0]!],
      available,
    ),
  ).toEqual([]);
  expect(projectLearningPlan([t], threads("a"), available)).toMatchObject([
    { kind: "learn", projectId: "p1" },
  ]);
  expect(
    projectLearningPlan(
      [t],
      [...threads("a"), ...threads("a", "p2", 1)],
      available,
    ),
  ).toEqual([]);
  expect(projectLearningPlan([t], threads("a", "missing"), available)).toEqual(
    [],
  );
});

it("learns narrow topics first and associates parents only when all children agree", () => {
  const workstreams = [
    workstream("parent"),
    workstream("a", "parent"),
    workstream("b", "parent"),
  ];
  expect(
    projectLearningPlan(workstreams, threads("a"), available).map(
      (d) => d.workstreamId,
    ),
  ).toEqual(["a"]);
  expect(
    projectLearningPlan(
      workstreams,
      [...threads("a"), ...threads("b")],
      available,
    ).map((d) => d.workstreamId),
  ).toEqual(["a", "b", "parent"]);
  expect(
    projectLearningPlan(
      workstreams,
      [...threads("a"), ...threads("b", "p2")],
      available,
    ).map((d) => d.workstreamId),
  ).toEqual(["a", "b"]);
});

it("preserves manual choices and disabled learning, including a parent's explicit exception", () => {
  for (const projectSource of ["manual", "disabled"] as const)
    expect(
      projectLearningPlan(
        [workstream("a", null, { projectId: "p2", projectSource })],
        threads("a"),
        available,
      ),
    ).toEqual([]);
  expect(
    projectLearningPlan(
      [
        workstream("parent"),
        workstream("a", "parent"),
        workstream("b", "parent", { projectSource: "disabled" }),
      ],
      [...threads("a"), ...threads("b")],
      available,
    ).map((d) => d.workstreamId),
  ).toEqual(["a"]);
});

it("suggests replacements for consistent alternative history and removal for mixed history", () => {
  const t = workstream("a", null, {
    projectId: "p1",
    projectSource: "learned",
  });
  expect(projectLearningPlan([t], threads("a", "p2"), available)).toMatchObject(
    [{ kind: "correct", projectId: "p2" }],
  );
  expect(
    projectLearningPlan(
      [t],
      [...threads("a"), ...threads("a", "p2", 1)],
      available,
    ),
  ).toMatchObject([{ kind: "correct", projectId: null }]);
  expect(projectLearningPlan([t], threads("a"), available)).toEqual([]);
});
