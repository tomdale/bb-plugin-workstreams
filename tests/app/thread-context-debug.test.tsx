// @vitest-environment jsdom
import type {
  ExperimentalDetailRowProps,
  ExperimentalInfoSectionProps,
} from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ThreadContextDebugSection,
  ThreadInfoDebugSection,
} from "../../src/app/debug/ThreadContextDebug.tsx";
import { mergePrefs, parsePrefs, type Prefs } from "../../src/domain/prefs.ts";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...sdk,
    experimental_InfoSection: ({
      label,
      count,
      children,
    }: ExperimentalInfoSectionProps) => (
      <section aria-label={label} data-count={count}>
        <h3>{label}</h3>
        {children}
      </section>
    ),
    experimental_DetailRow: ({
      label,
      icon,
      align = "center",
      children,
    }: ExperimentalDetailRowProps) => (
      <div data-testid="bb-detail-row" data-icon={icon} data-align={align}>
        <dt>{label}</dt>
        <dd>{children}</dd>
      </div>
    ),
  };
});

afterEach(cleanup);

const debugPrefs = (debug: boolean | Partial<Prefs["advanced"]>) =>
  mergePrefs(parsePrefs({}), {
    advanced: typeof debug === "boolean" ? { debug } : debug,
  });

const stateWith = (threadId: string) => ({
  analysis: {
    [threadId]: {
      recap: "Settled the topic",
      state: "done",
      needsYou: null,
      goal: "Evaluating tidy rename guidance",
      threadGoal: "Evaluate rename guidance across models.",
      digest:
        "The thread evaluates the Workstreams plugin's tidy suggestions across models.",
      revision: 1,
      at: Date.now() - 60_000,
      model: "google/gemini-3.8-flash",
      reported: true,
      requestsKey: "abc123",
      traceId: null,
    },
  },
  catalog: {
    assignments: {
      [threadId]: {
        threadId,
        entityId: "e1",
        status: "assigned",
        provenance: "full",
        label: "bb: Workstreams Plugin",
        ancestorIds: [],
        evidence: null,
        inheritedFrom: null,
      },
    },
  },
});

const renderSection = (
  debug: boolean | Partial<Prefs["advanced"]>,
  state: unknown,
  component: typeof ThreadContextDebugSection = ThreadContextDebugSection,
) =>
  renderSlot(
    { component },
    { threadId: "t1", projectId: "proj_1", environment: null },
    {
      settings: {},
      rpc: {
        prefs: () => ({ prefs: debugPrefs(debug) }),
        state: () => state,
      } as never,
    },
  );

it("shows the accumulated goal, digest, topic, and analysis run in Debug mode", async () => {
  const slot = await renderSection(true, stateWith("t1"));
  await waitFor(() => {
    expect(slot.baseElement.textContent).toContain(
      "Evaluate rename guidance across models.",
    );
  });
  const text = slot.baseElement.textContent ?? "";
  expect(text).toContain(
    "The thread evaluates the Workstreams plugin's tidy suggestions across models.",
  );
  expect(text).toContain("bb: Workstreams Plugin");
  expect(text).toContain("settled by Full analysis");
  expect(text).toContain("Settled title");
  expect(text).toContain("Evaluating tidy rename guidance");
  expect(text).toContain("reported by the agent");
  expect(text).toContain("google/gemini-3.8-flash");
  expect(
    slot.baseElement
      .querySelector("[data-ws-context-debug]")
      ?.classList.contains("px-2"),
  ).toBe(true);
  for (const item of slot.baseElement.querySelectorAll("dt, dd")) {
    expect(item.closest("dl")).not.toBeNull();
  }
});

it("uses bb's section and detail-row primitives in the Info tab", async () => {
  const slot = await renderSection(
    true,
    stateWith("t1"),
    ThreadInfoDebugSection,
  );
  const section = await slot.findByRole("region", {
    name: "Workstreams Debug",
  });
  expect(section.getAttribute("data-count")).toBeNull();
  expect(
    section
      .querySelector("[data-ws-context-debug]")
      ?.classList.contains("px-2"),
  ).toBe(false);

  const rows = within(section).getAllByTestId("bb-detail-row");
  expect(
    rows.map((row) => ({
      label: row.querySelector("dt")?.textContent,
      icon: row.getAttribute("data-icon"),
      align: row.getAttribute("data-align"),
    })),
  ).toEqual([
    { label: "Goal", icon: "Target", align: "start" },
    { label: "Digest", icon: "FileText", align: "start" },
    { label: "Topic", icon: "Folder", align: "start" },
    { label: "Settled title", icon: "Edit", align: "start" },
    { label: "Status", icon: "ChartColumn", align: "start" },
    { label: "Analyzed", icon: "Clock", align: "start" },
  ]);
});

it("renders nothing outside Debug mode", async () => {
  const slot = await renderSection(false, stateWith("t1"));
  await waitFor(() => {
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "prefs"),
    ).toBe(true);
  });
  expect(slot.baseElement.textContent ?? "").not.toContain(
    "Evaluate rename guidance across models.",
  );
});

it("renders nothing when its own switch is off under Debug mode", async () => {
  const slot = await renderSection(
    { debug: true, debugThreadInfo: false },
    stateWith("t1"),
  );
  await waitFor(() => {
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "prefs"),
    ).toBe(true);
  });
  expect(slot.baseElement.textContent ?? "").not.toContain(
    "Evaluate rename guidance across models.",
  );
});

it("says when a thread has no analysis recorded", async () => {
  const slot = await renderSection(true, { analysis: {}, catalog: {} });
  await waitFor(() => {
    expect(slot.baseElement.textContent).toContain(
      "No analysis recorded for this thread.",
    );
  });
});
