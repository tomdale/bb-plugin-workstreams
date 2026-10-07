// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type {
  PluginAppBuilder,
  PluginMessageBlockProps,
  PluginMessageBlockRegistration,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { registerReplyBlock } from "../../src/app/reply/register.ts";
import { blockInput } from "../domain/replyFixtures.ts";
import { REPLY_SAMPLES } from "../domain/replySamples.ts";

afterEach(cleanup);

async function registration(): Promise<PluginMessageBlockRegistration> {
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  const reply = app.messageBlocks.find((block) => block.name === "reply");
  if (!reply) throw new Error("reply block not registered");
  return reply;
}

async function draw(message: string, options?: { streaming?: boolean }) {
  const block = await registration();
  const { status, source, tree } = blockInput(message, options);
  const result = block.parse(
    { attributes: {}, source, tree },
    { version: 1, status },
  );
  const props: PluginMessageBlockProps = {
    data: result.ok ? result.data : null,
    error: result.ok ? null : result.error,
    status,
    source: message,
    message: {
      id: "m1",
      threadId: "t1",
      turnId: "turn1",
      role: "assistant",
    } as unknown as PluginMessageBlockProps["message"],
    index: 0,
  };
  return renderSlot(block, props);
}

const sample = (kind: string) =>
  REPLY_SAMPLES.find((entry) => entry.kind === kind)!.message;

it("registers the reply block for version 1", async () => {
  const block = await registration();
  expect(block.versions).toEqual([1]);
  expect(block.toText({ lead: "PASS", sections: [] })).toBe("PASS");
});

it("registers nothing on a bb without message blocks", () => {
  const app = { slots: {} } as unknown as PluginAppBuilder;
  expect(() => registerReplyBlock(app)).not.toThrow();
});

it("draws the lead, quiet labels, and drawn markers instead of checkboxes", async () => {
  const view = await draw(sample("blocked"));
  const root = view.container.querySelector("[data-reply-block]")!;
  expect(root.textContent).toContain("The live test stops with");
  expect(
    [...root.querySelectorAll("h3")].map((heading) => heading.textContent),
  ).toEqual(["Done", "Not done", "Needs you", "Next"]);
  expect(root.querySelector('[data-reply-item="Done"]')?.textContent).toBe(
    "Done: Wrote down which token the live test needs",
  );
  expect(root.querySelector('[data-reply-item="Not done"]')).not.toBeNull();
  expect(root.querySelector('input[type="checkbox"]')).toBeNull();
  expect(root.textContent).not.toContain("[x]");
  expect(root.textContent).not.toContain(":::");
  expect(root.className).not.toMatch(/border/);
});

it("keeps Details folded until opened", async () => {
  const view = await draw(sample("finished work"));
  const toggle = screen.getByRole("button", { name: "Details" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(view.container.textContent).not.toContain("temporary worktrees");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(view.container.textContent).toContain(
    "I removed both temporary worktrees",
  );
});

it("draws a one-line answer as the lead alone", async () => {
  const view = await draw(sample("one-line answer"));
  const root = view.container.querySelector("[data-reply-block]")!;
  expect(root.textContent).toBe("PASS");
  expect(root.querySelector("h3")).toBeNull();
});

it("shows the sections that have arrived while streaming", async () => {
  const view = await draw(
    ":::reply\nTests pass.\n\n### Checked\n22 tests\n\n### Ne",
    { streaming: true },
  );
  const labels = [...view.container.querySelectorAll("h3")].map(
    (heading) => heading.textContent,
  );
  expect(labels).toEqual(["Checked", "Ne"]);
});

it("draws nothing when a streaming parse has no data yet", async () => {
  const block = await registration();
  const view = renderSlot(block, {
    data: null,
    error: "not yet",
    status: "streaming",
    source: ":::reply\n",
    message: {} as PluginMessageBlockProps["message"],
    index: 0,
  });
  expect(view.container.querySelector("[data-reply-block]")).toBeNull();
});
