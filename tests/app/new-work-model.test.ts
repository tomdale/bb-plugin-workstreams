import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NewWork,
  identityDisplay,
  type NewWorkDeps,
} from "../../src/app/composer/new-work.ts";
import type { Preview } from "../../src/server/preview.ts";
import { DEBOUNCE_MS, SHORT_PAUSE_MS } from "../../src/app/composer/timing.ts";

const base = {
  confidence: "high" as const,
  reason: "Fits feature",
  subject: "Billing",
  workstreamId: "ws_billing",
  traceId: "trace_1",
};

const withWorkstream: Preview = {
  ...base,
  id: "d_feature",
  title: "Invoice layout",
};

const withProposal: Preview = {
  ...base,
  id: "d_proposal",
  subject: "Export",
  workstreamId: null,
  proposal: { name: "Export", description: "CSV export" },
};

function setup(route: (prompt: string) => Promise<Preview>) {
  const deps = {
    route: vi.fn(route),
    cancelRoute: vi.fn(),
  } satisfies NewWorkDeps;
  const newWork = new NewWork(deps);
  return { deps, newWork };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("NewWork model: the draft's workstream preview", () => {
  it("previews draft text after typing pauses", async () => {
    const { deps, newWork } = setup(async () => withWorkstream);
    newWork.observe("Fix invoice billing layout");

    expect(deps.route).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);
    expect(deps.route).toHaveBeenCalledWith("Fix invoice billing layout", null);

    const snapshot = newWork.snapshot();
    expect(snapshot.identity).toEqual({
      workstreamId: "ws_billing",
      proposal: null,
      label: "Billing",
      provenance: "automatic",
    });
    expect(snapshot.decision?.title).toBe("Invoice layout");
  });

  it("aborts classification in flight when text changes", async () => {
    let resolveRoute!: () => void;
    const pendingRoute = new Promise<Preview>((resolve) => {
      resolveRoute = () => resolve(withWorkstream);
    });
    const { deps, newWork } = setup(() => pendingRoute);
    newWork.observe("First draft text here");
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);

    newWork.observe("Updated draft text");
    expect(deps.cancelRoute).toHaveBeenCalledTimes(1);
    resolveRoute();
  });

  it("retries a preview canceled by another composer view", async () => {
    let calls = 0;
    const { deps, newWork } = setup(async () => {
      calls++;
      if (calls === 1) throw new Error("Canceled: the draft changed.");
      return withWorkstream;
    });
    newWork.observe("Fix invoice billing layout");
    // The external cancel retries instead of leaving the field stale.
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS + 5_000);
    expect(deps.route).toHaveBeenCalledTimes(2);
    expect(newWork.snapshot().identity).toEqual({
      workstreamId: "ws_billing",
      proposal: null,
      label: "Billing",
      provenance: "automatic",
    });
  });

  it("stops retrying a preview that keeps failing", async () => {
    let calls = 0;
    const { deps, newWork } = setup(async () => {
      calls++;
      throw new Error("Canceled: the draft changed.");
    });
    newWork.observe("Fix invoice billing layout");
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.route.mock.calls.length).toBeLessThanOrEqual(6);
    expect(deps.route.mock.calls.length).toBeGreaterThan(1);
  });

  it("clears automatic identity when draft text is emptied", async () => {
    const { newWork } = setup(async () => withWorkstream);
    newWork.observe("Invoice bug in billing layout");
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);
    expect(newWork.snapshot().identity?.workstreamId).toBe("ws_billing");

    newWork.observe("");
    expect(newWork.snapshot().identity).toBeNull();
  });
});

describe("NewWork model: picked, inherited, and no workstream", () => {
  it("preserves manual identity when typing further", async () => {
    const { newWork } = setup(async () => withWorkstream);
    newWork.selectIdentity({ workstreamId: "ent_storage", label: "Storage" });
    expect(newWork.snapshot().identity).toEqual({
      workstreamId: "ent_storage",
      proposal: null,
      label: "Storage",
      provenance: "manual",
    });
    expect(identityDisplay(newWork.snapshot())).toMatchObject({
      label: "Storage",
      auto: false,
      selected: true,
    });

    newWork.observe("Some text about invoices");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    // Manual identity persists and is not overwritten by classifier
    expect(newWork.snapshot().identity).toEqual({
      workstreamId: "ent_storage",
      proposal: null,
      label: "Storage",
      provenance: "manual",
    });
  });

  it("persists a picked No workstream", async () => {
    const { newWork } = setup(async () => withWorkstream);
    newWork.selectIdentity(null);
    expect(newWork.snapshot().identity).toEqual({
      workstreamId: null,
      proposal: null,
      label: "No workstream",
      provenance: "manual",
    });

    newWork.observe("Some other request");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    // A manual No workstream persists
    expect(newWork.snapshot().identity).toEqual({
      workstreamId: null,
      proposal: null,
      label: "No workstream",
      provenance: "manual",
    });
  });

  it("allows resetting back to automatic identity", async () => {
    const { newWork } = setup(async () => withProposal);
    newWork.observe("Export data to csv file format");
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);

    // Overwrite manually
    newWork.selectIdentity({ workstreamId: "ent_storage", label: "Storage" });
    expect(newWork.snapshot().identity?.provenance).toBe("manual");

    // Reset to automatic
    newWork.selectAutomaticIdentity();
    expect(newWork.snapshot().identity).toEqual({
      workstreamId: null,
      proposal: { name: "Export", description: "CSV export" },
      label: "Export",
      provenance: "automatic",
    });
  });
});

describe("NewWork model: a workstream's ＋", () => {
  it("starts in the workstream, which a preview never replaces", async () => {
    const { newWork } = setup(async () => withWorkstream);
    newWork.selectWorkstream({ sectionId: "sec_docs" }, "Docs");
    expect(newWork.snapshot().identity).toEqual({
      workstreamId: null,
      proposal: null,
      label: "Docs",
      provenance: "inherited",
      sectionId: "sec_docs",
    });
    newWork.observe("Add an example");
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);
    expect(newWork.snapshot().identity?.provenance).toBe("inherited");
    expect(identityDisplay(newWork.snapshot()).auto).toBe(false);
    // Emptying the draft keeps it.
    newWork.observe("");
    expect(newWork.snapshot().identity?.label).toBe("Docs");
  });
});
