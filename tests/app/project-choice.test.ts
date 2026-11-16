import { afterEach, expect, it, vi } from "vitest";
import {
  carryPickedTopic,
  preserveProjectChoice,
  takeProjectChoice,
} from "../../src/app/composer/project-choice.ts";
import { NewWork } from "../../src/app/composer/new-work.ts";

const choice = {
  identity: {
    entityId: "topic",
    proposal: null,
    label: "Topic",
    provenance: "automatic" as const,
  },
  decision: {
    id: "preview",
    traceId: null,
    confidence: "high" as const,
    subjectId: "topic",
    subject: "Topic",
    goal: "Fix parser",
    reason: "Matches",
  },
};
afterEach(() => {
  takeProjectChoice("project");
});

it("carries the topic, provenance, and preview into the replacement composer once", () => {
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

it("carries a picked topic to the draft's model in the project you chose", () => {
  const work = new NewWork(deps);
  work.selectIdentity({ entityId: "topic", label: "Topic" });
  carryPickedTopic("draft", "project", work.snapshot());
  expect(takeProjectChoice("project", "other-draft")).toBeUndefined();
  const replacement = new NewWork(deps, takeProjectChoice("other", "draft"));
  expect(replacement.snapshot()).toMatchObject({
    identity: { entityId: "topic", provenance: "manual" },
    projectOverride: true,
    suppliedProjectId: null,
  });
  expect(takeProjectChoice("other", "draft")).toBeUndefined();
  work.dispose();
  replacement.dispose();
});

it("does not carry a topic into the same project or carry Quick analysis's topic", () => {
  const work = new NewWork(deps);
  work.selectIdentity({ entityId: "topic", label: "Topic" });
  carryPickedTopic("draft", "project", work.snapshot());
  expect(takeProjectChoice("project", "draft")).toBeUndefined();
  carryPickedTopic("draft", "project", { ...work.snapshot(), ...choice });
  expect(takeProjectChoice("other", "draft")).toBeUndefined();
  work.dispose();
});

it("drops a carried topic no replacement took", () => {
  vi.useFakeTimers();
  try {
    const work = new NewWork(deps);
    work.selectIdentity({ entityId: "topic", label: "Topic" });
    carryPickedTopic("draft", "project", work.snapshot());
    vi.advanceTimersByTime(1000);
    expect(takeProjectChoice("other", "draft")).toBeUndefined();
    work.dispose();
  } finally {
    vi.useRealTimers();
  }
});

it("marks a project you choose after picking a topic, until the topic changes", () => {
  const work = new NewWork(deps);
  work.observeSelection({ projectId: "one" });
  work.observeSelection({ projectId: "two" });
  expect(work.snapshot().projectOverride).toBeFalsy();
  work.selectIdentity({ entityId: "topic", label: "Topic" });
  work.supplyProject("three");
  work.observeSelection({ projectId: "three" });
  expect(work.snapshot().projectOverride).toBeFalsy();
  work.observeSelection({ projectId: "four" });
  expect(work.viewSnapshot().projectOverride).toBe(true);
  work.selectIdentity({ entityId: "other", label: "Other" });
  expect(work.snapshot().projectOverride).toBe(false);
  work.dispose();
});
