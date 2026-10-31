// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import type {
  PluginAppBuilder,
  ExperimentalMessageBlockRegistration,
} from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { registerReplyBlock } from "../../src/app/reply/register.ts";
import { componentFence } from "../../src/domain/replyExamples.ts";
import { blockInput } from "../domain/replyFixtures.ts";

vi.mock("@get-bb/plugin-sdk/app", async (importActual) => {
  const actual = await importActual<typeof import("@get-bb/plugin-sdk/app")>();
  const React = await import("react");
  const { default: ReactMarkdown } = await import("react-markdown");
  return {
    ...actual,
    Markdown: (props: React.ComponentProps<typeof actual.Markdown>) =>
      React.createElement(ReactMarkdown, { children: props.content }),
  };
});
afterEach(cleanup);

const source = `:::reply{state="complete" kind="investigation"}
# The calculation treats percentages as cents
- [x] The supplied percentage is subtracted without conversion

${componentFence({ type: "context", topic: "Discount calculation", background: "An illustrative investigation." })}

The caller supplies a whole percentage, not a monetary amount.

The expression subtracts ten cents instead of one hundred cents. The full explanation stays visible.

${componentFence({ type: "finding", title: "The units differ", explanation: "The amount is in cents; the supplied discount is a percentage.", certainty: "unknown", consequence: "Check the other callers before changing the contract.", evidence: [{ label: "Caller fixture", detail: "The illustrative fixture pairs 10 with ten percent." }] })}
:::`;

function draw(docked?: { turnId: string; dismissed?: boolean }) {
  let block!: ExperimentalMessageBlockRegistration;
  registerReplyBlock({
    slots: {
      experimental_messageBlock: (
        value: ExperimentalMessageBlockRegistration,
      ) => {
        block = value;
      },
    },
  } as unknown as PluginAppBuilder);
  const input = blockInput(source),
    result = block.parse(input, { version: 1, status: input.status });
  return renderSlot(
    block,
    {
      data: result.ok ? result.data : null,
      source,
      status: input.status,
      error: null,
      message: { id: "m1", threadId: "t1", turnId: "turn1", projectId: "p1" },
      index: 0,
      Original: () => null,
    },
    {
      sdk: { threads: { get: async () => makeThreadResponse({ id: "t1" }) } },
      rpc: {
        state: () => ({
          recaps: docked ? { t1: { id: "r1", turnId: docked.turnId } } : {},
          dismissedRecaps: docked?.dismissed ? ["r1"] : [],
        }),
      },
    },
  );
}

it.each([
  ["docked", { turnId: "turn1" }, false],
  ["historical", { turnId: "another-turn" }, true],
  ["dismissed", { turnId: "turn1", dismissed: true }, true],
  ["no stored recap", undefined, true],
] as const)(
  "keeps the answer and explanation in the %s article",
  async (_name, docked, footer) => {
    const view = draw(docked);
    expect(
      screen.getByRole("heading", {
        name: "The calculation treats percentages as cents",
        level: 2,
      }),
    ).toBeDefined();
    expect(
      view.container.querySelectorAll("[data-reply-headline]"),
    ).toHaveLength(1);
    expect(view.container.querySelector("[data-reply-lead]")?.textContent).toBe(
      "The caller supplies a whole percentage, not a monetary amount.",
    );
    expect(view.container.textContent).toContain(
      "The full explanation stays visible.",
    );
    expect(view.container.textContent).toContain(
      "Check the other callers before changing the contract.",
    );
    expect(screen.getByText("Caller fixture")).toBeDefined();
    await waitFor(() =>
      expect(Boolean(view.container.querySelector("[data-reply-recap]"))).toBe(
        footer,
      ),
    );
    if (footer)
      expect(
        view.container
          .querySelector("[data-reply-block]")
          ?.lastElementChild?.hasAttribute("data-reply-recap"),
      ).toBe(true);
  },
);

it("labels the work state without inferring an established cause", () => {
  const view = draw({ turnId: "turn1" });
  const cue = view.container.querySelector("[data-reply-cue]");
  expect(cue?.textContent).toBe("Investigation·Complete");
  expect(cue?.textContent).not.toMatch(/cause identified|deployed|verified/i);
  expect(view.container.textContent).toContain("Not established");
});
