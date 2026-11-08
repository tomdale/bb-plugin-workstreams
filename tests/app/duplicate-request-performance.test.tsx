// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePendingQuestion } from "../../src/app/question/pending.ts";
import { useRecapPrefs } from "../../src/app/recap/prefs.ts";
import { payload } from "./question/submission-fixture.ts";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  const { useMemo } = await import("react");
  return {
    ...sdk,
    useRpc: () => {
      const rpc = sdk.useRpc();
      return useMemo(() => ({ call: rpc.call }), [rpc]);
    },
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("measures duplicate requests and timers for 16 consumers", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let activeTimers = 0;
  const nativeSetInterval = globalThis.setInterval;
  const nativeClearInterval = globalThis.clearInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    activeTimers += 1;
    return nativeSetInterval(handler, timeout, ...args);
  }) as typeof setInterval);
  vi.spyOn(globalThis, "clearInterval").mockImplementation(((
    id?: ReturnType<typeof setInterval>,
  ) => {
    if (id !== undefined) activeTimers -= 1;
    return nativeClearInterval(id);
  }) as typeof clearInterval);

  const questionPending = vi.fn(async (input: unknown) => {
    const { threadId } = input as { threadId: string };
    return {
      id: `question-${threadId}`,
      recoverable: false,
      payload,
    };
  });
  const recapPrefs = vi.fn(async () => ({ prefs: { layout: "full" } }));
  const renders = Array.from({ length: 16 }, () => 0);
  function Consumer({ id }: { id: number }) {
    renders[id]! += 1;
    const pending = usePendingQuestion("thr_shared");
    const { prefs } = useRecapPrefs();
    return (
      <output data-testid={`consumer-${id}`}>
        {pending?.id ?? "loading"}:{prefs?.layout ?? "loading"}
      </output>
    );
  }
  function Suite() {
    return Array.from({ length: 16 }, (_, id) => <Consumer key={id} id={id} />);
  }
  const slot = renderSlot(
    { component: Suite },
    {},
    { rpc: { question_pending: questionPending, recapPrefs } },
  );
  await waitFor(() =>
    expect(slot.getByTestId("consumer-15").textContent).toBe(
      "question-thr_shared:full",
    ),
  );
  const initial = {
    questionRpc: questionPending.mock.calls.length,
    prefsRpc: recapPrefs.mock.calls.length,
    activeTimers,
  };
  renders.fill(0);
  await slot.behavior.emitRealtime("changed", {});
  await act(async () => {});
  const afterChanged = questionPending.mock.calls.length;
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  const afterPoll = questionPending.mock.calls.length;
  const unchangedQuestionRenders = renders.reduce(
    (total, count) => total + count,
    0,
  );
  await slot.behavior.emitRealtime("recapPrefs", {
    prefs: { layout: "minimal" },
  });
  await waitFor(() =>
    expect(slot.getByTestId("consumer-15").textContent).toBe(
      "question-thr_shared:minimal",
    ),
  );
  const measured = {
    ...initial,
    changedQuestionRpc: afterChanged - initial.questionRpc,
    pollQuestionRpc: afterPoll - afterChanged,
    unchangedQuestionRenders,
    finalActiveTimers: activeTimers,
  };
  console.log(`PERF duplicate-requests-16 ${JSON.stringify(measured)}`);
  expect(measured).toEqual({
    questionRpc: 1,
    prefsRpc: 1,
    activeTimers: 1,
    changedQuestionRpc: 1,
    pollQuestionRpc: 1,
    unchangedQuestionRenders: 0,
    finalActiveTimers: 1,
  });
  slot.lifecycle.unmount();
  expect(activeTimers).toBe(0);
});
