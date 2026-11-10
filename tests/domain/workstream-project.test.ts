import { expect, it } from "vitest";
import {
  NO_PROJECT,
  workstreamProject,
  workstreamProjectConflict,
} from "../../src/domain/topicProject.ts";
import type { Topic } from "../../src/domain/topics.ts";

const topic = (id: string, extra: Partial<Topic> = {}): Topic => ({
  id,
  name: id,
  description: "",
  parentId: null,
  aliases: [],
  ...extra,
});
const entities = [
  topic("parent", { projectId: "p1" }),
  topic("child", { parentId: "parent" }),
  topic("off", { parentId: "parent", projectSource: "disabled" }),
  topic("bare"),
];

it("gives every workstream a project, defaulting to No project", () => {
  expect(workstreamProject("child", entities)).toBe("p1");
  expect(workstreamProject("off", entities)).toBe(NO_PROJECT);
  expect(workstreamProject("bare", entities)).toBe(NO_PROJECT);
});

it("flags a thread whose project differs from its workstream's", () => {
  expect(workstreamProjectConflict("child", entities, "p1")).toBeNull();
  expect(workstreamProjectConflict("child", entities, "p2")).toEqual({
    workstreamProjectId: "p1",
  });
  expect(workstreamProjectConflict("bare", entities, "p1")).toEqual({
    workstreamProjectId: NO_PROJECT,
  });
  expect(workstreamProjectConflict("bare", entities, NO_PROJECT)).toBeNull();
});

it("has no conflict without a workstream or a known thread project", () => {
  expect(workstreamProjectConflict(null, entities, "p2")).toBeNull();
  expect(workstreamProjectConflict("child", entities, undefined)).toBeNull();
});
