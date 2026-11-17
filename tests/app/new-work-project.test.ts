/**
 * Whose choice the New thread composer's project is, across the remounts a
 * project change causes, stale views of the same draft, and workstream
 * defaults that land late.
 */
import { expect, it, vi } from "vitest";
import {
  acquireRoutingModel,
  NewWork,
  releaseRoutingModel,
  submittedProject,
} from "../../src/app/composer/new-work.ts";

const deps = {
  route: async () => ({
    id: "preview",
    traceId: null,
    confidence: "low" as const,
    reason: "No workstream",
    subject: null,
  }),
  cancelRoute: () => {},
};

it("treats the project BB resolves as no choice, and a change after it as yours", () => {
  const work = new NewWork(deps);
  work.observeSelection({});
  work.observeSelection({ projectId: "a" });
  expect(work.snapshot().projectOverride).toBeFalsy();
  // BB can pass through no project while switching.
  work.observeSelection({});
  work.observeSelection({ projectId: "b" });
  expect(work.snapshot()).toMatchObject({
    projectOverride: true,
    userProjectId: "b",
  });
  work.dispose();
});

it("ignores an older selection a kept-alive view reports again", () => {
  const work = new NewWork(deps);
  const a = { projectId: "a" };
  const b = { projectId: "b" };
  work.observeSelection(a);
  work.supplyProject("b");
  work.observeSelection(b);
  work.observeSelection(a);
  expect(work.snapshot().selection).toBe(b);
  expect(work.snapshot().projectOverride).toBeFalsy();
  expect(submittedProject(work.snapshot())).toEqual({
    projectId: "b",
    source: "workstreams",
  });
  work.dispose();
});

it("keeps the draft's choices across a banner remount until the draft is sent", () => {
  const create = vi.fn(() => new NewWork(deps));
  const work = acquireRoutingModel("draft", create);
  work.observe("Fix the parser");
  work.observeSelection({ projectId: "a" });
  work.selectIdentity({ workstreamId: "w", label: "W" });
  work.observeSelection({ projectId: "b" });
  releaseRoutingModel("draft", work);
  // The project change remounted the banner.
  const replacement = acquireRoutingModel("draft", create);
  expect(replacement).toBe(work);
  expect(create).toHaveBeenCalledOnce();
  expect(work.snapshot()).toMatchObject({
    identity: { workstreamId: "w", provenance: "manual" },
    projectOverride: true,
    userProjectId: "b",
  });
  work.markSubmitted();
  work.observe("");
  expect(work.snapshot()).toMatchObject({
    identity: null,
    projectOverride: false,
    userProjectId: null,
  });
  releaseRoutingModel("draft", work);
});

it("clears the draft's identity only for a sent draft, not an emptied one", () => {
  const work = new NewWork(deps);
  work.observe("Fix the parser");
  work.selectIdentity({ workstreamId: "w", label: "W" });
  work.observe("");
  expect(work.snapshot().identity?.workstreamId).toBe("w");
  work.dispose();
});

it("restores your project when a default requested before it lands after", () => {
  const work = new NewWork(deps);
  work.observeSelection({ projectId: "a" });
  const move = work.beginProjectMove();
  work.supplyProject("b");
  move.target("b");
  work.observeSelection({ projectId: "x" });
  expect(work.takeRestore()).toBeNull();
  work.observeSelection({ projectId: "b" });
  expect(work.movingProject()).toBe(false);
  expect(work.takeRestore()).toBe("x");
  expect(work.takeRestore()).toBeNull();
  expect(work.snapshot().userProjectId).toBe("x");
  work.dispose();
});

it("holds a send until the project move ends", () => {
  vi.useFakeTimers();
  try {
    const work = new NewWork(deps);
    const listener = vi.fn();
    work.subscribe(listener);
    const move = work.beginProjectMove();
    work.requestSubmit();
    expect(work.takeSubmitRequest()).toBe(false);
    move.end();
    expect(listener).toHaveBeenCalled();
    expect(work.takeSubmitRequest()).toBe(true);
    expect(work.takeSubmitRequest()).toBe(false);
    // A move that never lands stops holding sends.
    work.beginProjectMove();
    work.requestSubmit();
    vi.advanceTimersByTime(5_000);
    expect(work.takeSubmitRequest()).toBe(true);
    work.dispose();
  } finally {
    vi.useRealTimers();
  }
});
