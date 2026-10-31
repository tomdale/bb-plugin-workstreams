// @vitest-environment jsdom
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { deliveredCardRecord } from "../../../src/app/question/DeliveredQuestion.tsx";
const app = await loadPluginApp(() => import("../../../src/app/index.tsx"));
afterEach(cleanup);
const result = {
  questions: [
    {
      question: "What should we test?",
      header: "Test",
      options: [
        { label: "Theme", description: "Pick a theme", preview: "Dark\nLight" },
      ],
      multiSelect: false,
    },
  ],
  answers: { "What should we test?": "Theme" },
};
const prefix =
  "Your earlier AskUserQuestion tool call has finished. Its result:";
it("replaces the delivered message's raw JSON with inline Q&A and restores host DOM on unmount", async () => {
  const message = render(
    <div data-timeline-row-id="thread:delivery">
      <div>
        <p>{prefix}</p>
        <p>{JSON.stringify(result)}</p>
      </div>
    </div>,
  );
  const overlay = renderSlot(
    app.appOverlays.find((p) => p.id === "delivered-questions")!,
    {},
  );
  await waitFor(() =>
    expect(
      message.container.querySelector("[data-ws-question-history]"),
    ).toBeTruthy(),
  );
  expect(message.getByText("What should we test?")).toBeTruthy();
  expect(message.getByText("Your answer")).toBeTruthy();
  expect(
    message.container
      .querySelector("[data-ws-question-history]")
      ?.hasAttribute("data-bb-plugin-root"),
  ).toBe(true);
  expect(
    message.container.querySelector(".ws-delivered-question-source"),
  ).toBeTruthy();
  expect(
    message.container.querySelectorAll("[data-ws-delivered-anchor]"),
  ).toHaveLength(1);
  overlay.lifecycle.unmount();
  expect(
    message.container.querySelector("[data-ws-question-history]"),
  ).toBeNull();
  expect(
    message.container.querySelector(".ws-delivered-question-source"),
  ).toBeNull();
  expect(message.getByText(JSON.stringify(result))).toBeTruthy();
});
it("replaces BB's clipped generated-message preview with an expansion hint", async () => {
  const message = render(
    <div data-timeline-row-id="thread:delivery">
      <div>
        <div>Delivered AskUserQuestion result</div>
        <div>
          <div>
            <div>
              Your earlier AskUserQuestion tool call has finished. Its
              result:...
            </div>
          </div>
        </div>
      </div>
    </div>,
  );
  const overlay = renderSlot(
    app.appOverlays.find((p) => p.id === "delivered-questions")!,
    {},
  );
  await waitFor(() =>
    expect(
      message.container.querySelector(".ws-delivered-question-preview"),
    ).toBeTruthy(),
  );
  expect(
    message.getByText("Expand to view the question and answer"),
  ).toBeTruthy();
  overlay.lifecycle.unmount();
  expect(
    message.container.querySelector(".ws-delivered-question-preview"),
  ).toBeNull();
});
it("replaces direct text-node results as well as nested markup", async () => {
  const raw = `${prefix}\n\n${JSON.stringify(result)}`;
  const message = render(
    <div data-timeline-row-id="thread:direct-text">
      <div>Delivered AskUserQuestion result</div>
      <div>{raw}</div>
    </div>,
  );
  const overlay = renderSlot(
    app.appOverlays.find((p) => p.id === "delivered-questions")!,
    {},
  );

  await waitFor(() =>
    expect(
      message.container.querySelector("[data-ws-question-history]"),
    ).toBeTruthy(),
  );
  expect(message.getByText("What should we test?")).toBeTruthy();
  expect(
    message.container.querySelector(".ws-delivered-question-source"),
  ).toBeTruthy();
  expect(
    message.container.querySelector("[data-ws-delivered-anchor]"),
  ).toBeTruthy();
  expect(
    message.container.querySelector(".ws-delivered-question-source")
      ?.textContent,
  ).toBe(raw);

  overlay.lifecycle.unmount();
  expect(
    message.container.querySelector(".ws-delivered-question-source"),
  ).toBeNull();
  expect(
    message.container.querySelector("[data-timeline-row-id]")?.textContent,
  ).toContain(raw);
});
it("does not convert malformed transport data or unrelated text", () => {
  expect(deliveredCardRecord("ordinary message")).toBeNull();
  expect(deliveredCardRecord(prefix + "\n{invalid")).toBeNull();
  expect(deliveredCardRecord(prefix + "\n{}")).toBeNull();
});

const recoveredPrefix =
  "My answer to your question (recovered after the question tool was interrupted):";
const recoveredSuffix =
  "Use this as my answer and resume the work that depended on it.";

