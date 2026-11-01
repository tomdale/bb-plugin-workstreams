import { expect, it } from "vitest";
import { NewWork, submittedProject } from "../../src/app/composer/new-work.ts";
import {
  preserveProjectChoice,
  takeProjectChoice,
} from "../../src/app/composer/project-choice.ts";

it("distinguishes independent projects, supplied projects, remounts, and user overrides", () => {
  const deps = {
    route: async () => ({
      id: "preview",
      traceId: null,
      confidence: "low" as const,
      reason: "No topic",
      subject: null,
    }),
    cancelRoute: () => {},
  };
  const work = new NewWork(deps);
  work.observeSelection({ projectId: "one" });
  expect(submittedProject(work.snapshot())).toEqual({
    projectId: "one",
    source: "independent",
  });
  work.supplyProject("two");
  work.observeSelection({ projectId: "one", permissionMode: "full" });
  preserveProjectChoice("two", work.snapshot());
  const replacement = new NewWork(deps, takeProjectChoice("two"));
  replacement.observeSelection({ projectId: "two" });
  expect(submittedProject(replacement.snapshot())).toEqual({
    projectId: "two",
    source: "workstreams",
  });
  replacement.observeSelection({ projectId: "three" });
  expect(submittedProject(replacement.snapshot())).toEqual({
    projectId: "three",
    source: "independent",
  });
  work.dispose();
  replacement.dispose();
});
