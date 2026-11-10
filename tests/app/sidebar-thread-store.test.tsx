// @vitest-environment jsdom
// The shared sidebar thread store (`useStableSidebarThreads.ts`): one SDK
// subscription per view however many surfaces read it, single-thread lookups
// that render only for their own thread, and publishes that skip the sharing
// walk when the host snapshot repeats.
import type {
  PluginSidebarThread,
  PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup } from "@testing-library/react";
import { memo, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import * as sharing from "../../src/app/structuralSharing.ts";
import {
  useSidebarThread,
  useStableSidebarThreads,
} from "../../src/app/useStableSidebarThreads.ts";
import { section, sidebarThread } from "./fixtures.ts";

const host = vi.hoisted(() => {
  let snapshot: PluginSidebarThreadsState;
  const listeners = new Set<() => void>();
  return {
    /** Calls of the SDK hook, by the view each call asked for. */
    calls: [] as string[],
    snapshot: () => snapshot,
    set: (next: PluginSidebarThreadsState) => {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("@get-bb/plugin-sdk/app", async (importActual) => {
  const actual = await importActual<typeof import("@get-bb/plugin-sdk/app")>();
  const React = await import("react");
  return {
    ...actual,
    experimental_useSidebarThreads: (options?: {
      experimental_lifecycles: readonly string[];
    }) => {
      host.calls.push(JSON.stringify(options?.experimental_lifecycles ?? []));
      return React.useSyncExternalStore(host.subscribe, host.snapshot);
    },
  };
});

afterEach(() => {
  cleanup();
  host.calls.length = 0;
  vi.restoreAllMocks();
});

const view = (threads: PluginSidebarThread[]): PluginSidebarThreadsState => ({
  status: "ready",
  threads,
  sections: [section("sec_1", "Lumen")],
  projects: [],
  experimental_archived: null,
});

let lookupRenders: Record<string, number> = {};
/** A thread link as a page draws it: memoized, so only its lookup renders it. */
const Lookup = memo(function Lookup({ id }: { id: string }) {
  const thread = useSidebarThread(id);
  lookupRenders[id] = (lookupRenders[id] ?? 0) + 1;
  return <p data-id={id}>{thread?.displayTitle ?? "none"}</p>;
});

it("looks up threads through one SDK subscription and renders only the changed thread's lookup", async () => {
  const threads = Array.from({ length: 40 }, (_, index) =>
    sidebarThread(`t${index}`, { title: `Thread ${index}` }),
  );
  host.set(view(threads));
  lookupRenders = {};
  function Page() {
    // The sidebar itself is the wide consumer; header actions ask for the
    // active view by name, which is the same view.
    useStableSidebarThreads();
    return (
      <>
        {threads.map((thread) => (
          <Lookup key={thread.id} id={thread.id} />
        ))}
        <ActiveView />
      </>
    );
  }
  let activeSnapshot: unknown;
  let defaultSnapshot: unknown;
  function ActiveView() {
    activeSnapshot = useStableSidebarThreads({
      experimental_lifecycles: ["active"],
    });
    defaultSnapshot = useStableSidebarThreads();
    return null;
  }
  const slot = renderSlot({ component: Page }, {});
  expect(activeSnapshot).toBe(defaultSnapshot);
  // Three wide consumers, one per `useStableSidebarThreads`; the 40 lookups
  // read the store without calling the SDK hook.
  expect(host.calls).toHaveLength(3);
  expect(slot.container.querySelector('[data-id="t7"]')!.textContent).toBe(
    "Thread 7",
  );

  lookupRenders = {};
  act(() =>
    host.set(
      view(
        threads.map((thread) =>
          thread.id === "t7"
            ? { ...thread, displayTitle: "Renamed", title: "Renamed" }
            : thread,
        ),
      ),
    ),
  );
  expect(lookupRenders).toEqual({ t7: 1 });
  expect(slot.container.querySelector('[data-id="t7"]')!.textContent).toBe(
    "Renamed",
  );
  slot.lifecycle.unmount();
});

it("keeps lookups live when the wide consumer that published for them unmounts", async () => {
  const threads = [sidebarThread("t1", { title: "First" })];
  host.set(view(threads));
  lookupRenders = {};
  let hideSidebar!: () => void;
  function Sidebar() {
    useStableSidebarThreads();
    return null;
  }
  function Overlay() {
    useStableSidebarThreads();
    return null;
  }
  function App() {
    const [sidebar, setSidebar] = useState(true);
    hideSidebar = () => setSidebar(false);
    return (
      <>
        {sidebar ? <Sidebar /> : null}
        <Overlay />
        <Lookup id="t1" />
      </>
    );
  }
  const slot = renderSlot({ component: App }, {});
  act(() => hideSidebar());
  await act(async () => {});
  act(() =>
    host.set(
      view([{ ...threads[0]!, displayTitle: "Second", title: "Second" }]),
    ),
  );
  expect(slot.container.querySelector('[data-id="t1"]')!.textContent).toBe(
    "Second",
  );
  slot.lifecycle.unmount();
});

it("skips the sharing walk when the publisher renders with the snapshot it last published", () => {
  const first = sidebarThread("t1", { title: "First" });
  host.set(view([first, sidebarThread("t2", { title: "Second" })]));
  let rerender!: () => void;
  function Publisher() {
    const [, setCount] = useState(0);
    rerender = () => setCount((count) => count + 1);
    useStableSidebarThreads();
    return null;
  }
  const slot = renderSlot({ component: Publisher }, {});
  // An equal copy of a thread: the store keeps the copy it already holds,
  // so the host's object never becomes the stored one.
  act(() => host.set(view([{ ...first }, host.snapshot().threads[1]!])));
  const walks = vi.spyOn(sharing, "shareJson");
  for (let index = 0; index < 5; index++) act(() => rerender());
  expect(walks).not.toHaveBeenCalled();

  // A host that changes its snapshot in place still publishes.
  const snapshot = host.snapshot() as unknown as {
    threads: PluginSidebarThread[];
  };
  snapshot.threads[1] = { ...snapshot.threads[1]!, displayTitle: "Changed" };
  act(() => rerender());
  expect(walks).toHaveBeenCalledOnce();
  slot.lifecycle.unmount();
});
