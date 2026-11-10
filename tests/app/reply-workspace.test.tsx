// @vitest-environment jsdom
import type {
  ExperimentalMessageBlockProps,
  PluginBrowserBbSdk,
} from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "../../src/domain/reply.ts";
import { ReplyBlock } from "../../src/app/reply/ReplyBlock.tsx";
import { blockInput } from "../domain/replyFixtures.ts";

const markdown = vi.hoisted(() => ({
  renders: [] as { content: string; document: unknown }[],
}));
vi.mock("@get-bb/plugin-sdk/app", async (importActual) => {
  const actual = await importActual<typeof import("@get-bb/plugin-sdk/app")>();
  const React = await import("react");
  return {
    ...actual,
    Markdown: (props: React.ComponentProps<typeof actual.Markdown>) => {
      markdown.renders.push({
        content: props.content,
        document: props.experimental_document,
      });
      return React.createElement(
        "div",
        {
          "data-markdown": props.content,
          "data-document": JSON.stringify(props.experimental_document),
        },
        props.content,
      );
    },
  };
});
afterEach(() => {
  cleanup();
  markdown.renders.length = 0;
});

const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

function blockProps(
  text: string,
  threadId = "t1",
  id = "m1",
): ExperimentalMessageBlockProps {
  const input = blockInput(`:::reply\n${text}\n:::\n`);
  const result = parse(input, { status: input.status });
  return {
    data: result.ok ? result.data : null,
    error: result.ok ? null : result.error,
    status: input.status,
    source: input.source,
    message: { id, threadId, turnId: "turn1", projectId: "p1" },
    index: 0,
    Original: () => null,
  };
}

type Environment = { id: string; path: string; hostId: string } | null;

/** A thread lookup the test settles, plus BB's realtime subscription. */
function fakeSdk(initial: Environment) {
  let environment = initial;
  const pending: (() => void)[] = [];
  let deferred = false;
  const get = vi.fn(
    () =>
      new Promise((resolve) => {
        const answer = () =>
          resolve({ id: "t1", ...(environment ? { environment } : {}) });
        if (deferred) pending.push(answer);
        else answer();
      }),
  );
  const listeners = new Map<string, (event: unknown) => void>();
  const subscribe = vi.fn(
    (args: { event: string; callback: (event: unknown) => void }) => {
      listeners.set(args.event, args.callback);
      return () => listeners.delete(args.event);
    },
  );
  return {
    sdk: { threads: { get }, subscribe } as unknown as PluginBrowserBbSdk,
    get,
    subscribe,
    defer() {
      deferred = true;
    },
    release() {
      deferred = false;
      for (const answer of pending.splice(0)) answer();
    },
    setEnvironment(next: Environment) {
      environment = next;
    },
    emit(event: string, payload: unknown) {
      listeners.get(event)?.(payload);
    },
  };
}

function Blocks({
  ids,
  threadId = "t1",
}: {
  ids: string[];
  threadId?: string;
}) {
  return (
    <>
      {ids.map((id) => (
        <ReplyBlock key={id} {...blockProps(`Reply ${id}.`, threadId, id)} />
      ))}
    </>
  );
}

const documents = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-markdown]")].map((node) =>
    node.getAttribute("data-document"),
  );

it("draws a thread's first reply once its workspace is known, so its Markdown never switches renderer", async () => {
  const host = fakeSdk({ id: "env1", path: "/work/shop", hostId: "host1" });
  host.defer();
  const view = renderSlot(
    { component: () => <Blocks ids={["a", "b"]} /> },
    {},
    { sdk: host.sdk },
  );
  await settle();
  expect(view.container.querySelector("[data-reply-block]")).toBeNull();
  await act(async () => host.release());
  await settle();
  expect(documents(view.container)).toHaveLength(2);
  for (const document of documents(view.container))
    expect(document).toContain('"rootPath":"/work/shop"');
  // BB's renderer type depends on whether a document is present. Every render
  // carried one, so no Markdown subtree was replaced mid-life.
  expect(markdown.renders.every(({ document }) => document)).toBe(true);
  expect(host.get).toHaveBeenCalledTimes(1);
});

it("shares one lookup across blocks and remounts in a thread", async () => {
  const host = fakeSdk({ id: "env1", path: "/work/shop", hostId: "host1" });
  const view = renderSlot(
    { component: Blocks },
    { ids: ["a", "b", "c"] },
    { sdk: host.sdk },
  );
  await settle();
  expect(documents(view.container)).toHaveLength(3);
  // Virtualized scrolling unmounts and remounts blocks. A remount draws at
  // once from the cached workspace instead of asking BB again.
  view.lifecycle.rerender(<Blocks ids={[]} />);
  view.lifecycle.rerender(<Blocks ids={["d", "a"]} />);
  expect(documents(view.container)).toHaveLength(2);
  expect(host.get).toHaveBeenCalledTimes(1);
  expect(host.subscribe).toHaveBeenCalledWith(
    expect.objectContaining({ event: "thread:changed" }),
  );
});

it("remembers a thread without a workspace and draws its replies without a document", async () => {
  const host = fakeSdk(null);
  const view = renderSlot(
    { component: Blocks },
    { ids: ["a"] },
    { sdk: host.sdk },
  );
  await settle();
  view.lifecycle.rerender(<Blocks ids={["a", "b"]} />);
  expect(documents(view.container)).toEqual([null, null]);
  expect(host.get).toHaveBeenCalledTimes(1);
});

it("revalidates on an environment change and keeps an unchanged workspace's identity", async () => {
  const host = fakeSdk({ id: "env1", path: "/work/shop", hostId: "host1" });
  const view = renderSlot(
    { component: () => <Blocks ids={["a"]} /> },
    {},
    { sdk: host.sdk },
  );
  await settle();
  const renders = markdown.renders.length;
  // Unrelated thread changes, and other threads' environment changes, do not
  // ask again.
  host.emit("thread:changed", {
    entity: "thread",
    id: "t1",
    changes: ["status-changed"],
  });
  host.emit("thread:changed", {
    entity: "thread",
    id: "t2",
    changes: ["environment-changed"],
  });
  host.emit("environment:changed", {
    entity: "environment",
    id: "env1",
    changes: ["git-refs-changed"],
  });
  await settle();
  expect(host.get).toHaveBeenCalledTimes(1);

  host.emit("thread:changed", {
    entity: "thread",
    id: "t1",
    changes: ["environment-changed"],
  });
  await settle();
  expect(host.get).toHaveBeenCalledTimes(2);
  expect(markdown.renders.length).toBe(renders);

  host.setEnvironment({ id: "env2", path: "/work/next", hostId: "host1" });
  host.emit("thread:changed", {
    entity: "thread",
    id: "t1",
    changes: ["environment-changed"],
  });
  await settle();
  expect(documents(view.container)[0]).toContain('"rootPath":"/work/next"');
});

it("draws replies without a workspace when the first lookup does not answer, then takes it", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"], shouldAdvanceTime: true });
  try {
    const host = fakeSdk({ id: "env1", path: "/work/shop", hostId: "host1" });
    host.defer();
    const view = renderSlot(
      { component: () => <Blocks ids={["a"]} /> },
      {},
      { sdk: host.sdk },
    );
    await settle();
    expect(view.container.querySelector("[data-reply-block]")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(documents(view.container)).toEqual([null]);
    await act(async () => host.release());
    await settle();
    expect(documents(view.container)[0]).toContain('"rootPath":"/work/shop"');
  } finally {
    vi.useRealTimers();
  }
});
