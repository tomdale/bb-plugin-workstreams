// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
const app = await loadPluginApp(() => import("../../../src/app/index.tsx"));
afterEach(cleanup);
it("renders the saved Q&A at the form row without a header or panel", async () => {
  expect(app.threadHeaderActions.some((p) => p.id === "question-history")).toBe(
    false,
  );
  expect(app.threadPanelActions.some((p) => p.id === "question-history")).toBe(
    false,
  );
  const payload = {
    questions: [
      {
        id: "q0",
        prompt: "Which database?",
        details: "Compare **managed** and local options.",
        shortLabel: "Database",
        multiSelect: false,
        allowFreeText: true,
        options: [
          {
            value: "q0o0",
            label: "SQLite",
            description: "Embedded",
            preview: "CREATE TABLE test;",
          },
        ],
      },
    ],
  };
  const slot = renderSlot(
    app.timelineRenderers.find(
      (p) => p.kind === "workstreams/ask-user-question",
    )!,
    {
      row: {
        id: "thread:form:interaction",
        threadId: "thread",
        turnId: null,
        kind: "workstreams/ask-user-question",
        toolName: null,
        status: "completed",
        startedAt: 123,
        completedAt: null,
      },
      payload: null,
      presentation: null,
      thread: { id: "thread", providerId: "pi" },
      Original: () => <p>Original row</p>,
    },
    {
      rpc: {
        question_at: () => ({
          id: "saved",
          at: 123,
          status: "answered",
          payload,
          result: {
            questions: [
              {
                question: "Which database?",
                details: "Compare **managed** and local options.",
                header: "Database",
                multiSelect: false,
                options: [],
              },
            ],
            answers: { "Which database?": "SQLite with replicas" },
          },
        }),
      },
    },
  );
  await slot.findByText("SQLite with replicas");
  expect(slot.getByText("Which database?")).toBeTruthy();
  const disclosure = slot.getByRole("button", { expanded: false });
  expect(slot.queryByText("CREATE TABLE test;")).toBeNull();
  fireEvent.click(disclosure);
  expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  expect(slot.getByText("Compare **managed** and local options.")).toBeTruthy();
  expect(slot.getByRole("list", { name: "Options offered" })).toBeTruthy();
  expect(slot.getByText("CREATE TABLE test;")).toBeTruthy();
  expect(slot.queryByText("Original row")).toBeNull();
});

it("reconstructs every input and output as read-only content from the persisted form payload", async () => {
  const { result } = await import("./submission-fixture.ts");
  const { vi } = await import("vitest");
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:attachment"),
      revokeObjectURL: vi.fn(),
    }),
  );
  const slot = renderSlot(
    app.timelineRenderers.find(
      (p) => p.kind === "workstreams/ask-user-question",
    )!,
    {
      row: {
        id: "thread:form:restored",
        threadId: "thread",
        turnId: null,
        kind: "workstreams/ask-user-question",
        toolName: null,
        status: "completed",
        startedAt: 123,
        completedAt: 124,
      },
      payload: JSON.parse(JSON.stringify(result)),
      presentation: null,
      thread: { id: "thread", providerId: "pi" },
      Original: () => <p>Original row</p>,
    },
    {
      rpc: { question_at: () => null },
      sdk: {
        projects: {
          attachments: {
            read: async ({ path }) => ({
              bytes: new TextEncoder().encode(path),
              mimeType: path.endsWith("png") ? "image/png" : "text/plain",
              sizeBytes: 6,
            }),
          },
        },
      },
    },
  );
  expect(slot.getByText("Which layout?")).toBeTruthy();
  expect(slot.getByText("Cards · Keep the details visible.")).toBeTruthy();
  expect(slot.getByText("Types, build · Tests")).toBeTruthy();
  expect(
    slot.getByText("Use the attached sample. · sample.txt · sample.png"),
  ).toBeTruthy();
  expect(slot.queryByText("Room for details")).toBeNull();
  const disclosure = slot.getByRole("button", { expanded: false });
  fireEvent.click(disclosure);
  await slot.findByRole("link", { name: "sample.txt" });
  expect(
    slot.getByRole("link", { name: "sample.txt" }).getAttribute("download"),
  ).toBe("sample.txt");
  expect(slot.getByRole("img", { name: "sample.png" })).toBeTruthy();
  expect(slot.getByText("Compare **both** designs.")).toBeTruthy();
  expect(slot.getByText("Room for details")).toBeTruthy();
  expect(slot.getByText("[ card ] [ card ]")).toBeTruthy();
  expect(slot.getByText("[ row one ] [ row two ]")).toBeTruthy();
  expect(slot.getByText("Keep the details visible.")).toBeTruthy();
  expect(slot.getByText("Use the attached sample.")).toBeTruthy();
  expect(slot.container.querySelectorAll(".sr-only")).toHaveLength(3);
  expect(
    slot.container.querySelector(
      "input, textarea, [role=radio], [role=checkbox], [contenteditable=true]",
    ),
  ).toBeNull();
  fireEvent.click(disclosure);
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(slot.queryByText("Room for details")).toBeNull();
  slot.lifecycle.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});

it.each(["pending", "unknown"] as const)(
  "keeps the submitted form payload when the durable outcome is %s without a result",
  async (status) => {
    const { payload } = await import("./submission-fixture.ts");
    const result = {
      questions: [
        {
          question: "Keep my input?",
          header: "Input",
          options: [],
          multiSelect: false,
        },
      ],
      answers: { "Keep my input?": "Keep this answer" },
    };
    const slot = renderSlot(
      app.timelineRenderers.find(
        (p) => p.kind === "workstreams/ask-user-question",
      )!,
      {
        row: {
          id: "thread:form:input",
          threadId: "thread",
          turnId: null,
          kind: "workstreams/ask-user-question",
          toolName: null,
          status: "completed",
          startedAt: 123,
          completedAt: 124,
        },
        payload: result,
        presentation: null,
        thread: { id: "thread", providerId: "pi" },
        Original: () => <p>Original row</p>,
      },
      {
        rpc: {
          question_at: () => ({
            id: "saved",
            at: 123,
            status,
            payload,
            result: null,
          }),
        },
      },
    );
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.some((call) => call.method === "question_at"),
      ).toBe(true),
    );
    expect(slot.getByText("Keep this answer")).toBeTruthy();
    expect(slot.queryByText("No answer was retained")).toBeNull();
  },
);
