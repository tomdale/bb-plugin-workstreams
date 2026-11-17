import { expect, it } from "vitest";
import { chosenProject } from "../../src/domain/workstreamProject.ts";
import type { Workstream } from "../../src/domain/workstreams.ts";

const workstreams: Workstream[] = [
  {
    id: "parent",
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
    parentId: "parent",
  },
  {
    id: "override",
    name: "Override",
    description: "",
    aliases: [],
    parentId: "parent",
    projectId: "project-child",
  },
];

it("uses the group's associated project unless the workstream overrides it", () => {
  expect(chosenProject("parent", workstreams)).toBe("project-root");
  expect(chosenProject("child", workstreams)).toBe("project-root");
  expect(chosenProject("override", workstreams)).toBe("project-child");
});

it("leaves unknown, unassociated, and cyclic workstreams without a project", () => {
  expect(chosenProject(null, workstreams)).toBeNull();
  expect(chosenProject("missing", workstreams)).toBeNull();
  expect(
    chosenProject("child", [{ ...workstreams[1]!, parentId: "child" }]),
  ).toBeNull();
});
