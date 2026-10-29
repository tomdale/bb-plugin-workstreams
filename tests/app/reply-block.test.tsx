// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type {
  PluginAppBuilder,
  ExperimentalMessageBlockProps,
  ExperimentalMessageBlockRegistration,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { registerReplyBlock } from "../../src/app/reply/register.ts";
import { blockInput } from "../domain/replyFixtures.ts";
import { REPLY_SAMPLES } from "../domain/replySamples.ts";

afterEach(cleanup);

/** Stands in for bb's own rendering of the block. */
const Original = () => <div data-original="">bb's rendering</div>;

async function registration(): Promise<ExperimentalMessageBlockRegistration> {
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
  const props: ExperimentalMessageBlockProps = {
    data: result.ok ? result.data : null,
    error: result.ok ? null : result.error,
    status,
    source: message,
    message: {
      id: "m1",
      threadId: "t1",
      turnId: "turn1",
      role: "assistant",
    } as unknown as ExperimentalMessageBlockProps["message"],
    index: 0,
    Original,
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
  const view = await draw(":::reply\nPASS\n:::\n");
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
    message: {} as ExperimentalMessageBlockProps["message"],
    index: 0,
    Original,
  });
  expect(view.container.querySelector("[data-reply-block]")).toBeNull();
});

it("shows bb's own rendering when the reply ended without its closing line", async () => {
  const view = await draw(":::reply\nTests pass.\n\n### Checked\n22 tests\n");
  expect(view.container.querySelector("[data-original]")).not.toBeNull();
  expect(view.container.querySelector("[data-reply-block]")).toBeNull();
});

it("draws a code block inside a section", async () => {
  const view = await draw(
    [
      ":::reply",
      "The config now sets a timeout.",
      "",
      "### Checked",
      "```ts",
      "### not a heading",
      "export const timeout = 30;",
      "```",
      "",
      "### Next",
      "- Restart the server",
      ":::",
    ].join("\n"),
  );
  const root = view.container.querySelector("[data-reply-block]")!;
  expect(
    [...root.querySelectorAll("h3")].map((heading) => heading.textContent),
  ).toEqual(["Checked", "Next"]);
  // The section goes to bb's Markdown whole, fence included.
  const checked = root.querySelector('[data-reply-section="Checked"]')!;
  expect(
    checked.querySelector('[data-testid="bb-markdown"]')?.textContent,
  ).toBe("```ts\n### not a heading\nexport const timeout = 30;\n```");
});

it("draws a streaming reply through to closed without showing bb's rendering", async () => {
  const block = await registration();
  const full = ":::reply\nTests pass.\n\n### Checked\n22 tests\n:::\n";
  const props = (message: string, status: "streaming" | "closed") => {
    const { source, tree } = blockInput(message, {
      streaming: status === "streaming",
    });
    const result = block.parse(
      { attributes: {}, source, tree },
      { version: 1, status },
    );
    return {
      data: result.ok ? result.data : null,
      error: result.ok ? null : result.error,
      status,
      source: message,
      message: {} as ExperimentalMessageBlockProps["message"],
      index: 0,
      Original,
    };
  };
  const view = renderSlot(block, props(":::reply\nTests pass.\n", "streaming"));
  const steps = [
    props(":::reply\nTests pass.\n\n### Checked\n22", "streaming"),
    props(full, "closed"),
  ];
  for (const next of steps) {
    view.lifecycle.rerender(<block.component {...next} />);
    expect(view.container.querySelector("[data-original]")).toBeNull();
    expect(view.container.querySelector("[data-reply-block]")).not.toBeNull();
  }
});
