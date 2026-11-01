import { afterEach, expect, it } from "vitest";
import {
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
