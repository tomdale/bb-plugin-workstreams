// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { STREAM_DECK_CHANNEL } from "../../src/domain/streamDeck.ts";

const opened = vi.hoisted(() => [] as (string | null)[]);
vi.mock("../../src/app/upNext/NextUpCommand.tsx", () => ({
  openNextUpThread: (threadId: string | null) => opened.push(threadId),
}));

const { StreamDeckBridge } =
  await import("../../src/app/upNext/StreamDeckBridge.tsx");

afterEach(() => {
  cleanup();
  opened.length = 0;
});

it("opens the Up Next thread after the open one when the Next key is pressed", async () => {
  const slot = renderSlot(
    { component: StreamDeckBridge },
    {},
    { context: { threadId: "thr_open" } },
  );
  await slot.behavior.emitRealtime(STREAM_DECK_CHANNEL, {
    command: "next-up-thread",
  });
  expect(opened).toEqual(["thr_open"]);

  await slot.behavior.emitRealtime(STREAM_DECK_CHANNEL, { command: "other" });
  await slot.behavior.emitRealtime("changed", { command: "next-up-thread" });
  expect(opened).toEqual(["thr_open"]);
});
