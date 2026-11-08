// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuestionHistoryInline } from "../../../src/app/question/QuestionHistory.tsx";
afterEach(cleanup);
it("renders the saved Q&A at the form row", async () => {
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
    { component: QuestionHistoryInline },
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

it("does not refetch a known-final direct record on realtime signals", async () => {
  const result = {
    questions: [
      {
        question: "Keep this answer?",
        header: "Answer",
        options: [],
        multiSelect: false,
      },
    ],
    answers: { "Keep this answer?": "Keep it" },
  };
  const questionAt = vi.fn(() => null);
  const slot = renderSlot(
    { component: QuestionHistoryInline },
    {
      row: {
        id: "thread:form:final",
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
    { rpc: { question_at: questionAt } },
  );
  await slot.findByText("Keep it");
  await waitFor(() => expect(questionAt).toHaveBeenCalledTimes(1));
  await slot.behavior.emitRealtime("changed", {});
  await slot.behavior.emitRealtime("changed", {});
  expect(questionAt).toHaveBeenCalledTimes(1);
});

it("coalesces pending realtime signals and preserves a late durable answer", async () => {
  const payload = {
    questions: [
      {
        id: "q0",
        prompt: "Choose an answer",
        shortLabel: "Answer",
        multiSelect: false,
        allowFreeText: true,
        options: [],
      },
    ],
  };
  let answerFirst!: (value: unknown) => void;
  let answerSecond!: (value: unknown) => void;
  const questionAt = vi
    .fn()
    .mockImplementationOnce(
      () => new Promise((resolve) => (answerFirst = resolve)),
    )
    .mockImplementationOnce(
      () => new Promise((resolve) => (answerSecond = resolve)),
    );
  const slot = renderSlot(
    { component: QuestionHistoryInline },
    {
      row: {
        id: "thread:form:pending",
        threadId: "thread",
        turnId: null,
        kind: "workstreams/ask-user-question",
        toolName: null,
        status: "completed",
        startedAt: 123,
        completedAt: 124,
      },
      payload: null,
      presentation: null,
      thread: { id: "thread", providerId: "pi" },
      Original: () => <p>Original row</p>,
    },
    { rpc: { question_at: questionAt } },
  );
  await waitFor(() => expect(questionAt).toHaveBeenCalledTimes(1));
  await slot.behavior.emitRealtime("changed", {});
  await slot.behavior.emitRealtime("changed", {});
  await slot.behavior.emitRealtime("changed", {});
  expect(questionAt).toHaveBeenCalledTimes(1);

  answerFirst({
    id: "saved",
    at: 123,
    status: "pending",
    payload,
    result: null,
  });
  await waitFor(() => expect(questionAt).toHaveBeenCalledTimes(2));
  answerSecond({
    id: "saved",
    at: 123,
    status: "answered",
    payload,
    result: {
      questions: [
        {
          question: "Choose an answer",
          header: "Answer",
          options: [],
          multiSelect: false,
        },
      ],
      answers: { "Choose an answer": "Late answer" },
    },
  });
  await slot.findByText("Late answer");
  await slot.behavior.emitRealtime("changed", {});
  expect(questionAt).toHaveBeenCalledTimes(2);
});

it("does not publish a deep-equal missing result", async () => {
  const questionAt = vi.fn(() => null);
  const Original = vi.fn(() => <p>Original row</p>);
  const slot = renderSlot(
    { component: QuestionHistoryInline },
    {
      row: {
        id: "thread:form:missing",
        threadId: "thread",
        turnId: null,
        kind: "workstreams/ask-user-question",
        toolName: null,
        status: "completed",
        startedAt: 123,
        completedAt: 124,
      },
      payload: null,
      presentation: null,
      thread: { id: "thread", providerId: "pi" },
      Original,
    },
    { rpc: { question_at: questionAt } },
  );
  await waitFor(() => expect(questionAt).toHaveBeenCalledTimes(1));
  await act(async () => {});
  Original.mockClear();

  await slot.behavior.emitRealtime("changed", {});
  await waitFor(() => expect(questionAt).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(Original).not.toHaveBeenCalled();
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
    { component: QuestionHistoryInline },
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
      { component: QuestionHistoryInline },
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
