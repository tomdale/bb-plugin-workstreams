import { expect, it } from "vitest";
import { topicProject } from "../../src/domain/topicProject.ts";
import type { Topic } from "../../src/domain/topics.ts";

const topics: Topic[] = [
  {
    id: "root",
    name: "Root",
    description: "",
    aliases: [],
    parentId: null,
    projectId: "project-root",
  },
  {
    id: "child",
    name: "Child",
    description: "",
    aliases: [],
    parentId: "root",
  },
  {
    id: "override",
    name: "Override",
    description: "",
    aliases: [],
    parentId: "root",
    projectId: "project-child",
  },
];

it("uses the nearest topic's associated project, including a subtopic's override", () => {
  expect(topicProject("root", topics)).toBe("project-root");
  expect(topicProject("child", topics)).toBe("project-root");
  expect(topicProject("override", topics)).toBe("project-child");
});

it("leaves unknown, unassociated, and cyclic topics without a project", () => {
  expect(topicProject(null, topics)).toBeNull();
  expect(topicProject("missing", topics)).toBeNull();
  expect(
    topicProject("child", [{ ...topics[1]!, parentId: "child" }]),
  ).toBeNull();
});
