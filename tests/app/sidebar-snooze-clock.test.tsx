// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as presentation from "../../src/app/sidebar/presentation.ts";
import { describeWake, presetWhen } from "../../src/domain/snooze.ts";
import { section, sidebarThread } from "./fixtures.ts";
import {
  mount,
  snoozeSettings,
  thirtyMinutes,
  untilUpdate,
} from "./sidebar-fixture.tsx";

const START = new Date(2026, 0, 1, 10, 0, 0).getTime();
const MINUTE = 60_000;

beforeEach(() => {
  window.localStorage.clear();
  // The shared clock ticks on an interval, and reads the day from Date, so
  // both are faked; everything else stays real for the harness.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** What the default snooze button names at `now`. */
function defaultName(now: number, action = "Snooze") {
  const when = presetWhen(thirtyMinutes, now);
  return `${action} ${describeWake(when.until, now, when.events)}`;
}

/** One thread in Alpha, whose age reads the same a minute later. */
async function mountAlpha() {
  const slot = await mount(
    [
      sidebarThread("ask", {
        sectionId: "sec_a",
        title: "Asking task",
        latestAttentionAt: START - 5 * 3_600_000,
      }),
    ],
    {
      settings: { showForYou: false, showRecent: false },
      sections: [section("sec_a", "Alpha")],
      snoozePrefs: snoozeSettings(thirtyMinutes, untilUpdate),
    },
  );
  const alpha = await waitFor(() =>
    slot.getByRole("region", { name: "Alpha" }),
  );
  return { slot, alpha };
}

it("moves a thread row's default snooze label as the clock does", async () => {
  const { slot, alpha } = await mountAlpha();
  const button = within(alpha).getByRole("button", {
    name: /^Snooze until/,
  });
  expect(button.getAttribute("aria-label")).toBe(defaultName(START));

  const rowRenders = vi.spyOn(presentation, "presentRow");
  act(() => vi.advanceTimersByTime(MINUTE));

  expect(button.getAttribute("aria-label")).toBe(defaultName(START + MINUTE));
  // Only the button read the clock, so the row around it did not render.
  expect(rowRenders).not.toHaveBeenCalled();
  slot.lifecycle.unmount();
});

it("snoozes until the default named when the button is pressed", async () => {
  const { slot, alpha } = await mountAlpha();
  const button = within(alpha).getByRole("button", {
    name: /^Snooze until/,
  });
  act(() => vi.advanceTimersByTime(MINUTE));
  expect(button.getAttribute("aria-label")).toBe(defaultName(START + MINUTE));

  fireEvent.click(button);
  await waitFor(() =>
    expect(slot.inspection.rpcCalls.some((c) => c.method === "snooze")).toBe(
      true,
    ),
  );
  const { until } = slot.inspection.rpcCalls.find((c) => c.method === "snooze")!
    .input as { until: number };
  expect(until).toBe(START + MINUTE + 30 * MINUTE);
  slot.lifecycle.unmount();
});

it("moves a workstream header's default snooze label as the clock does", async () => {
  const { slot, alpha } = await mountAlpha();
  const button = within(alpha).getByRole("button", {
    name: /^Snooze 1 thread in Alpha until/,
  });
  expect(button.getAttribute("aria-label")).toBe(
    defaultName(START, "Snooze 1 thread in Alpha"),
  );

  const headerRenders = vi.spyOn(presentation, "headerCounts");
  act(() => vi.advanceTimersByTime(MINUTE));

  expect(button.getAttribute("aria-label")).toBe(
    defaultName(START + MINUTE, "Snooze 1 thread in Alpha"),
  );
  // Only the button read the clock, so the header around it did not render.
  expect(headerRenders).not.toHaveBeenCalled();
  slot.lifecycle.unmount();
});
