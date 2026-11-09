// @vitest-environment jsdom
import type {
  ExperimentalDetailRowProps,
  ExperimentalInfoSectionProps,
} from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ThreadContextDebugSection,
  ThreadInfoDebugSection,
} from "../../src/app/debug/ThreadContextDebug.tsx";
import { mergePrefs, parsePrefs, type Prefs } from "../../src/domain/prefs.ts";
import { entry, trace } from "./activity-fixtures.ts";

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
    advanced: typeof debug === "boolean" ? { debugUi: debug } : debug,
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
  rpc: Record<string, unknown> = {},
) =>
  renderSlot(
    { component },
    { threadId: "t1", projectId: "proj_1", environment: null },
    {
      settings: {},
      rpc: {
        prefs: () => ({ prefs: debugPrefs(debug) }),
        state: () => state,
        threadActivity: () => ({ entries: [], traces: [] }),
        ...rpc,
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

it("lists analysis and journal events and opens every transcript behind an event", async () => {
  const now = Date.now();
  const analysis = trace("analysis", {
    at: now - 1_000,
    label: "Evaluate rename guidance",
    summary:
      "done · title “Evaluate rename guidance” · goal “Keep titles current”",
    threads: ["t1"],
  });
  const placement = trace("placement", {
    at: now - 3_000,
    kind: "placement",
    label: "Evaluate rename guidance",
    summary: "Workstreams",
    threads: ["t1"],
  });
  const journal = {
    ...entry,
    action: "retitle" as const,
    at: now - 2_000,
    rationale: "Retitled from Old focus",
    traceIds: [analysis.id, placement.id],
  };
  const unrelated = trace("unrelated", {
    at: now - 4_000,
    label: "Unrelated request",
    threads: ["t2"],
  });
  const calls = [analysis, placement];
  const fullTrace = (summary: (typeof calls)[number], prompt: string) => ({
    ...summary,
    provider: "test",
    thinking: "off",
    system: "Analyze",
    prompt,
    input: null,
    response: `Raw response for ${prompt}`,
    reasoning: null,
    stopReason: "stop",
    parsed: {},
    outcome: {},
    links: [],
    replays: [],
  });
  const slot = await renderSection(
    true,
    stateWith("t1"),
    ThreadContextDebugSection,
    {
      threadActivity: () => ({ entries: [journal], traces: calls }),
      traces: ({
        ids,
        link,
      }: {
        ids?: string[];
        link?: { kind: string; ref: string };
      }) => ({
        traces:
          link?.kind === "entry" && link.ref === journal.id
            ? calls
            : [analysis, placement, unrelated].filter((call) =>
                ids?.includes(call.id),
              ),
      }),
      trace: ({ id }: { id: string }) => ({
        trace:
          id === analysis.id
            ? fullTrace(analysis, "Exact analysis prompt")
            : fullTrace(placement, "Exact placement prompt"),
      }),
    },
  );

  const activity = (await slot.findByText("Activity")).closest(
    "[data-ws-thread-activity]",
  )!;
  expect(
    within(activity as HTMLElement).getByRole("list", {
      name: "Thread activity",
    }),
  ).toBeTruthy();
  const rows = within(activity as HTMLElement).getAllByRole("button");
  expect(rows[0]?.textContent).not.toContain("·");
  expect(rows[0]?.textContent).toContain("Work status: done");
  const chevrons = (activity as HTMLElement).querySelectorAll(
    "[data-activity-chevron]",
  );
  expect(chevrons).toHaveLength(rows.length);
  for (const chevron of chevrons)
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("Full analysis"),
    expect.stringContaining("Updated title"),
    expect.stringContaining("Placement"),
  ]);

  fireEvent.click(
    within(activity as HTMLElement).getByRole("button", {
      name: /Updated title/,
    }),
  );
  const pane = await within(document.body).findByRole("dialog");
  expect(
    await within(pane).findByRole("button", { name: /Full analysis/ }),
  ).toBeTruthy();
  expect(within(pane).getByRole("button", { name: /Placement/ })).toBeTruthy();
  expect(
    slot.inspection.rpcCalls.some(
      (call) =>
        call.method === "traces" &&
        JSON.stringify(call.input) ===
          JSON.stringify({
            link: { kind: "entry", ref: journal.id },
            limit: 201,
          }),
    ),
  ).toBe(true);
  expect(within(pane).queryByText("Unrelated request")).toBeNull();

  const reveal = async (name: string) => {
    const summary = await within(pane).findByText(name);
    fireEvent.click(summary);
    expect(summary.closest("details")?.open).toBe(true);
  };
  await reveal("Raw response");
  await reveal("Prompt");
  expect(await within(pane).findByLabelText("Prompt")).toHaveProperty(
    "textContent",
    "Exact analysis prompt",
  );
  expect(within(pane).getByLabelText("Raw response")).toHaveProperty(
    "textContent",
    "Raw response for Exact analysis prompt",
  );

  fireEvent.click(within(pane).getByRole("button", { name: /Placement/ }));
  await reveal("Raw response");
  await reveal("Prompt");
  expect(await within(pane).findByLabelText("Prompt")).toHaveProperty(
    "textContent",
    "Exact placement prompt",
  );
  expect(within(pane).getByLabelText("Raw response")).toHaveProperty(
    "textContent",
    "Raw response for Exact placement prompt",
  );
});

it("coalesces realtime bursts into one active request and one trailing refresh", async () => {
  const pending: (() => void)[] = [];
  const threadActivity = vi.fn(
    () =>
      new Promise<{ entries: []; traces: [] }>((resolve) => {
        pending.push(() => resolve({ entries: [], traces: [] }));
      }),
  );
  const slot = await renderSection(
    true,
    stateWith("t1"),
    ThreadContextDebugSection,
    { threadActivity },
  );
  await waitFor(() => expect(threadActivity).toHaveBeenCalledTimes(1));

  await slot.behavior.emitRealtime("changed", {});
  await slot.behavior.emitRealtime("changed", {});
  await slot.behavior.emitRealtime("changed", {});
  expect(threadActivity).toHaveBeenCalledTimes(1);

  await act(async () => pending.shift()!());
  await waitFor(() => expect(threadActivity).toHaveBeenCalledTimes(2));
  await act(async () => pending.shift()!());
  await slot.findByText("No activity recorded for this thread.");
  expect(threadActivity).toHaveBeenCalledTimes(2);
});

it("restores focus to Activity when a refresh removes the originating row", async () => {
  let entries = [entry];
  const slot = await renderSection(
    true,
    stateWith("t1"),
    ThreadContextDebugSection,
    {
      threadActivity: () => ({ entries, traces: [] }),
      traces: () => ({ traces: [] }),
    },
  );
  const activity = (await slot.findByText("Activity")).closest(
    "[data-ws-thread-activity]",
  )!;
  fireEvent.click(
    within(activity as HTMLElement).getByRole("button", { name: /Move/ }),
  );
  const pane = await within(document.body).findByRole("dialog");

  entries = [];
  await slot.behavior.emitRealtime("changed", {});
  await slot.findByText("No activity recorded for this thread.");
  fireEvent.keyDown(pane, { key: "Escape" });
  await waitFor(() =>
    expect(document.activeElement).toBe(slot.getByText("Activity")),
  );
});

it("reports an activity loading failure without hiding the metadata", async () => {
  const slot = await renderSection(
    true,
    stateWith("t1"),
    ThreadContextDebugSection,
    {
      threadActivity: () => Promise.reject(new Error("Activity unavailable")),
    },
  );
  expect(await slot.findByRole("alert")).toHaveProperty(
    "textContent",
    "Activity unavailable",
  );
  expect(slot.baseElement.textContent).toContain(
    "Evaluate rename guidance across models.",
  );
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
    { debugUi: true, debugThreadInfo: false },
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
