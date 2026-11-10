// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePendingQuestion } from "../../../src/app/question/pending.ts";
import { payload } from "./submission-fixture.ts";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function question(id: string) {
  return { id, recoverable: false, payload };
}

/** Intervals at the old poll's period; fake timers keep their own. */
const polls = (interval: { mock: { calls: unknown[][] } }) =>
  interval.mock.calls.filter(([, delay]) => delay === 2000).length;

async function flushRead() {
  await act(async () => {});
}

it("does not read or poll for a thread and ignores an old thread's late read", async () => {
  const first = deferred<ReturnType<typeof question>>();
  const read = vi.fn((input: unknown) => {
    const { threadId } = input as { threadId: string };
    return threadId === "first" ? first.promise : question("second-question");
  });
  const interval = vi.spyOn(globalThis, "setInterval");
  let threadId: string | null = null;
  function Current() {
    const pending = usePendingQuestion(threadId);
    return <p>{pending?.id ?? "No question"}</p>;
  }
  const slot = renderSlot(
    { component: Current },
    {},
    { rpc: { question_pending: read } },
  );
  expect(read).not.toHaveBeenCalled();
  expect(polls(interval)).toBe(0);

  threadId = "first";
  slot.rerender(<Current />);
  await flushRead();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(polls(interval)).toBe(0);

  threadId = "second";
  slot.rerender(<Current />);
  await flushRead();
  await waitFor(() => expect(slot.getByText("second-question")).toBeTruthy());
  await act(async () => {
    first.resolve(question("first-question"));
    await first.promise;
  });
  expect(slot.getByText("second-question")).toBeTruthy();
  slot.lifecycle.unmount();
});

it("stops reading after the last unmount and reads again on remount", async () => {
  const read = vi.fn(async () => null);
  let mounted = true;
  function Current() {
    usePendingQuestion("thread");
    return <div />;
  }
  function Host() {
    return mounted ? <Current /> : null;
  }
  const slot = renderSlot(
    { component: Host },
    {},
    { rpc: { question_pending: read } },
  );
  await flushRead();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));

  mounted = false;
  slot.rerender(<Host />);
  await act(async () => {
    vi.advanceTimersByTime(6000);
  });
  expect(read).toHaveBeenCalledTimes(1);

  mounted = true;
  slot.rerender(<Host />);
  await flushRead();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  slot.lifecycle.unmount();
});

it("keeps one in-flight read and publishes only the latest revalidation", async () => {
  const first = deferred<ReturnType<typeof question>>();
  const latest = deferred<ReturnType<typeof question>>();
  const read = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => latest.promise);
  function Current() {
    const pending = usePendingQuestion("thread");
    return <p>{pending?.id ?? "No question"}</p>;
  }
  const slot = renderSlot(
    { component: Current },
    {},
    { rpc: { question_pending: read } },
  );
  await flushRead();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await slot.behavior.emitRealtime("question:thread", {});
  await slot.behavior.emitRealtime("question:thread", {});
  expect(read).toHaveBeenCalledTimes(1);

  await act(async () => {
    first.resolve(question("stale"));
    await first.promise;
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(slot.getByText("No question")).toBeTruthy();
  await act(async () => {
    latest.resolve(question("latest"));
    await latest.promise;
  });
  await waitFor(() => expect(slot.getByText("latest")).toBeTruthy());
  expect(read).toHaveBeenCalledTimes(2);
  slot.lifecycle.unmount();
});

it("reads its thread's question signals, not others, and revalidates after reconnecting", async () => {
  let value: ReturnType<typeof question> | null = question("waiting");
  const read = vi.fn(async () => value);
  function Current() {
    const pending = usePendingQuestion("thread");
    return <p>{pending?.id ?? "No question"}</p>;
  }
  const slot = renderSlot(
    { component: Current },
    {},
    { rpc: { question_pending: read } },
  );
  await flushRead();
  await waitFor(() => expect(slot.getByText("waiting")).toBeTruthy());
  value = null;
  // Nothing polls: without a signal the store keeps its value.
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  await slot.behavior.emitRealtime("question:other", {});
  await slot.behavior.emitRealtime("changed", {});
  expect(read).toHaveBeenCalledTimes(1);
  // The server signals the thread when the waiter stops.
  await slot.behavior.emitRealtime("question:thread", {});
  await waitFor(() => expect(slot.getByText("No question")).toBeTruthy());
  expect(read).toHaveBeenCalledTimes(2);

  value = question("reconnected");
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  expect(read).toHaveBeenCalledTimes(2);
  await slot.behavior.setRealtimeConnectionState("connected");
  await waitFor(() => expect(slot.getByText("reconnected")).toBeTruthy());
  expect(read).toHaveBeenCalledTimes(3);
  slot.lifecycle.unmount();
});

it("shares work within each thread without combining different threads", async () => {
  const read = vi.fn(async (input: unknown) => {
    const { threadId } = input as { threadId: string };
    return question(threadId);
  });
  const interval = vi.spyOn(globalThis, "setInterval");
  function Consumer({ threadId }: { threadId: string }) {
    const pending = usePendingQuestion(threadId);
    return <output data-testid={threadId}>{pending?.id}</output>;
  }
  function Suite() {
    return (
      <>
        <Consumer threadId="first" />
        <Consumer threadId="first" />
        <Consumer threadId="second" />
      </>
    );
  }
  const slot = renderSlot(
    { component: Suite },
    {},
    { rpc: { question_pending: read } },
  );
  await flushRead();
  await waitFor(() =>
    expect(slot.getByTestId("second").textContent).toBe("second"),
  );
  expect(read).toHaveBeenCalledTimes(2);
  expect(polls(interval)).toBe(0);
  await slot.behavior.emitRealtime("question:first", {});
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(read).toHaveBeenLastCalledWith({ threadId: "first" });
  slot.lifecycle.unmount();
});

it("tries a failed read once more", async () => {
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(question("recovered"));
  function Current() {
    const pending = usePendingQuestion("thread");
    return <p>{pending?.id ?? "No question"}</p>;
  }
  const slot = renderSlot(
    { component: Current },
    {},
    { rpc: { question_pending: read } },
  );
  await flushRead();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  // Only once: the next signal reads it after that.
  await act(async () => {
    vi.advanceTimersByTime(10_000);
  });
  expect(read).toHaveBeenCalledTimes(2);
  await slot.behavior.emitRealtime("question:thread", {});
  await waitFor(() => expect(slot.getByText("recovered")).toBeTruthy());
  slot.lifecycle.unmount();
});
