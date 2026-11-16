import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NewWork,
  submittedIdentity,
  type NewWorkDeps,
  type NewWorkIdentityReport,
} from "../../src/app/composer/new-work.ts";
import type { Preview } from "../../src/server/preview.ts";
import { SHORT_PAUSE_MS } from "../../src/app/composer/timing.ts";

const automaticProposal = {
  name: "Export",
  description: "CSV export",
  parentId: "ent_data",
  ancestors: [{ name: "Data", description: "Data tools" }],
};

const preview: Preview = {
  id: "d_export",
  confidence: "high",
  reason: "Fits feature",
  subject: "Export",
  workstreamId: null,
  proposal: automaticProposal,
  title: "Export billing data",
  traceId: "trace_1",
};

function setup(
  overrides: Partial<NewWorkDeps> = {},
  choice?: ConstructorParameters<typeof NewWork>[1],
) {
  const deps: NewWorkDeps = {
    route: vi.fn(() => new Promise<Preview>(() => {})),
    cancelRoute: vi.fn(),
    ...overrides,
  };
  const newWork = new NewWork(deps, choice);
  return { deps, newWork };
}

const nextMicrotask = () => Promise.resolve();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("NewWork view store", () => {
  it("keeps the view snapshot stable for text and irrelevant selection while the full store notifies", () => {
    const { newWork } = setup();
    const fullListener = vi.fn();
    const viewListener = vi.fn();
    newWork.subscribe(fullListener);
    newWork.subscribeView(viewListener);
    const view = newWork.viewSnapshot();

    newWork.observe("A draft whose picker is unchanged");
    newWork.observeSelection({ providerId: "openai", model: "gpt-1" });
    newWork.observeSelection({ providerId: "anthropic", model: "claude-1" });

    expect(fullListener).toHaveBeenCalledTimes(3);
    expect(viewListener).not.toHaveBeenCalled();
    expect(newWork.viewSnapshot()).toBe(view);
    expect(newWork.snapshot().text).toBe("A draft whose picker is unchanged");
    expect(newWork.snapshot().selection?.providerId).toBe("anthropic");
  });

  it("publishes identity, error, and error-count changes", () => {
    const { newWork } = setup();
    const viewListener = vi.fn();
    newWork.subscribeView(viewListener);

    newWork.selectIdentity({ workstreamId: "ent_billing", label: "Billing" });
    expect(newWork.viewSnapshot().identity?.workstreamId).toBe("ent_billing");
    expect(viewListener).toHaveBeenCalledTimes(1);

    newWork.reportError(new Error("First failure"));
    expect(newWork.viewSnapshot()).toMatchObject({
      error: "First failure",
      errors: 1,
    });
    expect(viewListener).toHaveBeenCalledTimes(2);

    newWork.reportError(new Error("Second failure"));
    expect(newWork.viewSnapshot()).toMatchObject({
      error: "Second failure",
      errors: 2,
    });
    expect(viewListener).toHaveBeenCalledTimes(3);
  });

  it("publishes classification and decision changes", async () => {
    let resolveRoute!: (decision: Preview) => void;
    const route = vi.fn(
      () =>
        new Promise<Preview>((resolve) => {
          resolveRoute = resolve;
        }),
    );
    const { newWork } = setup({ route });
    const viewListener = vi.fn();
    newWork.subscribeView(viewListener);

    newWork.observe("Export billing data to CSV");
    await vi.advanceTimersByTimeAsync(SHORT_PAUSE_MS);
    expect(newWork.viewSnapshot().classifying).toBe(true);
    expect(viewListener).toHaveBeenCalledTimes(1);

    resolveRoute(preview);
    await vi.advanceTimersByTimeAsync(0);
    expect(newWork.viewSnapshot().decision).toEqual(preview);
    expect(newWork.viewSnapshot().identity?.proposal).toEqual(
      automaticProposal,
    );
    expect(newWork.viewSnapshot().classifying).toBe(false);
    expect(viewListener).toHaveBeenCalledTimes(3);
  });
});