it.each([prefix, recoveredPrefix])(
  "restores the same card for %s, including when paragraphs omit newline separators",
  async (lead) => {
    const { result: complete } = await import("./submission-fixture.ts");
    // Attachment retrieval is covered by the timeline test; use text-only here.
    const answer = {
      ...complete,
      submission: {
        answers: {
          ...complete.submission!.answers,
          q2: { selected: [], freeText: "More detail" },
        },
      },
      annotations: undefined,
    };
    const raw = `${lead}${JSON.stringify(answer)}${lead === recoveredPrefix ? recoveredSuffix : ""}`;
    const message = render(
      <div data-timeline-row-id="thread:delivery">
        <div style={{ maxHeight: 20, overflow: "hidden" }}>
          <div>{raw}</div>
          <button>Show more</button>
        </div>
      </div>,
    );
    for (let reload = 0; reload < 2; reload++) {
      const overlay = renderSlot(
        app.appOverlays.find((p) => p.id === "delivered-questions")!,
        {},
      );
      await waitFor(() =>
        expect(
          message.container.querySelectorAll("[data-ws-question-history]"),
        ).toHaveLength(1),
      );
      expect(message.getByText("Keep the details visible.")).toBeTruthy();
      expect(
        message.container.querySelector("[data-ws-delivered-anchor]")
          ?.parentElement?.dataset.timelineRowId,
      ).toBe("thread:delivery");
      expect(
        message.container.querySelector(
          "[data-ws-question-history] input, [data-ws-question-history] button",
        ),
      ).toBeNull();
      overlay.lifecycle.unmount();
      expect(
        message.container.querySelector(".ws-delivered-question-row"),
      ).toBeNull();
    }
  },
);

it("keeps one answer when the original form and a delivery are both mounted, and restores it as rows unmount", async () => {
  const raw = `${recoveredPrefix}\n${JSON.stringify(result)}\n${recoveredSuffix}`;
  const record = deliveredCardRecord(raw)!;
  const { QuestionHistoryCard } =
    await import("../../../src/app/question/QuestionHistory.tsx");
  const message = render(
    <div data-timeline-row-list="normal">
      <div data-timeline-row-id="thread:form:one">
        <QuestionHistoryCard record={record} />
      </div>
      <div data-timeline-row-id="thread:delivery">
        <p>{raw}</p>
      </div>
    </div>,
  );
  const overlay = renderSlot(
    app.appOverlays.find((p) => p.id === "delivered-questions")!,
    {},
  );
  await waitFor(() =>
    expect(
      message.container.querySelector(".ws-delivered-question-duplicate"),
    ).toBeTruthy(),
  );
  expect(
    message.container.querySelectorAll("[data-ws-question-history]"),
  ).toHaveLength(1);
  message.rerender(
    <div data-timeline-row-list="normal">
      <div data-timeline-row-id="thread:delivery">
        <p>{raw}</p>
      </div>
    </div>,
  );
  await waitFor(() =>
    expect(
      message.container.querySelectorAll("[data-ws-question-history]"),
    ).toHaveLength(1),
  );
  expect(
    message.container.querySelector(".ws-delivered-question-duplicate"),
  ).toBeNull();
  message.rerender(
    <div data-timeline-row-list="normal">
      <div data-timeline-row-id="thread:delivery">
        <p>Ordinary message</p>
      </div>
    </div>,
  );
  await waitFor(() =>
    expect(
      message.container.querySelector("[data-ws-question-history]"),
    ).toBeNull(),
  );
  expect(
    message.container.querySelector(".ws-delivered-question-row"),
  ).toBeNull();
  overlay.lifecycle.unmount();
});

it("loads the exact retained event instead of reconstructing Markdown-altered or clipped JSON", async () => {
  const { vi } = await import("vitest");
  const read = vi.fn(
    async () =>
      [
        {
          type: "client/turn/requested",
          seq: 42,
          data: {
            input: [
              {
                type: "text",
                text: `${recoveredPrefix}\n${JSON.stringify({ ...result, questions: result.questions.map((q) => ({ ...q, details: "Keep **literal** Markdown and <tags>." })) })}\n${recoveredSuffix}`,
              },
            ],
          },
        },
      ] as unknown as Awaited<
        ReturnType<PluginBrowserBbSdk["threads"]["events"]["list"]>
      >,
  );
  const message = render(
    <div data-timeline-row-id="thread:user-seed:42">
      <div>{recoveredPrefix}...</div>
    </div>,
  );
  const overlay = renderSlot(
    app.appOverlays.find((p) => p.id === "delivered-questions")!,
    {},
    { sdk: { threads: { events: { list: read } } } },
  );
  await waitFor(() =>
    expect(
      message.getByText("Keep **literal** Markdown and <tags>."),
    ).toBeTruthy(),
  );
  expect(read).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledWith(
    expect.objectContaining({
      threadId: "thread",
      afterSeq: "41",
      beforeSeq: "43",
      limit: "1",
    }),
  );
  expect(
    message.queryByText("Expand to view the question and answer"),
  ).toBeNull();
  overlay.lifecycle.unmount();
});

it("replaces only the delivery row inside a turn and leaves unrelated content visible", async () => {
  const message = render(
    <div data-timeline-row-id="thread:turn">
      <p>Work before the answer</p>
      <div data-timeline-row-list="nested">
        <div data-timeline-row-id="thread:delivery">
          <p>{`${prefix}\n${JSON.stringify(result)}`}</p>
        </div>
      </div>
    </div>,
  );
  const overlay = renderSlot(
    app.appOverlays.find((p) => p.id === "delivered-questions")!,
    {},
  );
  await waitFor(() =>
    expect(
      message.container.querySelector("[data-ws-question-history]"),
    ).toBeTruthy(),
  );
  expect(
    message.container
      .querySelector("[data-timeline-row-id='thread:turn']")
      ?.classList.contains("ws-delivered-question-row"),
  ).toBe(false);
  expect(
    message.container.querySelectorAll(".ws-delivered-question-row"),
  ).toHaveLength(1);
  overlay.lifecycle.unmount();
});
