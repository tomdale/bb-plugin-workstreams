// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  parseThreshold,
  UsageSettings,
} from "../../src/app/settings/UsageSettings.tsx";
import { mergePrefs, parsePrefs } from "../../src/domain/prefs.ts";
import {
  evaluateLimits,
  limitsOf,
  type SpendState,
  type UsageTotalsByWindow,
} from "../../src/domain/usage.ts";

afterEach(cleanup);

const NOW = new Date(2026, 6, 16, 15, 42).getTime();
const totals = (
  patch: Partial<UsageTotalsByWindow> = {},
): UsageTotalsByWindow => ({
  hour: { cost: 0.5, calls: 20, unmetered: 0 },
  day: { cost: 4, calls: 200, unmetered: 0 },
  month: { cost: 40, calls: 2000, unmetered: 0 },
  ...patch,
});
const stateFor = (patch: Partial<UsageTotalsByWindow> = {}): SpendState =>
  evaluateLimits(limitsOf(parsePrefs({}).usage), totals(patch), NOW);
const PAUSED = stateFor({ day: { cost: 31, calls: 900, unmetered: 0 } });

async function mount(
  options: {
    stored?: unknown;
    state?: SpendState;
    /** Holds the preferences back, as a slow first load does. */
    prefs?: () => Promise<{ prefs: unknown }>;
  } = {},
) {
  let prefs = parsePrefs(options.stored ?? {});
  let state = options.state ?? stateFor();
  const slot = await renderSlot(
    { component: UsageSettings },
    {},
    {
      rpc: {
        prefs: options.prefs ?? (() => ({ prefs })),
        setPrefs: (input: unknown) => {
          prefs = mergePrefs(
            prefs,
            (input as { patch: Parameters<typeof mergePrefs>[1] }).patch,
          );
          return { prefs };
        },
        usage: () => ({ state }),
        usageResume: () => {
          state = stateFor();
          return { state };
        },
      },
    },
  );
  const saves = () =>
    slot.inspection.rpcCalls
      .filter((call) => call.method === "setPrefs")
      .map((call) => (call.input as { patch: unknown }).patch);
  const field = (name: string) =>
    slot.getByRole("textbox", { name }) as HTMLInputElement;
  const commit = (name: string, text: string) => {
    fireEvent.change(field(name), { target: { value: text } });
    fireEvent.blur(field(name));
  };
  return { slot, saves, field, commit };
}