describe("NewWork canonical identity reports", () => {
  it("preserves the initial empty report", async () => {
    const reportIdentity = vi.fn();
    setup({ reportIdentity });

    expect(reportIdentity).not.toHaveBeenCalled();
    await nextMicrotask();
    expect(reportIdentity).toHaveBeenCalledExactlyOnceWith({
      text: "",
      identity: null,
      projectChoice: null,
    });
  });

  it("coalesces same-microtask changes into one canonical report", async () => {
    const reportIdentity = vi.fn();
    const { newWork } = setup({ reportIdentity });

    newWork.observe("First draft");
    newWork.observe("Revised draft");
    newWork.observeSelection({ projectId: "proj_1", providerId: "openai" });
    newWork.selectIdentity({ workstreamId: "ent_billing", label: "Billing" });

    await nextMicrotask();
    expect(reportIdentity).toHaveBeenCalledExactlyOnceWith({
      text: "Revised draft",
      identity: {
        workstreamId: "ent_billing",
        proposal: null,
        provenance: "manual",
      },
      projectChoice: { projectId: "proj_1", source: "independent" },
    });
  });

  it("reports distinct keystrokes after each awaited microtask without preview debounce", async () => {
    const reportIdentity = vi.fn();
    const { newWork } = setup({ reportIdentity });
    await nextMicrotask();
    reportIdentity.mockClear();

    newWork.observe("First keystroke");
    await nextMicrotask();
    newWork.observe("Second keystroke");
    await nextMicrotask();

    expect(reportIdentity.mock.calls.map(([report]) => report.text)).toEqual([
      "First keystroke",
      "Second keystroke",
    ]);
  });

  it("flushes nonempty reports before a clear and the latest report on dispose", async () => {
    const reportIdentity = vi.fn();
    const { newWork } = setup({ reportIdentity });
    await nextMicrotask();
    reportIdentity.mockClear();

    newWork.observe("Ready to submit");
    newWork.observe("");
    expect(reportIdentity.mock.calls.map(([report]) => report.text)).toEqual([
      "Ready to submit",
    ]);

    newWork.observe("Next draft before the queued clear");
    await nextMicrotask();
    expect(reportIdentity.mock.calls.map(([report]) => report.text)).toEqual([
      "Ready to submit",
      "Next draft before the queued clear",
    ]);

    newWork.observe("");
    newWork.dispose();
    expect(reportIdentity.mock.calls.map(([report]) => report.text)).toEqual([
      "Ready to submit",
      "Next draft before the queued clear",
      "",
    ]);

    await nextMicrotask();
    expect(reportIdentity).toHaveBeenCalledTimes(3);
  });

  it("continues after synchronous throws and rejected reports", async () => {
    const reportIdentity = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Synchronous failure");
      })
      .mockRejectedValueOnce(new Error("Rejected report"))
      .mockResolvedValue({ filed: true });
    const { newWork } = setup({ reportIdentity });

    await nextMicrotask();
    newWork.observe("First report after a throw");
    await nextMicrotask();
    await nextMicrotask();
    newWork.observe("Later report after a rejection");
    await nextMicrotask();

    expect(reportIdentity).toHaveBeenCalledTimes(3);
    expect(reportIdentity.mock.lastCall?.[0].text).toBe(
      "Later report after a rejection",
    );
  });

  it("does not serialize later reports behind unsettled adapter calls", async () => {
    const reportIdentity = vi.fn(() => new Promise<void>(() => {}));
    const { newWork } = setup({ reportIdentity });

    await nextMicrotask();
    newWork.observe("First unsettled report");
    await nextMicrotask();
    newWork.observe("Second unsettled report");
    await nextMicrotask();

    expect(reportIdentity).toHaveBeenCalledTimes(3);
  });

  it("reports proposal, inherited section, and automatic goal metadata exactly", async () => {
    const reportIdentity = vi.fn();
    const { newWork } = setup(
      { reportIdentity },
      { identity: null, decision: preview },
    );
    await nextMicrotask();
    reportIdentity.mockClear();

    const manualProposal = {
      name: "Invoices",
      description: "Invoice tools",
      parentId: "ent_billing",
    };
    newWork.selectIdentity({ proposal: manualProposal, label: "Invoices" });
    await nextMicrotask();
    newWork.selectWorkstream({ sectionId: "sec_docs" }, "Docs");
    await nextMicrotask();
    newWork.selectAutomaticIdentity();
    await nextMicrotask();

    expect(
      reportIdentity.mock.calls.map(([report]) => report.identity),
    ).toEqual([
      {
        workstreamId: null,
        proposal: manualProposal,
        provenance: "manual",
      },
      {
        workstreamId: null,
        proposal: null,
        provenance: "inherited",
        sectionId: "sec_docs",
      },
      // The preview answered other text, so its title isn't sent.
      {
        workstreamId: null,
        proposal: automaticProposal,
        provenance: "automatic",
      },
    ]);
  });

  it("sends a preview's title only with the text it answered", () => {
    const identity = {
      workstreamId: null,
      proposal: automaticProposal,
      label: "Export",
      provenance: "automatic" as const,
    };
    const decision = { ...preview, answered: "Export billing data" };
    expect(
      submittedIdentity({ identity, decision, text: " Export billing data " }),
    ).toEqual({
      workstreamId: null,
      proposal: automaticProposal,
      provenance: "automatic",
      title: "Export billing data",
      answered: true,
    });
    expect(
      submittedIdentity({ identity, decision, text: "Export billing data!" }),
    ).toEqual({
      workstreamId: null,
      proposal: automaticProposal,
      provenance: "automatic",
    });
  });

  it("dedupes selection refs and provider or model changes but reports project provenance", async () => {
    const reportIdentity = vi.fn();
    const { newWork } = setup({ reportIdentity });
    await nextMicrotask();
    reportIdentity.mockClear();

    newWork.observeSelection({ providerId: "openai", model: "gpt-1" });
    await nextMicrotask();
    expect(reportIdentity).not.toHaveBeenCalled();

    newWork.supplyProject("proj_1");
    newWork.observeSelection({
      projectId: "proj_1",
      providerId: "openai",
      model: "gpt-1",
    });
    await nextMicrotask();
    newWork.observeSelection({
      projectId: "proj_1",
      providerId: "anthropic",
      model: "claude-1",
    });
    await nextMicrotask();

    expect(reportIdentity).toHaveBeenCalledTimes(1);
    expect(reportIdentity.mock.lastCall?.[0].projectChoice).toEqual({
      projectId: "proj_1",
      source: "workstreams",
    });

    newWork.observeSelection({ projectId: "proj_2" });
    await nextMicrotask();
    expect(reportIdentity).toHaveBeenCalledTimes(2);
    expect(reportIdentity.mock.lastCall?.[0]).toMatchObject({
      projectChoice: { projectId: "proj_2", source: "independent" },
    } satisfies Partial<NewWorkIdentityReport>);
  });
});
