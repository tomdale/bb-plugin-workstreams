// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  DebugCommandBridge,
  toggleDebugUi,
} from "../../src/app/debug/DebugCommand.tsx";
import {
  mergePrefs,
  parsePrefs,
  type PrefsPatch,
} from "../../src/domain/prefs.ts";

afterEach(cleanup);

it("flips the debug UI preference through the prefs RPC", async () => {
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
  toggleDebugUi();
  await waitFor(() => expect(prefs.advanced.debugUi).toBe(true));
  toggleDebugUi();
  await waitFor(() => expect(prefs.advanced.debugUi).toBe(false));
  expect(
    slot.inspection.rpcCalls
      .filter((call) => call.method === "setPrefs")
      .map((call) => call.input),
  ).toEqual([
    { patch: { advanced: { debugUi: true } } },
    { patch: { advanced: { debugUi: false } } },
  ]);
});

it("leaves recording alone when the UI is toggled", async () => {
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
  expect(prefs.advanced.debugRecord).toBe(true);
  toggleDebugUi();
  await waitFor(() => expect(prefs.advanced.debugUi).toBe(true));
  toggleDebugUi();
  await waitFor(() => expect(prefs.advanced.debugUi).toBe(false));
  // Recording never rides along with showing and hiding the debug UI.
  expect(prefs.advanced.debugRecord).toBe(true);
  expect(
    slot.inspection.rpcCalls
      .filter((call) => call.method === "setPrefs")
      .map((call) => call.input),
  ).toEqual([
    { patch: { advanced: { debugUi: true } } },
    { patch: { advanced: { debugUi: false } } },
  ]);
});

it("is a no-op before the bridge mounts", () => {
  expect(() => toggleDebugUi()).not.toThrow();
});
