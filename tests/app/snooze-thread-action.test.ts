import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  parseSnoozePrefs,
  presetWhen,
  type SnoozePrefs,
} from "../../src/domain/snooze.ts";
import {
  registerSnoozeThreadAction,
  snoozeThreadAction,
  WAKE_NOW_CHOICE,
  type SnoozeActionData,
} from "../../src/app/snooze/threadAction.ts";

const NOW = new Date(2026, 10, 13, 17, 32).getTime();

const prefs: SnoozePrefs = parseSnoozePrefs({
  presets: [
    {
      id: "20m",
      label: "",
      rule: { kind: "duration", amount: 20, unit: "minutes" },
    },
    {
      id: "3h",
      label: "",
      rule: { kind: "duration", amount: 3, unit: "hours" },
    },
    {
      id: "tomorrow",
      label: "Tomorrow morning",
      rule: { kind: "time", day: "tomorrow", hour: 9, minute: 0 },
    },
  ],
  default: "3h",
});

const thread = { id: "thr_a", latestAttentionAt: 5 } as PluginSidebarThread;

function data(overrides: Partial<SnoozeActionData> = {}): SnoozeActionData {
  return {
    prefs,
    snoozes: {},
    setSnoozes: vi.fn(async () => undefined),
    listed: new Map([[thread.id, thread]]),
    ...overrides,
  };
}

beforeEach(() => {
  toast.mockClear();
  toast.error.mockClear();
  vi.useRealTimers();
});

describe("Snooze thread action", () => {
  it("lists the presets in order and names the default", () => {
    const action = snoozeThreadAction(thread.id, data(), NOW);
    expect(action?.label).toBe("Snooze");
    expect(action?.detail).toBe("3 hours");
    expect(action?.choices.items).toEqual([
      { id: "20m", label: "20 minutes" },
      { id: "3h", label: "3 hours" },
      { id: "tomorrow", label: "Tomorrow morning" },
    ]);
    expect(action?.choices.hint).toBeUndefined();
  });

  it("snoozes with the chosen preset, or the default without a choice", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const setSnoozes = vi.fn(async () => undefined);
    const action = snoozeThreadAction(thread.id, data({ setSnoozes }), NOW)!;
    action.run({ value: "tomorrow" });
    action.run({});
    expect(setSnoozes.mock.calls).toEqual([
      [[thread], presetWhen(prefs.presets[2]!, NOW)],
      [[thread], presetWhen(prefs.presets[1]!, NOW)],
    ]);
  });

  it("offers Wake now first for a snoozed thread and wakes it", () => {
    const setSnoozes = vi.fn(async () => undefined);
    const snoozes = {
      [thread.id]: {
        until: NOW + 60 * 60 * 1000,
        attentionAt: 5,
        at: NOW - 1000,
      },
    };
    const action = snoozeThreadAction(
      thread.id,
      data({ snoozes, setSnoozes }),
      NOW,
    )!;
    expect(action.detail).toBeUndefined();
    expect(action.choices.hint).toMatch(/^Snoozed until /);
    expect(action.choices.items[0]).toEqual({
      id: WAKE_NOW_CHOICE,
      label: "Wake now",
    });
    action.run({ value: WAKE_NOW_CHOICE });
    expect(setSnoozes).toHaveBeenCalledWith([thread], "wake");
  });

  it("does nothing but explain when a chosen preset was removed", () => {
    const setSnoozes = vi.fn(async () => undefined);
    snoozeThreadAction(thread.id, data({ setSnoozes }), NOW)!.run({
      value: "gone",
    });
    expect(setSnoozes).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("hides itself for a thread the sidebar doesn't list", () => {
    expect(snoozeThreadAction("thr_hidden", data(), NOW)).toBeNull();
  });

  it("registers only where BB takes plugin thread actions", () => {
    const experimental_threadAction = vi.fn();
    registerSnoozeThreadAction({ slots: { experimental_threadAction } });
    expect(experimental_threadAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "snooze", title: "Snooze", icon: "Clock" }),
    );
    expect(() => registerSnoozeThreadAction({ slots: {} })).not.toThrow();
  });
});
