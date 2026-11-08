// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  DebugCommandBridge,
  toggleDebugMode,
} from "../../src/app/debug/DebugCommand.tsx";
import {
  mergePrefs,
  parsePrefs,
  type PrefsPatch,
} from "../../src/domain/prefs.ts";

afterEach(cleanup);

it("flips the Debug mode preference through the prefs RPC", async () => {
  let prefs = parsePrefs({});
  const slot = await renderSlot(
    { component: DebugCommandBridge },
    {},
    {
      settings: {},
      rpc: {
        prefs: () => ({ prefs }),
        setPrefs: (input: unknown) => {
          prefs = mergePrefs(prefs, (input as { patch: PrefsPatch }).patch);
          return { prefs };
        },
      } as never,
    },
  );
  await waitFor(() =>
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "prefs"),
    ).toBe(true),
  );
  toggleDebugMode();
  await waitFor(() => expect(prefs.advanced.debug).toBe(true));
  toggleDebugMode();
  await waitFor(() => expect(prefs.advanced.debug).toBe(false));
  expect(
    slot.inspection.rpcCalls
      .filter((call) => call.method === "setPrefs")
      .map((call) => call.input),
  ).toEqual([
    { patch: { advanced: { debug: true } } },
    { patch: { advanced: { debug: false } } },
  ]);
});

it("is a no-op before the bridge mounts", () => {
  expect(() => toggleDebugMode()).not.toThrow();
});
