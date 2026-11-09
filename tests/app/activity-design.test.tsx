// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CallRow } from "../../src/app/page/CallRow.tsx";
import { ActivityTerm } from "../../src/app/page/ActivityTerm.tsx";
import type { TraceSummary } from "../../src/domain/trace.ts";
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function page(
  summary: string | null,
  overrides: Partial<TraceSummary> = {},
) {
  const trace: TraceSummary = {
    id: "t",
    at: 1000,
    kind: "full-analysis",
    status: "ok",
    label: "Fix parser",
    model: "test/model",
    durationMs: 1200,
    replayOf: null,
    usage: null,
    error: null,
    summary,
    threads: [],
    ...overrides,
  };
  return renderSlot(
    {
      component: ({ trace }: { trace: TraceSummary }) => (
        <ul>
          <CallRow trace={trace} />
        </ul>
      ),
    },
    { trace },
    { rpc: { prefs: () => ({ prefs: { advanced: { debugUi: true } } }) } },
  );
}

it("labels status and topic, explains review on focus, and hides metrics by default", async () => {
  const slot = await page("review · goal “Fix parser tabs” · BB");
  const row = (await slot.findByText("Fix parser", { exact: true })).closest(
    "li",
  )!;
  expect(within(row).getByText("Work status:")).toBeTruthy();
  expect(within(row).getByText("Topic:").parentElement!.textContent).toBe(
    "Topic: BB",
  );
  expect(within(row).getByText("Title:").parentElement!.textContent).toBe(
    "Title: “Fix parser tabs”",
  );
  expect(
    within(row).getByText("Technical details").closest("details")!.open,
  ).toBe(false);
  const infoButton = within(row).getByRole("button", {
    name: "About Ready for your review",
  });
  expect(infoButton.querySelector("svg")).toBeTruthy();
  fireEvent.focus(infoButton);
  const tooltip = await within(document.body).findByRole("tooltip");
  expect(tooltip.textContent).toBe(
    "A deliverable is ready for you to review, test, merge, or ship.",
  );
  fireEvent.blur(infoButton);
  fireEvent.click(within(row).getByText("Technical details"));
  expect(within(row).getAllByText("Not reported")).toHaveLength(3);
  expect(within(row).getByText("Duration")).toBeTruthy();
});

it("labels a turn the agent reported itself", async () => {
  const slot = await page("reported · goal “Parser complete”");
  await slot.findByText("Reported by the agent");
  expect(slot.queryByText("Topic:")).toBeNull();
});

it("shows what Quick analysis named a new thread", async () => {
  const slot = await page("goal “Fix stale build cache” · Lumen", {
    kind: "quick-analysis",
    label: "Fix the stale build cache in the monorepo",
  });
  const row = (
    await slot.findByText("Fix the stale build cache in the monorepo")
  ).closest("li")!;
  expect(within(row).getByText("Quick analysis")).toBeTruthy();
  expect(within(row).getByText("Model result:")).toBeTruthy();
  expect(within(row).getByText(/Title: “Fix stale build cache”/)).toBeTruthy();
});

it("preserves unknown summary formats as labeled model results", async () => {
  const slot = await page("A future summary format");
  expect(await slot.findByText("A future summary format")).toBeTruthy();
  expect(slot.getByText("Model result:")).toBeTruthy();
  expect(slot.queryByText("Work status:")).toBeNull();
});

it("does not rerender settled terms and call rows for an unrelated disclosure", async () => {
  const trace: TraceSummary = {
    id: "settled",
    at: 1000,
    kind: "full-analysis",
    status: "ok",
    label: "Settled call",
    model: "test/model",
    durationMs: 1200,
    replayOf: null,
    usage: null,
    error: null,
    summary: "No change needed",
    threads: [],
  };
  const termRender = vi.spyOn(
    ActivityTerm as unknown as {
      type: (props: Parameters<typeof ActivityTerm>[0]) => unknown;
    },
    "type",
  );
  const callRender = vi.spyOn(
    CallRow as unknown as {
      type: (props: Parameters<typeof CallRow>[0]) => unknown;
    },
    "type",
  );
  function Rows() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen((value) => !value)}>
          Local disclosure
        </button>
        {open ? <p>Unrelated details</p> : null}
        <ActivityTerm label="Settled term" description="Already visible" />
        <ul>
          <CallRow trace={trace} />
        </ul>
      </>
    );
  }
  const slot = renderSlot(
    { component: Rows },
    {},
    { rpc: { prefs: () => ({ prefs: { advanced: { debugUi: true } } }) } },
  );
  await slot.findByRole("button", { name: "Inspect this model call" });
  termRender.mockClear();
  callRender.mockClear();
  fireEvent.click(slot.getByRole("button", { name: "Local disclosure" }));
  expect(slot.getByText("Unrelated details")).toBeTruthy();
  expect(termRender).not.toHaveBeenCalled();
  expect(callRender).not.toHaveBeenCalled();
});

it("keeps failed calls and their errors visible outside technical details", async () => {
  const slot = await page(null, {
    status: "failed",
    error: "Model unavailable",
  });
  const error = await slot.findByText("Model unavailable");
  expect(error.closest("details")).toBeNull();
  expect(slot.getByText("Model call failed")).toBeTruthy();
});
