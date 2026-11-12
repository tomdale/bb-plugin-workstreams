// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { STREAM_DECK_CHANNEL } from "../../src/domain/streamDeck.ts";

const opened = vi.hoisted(() => [] as (string | null)[]);
const route = vi.hoisted(() => ({ threadId: "thr_open" as string | null }));
vi.mock("../../src/app/upNext/NextUpCommand.tsx", () => ({
  openNextUpThread: (threadId: string | null) => opened.push(threadId),
}));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@get-bb/plugin-sdk/app")>()),
  useBbContext: () => ({ projectId: null, threadId: route.threadId }),
}));

const { StreamDeckBridge } =
  await import("../../src/app/upNext/StreamDeckBridge.tsx");

afterEach(() => {
  cleanup();
  opened.length = 0;
  route.threadId = "thr_open";
});

function mount() {
  const viewing: unknown[] = [];
  const slot = renderSlot(
    { component: StreamDeckBridge },
    {},
    {
      rpc: {
        streamDeckViewing: async (input: unknown) => {
          viewing.push(input);
          return { ok: true as const };
        },
      },
    },
  );
  return { slot, viewing };
}

const stamp = (epoch: string) => ({
  epoch,
  revisions: {
    analysis: 1,
    recaps: 1,
    order: 1,
    snoozes: 1,
    catalog: 1,
    suggestions: 1,
  },
});

it("opens the Up Next thread after the open one when the Next key is pressed", async () => {
  const { slot } = mount();
  await slot.behavior.emitRealtime(STREAM_DECK_CHANNEL, {
    command: "next-up-thread",
  });
  expect(opened).toEqual(["thr_open"]);

  await slot.behavior.emitRealtime(STREAM_DECK_CHANNEL, { command: "other" });
  await slot.behavior.emitRealtime("changed", { command: "next-up-thread" });
  expect(opened).toEqual(["thr_open"]);
});

it("reports the open thread as it changes, when the app comes forward, and after Workstreams restarts", async () => {
  const { slot, viewing } = mount();
  await waitFor(() => expect(viewing).toEqual([{ threadId: "thr_open" }]));

  route.threadId = null;
  slot.lifecycle.rerender(<StreamDeckBridge />);
  await waitFor(() => expect(viewing).toHaveLength(2));
  expect(viewing[1]).toEqual({ threadId: null });

  route.threadId = "thr_other";
  slot.lifecycle.rerender(<StreamDeckBridge />);
  await waitFor(() => expect(viewing).toHaveLength(3));
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(viewing).toHaveLength(4));
  expect(viewing[3]).toEqual({ threadId: "thr_other" });

  // The first stamp is the running server's; a new epoch is a restart.
  await slot.behavior.emitRealtime("changed", stamp("one"));
  await slot.behavior.emitRealtime("changed", stamp("one"));
  expect(viewing).toHaveLength(4);
  await slot.behavior.emitRealtime("changed", stamp("two"));
  await waitFor(() => expect(viewing).toHaveLength(5));
  expect(viewing[4]).toEqual({ threadId: "thr_other" });
});