it("renders the stored thresholds, blank for off, and the flags switch", async () => {
  const { slot, field } = await mount({
    stored: { usage: { daySpendCap: 42.5, hourCallsWarn: null } },
  });
  await slot.findByRole("textbox", { name: "Last hour: warn at" });
  expect(
    [
      "Last hour: warn at",
      "Last hour: pause at",
      "Today: warn at",
      "Today: pause at",
      "This month: warn at",
      "This month: pause at",
      "Requests per hour: warn at",
      "Requests per hour: pause at",
    ].map((name) => field(name).value),
  ).toEqual(["3", "10", "10", "42.5", "", "", "", "500"]);
  expect(
    slot
      .getByRole("switch", { name: "Flag unusual usage" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(slot.queryByRole("status")).toBeNull();
  expect(slot.queryByRole("button", { name: "Resume" })).toBeNull();
});

it("replaces a bad stored threshold with its default and keeps the others", async () => {
  const { slot, field } = await mount({
    stored: {
      usage: { hourSpendCap: -4, daySpendCap: "lots", daySpendWarn: 7 },
    },
  });
  await slot.findByRole("textbox", { name: "Today: warn at" });
  expect(field("Last hour: pause at").value).toBe("10");
  expect(field("Today: pause at").value).toBe("30");
  expect(field("Today: warn at").value).toBe("7");
});

it("saves a threshold on blur and on Enter, and a blank field as null", async () => {
  const { slot, saves, field, commit } = await mount();
  await slot.findByRole("textbox", { name: "Today: pause at" });
  commit("Today: pause at", "$45.50");
  await waitFor(() => expect(saves()).toHaveLength(1));
  fireEvent.change(field("Requests per hour: warn at"), {
    target: { value: "" },
  });
  fireEvent.keyDown(field("Requests per hour: warn at"), { key: "Enter" });
  await waitFor(() => expect(saves()).toHaveLength(2));
  expect(saves()).toEqual([
    { usage: { daySpendCap: 45.5 } },
    { usage: { hourCallsWarn: null } },
  ]);
  // An unchanged field saves nothing.
  fireEvent.blur(field("Last hour: warn at"));
  fireEvent.click(slot.getByRole("switch", { name: "Flag unusual usage" }));
  await waitFor(() => expect(saves()).toHaveLength(3));
  expect(saves()[2]).toEqual({ usage: { detectors: false } });
});

it("rejects a pause threshold below its warning and saves neither", async () => {
  const { slot, saves, field, commit } = await mount();
  await slot.findByRole("textbox", { name: "Today: pause at" });
  commit("Today: pause at", "9.99");
  expect(slot.getByRole("alert").textContent).toBe(
    "Pause at can't be below Warn at.",
  );
  expect(field("Today: pause at").getAttribute("aria-invalid")).toBe("true");
  commit("Today: warn at", "40");
  expect(slot.getByRole("alert").textContent).toBe(
    "Warn at can't be above Pause at.",
  );
  expect(saves()).toEqual([]);
  // Equal thresholds are allowed, and both typed values save together.
  commit("Today: pause at", "40");
  await waitFor(() => expect(saves()).toHaveLength(1));
  expect(saves()[0]).toEqual({ usage: { daySpendWarn: 40, daySpendCap: 40 } });
  expect(slot.queryByRole("alert")).toBeNull();
});

it("rejects amounts that are not thresholds", async () => {
  const { slot, saves, commit } = await mount();
  await slot.findByRole("textbox", { name: "Today: pause at" });
  commit("Last hour: warn at", "0");
  expect(slot.getByRole("alert").textContent).toBe("Enter a number above 0.");
  commit("Requests per hour: pause at", "500.5");
  expect(
    slot.getAllByRole("alert").map((alert) => alert.textContent),
  ).toContain("Enter a whole number above 0.");
  expect(saves()).toEqual([]);
  expect(parseThreshold("-3", "spend")).toEqual({
    error: "Enter a number above 0.",
  });
  expect(parseThreshold("abc", "calls")).toEqual({
    error: "Enter a whole number above 0.",
  });
  expect(parseThreshold("1000001", "spend")).toEqual({
    error: "Enter 1,000,000 or less.",
  });
  expect(parseThreshold("1,000,000", "calls")).toEqual({ value: 1_000_000 });
  expect(parseThreshold("  ", "spend")).toEqual({ value: null });
  expect(parseThreshold("0.5", "spend")).toEqual({ value: 0.5 });
});

it("writes nothing and shows no fields before the preferences load", async () => {
  const { slot, saves } = await mount({ prefs: () => new Promise(() => {}) });
  expect(slot.getByText("Loading settings…")).toBeTruthy();
  expect(slot.queryAllByRole("textbox")).toEqual([]);
  expect(slot.queryByRole("switch")).toBeNull();
  expect(saves()).toEqual([]);
});

it("shows what is paused with Resume, which resumes", async () => {
  const { slot } = await mount({ state: PAUSED });
  const status = await slot.findByRole("status");
  expect(status.textContent).toContain("Model calls are paused");
  expect(status.textContent).toContain(
    "Today's spend reached the $30.00 limit. Calls resume at midnight.",
  );
  fireEvent.click(slot.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(slot.queryByRole("status")).toBeNull());
  expect(
    slot.inspection.rpcCalls.filter((call) => call.method === "usageResume"),
  ).toHaveLength(1);
});

it("names a reached warning in one line, without Resume", async () => {
  const { slot } = await mount({
    state: stateFor({ day: { cost: 12, calls: 300, unmetered: 0 } }),
  });
  const status = await slot.findByRole("status");
  expect(status.textContent).toBe(
    "Today's spend reached the $10.00 warning. Calls pause at $30.00.",
  );
  expect(slot.queryByRole("button", { name: "Resume" })).toBeNull();
});

it("opens the Usage page", async () => {
  const { slot } = await mount();
  fireEvent.click(await slot.findByRole("button", { name: "Open Usage" }));
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "toPluginPanel",
    path: "home",
    options: { subPath: "usage" },
  });
});
