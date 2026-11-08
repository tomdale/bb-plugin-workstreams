// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionAnchor } from "../../../src/app/question/QuestionCard.tsx";

const anchorRefs = vi.hoisted(() => {
  const calls: (HTMLElement | null)[] = [];
  const wrappers = new WeakMap<Function, Function>();
  const wrapProps = (value: unknown) => {
    if (!value || typeof value !== "object") return value;
    const props = value as { className?: unknown; ref?: unknown };
    if (props.className !== "contents" || typeof props.ref !== "function")
      return props;
    const original = props.ref as (
      node: HTMLElement | null,
    ) => void | (() => void);
    let wrapped = wrappers.get(original);
    if (!wrapped) {
      wrapped = (node: HTMLElement | null) => {
        calls.push(node);
        const cleanup = original(node);
        if (typeof cleanup === "function")
          return () => {
            calls.push(null);
            cleanup();
          };
      };
      wrappers.set(original, wrapped);
    }
    return { ...props, ref: wrapped };
  };
  return { calls, wrapProps };
});

// Count callback-ref attachments and cleanups while preserving each ref
// identity. A fresh wrapper would itself force React to detach and reattach an
// otherwise stable callback, so the wrappers are cached by the original ref.
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const instrument = <T extends typeof actual.jsx>(render: T) =>
    new Proxy(render, {
      apply(target, receiver, args) {
        args[1] = anchorRefs.wrapProps(args[1]);
        return Reflect.apply(target, receiver, args);
      },
    });
  return {
    ...actual,
    jsx: instrument(actual.jsx),
    jsxs: instrument(actual.jsxs),
  };
});

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return {
    ...actual,
    jsxDEV: new Proxy(actual.jsxDEV, {
      apply(target, receiver, args) {
        args[1] = anchorRefs.wrapProps(args[1]);
        return Reflect.apply(target, receiver, args);
      },
    }),
  };
});

beforeEach(() => {
  anchorRefs.calls.length = 0;
});
afterEach(cleanup);

function mountAnchor() {
  return renderSlot(
    { component: QuestionAnchor },
    {},
    {
      composer: {
        scope: { kind: "thread", threadId: "thr_first" },
        text: "draft",
      },
      rpc: { question_pending: () => null },
    },
  );
}

it("keeps the question anchor ref settled across 60 composer drafts", async () => {
  const view = mountAnchor();
  await waitFor(() =>
    expect(
      view.inspection.rpcCalls.some(
        (call) => call.method === "question_pending",
      ),
    ).toBe(true),
  );
  anchorRefs.calls.length = 0;
  for (let draft = 0; draft < 60; draft++)
    await view.behavior.setComposerText(`draft ${draft}`);
  const cleanups = anchorRefs.calls.filter((node) => node === null).length;
  const attachments = anchorRefs.calls.length - cleanups;
  console.log(
    `PERF question-anchor-60-drafts ${JSON.stringify({ cleanups, attachments })}`,
  );
  expect(anchorRefs.calls).toHaveLength(0);
});

it("cleans up the old thread anchor and attaches the new thread once", async () => {
  const view = mountAnchor();
  await waitFor(() =>
    expect(
      view.inspection.rpcCalls.some(
        (call) => call.method === "question_pending",
      ),
    ).toBe(true),
  );
  anchorRefs.calls.length = 0;
  await view.behavior.setComposerScope({
    kind: "thread",
    threadId: "thr_second",
  });
  expect(anchorRefs.calls).toHaveLength(2);
  expect(anchorRefs.calls[0]).toBeNull();
  expect(anchorRefs.calls[1]).toBeInstanceOf(HTMLElement);

  anchorRefs.calls.length = 0;
  view.lifecycle.unmount();
  expect(anchorRefs.calls).toEqual([null]);
});
