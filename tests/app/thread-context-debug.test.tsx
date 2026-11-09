// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ThreadContextDebugSection } from "../../src/app/debug/ThreadContextDebug.tsx";
import { mergePrefs, parsePrefs } from "../../src/domain/prefs.ts";

afterEach(cleanup);

const debugPrefs = (debug: boolean) =>
  mergePrefs(parsePrefs({}), { advanced: { debug } });

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

const renderSection = (debug: boolean, state: unknown) =>
  renderSlot(
    { component: ThreadContextDebugSection },
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
  expect(text).toContain("Settled title: Evaluating tidy rename guidance");
  expect(text).toContain("reported by the agent");
  expect(text).toContain("google/gemini-3.8-flash");
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

it("says when a thread has no analysis recorded", async () => {
  const slot = await renderSection(true, { analysis: {}, catalog: {} });
  await waitFor(() => {
    expect(slot.baseElement.textContent).toContain(
      "No analysis recorded for this thread.",
    );
  });
});
