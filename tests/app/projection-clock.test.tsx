// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  useWorkstreams,
  type ServerState,
} from "../../src/app/useWorkstreams.ts";
import { projectWorkstreams, DAY_MS } from "../../src/domain/project.ts";
import { agedKind } from "../../src/domain/upNext.ts";
import { DEFAULT_SNOOZE_PREFS } from "../../src/domain/snooze.ts";
import { section, sidebarThread } from "./fixtures.ts";

const harness = vi.hoisted(() => ({
  sidebar: {
    current: {
      status: "ready",
      threads: [] as unknown[],
      sections: [] as unknown[],
      projects: [],
    },
  },
}));

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  const { useMemo } = await import("react");
  return {
    ...sdk,
    useRpc: () => {
      const rpc = sdk.useRpc();
      return useMemo(() => ({ call: rpc.call }), [rpc]);
    },
    experimental_useSidebarThreads: () => harness.sidebar.current,
  };
});

vi.mock("../../src/domain/project.ts", async (importOriginal) => {
  const domain =
    await importOriginal<typeof import("../../src/domain/project.ts")>();
  return {
    ...domain,
    projectWorkstreams: vi.fn(domain.projectWorkstreams),
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(projectWorkstreams).mockClear();
});

function state(): ServerState {
  return {
    analysis: {},
    recaps: {},
    dismissedRecaps: [],
    order: { workstreams: [], threads: {}, prioritized: [] },
    snoozes: {},
    snoozePrefs: DEFAULT_SNOOZE_PREFS,
    catalog: { entities: [], groups: {}, assignments: {}, revision: 1 },
    pendingSuggestions: 0,
  };
}

function rpc(overrides: Record<string, unknown> = {}) {
  return {
    state: vi.fn(async () => state()),
    prefs: vi.fn(async () => ({ prefs: {} })),
    ...overrides,
  };
}

it("keeps the projection and Up Next options through a minute with no deadline", async () => {
  vi.useFakeTimers();
  const at = 100 * DAY_MS;
  vi.setSystemTime(at);
  harness.sidebar.current = {
    status: "ready",
    threads: [sidebarThread("t1")],
    sections: [],
    projects: [],
  };
  let latest!: ReturnType<typeof useWorkstreams>;
  function Suite() {
    latest = useWorkstreams();
    return <output data-testid="now">{latest.now}</output>;
  }
  const slot = renderSlot({ component: Suite }, {}, { rpc: rpc() });
  await act(async () => {});
  const projection = latest.projection;
  const upNextOptions = latest.upNextOptions;
  const calls = vi.mocked(projectWorkstreams).mock.calls.length;

  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(within(slot.container).getByTestId("now").textContent).toBe(
    String(at),
  );
  expect(latest.now).toBe(at);
  expect(latest.projection).toBe(projection);
  expect(latest.upNextOptions).toBe(upNextOptions);
  expect(vi.mocked(projectWorkstreams).mock.calls.length).toBe(calls);
  slot.lifecycle.unmount();
});

it("rebuilds at the dormancy and Up Next staleness boundaries", async () => {
  vi.useFakeTimers();
  const at = 100 * DAY_MS;
  vi.setSystemTime(at);
  const quietAt = at - 30 * DAY_MS;
  const staleAt = at - 7 * DAY_MS;
  const quiet = sidebarThread("quiet", {
    sectionId: "sec_quiet",
    latestAttentionAt: quietAt,
  });
  const stale = sidebarThread("stale", { latestAttentionAt: staleAt });
  const stored = state();
  stored.analysis.stale = {
    recap: "Review the result.",
    state: "review",
    needsYou: null,
    goal: null,
    revision: staleAt,
    at,
    model: "m",
  };
  harness.sidebar.current = {
    status: "ready",
    threads: [quiet, stale],
    sections: [section("sec_quiet", "Quiet")],
    projects: [],
  };
  let latest!: ReturnType<typeof useWorkstreams>;
  function Suite() {
    latest = useWorkstreams();
    return <output>{latest.now}</output>;
  }
  const slot = renderSlot(
    { component: Suite },
    {},
    { rpc: rpc({ state: vi.fn(async () => stored) }) },
  );
  await act(async () => {});
  expect(
    latest.projection.groups.some((group) => group.id === "sec_quiet"),
  ).toBe(true);
  expect(agedKind(stale, latest.upNextOptions.kindOf(stale), latest.now)).toBe(
    "review",
  );

  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(latest.now).toBe(at + 1);
  expect(latest.projection.dormant.map((group) => group.id)).toContain(
    "sec_quiet",
  );
  expect(agedKind(stale, latest.upNextOptions.kindOf(stale), latest.now)).toBe(
    "other",
  );
  slot.lifecycle.unmount();
});
