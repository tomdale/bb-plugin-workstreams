// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ClientReport } from "../../src/app/reply/ClientReport.tsx";
import { registerReplyBlock } from "../../src/app/reply/register.ts";

afterEach(cleanup);

const reports = (slot: ReturnType<typeof renderSlot>) =>
  slot.inspection.rpcCalls
    .filter((call) => call.method === "reportClient")
    .map((call) => call.input);

it.each([
  ["upstream bb, without the slot", {}, false],
  [
    "the tomdale/bb fork, with the slot",
    { experimental_messageBlock: () => {} },
    true,
  ],
])("reports what %s draws", async (_, slots, messageBlocks) => {
  registerReplyBlock({ slots } as unknown as PluginAppBuilder);
  const slot = renderSlot(
    { component: ClientReport },
    {},
    { rpc: { reportClient: () => ({ ok: true }) } },
  );
  await waitFor(() => expect(reports(slot)).toEqual([{ messageBlocks }]));
});

it("reports again when the realtime link comes back", async () => {
  registerReplyBlock({
    slots: { experimental_messageBlock: () => {} },
  } as unknown as PluginAppBuilder);
  const slot = renderSlot(
    { component: ClientReport },
    {},
    { rpc: { reportClient: () => ({ ok: true }) } },
  );
  await waitFor(() => expect(reports(slot)).toHaveLength(1));
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  await slot.behavior.setRealtimeConnectionState("connected");
  await waitFor(() => expect(reports(slot)).toHaveLength(2));
});
