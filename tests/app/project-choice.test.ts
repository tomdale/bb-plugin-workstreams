import { afterEach, expect, it, vi } from "vitest";
import {
  carryAcrossProjectChange,
  preserveProjectChoice,
  takeProjectChoice,
} from "../../src/app/composer/project-choice.ts";
import { NewWork } from "../../src/app/composer/new-work.ts";

const choice = {
  identity: {
    workstreamId: "workstream",
    proposal: null,
    label: "Workstream",
    provenance: "automatic" as const,
  },
  decision: {
    id: "preview",
    traceId: null,
    confidence: "high" as const,
    workstreamId: "workstream",
    subject: "Workstream",
    goal: "Fix parser",
    reason: "Matches",
  },
};
afterEach(() => {
  takeProjectChoice("project");
});

it("carries the workstream, provenance, and preview into the replacement composer once", () => {
  const release = preserveProjectChoice("project", choice);
  expect(takeProjectChoice("other")).toBeUndefined();
  const model = new NewWork(
    { route: async () => choice.decision, cancelRoute: () => {} },
    takeProjectChoice("project"),
  );
  expect(model.snapshot()).toMatchObject(choice);
  expect(takeProjectChoice("project")).toBeUndefined();
  release();
  model.dispose();
});

it("releases a failed or settled switch without erasing a newer transfer", () => {
  const old = preserveProjectChoice("project", choice);
  const latest = preserveProjectChoice("project", {
    ...choice,
    identity: { ...choice.identity, provenance: "manual" },
  });
  old();
  expect(takeProjectChoice("project")?.identity?.provenance).toBe("manual");
  latest();
  preserveProjectChoice("project", choice)();
  expect(takeProjectChoice("project")).toBeUndefined();
});

const deps = { route: async () => choice.decision, cancelRoute: () => {} };

it("carries a picked workstream to the draft's model in the project you chose", () => {
  const work = new NewWork(deps);
  work.selectIdentity({ workstreamId: "workstream", label: "Workstream" });
  carryAcrossProjectChange("draft", "project", work.snapshot());
  expect(takeProjectChoice("project", "other-draft")).toBeUndefined();
  const replacement = new NewWork(deps, takeProjectChoice("other", "draft"));
  expect(replacement.snapshot()).toMatchObject({
    identity: { workstreamId: "workstream", provenance: "manual" },
    projectOverride: true,
    suppliedProjectId: null,
  });
  expect(takeProjectChoice("other", "draft")).toBeUndefined();
  work.dispose();
  replacement.dispose();
});

it("does not carry a choice into the same project", () => {
  const work = new NewWork(deps);
  work.selectIdentity({ workstreamId: "workstream", label: "Workstream" });
  carryAcrossProjectChange("draft", "project", work.snapshot());
  expect(takeProjectChoice("project", "draft")).toBeUndefined();
  work.dispose();
});

it("carries a project you chose, but not Quick analysis's workstream", () => {
  const work = new NewWork(deps);
  carryAcrossProjectChange("draft", "project", {
    ...work.snapshot(),
    ...choice,
  });
  expect(takeProjectChoice("other", "draft")).toEqual({
    identity: null,
    decision: null,
    suppliedProjectId: null,
    projectOverride: true,
  });
  work.dispose();
});

it("drops a carried workstream no replacement took", () => {
  vi.useFakeTimers();
  try {
    const work = new NewWork(deps);
    work.selectIdentity({ workstreamId: "workstream", label: "Workstream" });
    carryAcrossProjectChange("draft", "project", work.snapshot());
    vi.advanceTimersByTime(1000);
    expect(takeProjectChoice("other", "draft")).toBeUndefined();
    work.dispose();
  } finally {
    vi.useRealTimers();
  }
});

it("marks a project you choose until you pick a workstream", () => {
  const work = new NewWork(deps);
  work.observeSelection({ projectId: "one" });
  work.observeSelection({ projectId: "two" });
  expect(work.viewSnapshot().projectOverride).toBe(true);
  // Quick analysis's workstream, or Automatic, keeps your project.
  work.selectIdentity(null, "automatic");
  work.selectAutomaticIdentity();
  expect(work.snapshot().projectOverride).toBe(true);
  work.selectIdentity({ workstreamId: "workstream", label: "Workstream" });
  expect(work.snapshot().projectOverride).toBe(false);
  work.supplyProject("three");
  work.observeSelection({ projectId: "three" });
  expect(work.snapshot().projectOverride).toBe(false);
  work.observeSelection({ projectId: "four" });
  expect(work.snapshot().projectOverride).toBe(true);
  work.selectIdentity({ workstreamId: "other", label: "Other" });
  expect(work.snapshot().projectOverride).toBe(false);
  work.dispose();
});
