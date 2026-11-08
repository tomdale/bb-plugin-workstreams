// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { usePendingQuestion } from "../../../src/app/question/pending.ts";
import { payload } from "./submission-fixture.ts";

afterEach(cleanup);

it("ignores a late pending-question read after switching threads", async () => {
  let threadId = "first";
  let resolveFirst!: (value: unknown) => void;
  const first = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  function CurrentQuestion() {
    const pending = usePendingQuestion(threadId);
    return <p>{pending?.id ?? "No question"}</p>;
  }
  const slot = renderSlot(
    { component: CurrentQuestion },
    {},
    {
      rpc: {
        question_pending: (input) =>
          (input as { threadId: string }).threadId === "first"
            ? first
            : { id: "second-question", recoverable: false, payload },
      },
    },
  );
  threadId = "second";
  slot.rerender(<CurrentQuestion />);
  await waitFor(() => expect(slot.getByText("second-question")).toBeTruthy());
  await act(async () => {
    resolveFirst({ id: "first-question", recoverable: false, payload });
  });
  expect(slot.getByText("second-question")).toBeTruthy();
  slot.lifecycle.unmount();
});
