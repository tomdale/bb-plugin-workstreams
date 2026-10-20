// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ReplyBlock } from "../../src/app/reply/ReplyBlock.tsx";
import {
  registerReplyBlock,
  replyBlocksDrawn,
  type CodeFenceProps,
  type CodeFenceStatus,
} from "../../src/app/reply/register.ts";
import { REPLY_SAMPLES } from "../domain/replySamples.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Original() {
  return <pre data-original="">bb code block</pre>;
}

const props = (code: string, status: CodeFenceStatus): CodeFenceProps => ({
  code,
  status,
  language: "reply",
  index: 0,
  message: { id: "m1", threadId: "t1", turnId: "turn1", projectId: null },
  Original,
});

const draw = (code: string, status: CodeFenceStatus = "closed") =>
  renderSlot({ component: ReplyBlock }, props(code, status));

const sample = (kind: string) =>
  REPLY_SAMPLES.find((entry) => entry.kind === kind)!.body;

const labels = (root: ParentNode) =>
  [...root.querySelectorAll("h3")].map((heading) => heading.textContent);

it("claims the reply fence language when the slot exists", () => {
  const register = vi.fn();
  registerReplyBlock({
    slots: { experimental_codeFenceRenderer: register },
  } as unknown as PluginAppBuilder);
  expect(register).toHaveBeenCalledWith({
    id: "reply",
    languages: ["reply"],
    component: ReplyBlock,
  });
  expect(replyBlocksDrawn()).toBe(true);
});

it("registers nothing on a bb without the slot", () => {
  const app = { slots: {} } as unknown as PluginAppBuilder;
  expect(() => registerReplyBlock(app)).not.toThrow();
});

it("draws the lead, quiet labels, and drawn markers instead of checkboxes", () => {
  const view = draw(sample("blocked"));
  const root = view.container.querySelector("[data-reply-block]")!;
  expect(root.textContent).toContain("The live test stops with");
  expect(labels(root)).toEqual(["Done", "Not done", "Needs you", "Next"]);
  expect(root.querySelector('[data-reply-item="Done"]')?.textContent).toBe(
    "Done: Wrote down which token the live test needs",
  );
  expect(root.querySelector('[data-reply-item="Not done"]')).not.toBeNull();
  expect(root.querySelector('input[type="checkbox"]')).toBeNull();
  expect(root.querySelector("ul ul, li > ul")).toBeNull();
  expect(root.textContent).not.toContain("[x]");
  expect(root.textContent).not.toContain("###");
  expect(root.className).not.toMatch(/border/);
});

it("draws an inner code block inside its section", () => {
  const view = draw(sample("with code"));
  const root = view.container.querySelector("[data-reply-block]")!;
  expect(labels(root)).toEqual(["Done", "How to run"]);
  expect(
    root.querySelector('[data-reply-section="How to run"]')?.textContent,
  ).toContain("npm run check -- --all");
});

it("keeps Details folded until opened", () => {
  const view = draw(sample("finished work"));
  const toggle = screen.getByRole("button", { name: "Details" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(view.container.textContent).not.toContain("temporary worktrees");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(view.container.textContent).toContain(
    "I removed both temporary worktrees",
  );
});

it("draws a one-line answer as the lead alone", () => {
  const view = draw(sample("one-line answer"));
  const root = view.container.querySelector("[data-reply-block]")!;
  expect(root.textContent).toBe("PASS");
  expect(root.querySelector("h3")).toBeNull();
});

it("shows the sections that have arrived while streaming", () => {
  const view = draw(
    "Tests pass.\n\n### Checked\n22 tests\n\n### Ne",
    "streaming",
  );
  expect(labels(view.container)).toEqual(["Checked", "Ne"]);
});

it("shows bb's code block for a body that does not read as a reply", () => {
  const view = draw("### Checked\nNo lead.");
  expect(view.container.querySelector("[data-original]")).not.toBeNull();
  expect(view.container.querySelector("[data-reply-block]")).toBeNull();
});

it("shows bb's code block at once for a fence first seen unclosed", () => {
  const view = draw(sample("blocked"), "unclosed");
  expect(view.container.querySelector("[data-original]")).not.toBeNull();
});

it("rides out a brief unclosed at the end of a stream", () => {
  vi.useFakeTimers();
  const body = sample("blocked");
  const update = (view: ReturnType<typeof draw>, status: CodeFenceStatus) =>
    act(() => {
      view.lifecycle.rerender(<ReplyBlock {...props(body, status)} />);
    });
  const replyStatus = (view: ReturnType<typeof draw>) =>
    view.container
      .querySelector("[data-reply-block]")
      ?.getAttribute("data-reply-status");

  const ends = draw(body, "streaming");
  update(ends, "unclosed");
  expect(replyStatus(ends)).toBe("streaming");
  update(ends, "closed");
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(replyStatus(ends)).toBe("closed");
  ends.lifecycle.unmount();

  const stuck = draw(body, "streaming");
  update(stuck, "unclosed");
  expect(replyStatus(stuck)).toBe("streaming");
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(stuck.container.querySelector("[data-original]")).not.toBeNull();
});
