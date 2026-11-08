import { expect, it, vi } from "vitest";
import {
  createActivityLoader,
  TRACE_PAGE,
  type ActivityQuery,
} from "../../src/app/page/activityLoader.ts";
import type { TraceSummary } from "../../src/domain/trace.ts";
import { entry, trace } from "./activity-fixtures.ts";

const query: ActivityQuery = {
  external: false,
  debug: true,
  traceLimit: TRACE_PAGE,
  callKind: "",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(
  overrides: Partial<Parameters<typeof createActivityLoader>[0]> = {},
) {
  const source = {
    journal: vi.fn(async () => [entry]),
    traces: vi.fn(async () => [trace("current")]),
    ...overrides,
  };
  const sink = { entries: vi.fn(), calls: vi.fn(), error: vi.fn() };
  return { source, sink, loader: createActivityLoader(source, sink) };
}

it("loads journal and calls independently so a slow trace request does not hide entries", async () => {
  const pending = deferred<TraceSummary[]>();
  const { loader, source, sink } = fixture({ traces: () => pending.promise });
  const loading = loader.load({ ...query, external: true });
  // The journal completion was queued before this microtask, without a timer.
  await Promise.resolve();
  expect(source.journal).toHaveBeenCalledWith({ limit: 300, external: true });
  expect(sink.entries).toHaveBeenCalledWith([entry]);
  expect(sink.calls).not.toHaveBeenCalled();
  pending.resolve([trace("done")]);
  await loading;
  expect(sink.calls).toHaveBeenCalledWith([trace("done")], false);
});

it("pages with a stable timestamp/id cursor and refreshes all loaded history from the top", async () => {
  let first = Array.from({ length: TRACE_PAGE }, (_, i) => trace(`call-${i}`));
  let older = [trace("older")];
  const traces = vi.fn(
    async ({ before }: { before?: { at: number; id: string } }) =>
      before ? older : first,
  );
  const { loader, sink } = fixture({ traces });
  await loader.load(query);
  expect(sink.calls).toHaveBeenLastCalledWith(first, true);
  await loader.load({ ...query, traceLimit: TRACE_PAGE * 2 });
  expect(traces).toHaveBeenLastCalledWith({
    limit: 100,
    before: { at: 1000, id: "call-99" },
  });
  expect(sink.calls).toHaveBeenLastCalledWith([...first, ...older], false);
  // A deleted call leaves the older page, and a changed label replaces its old value.
  first = [
    trace("new"),
    ...first
      .slice(0, -1)
      .map((call, i) =>
        i === 0 ? { ...call, label: "Refreshed call" } : call,
      ),
  ];
  older = [];
  await loader.load({ ...query, traceLimit: TRACE_PAGE * 2 });
  expect(sink.calls).toHaveBeenLastCalledWith(first, false);
  expect(traces.mock.calls.slice(-2)).toEqual([
    [{ limit: 100 }],
    [{ limit: 100, before: { at: 1000, id: "call-98" } }],
  ]);
});

it("applies the kind filter on every page and stops at the requested depth", async () => {
  const full = Array.from({ length: TRACE_PAGE }, (_, i) =>
    trace(`call-${i}`, { kind: "quick-analysis" }),
  );
  const traces = vi.fn(async () => full);
  const { loader, sink } = fixture({ traces });
  await loader.load({
    ...query,
    callKind: "quick-analysis",
    traceLimit: TRACE_PAGE * 2,
  });
  expect(traces.mock.calls).toEqual([
    [{ limit: 100, kind: "quick-analysis" }],
    [
      {
        limit: 100,
        kind: "quick-analysis",
        before: { at: 1000, id: "call-99" },
      },
    ],
  ]);
  expect(sink.calls).toHaveBeenLastCalledWith([...full, ...full], true);
});

it("does not fetch traces with Debug off and clears the trace view", async () => {
  const { loader, source, sink } = fixture();
  await loader.load({ ...query, debug: false });
  expect(source.traces).not.toHaveBeenCalled();
  expect(sink.calls).toHaveBeenCalledWith([], false);
  expect(sink.entries).toHaveBeenCalledWith([entry]);
});

it.each(["resolve", "reject"] as const)(
  "ignores stale trace %s after a filter changes",
  async (completion) => {
    const old = deferred<TraceSummary[]>();
    const traces = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue([trace("filtered")]);
    const { loader, sink } = fixture({ traces });
    const first = loader.load({ ...query, traceLimit: TRACE_PAGE * 2 });
    await loader.load({ ...query, callKind: "quick-analysis" });
    sink.calls.mockClear();
    sink.error.mockClear();
    if (completion === "resolve")
      old.resolve(
        Array.from({ length: TRACE_PAGE }, (_, i) => trace(`old-${i}`)),
      );
    else old.reject(new Error("Old failure"));
    await first;
    expect(sink.calls).not.toHaveBeenCalled();
    expect(sink.error).not.toHaveBeenCalled();
    expect(traces).toHaveBeenCalledTimes(2);
  },
);

it("invalidates pending journal results as well as traces", async () => {
  const old = deferred<(typeof entry)[]>();
  const journal = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue([{ ...entry, id: "new" }]);
  const { loader, sink } = fixture({ journal });
  const first = loader.load(query);
  await loader.load({ ...query, external: true });
  old.resolve([entry]);
  await first;
  expect(sink.entries).toHaveBeenCalledExactlyOnceWith([
    { ...entry, id: "new" },
  ]);
});

it.each(["resolve", "reject"] as const)(
  "cancels pending work on cleanup (%s) and can load again",
  async (completion) => {
    const old = deferred<TraceSummary[]>();
    const traces = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue([trace("remounted")]);
    const { loader, sink } = fixture({ traces });
    const first = loader.load(query);
    loader.cancel();
    sink.error.mockClear();
    if (completion === "resolve") old.resolve([trace("old")]);
    else old.reject("Old error");
    await first;
    expect(sink.entries).not.toHaveBeenCalled();
    expect(sink.calls).not.toHaveBeenCalled();
    expect(sink.error).not.toHaveBeenCalled();
    await loader.load(query);
    expect(sink.calls).toHaveBeenCalledWith([trace("remounted")], false);
  },
);

it("publishes successful traces even if the journal fails", async () => {
  const { loader, sink } = fixture({
    journal: async () => {
      throw new Error("Journal unavailable");
    },
  });
  await loader.load(query);
  expect(sink.error).toHaveBeenLastCalledWith("Journal unavailable");
  expect(sink.calls).toHaveBeenCalledWith([trace("current")], false);
});

it("keeps the previous trace view if a later page fails, then clears the error on refresh", async () => {
  const full = Array.from({ length: TRACE_PAGE }, (_, i) => trace(`call-${i}`));
  const traces = vi
    .fn()
    .mockResolvedValueOnce([trace("previous")])
    .mockResolvedValueOnce(full)
    .mockRejectedValueOnce("Page failed")
    .mockResolvedValue([]);
  const { loader, sink } = fixture({ traces });
  await loader.load(query);
  await loader.load({ ...query, traceLimit: TRACE_PAGE * 2 });
  expect(sink.calls).toHaveBeenCalledExactlyOnceWith(
    [trace("previous")],
    false,
  );
  expect(sink.error).toHaveBeenLastCalledWith("Page failed");
  await loader.load(query);
  expect(sink.error).toHaveBeenLastCalledWith(null);
  expect(sink.calls).toHaveBeenLastCalledWith([], false);
});

it("coalesces a realtime burst to one active load and one trailing refresh", async () => {
  const first = deferred<(typeof entry)[]>();
  const second = deferred<(typeof entry)[]>();
  const journal = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { loader, source, sink } = fixture({ journal });
  const loading = loader.refresh(query);
  loader.refresh(query);
  loader.refresh(query);
  loader.refresh(query);
  expect(source.journal).toHaveBeenCalledTimes(1);

  first.resolve([entry]);
  await loading;
  await vi.waitFor(() => expect(source.journal).toHaveBeenCalledTimes(2));
  expect(source.journal).toHaveBeenCalledTimes(2);
  second.resolve([{ ...entry, id: "trailing" }]);
  await vi.waitFor(() =>
    expect(sink.entries).toHaveBeenLastCalledWith([
      { ...entry, id: "trailing" },
    ]),
  );
  expect(source.journal).toHaveBeenCalledTimes(2);
});

it("keeps filter changes immediate and drops an older trailing realtime refresh", async () => {
  const old = deferred<(typeof entry)[]>();
  const journal = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue([{ ...entry, id: "filtered" }]);
  const { loader, source, sink } = fixture({ journal });
  const realtime = loader.refresh(query);
  loader.refresh(query);
  await loader.load({ ...query, external: true });
  expect(source.journal).toHaveBeenCalledTimes(2);
  expect(sink.entries).toHaveBeenCalledExactlyOnceWith([
    { ...entry, id: "filtered" },
  ]);

  old.resolve([entry]);
  await realtime;
  await Promise.resolve();
  expect(source.journal).toHaveBeenCalledTimes(2);
  expect(sink.entries).toHaveBeenCalledExactlyOnceWith([
    { ...entry, id: "filtered" },
  ]);
});

it("invalidates an older page when Debug is turned off", async () => {
  const full = Array.from({ length: TRACE_PAGE }, (_, i) => trace(`call-${i}`));
  const older = deferred<TraceSummary[]>();
  const traces = vi
    .fn()
    .mockResolvedValueOnce(full)
    .mockReturnValueOnce(older.promise);
  const { loader, sink } = fixture({ traces });
  const first = loader.load({ ...query, traceLimit: TRACE_PAGE * 2 });
  await Promise.resolve();
  expect(traces).toHaveBeenCalledTimes(2);
  await loader.load({ ...query, debug: false });
  older.resolve([trace("old")]);
  await first;
  expect(sink.calls).toHaveBeenCalledExactlyOnceWith([], false);
});
