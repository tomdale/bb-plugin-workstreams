import { expect, it } from "vitest";
import {
  NO_PROJECT,
  workstreamProject,
  workstreamProjectConflict,
} from "../../src/domain/workstreamProject.ts";
import type { Workstream } from "../../src/domain/workstreams.ts";

const workstream = (
  id: string,
  extra: Partial<Workstream> = {},
): Workstream => ({
  id,
  name: id,
  description: "",
  parentId: null,
  aliases: [],
  ...extra,
});
const workstreams = [
  workstream("parent", { projectId: "p1" }),
  workstream("child", { parentId: "parent" }),
  workstream("off", { parentId: "parent", projectSource: "disabled" }),
  workstream("bare"),
];

it("gives every workstream a project, defaulting to No project", () => {
  expect(workstreamProject("child", workstreams)).toBe("p1");
  expect(workstreamProject("off", workstreams)).toBe(NO_PROJECT);
  expect(workstreamProject("bare", workstreams)).toBe(NO_PROJECT);
});

it("flags a thread whose project differs from its workstream's", () => {
  expect(workstreamProjectConflict("child", workstreams, "p1")).toBeNull();
  expect(workstreamProjectConflict("child", workstreams, "p2")).toEqual({
    workstreamProjectId: "p1",
  });
  expect(workstreamProjectConflict("bare", workstreams, "p1")).toEqual({
    workstreamProjectId: NO_PROJECT,
  });
  expect(workstreamProjectConflict("bare", workstreams, NO_PROJECT)).toBeNull();
});

it("has no conflict without a workstream or a known thread project", () => {
  expect(workstreamProjectConflict(null, workstreams, "p2")).toBeNull();
  expect(workstreamProjectConflict("child", workstreams, undefined)).toBeNull();
});
