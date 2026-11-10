// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, waitFor, within } from "@testing-library/react";
import { memo, Profiler } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ServerStateRealtime } from "../../src/app/serverState.ts";
import { usePrefs } from "../../src/app/prefs.ts";
import { useSetSpinner, useSpinner } from "../../src/app/spinner.ts";
import { shareJson } from "../../src/app/structuralSharing.ts";
import { useDockedTurn } from "../../src/app/reply/useDockedTurn.ts";
import {
  useServerState,
  useWorkstreams,
  type ServerState,
} from "../../src/app/useWorkstreams.ts";
import { projectWorkstreams } from "../../src/domain/project.ts";
import { parsePrefs } from "../../src/domain/prefs.ts";
import { topicIndex } from "../../src/domain/topic-path.ts";
import { parseSpinner, type SpinnerStyle } from "../../src/domain/spinner.ts";
import { DEFAULT_SNOOZE_PREFS } from "../../src/domain/snooze.ts";
import { Row } from "../../src/app/sidebar/Row.tsx";
import {
  RowMenu,
  type RowMenuHandlers,
} from "../../src/app/sidebar/RowMenu.tsx";
import { section, sidebarThread } from "./fixtures.ts";

const harness = vi.hoisted(() => ({
  active: new Map<string, Set<object>>(),
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
  const { useEffect, useMemo } = await import("react");
  return {
    ...sdk,
    useRpc: () => {
      const rpc = sdk.useRpc();
      return useMemo(() => ({ call: rpc.call }), [rpc]);
    },
    useRealtime: (channel: string, handler: (payload: unknown) => void) => {
      sdk.useRealtime(channel, handler);
      useEffect(() => {
        let subscriptions = harness.active.get(channel);
        if (!subscriptions) {
          subscriptions = new Set();
          harness.active.set(channel, subscriptions);
        }
        const subscription = {};
        subscriptions.add(subscription);
        return () => {
          subscriptions.delete(subscription);
        };
      }, [channel]);
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

vi.mock("../../src/domain/prefs.ts", async (importOriginal) => {
  const domain =
    await importOriginal<typeof import("../../src/domain/prefs.ts")>();
  return { ...domain, parsePrefs: vi.fn(domain.parsePrefs) };
});

vi.mock("../../src/domain/spinner.ts", async (importOriginal) => {
  const domain =
    await importOriginal<typeof import("../../src/domain/spinner.ts")>();
  return { ...domain, parseSpinner: vi.fn(domain.parseSpinner) };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  harness.active.clear();
  vi.mocked(projectWorkstreams).mockClear();
  vi.mocked(parsePrefs).mockClear();
  vi.mocked(parseSpinner).mockClear();
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
    pendingSuggestions: 1,
  };
}

function rpc(overrides: Record<string, unknown> = {}) {
  return {
    state: vi.fn(async () => state()),
    prefs: vi.fn(async () => ({ prefs: {} })),
    spinner: vi.fn(async () => ({
      spinner: { shape: "spokes", primary: "subtle", secondary: "auto" },
    })),
    ...overrides,
  };
}

function report(metric: string, details: Record<string, number>) {
  console.log(`PERF ${metric} ${JSON.stringify(details)}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function spinnerStyle(
  shape: SpinnerStyle["shape"],
  primary: SpinnerStyle["primary"],
): SpinnerStyle {
  return { shape, primary, secondary: "auto" };
}

function mountSpinner(
  handlers: ReturnType<typeof rpc>,
  onError: (cause: unknown) => void,
) {
  let update!: ReturnType<typeof useSetSpinner>;
  let current!: SpinnerStyle;
  function Editor() {
    update = useSetSpinner(onError);
    current = useSpinner();
    return null;
  }
  const slot = renderSlot({ component: Editor }, {}, { rpc: handlers });
  return {
    slot,
    value: () => current,
    update: (patch: Parameters<ReturnType<typeof useSetSpinner>>[0]) =>
      update(patch),
  };
}

it("measures notifications for a cloned equal server snapshot", async () => {
  const handlers = rpc();
  const renders = [0, 0, 0];
  let latest!: ServerState;
  function Consumer({ id }: { id: number }) {
    const { server } = useServerState();
    if (id === 0) latest = server;
    renders[id]! += 1;
    return (
      <output data-testid={`state-${id}`}>{server.pendingSuggestions}</output>
    );
  }
  function Suite() {
    return (
      <>
        <ServerStateRealtime />
        {renders.map((_, id) => (
          <Consumer key={id} id={id} />
        ))}
      </>
    );
  }
  const slot = renderSlot({ component: Suite }, {}, { rpc: handlers });
  await waitFor(() =>
    expect(within(slot.container).getByTestId("state-0").textContent).toBe("1"),
  );
  const before = [...renders];
  const previous = latest;
  vi.mocked(handlers.state).mockImplementation(async () =>
    JSON.parse(JSON.stringify(state())),
  );
  await slot.behavior.emitRealtime("changed", {});
  await waitFor(() => expect(handlers.state).toHaveBeenCalledTimes(2));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const notifications = renders.reduce(
    (total, count, id) => total + count - before[id]!,
    0,
  );
  report("identical-state-notifications", { consumers: 3, notifications });
  expect(notifications).toBe(0);
  expect(latest).toBe(previous);
});

it("measures transcript renders when an unrelated server field changes", async () => {
  const initial = state();
  initial.recaps.t1 = {
    id: "r1",
    turnId: "turn1",
  } as ServerState["recaps"][string];
  const read = vi.fn(async () => initial);
  const handlers = rpc({ state: read });
  let dockedRenders = 0;
  const Docked = memo(function Docked() {
    const docked = useDockedTurn("t1", "turn1");
    dockedRenders += 1;
    return <output data-testid="docked">{String(docked)}</output>;
  });
  function Suite() {
    const { server } = useServerState();
    return (
      <>
        <ServerStateRealtime />
        <output data-testid="revision">{server.pendingSuggestions}</output>
        <Docked />
        <Docked />
      </>
    );
  }
  const slot = renderSlot({ component: Suite }, {}, { rpc: handlers });
  await waitFor(() =>
    expect(
      within(slot.container)
        .getAllByTestId("docked")
        .map((node) => node.textContent),
    ).toEqual(["true", "true"]),
  );
  const before = dockedRenders;
  read.mockImplementation(async () => ({ ...initial, pendingSuggestions: 2 }));
  await slot.behavior.emitRealtime("changed", {});
  await waitFor(() =>
    expect(within(slot.container).getByTestId("revision").textContent).toBe(
      "2",
    ),
  );
  report("unchanged-docked-selector-renders", {
    transcriptBlocks: 2,
    renders: dockedRenders - before,
  });
  expect(dockedRenders - before).toBe(0);
  expect(
    within(slot.container)
      .getAllByTestId("docked")
      .map((node) => node.textContent),
  ).toEqual(["true", "true"]);

  const beforeDismissal = dockedRenders;
  read.mockImplementation(async () => ({
    ...initial,
    dismissedRecaps: ["r1"],
  }));
  await slot.behavior.emitRealtime("changed", {});
  await waitFor(() =>
    expect(
      within(slot.container)
        .getAllByTestId("docked")
        .map((node) => node.textContent),
    ).toEqual(["false", "false"]),
  );
  expect(dockedRenders - beforeDismissal).toBe(2);
});

it("measures per-hook RPC clients and realtime work", async () => {
  const handlers = rpc();
  function Consumer({ id }: { id: number }) {
    const { prefs } = usePrefs();
    const spinner = useSpinner();
    return (
      <output data-testid={`client-${id}`} data-loaded={prefs !== null}>
        {prefs?.sidebar.timestamps}:{spinner.shape}
      </output>
    );
  }
  function Suite({ leader = true }: { leader?: boolean }) {
    return (
      <>
        <ServerStateRealtime />
        {[0, 1, 2, 3]
          .filter((id) => leader || id !== 0)
          .map((id) => (
            <Consumer key={id} id={id} />
          ))}
      </>
    );
  }
  const slot = renderSlot({ component: Suite }, {}, { rpc: handlers });
  await waitFor(() => {
    for (let id = 0; id < 4; id++)
      expect(
        within(slot.container).getByTestId(`client-${id}`).dataset.loaded,
      ).toBe("true");
  });
  const measurements = {
    consumers: 4,
    prefsRpc: vi.mocked(handlers.prefs).mock.calls.length,
    spinnerRpc: vi.mocked(handlers.spinner).mock.calls.length,
    prefsRealtime: harness.active.get("prefs")?.size ?? 0,
    spinnerRealtime: harness.active.get("spinner")?.size ?? 0,
  };
  report("per-hook-clients", measurements);
  expect(measurements).toEqual({
    consumers: 4,
    prefsRpc: 1,
    spinnerRpc: 1,
    prefsRealtime: 4,
    spinnerRealtime: 4,
  });
  const beforePrefs = vi.mocked(parsePrefs).mock.calls.length;
  await slot.behavior.emitRealtime("prefs", {
    prefs: { sidebar: { timestamps: "hide" } },
  });
  const prefsParses = vi.mocked(parsePrefs).mock.calls.length - beforePrefs;
  const beforeSpinner = vi.mocked(parseSpinner).mock.calls.length;
  await slot.behavior.emitRealtime("spinner", {
    spinner: { shape: "orbit", primary: "green", secondary: "none" },
  });
  const spinnerParses =
    vi.mocked(parseSpinner).mock.calls.length - beforeSpinner;
  report("realtime-broadcast-work", {
    consumers: 4,
    prefsParses,
    spinnerParses,
  });
  expect(prefsParses).toBe(1);
  expect(spinnerParses).toBe(1);
  for (let id = 0; id < 4; id++)
    expect(within(slot.container).getByTestId(`client-${id}`).textContent).toBe(
      "hide:orbit",
    );

  slot.lifecycle.rerender(<Suite leader={false} />);
  await slot.behavior.emitRealtime("prefs", {
    prefs: { sidebar: { timestamps: "always" } },
  });
  await slot.behavior.emitRealtime("spinner", {
    spinner: { shape: "dots", primary: "green", secondary: "none" },
  });
  for (let id = 1; id < 4; id++)
    expect(within(slot.container).getByTestId(`client-${id}`).textContent).toBe(
      "show:dots",
    );
});

it("skips closed row and menu renders for unrelated preference publishes", async () => {
  const thread = sidebarThread("t1");
  const handlers: RowMenuHandlers = {
    rename: vi.fn(),
    openParent: vi.fn(),
    snooze: vi.fn(),
    customSnooze: vi.fn(),
    wake: vi.fn(),
    reportError: vi.fn(),
    inspect: vi.fn(),
  };
  let rowRenders = 0;
  function LivePreferences() {
    usePrefs();
    return null;
  }
  function Suite() {
    return (
      <>
        <LivePreferences />
        <Profiler id="row" onRender={() => rowRenders++}>
          <RowMenu
            thread={thread}
            handlers={handlers}
            snoozePrefs={DEFAULT_SNOOZE_PREFS}
          >
            <Row
              thread={thread}
              depth={0}
              active={false}
              onNavigate={() => {}}
            />
          </RowMenu>
        </Profiler>
      </>
    );
  }
  const slot = renderSlot(
    { component: Suite },
    {},
    {
      rpc: rpc(),
      sidebarThreads: {
        status: "ready",
        threads: [thread],
        sections: [],
        projects: [],
      },
    },
  );
  await waitFor(() =>
    expect(slot.container.querySelector("[data-timestamp]")).not.toBeNull(),
  );
  expect(harness.active.get("prefs")?.size).toBe(1);
  rowRenders = 0;
  await slot.behavior.emitRealtime("prefs", {
    prefs: { threads: { autoTitle: false } },
  });
  report("unrelated-preference-row-renders", { rows: 1, renders: rowRenders });
  expect(rowRenders).toBe(0);
  expect(slot.container.querySelector("[data-timestamp]")).not.toBeNull();

  await slot.behavior.emitRealtime("prefs", {
    prefs: { sidebar: { timestamps: "hide" } },
  });
  await waitFor(() =>
    expect(slot.container.querySelector("[data-timestamp]")).toBeNull(),
  );
  expect(rowRenders).toBe(1);
  slot.lifecycle.unmount();
});

it("shares pending spinner writes and live colors across per-hook clients", async () => {
  let stored = spinnerStyle("spokes", "subtle");
  const setSpinner = vi.fn(async (input: unknown) => {
    stored = {
      ...(input as { spinner: SpinnerStyle }).spinner,
      primary: "#00ff00",
    };
    return { spinner: stored };
  });
  const handlers = rpc({
    setSpinner,
    spinner: vi.fn(async () => ({ spinner: stored })),
  });
  let update!: ReturnType<typeof useSetSpinner>;
  const onError = vi.fn();
  function Editor() {
    update = useSetSpinner(onError);
    return null;
  }
  function Reader({ id }: { id: number }) {
    const spinner = useSpinner();
    return <output data-testid={`color-${id}`}>{spinner.primary}</output>;
  }
  function Suite() {
    return (
      <>
        <Editor />
        {[0, 1, 2].map((id) => (
          <Reader key={id} id={id} />
        ))}
      </>
    );
  }
  const slot = renderSlot({ component: Suite }, {}, { rpc: handlers });
  await waitFor(() => expect(handlers.spinner).toHaveBeenCalledTimes(1));
  vi.useFakeTimers();
  act(() => update({ primary: "#ff0000" }));
  for (let id = 0; id < 3; id++)
    expect(within(slot.container).getByTestId(`color-${id}`).textContent).toBe(
      "#ff0000",
    );

  stored = spinnerStyle("orbit", "#0000ff");
  await slot.behavior.emitRealtime("spinner", {
    spinner: stored,
  });
  for (let id = 0; id < 3; id++)
    expect(within(slot.container).getByTestId(`color-${id}`).textContent).toBe(
      "#ff0000",
    );
  act(() => vi.advanceTimersByTime(249));
  expect(setSpinner).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(setSpinner).toHaveBeenCalledTimes(1);
  for (let id = 0; id < 3; id++)
    expect(within(slot.container).getByTestId(`color-${id}`).textContent).toBe(
      "#00ff00",
    );
  expect(onError).not.toHaveBeenCalled();

  await slot.behavior.emitRealtime("spinner", {
    spinner: { shape: "dots", primary: "#0000ff", secondary: "auto" },
  });
  for (let id = 0; id < 3; id++)
    expect(within(slot.container).getByTestId(`color-${id}`).textContent).toBe(
      "#0000ff",
    );
});

it("keeps the newest spinner save when responses finish in reverse", async () => {
  const first = deferred<{ spinner: SpinnerStyle }>();
  const second = deferred<{ spinner: SpinnerStyle }>();
  const setSpinner = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  const handlers = rpc({ setSpinner });
  const onError = vi.fn();
  const editor = mountSpinner(handlers, onError);
  await waitFor(() => expect(handlers.spinner).toHaveBeenCalledTimes(1));
  await act(async () => {});
  vi.useFakeTimers();

  act(() => editor.update({ primary: "#111111" }));
  await act(async () => vi.advanceTimersByTime(250));
  act(() => editor.update({ shape: "orbit", primary: "#222222" }));
  await act(async () => vi.advanceTimersByTime(250));
  expect(setSpinner).toHaveBeenCalledTimes(2);

  const newest = spinnerStyle("orbit", "#222222");
  await act(async () => {
    second.resolve({ spinner: newest });
    await second.promise;
  });
  expect(editor.value()).toEqual(newest);
  await act(async () => {
    first.resolve({ spinner: spinnerStyle("spokes", "#111111") });
    await first.promise;
  });
  expect(editor.value()).toEqual(newest);
  expect(onError).not.toHaveBeenCalled();
});

it("keeps a newer spinner save across an older error and a later rollback", async () => {
  const first = deferred<{ spinner: SpinnerStyle }>();
  const second = deferred<{ spinner: SpinnerStyle }>();
  const third = deferred<{ spinner: SpinnerStyle }>();
  const setSpinner = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise)
    .mockImplementationOnce(() => third.promise);
  const handlers = rpc({ setSpinner });
  const onError = vi.fn();
  const editor = mountSpinner(handlers, onError);
  await waitFor(() => expect(handlers.spinner).toHaveBeenCalledTimes(1));
  await act(async () => {});
  vi.useFakeTimers();

  act(() => editor.update({ primary: "#111111" }));
  await act(async () => vi.advanceTimersByTime(250));
  act(() => editor.update({ shape: "orbit", primary: "#222222" }));
  await act(async () => vi.advanceTimersByTime(250));
  const newest = spinnerStyle("orbit", "#222222");
  await act(async () => {
    second.resolve({ spinner: newest });
    await second.promise;
  });

  const staleError = new Error("older write failed");
  await act(async () => {
    first.reject(staleError);
    await first.promise.catch(() => {});
  });
  expect(onError).toHaveBeenCalledWith(staleError);
  expect(editor.value()).toEqual(newest);

  act(() => editor.update({ primary: "#333333" }));
  await act(async () => vi.advanceTimersByTime(250));
  const latestError = new Error("latest write failed");
  await act(async () => {
    third.reject(latestError);
    await third.promise.catch(() => {});
  });
  expect(onError).toHaveBeenCalledWith(latestError);
  expect(editor.value()).toEqual(newest);
});

it("restores the initial spinner snapshot when its read follows a save error", async () => {
  const initial = deferred<{ spinner: SpinnerStyle }>();
  const write = deferred<{ spinner: SpinnerStyle }>();
  const handlers = rpc({
    spinner: vi.fn(() => initial.promise),
    setSpinner: vi.fn(() => write.promise),
  });
  const onError = vi.fn();
  const editor = mountSpinner(handlers, onError);
  await waitFor(() => expect(handlers.spinner).toHaveBeenCalledTimes(1));
  vi.useFakeTimers();

  act(() => editor.update({ primary: "#ff0000" }));
  await act(async () => vi.advanceTimersByTime(250));
  const cause = new Error("write failed");
  await act(async () => {
    write.reject(cause);
    await write.promise.catch(() => {});
  });
  expect(onError).toHaveBeenCalledWith(cause);

  const stored = spinnerStyle("orbit", "#0000ff");
  await act(async () => {
    initial.resolve({ spinner: stored });
    await initial.promise;
  });
  expect(editor.value()).toEqual(stored);
});

it("re-reads a suppressed spinner broadcast after the local save callback", async () => {
  const initial = spinnerStyle("spokes", "subtle");
  const remote = spinnerStyle("orbit", "#0000ff");
  const write = deferred<{ spinner: SpinnerStyle }>();
  const reread = deferred<{ spinner: SpinnerStyle }>();
  const spinner = vi
    .fn()
    .mockImplementationOnce(async () => ({ spinner: initial }))
    .mockImplementationOnce(() => reread.promise);
  const handlers = rpc({
    spinner,
    setSpinner: vi.fn(() => write.promise),
  });
  const onError = vi.fn();
  const editor = mountSpinner(handlers, onError);
  await waitFor(() => expect(editor.value()).toEqual(initial));
  vi.useFakeTimers();

  act(() => editor.update({ primary: "#ff0000" }));
  await act(async () => vi.advanceTimersByTime(250));
  await editor.slot.behavior.emitRealtime("spinner", { spinner: remote });
  expect(editor.value()).toEqual(spinnerStyle("spokes", "#ff0000"));
  expect(spinner).toHaveBeenCalledTimes(1);

  const saved = spinnerStyle("spokes", "#00ff00");
  await act(async () => {
    write.resolve({ spinner: saved });
    await write.promise;
  });
  expect(editor.value()).toEqual(saved);
  expect(spinner).toHaveBeenCalledTimes(2);
  await act(async () => {
    reread.resolve({ spinner: remote });
    await reread.promise;
  });
  expect(editor.value()).toEqual(remote);
  expect(onError).not.toHaveBeenCalled();
});

it("measures projection work for an unchanged rerender and a thread update", async () => {
  const at = 1_000_000;
  const date = vi.spyOn(Date, "now").mockReturnValue(at);
  harness.sidebar.current = {
    status: "ready",
    threads: [sidebarThread("t1")],
    sections: [],
    projects: [],
  };
  function Suite() {
    const ws = useWorkstreams();
    return <output data-testid="now">{ws.now}</output>;
  }
  const slot = renderSlot({ component: Suite }, {}, { rpc: rpc() });
  await waitFor(() =>
    expect(vi.mocked(projectWorkstreams).mock.calls.length).toBeGreaterThan(0),
  );
  const before = vi.mocked(projectWorkstreams).mock.calls.length;
  date.mockReturnValue(at + 5);
  slot.lifecycle.rerender(<Suite />);
  const unchanged = vi.mocked(projectWorkstreams).mock.calls.length - before;
  const beforeUpdate = vi.mocked(projectWorkstreams).mock.calls.length;
  date.mockReturnValue(at + 10);
  harness.sidebar.current = {
    ...harness.sidebar.current,
    threads: [sidebarThread("t2")],
  };
  slot.lifecycle.rerender(<Suite />);
  const threadUpdate =
    vi.mocked(projectWorkstreams).mock.calls.length - beforeUpdate;
  report("projection-work", { unchanged, threadUpdate });
  expect(unchanged).toBe(0);
  expect(threadUpdate).toBe(1);
  expect(within(slot.container).getByTestId("now").textContent).toBe(
    String(at + 10),
  );
});

it("projects a due snooze deadline on a parent rerender", async () => {
  vi.useFakeTimers();
  const at = 1_000_000;
  vi.setSystemTime(at);
  const until = at + 50;
  const expiring = state();
  expiring.snoozes.t1 = { until, attentionAt: 1, at: 1 };
  harness.sidebar.current = {
    status: "ready",
    threads: [sidebarThread("t1")],
    sections: [section("sec_empty", "Empty")],
    projects: [],
  };
  function Suite() {
    const ws = useWorkstreams();
    return (
      <output
        data-testid="clock"
        data-snoozed={ws.projection.snoozed.length}
        data-empty={ws.projection.groups.some(
          (group) => group.id === "sec_empty",
        )}
      >
        {ws.now}
      </output>
    );
  }
  const slot = renderSlot(
    { component: Suite },
    {},
    { rpc: rpc({ state: vi.fn(async () => expiring) }) },
  );
  await act(async () => {});
  const clock = () => within(slot.container).getByTestId("clock");
  expect(clock().dataset.snoozed).toBe("1");
  // A workstream whose thread is snoozed keeps no row of its own.
  expect(clock().dataset.empty).toBe("false");

  // Advancing wall time does not run the pending timer. The parent rerender
  // must nevertheless expire the actual projection, not just sample `now`.
  vi.setSystemTime(until);
  slot.lifecycle.rerender(<Suite />);
  expect(clock().dataset.snoozed).toBe("0");
  expect(clock().dataset.empty).toBe("false");
  expect(clock().textContent).toBe(String(until));
});

it.each(["save-first", "read-first"] as const)(
  "keeps the save across a same-edit read (%s)",
  async (order) => {
    const staleRead = deferred<{ spinner: SpinnerStyle }>();
    const write = deferred<{ spinner: SpinnerStyle }>();
    const spinner = vi
      .fn()
      .mockRejectedValueOnce(new Error("initial read failed"))
      .mockImplementationOnce(() => staleRead.promise);
    const handlers = rpc({ spinner, setSpinner: vi.fn(() => write.promise) });
    let update!: ReturnType<typeof useSetSpinner>;
    let current!: SpinnerStyle;
    function Editor() {
      update = useSetSpinner(() => {});
      current = useSpinner();
      return null;
    }
    function AdditionalReader() {
      useSpinner();
      return null;
    }
    function Suite({ extra = false }: { extra?: boolean }) {
      return (
        <>
          <Editor />
          {extra && <AdditionalReader />}
        </>
      );
    }
    const slot = renderSlot({ component: Suite }, {}, { rpc: handlers });
    await waitFor(() => expect(spinner).toHaveBeenCalledTimes(1));
    await act(async () => {});
    vi.useFakeTimers();
    act(() => update({ primary: "#222222" }));
    await act(async () => vi.advanceTimersByTime(250));
    slot.lifecycle.rerender(<Suite extra />);
    expect(spinner).toHaveBeenCalledTimes(2);
    const saved = spinnerStyle("spokes", "#222222");
    const finishRead = () =>
      act(async () => {
        staleRead.resolve({ spinner: spinnerStyle("spokes", "#111111") });
        await staleRead.promise;
      });
    const finishWrite = () =>
      act(async () => {
        write.resolve({ spinner: saved });
        await write.promise;
      });
    if (order === "save-first") {
      await finishWrite();
      expect(current).toEqual(saved);
      await finishRead();
    } else {
      await finishRead();
      await finishWrite();
    }
    expect(current).toEqual(saved);
  },
);

it("revalidates preferences and spinners after a reader-free interval", async () => {
  let timestamps = "show";
  let stored = spinnerStyle("spokes", "subtle");
  const handlers = rpc({
    prefs: vi.fn(async () => ({ prefs: { sidebar: { timestamps } } })),
    spinner: vi.fn(async () => ({ spinner: stored })),
  });
  let shown = "";
  let renders = 0;
  function Reader() {
    const { prefs } = usePrefs();
    const spinner = useSpinner();
    shown = `${prefs?.sidebar.timestamps}:${spinner.shape}`;
    renders += 1;
    return null;
  }
  function Suite({ visible = true }: { visible?: boolean }) {
    return visible ? <Reader /> : null;
  }
  const slot = renderSlot({ component: Suite }, {}, { rpc: handlers });
  await waitFor(() => expect(shown).toBe("show:spokes"));
  slot.lifecycle.rerender(<Suite visible={false} />);
  timestamps = "hide";
  stored = spinnerStyle("dots", "#222222");
  slot.lifecycle.rerender(<Suite />);
  await waitFor(() => expect(shown).toBe("hide:dots"));
  expect(handlers.prefs).toHaveBeenCalledTimes(2);
  expect(handlers.spinner).toHaveBeenCalledTimes(2);
  renders = 0;
  await slot.behavior.emitRealtime("prefs", {
    prefs: { sidebar: { timestamps } },
  });
  await slot.behavior.emitRealtime("spinner", { spinner: stored });
  expect(renders).toBe(0);
});

it("rejects preference and spinner reads crossing a reader-free interval", async () => {
  const oldPrefs = deferred<{ prefs: unknown }>();
  const oldSpinner = deferred<{ spinner: SpinnerStyle }>();
  const handlers = rpc({
    prefs: vi
      .fn()
      .mockImplementationOnce(() => oldPrefs.promise)
      .mockResolvedValue({ prefs: { sidebar: { timestamps: "hide" } } }),
    spinner: vi
      .fn()
      .mockImplementationOnce(() => oldSpinner.promise)
      .mockResolvedValue({ spinner: spinnerStyle("dots", "#222222") }),
  });
  let shown = "";
  function Reader() {
    const { prefs } = usePrefs();
    const spinner = useSpinner();
    shown = `${prefs?.sidebar.timestamps}:${spinner.shape}`;
    return null;
  }
  function Suite({ visible = true }: { visible?: boolean }) {
    return visible ? <Reader /> : null;
  }
  const slot = renderSlot({ component: Suite }, {}, { rpc: handlers });
  await waitFor(() => expect(handlers.spinner).toHaveBeenCalledTimes(1));
  slot.lifecycle.rerender(<Suite visible={false} />);
  slot.lifecycle.rerender(<Suite />);
  await act(async () => {
    oldPrefs.resolve({ prefs: { sidebar: { timestamps: "show" } } });
    oldSpinner.resolve({ spinner: spinnerStyle("spokes", "subtle") });
    await Promise.all([oldPrefs.promise, oldSpinner.promise]);
  });
  await waitFor(() => expect(shown).toBe("hide:dots"));
  expect(handlers.prefs).toHaveBeenCalledTimes(2);
  expect(handlers.spinner).toHaveBeenCalledTimes(2);
});

it("reuses catalog paths, leaf ordering, and search fields per snapshot", () => {
  const entities = [
    {
      id: "area",
      name: "Area",
      description: "Parent scope",
      parentId: null,
      aliases: ["Realm"],
    },
    {
      id: "shipping",
      name: "Shipping",
      description: "Exports",
      parentId: "area",
      aliases: ["Delivery"],
    },
    {
      id: "loose",
      name: "Loose ends",
      description: "",
      parentId: null,
      aliases: [],
    },
  ];
  const index = topicIndex(entities);
  expect(topicIndex(entities)).toBe(index);
  expect(index.byId.get("area")?.name).toBe("Area");
  expect(index.path("shipping")).toBe("Area: Shipping");
  expect(index.leafTopics.map((topic) => topic.path)).toEqual([
    "Area: Shipping",
    "Loose ends",
  ]);
  const shipping = index.leafTopics[0]!;
  for (const query of ["shipping", "exports", "delivery", "area", "realm"])
    expect(shipping.searchText.some((text) => text.includes(query))).toBe(true);
  expect(index.hasExactName("area")).toBe(true);
  expect(index.hasExactName("realm")).toBe(false);
  expect(topicIndex(entities.map((entity) => ({ ...entity })))).not.toBe(index);
});

it("reuses equal JSON trees and unchanged branches of a nested update", () => {
  const previous = state();
  previous.snoozes = {
    a: { until: null, attentionAt: 1, at: 1 },
    b: { until: 10, attentionAt: 2, at: 2 },
  };
  const equal = JSON.parse(JSON.stringify(previous)) as ServerState;
  expect(shareJson(previous, equal)).toBe(previous);

  const changed = JSON.parse(JSON.stringify(previous)) as ServerState;
  changed.snoozes.b = { ...changed.snoozes.b!, until: 20 };
  const shared = shareJson(previous, changed);
  expect(shared).not.toBe(previous);
  expect(shared.snoozes.a).toBe(previous.snoozes.a);
  expect(shared.snoozes.b).not.toBe(previous.snoozes.b);
  expect(shared.snoozes.b!.until).toBe(20);
  expect(shared.order).toBe(previous.order);
  expect(shared.snoozePrefs).toBe(previous.snoozePrefs);
  expect(shared.catalog).toBe(previous.catalog);
});
