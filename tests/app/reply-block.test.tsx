// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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

async function draw(
  message: string,
  options?: {
    streaming?: boolean;
    docked?: { turnId: string; dismissed?: boolean };
  },
) {
  const block = await registration();
  const { status, source, tree, attributes } = blockInput(message, options);
  const result = block.parse(
    { attributes, source, tree },
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
  const docked = options?.docked;
  return renderSlot(
    block,
    props,
    docked
      ? {
          rpc: {
            state: () => ({
              recaps: { t1: { id: "r1", turnId: docked.turnId } },
              dismissedRecaps: docked.dismissed ? ["r1"] : [],
            }),
          },
        }
      : undefined,
  );
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

it("starts a block with no lead at its first section, with no gap above", async () => {
  const view = await draw(sample("finished work"));
  const root = view.container.querySelector("[data-reply-block]")!;
  const first = root.firstElementChild!;
  expect(first.getAttribute("data-reply-section")).toBe("Checked");
  expect(first.className).toContain("first:mt-0");
});

const CARD = `:::reply{state="review"}
# Fixed the percent coupon math
- [x] \`apply_percent_coupon\` applies a percentage

### Checked
Ran \`python3 -m unittest\` locally.

### Review
- Run the cart tests

### Next
- Push the fix: Push the coupon fix
:::
`;

it("draws a past turn's card fields in the block, without next actions", async () => {
  const view = await draw(CARD);
  await waitFor(() =>
    expect(
      view.container.querySelector("[data-reply-headline]"),
    ).not.toBeNull(),
  );
  const root = view.container.querySelector("[data-reply-block]")!;
  expect(root.querySelector("[data-reply-headline]")?.textContent).toBe(
    "Fixed the percent coupon math",
  );
  expect(
    root.querySelector('[data-reply-results] [data-reply-item="Done"]')
      ?.textContent,
  ).toContain("applies a percentage");
  expect(
    [...root.querySelectorAll("h3")].map((heading) => heading.textContent),
  ).toEqual(["Review", "Checked"]);
  expect(root.textContent).not.toContain("Push the fix");
});

it("leaves the card fields to the docked card for its own turn", async () => {
  const view = await draw(CARD, { docked: { turnId: "turn1" } });
  await waitFor(() =>
    expect(
      view.container
        .querySelector("[data-reply-block]")
        ?.getAttribute("data-reply-docked"),
    ).toBe(""),
  );
  const root = view.container.querySelector("[data-reply-block]")!;
  expect(root.querySelector("[data-reply-headline]")).toBeNull();
  expect(root.querySelector("[data-reply-results]")).toBeNull();
  expect(
    [...root.querySelectorAll("h3")].map((heading) => heading.textContent),
  ).toEqual(["Checked"]);
});

it("shows the card fields again once the card is dismissed or belongs to another turn", async () => {
  for (const docked of [
    { turnId: "turn1", dismissed: true },
    { turnId: "turn2" },
  ]) {
    const view = await draw(CARD, { docked });
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-reply-headline]"),
      ).not.toBeNull(),
    );
    view.lifecycle.unmount();
  }
});

it("draws nothing for a short answer while its card is docked", async () => {
  const short = ':::reply{state="complete"}\n# Python 3.9 or newer\n:::\n';
  const shown = await draw(short);
  await waitFor(() =>
    expect(
      shown.container.querySelector("[data-reply-headline]")?.textContent,
    ).toBe("Python 3.9 or newer"),
  );
  shown.lifecycle.unmount();
  const view = await draw(short, { docked: { turnId: "turn1" } });
  await waitFor(() =>
    expect(view.container.querySelector("[data-reply-block]")).toBeNull(),
  );
});

it("draws the docked layout until the docked state is known, so card fields never flash", async () => {
  let answer: (value: unknown) => void = () => {};
  const block = await registration();
  const { status, source, tree, attributes } = blockInput(CARD);
  const result = block.parse(
    { attributes, source, tree },
    { version: 1, status },
  );
  const view = renderSlot(
    block,
    {
      data: result.ok ? result.data : null,
      error: null,
      status,
      source: CARD,
      message: {
        id: "m1",
        threadId: "t1",
        turnId: "turn1",
      } as unknown as ExperimentalMessageBlockProps["message"],
      index: 0,
      Original,
    },
    {
      rpc: {
        state: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
    },
  );
  const root = () => view.container.querySelector("[data-reply-block]")!;
  expect(root().getAttribute("data-reply-docked")).toBe("pending");
  expect(root().querySelector("[data-reply-headline]")).toBeNull();
  expect(root().textContent).toContain("Ran");
  answer({ recaps: {}, dismissedRecaps: [] });
  await waitFor(() =>
    expect(root().querySelector("[data-reply-headline]")).not.toBeNull(),
  );
});

it("keeps the last good reply while a streaming update fails to parse", async () => {
  const block = await registration();
  const message = {
    id: "m1",
    threadId: "t1",
    turnId: "turn1",
  } as unknown as ExperimentalMessageBlockProps["message"];
  const good = blockInput(":::reply\nTests pass.\n\n### Checked\n22 tests\n", {
    streaming: true,
  });
  const parsed = block.parse(
    { attributes: {}, source: good.source, tree: good.tree },
    { version: 1, status: "streaming" },
  );
  const base = {
    source: "",
    message,
    index: 0,
    Original,
  };
  const view = renderSlot(block, {
    ...base,
    data: parsed.ok ? parsed.data : null,
    error: null,
    status: "streaming" as const,
  });
  const text = () =>
    view.container.querySelector("[data-reply-block]")?.textContent;
  expect(text()).toContain("22 tests");
  for (const next of [
    { data: null, error: "not yet" },
    { data: { not: "a reply" }, error: null },
  ]) {
    view.lifecycle.rerender(
      <block.component {...base} {...next} status="streaming" />,
    );
    expect(text()).toContain("22 tests");
  }
  // Once closed, only the fresh parse counts.
  view.lifecycle.rerender(
    <block.component
      {...base}
      data={{ not: "a reply" }}
      error={null}
      status="closed"
    />,
  );
  expect(view.container.querySelector("[data-reply-block]")).toBeNull();
});

it("fades in a section that arrives mid-stream, and keeps existing ones in place", async () => {
  const block = await registration();
  const message = {
    id: "m1",
    threadId: "t1",
    turnId: "turn1",
  } as unknown as ExperimentalMessageBlockProps["message"];
  const props = (text: string, status: "streaming" | "closed") => {
    const input = blockInput(text, { streaming: status === "streaming" });
    const parsed = block.parse(
      { attributes: {}, source: input.source, tree: input.tree },
      { version: 1, status },
    );
    return {
      data: parsed.ok ? parsed.data : null,
      error: null,
      status,
      source: text,
      message,
      index: 0,
      Original,
    };
  };
  const view = renderSlot(
    block,
    props(":::reply\nLead.\n\n### Checked\n22 tests\n", "closed"),
  );
  const first = view.container.querySelector('[data-reply-section="Checked"]')!;
  expect(first.className).not.toContain("ws-reply-enter");
  view.lifecycle.rerender(
    <block.component
      {...props(
        ":::reply\nLead.\n\n### Checked\n22 tests\n\n### Ne",
        "streaming",
      )}
    />,
  );
  view.lifecycle.rerender(
    <block.component
      {...props(
        ":::reply\nLead.\n\n### Checked\n22 tests\n\n### Next\nShip",
        "streaming",
      )}
    />,
  );
  // The same node, not remounted, and the new one fading in.
  expect(view.container.querySelector('[data-reply-section="Checked"]')).toBe(
    first,
  );
  const added = view.container.querySelector('[data-reply-section="Next"]')!;
  expect(added.className).toContain("ws-reply-enter");
});

it("draws a block without state that holds only a headline as a plain headline", async () => {
  const view = await draw(
    ":::reply\n# No. The `shop` package declares no third-party dependencies\n:::\n",
    { docked: { turnId: "turn1" } },
  );
  const root = view.container.querySelector("[data-reply-block]")!;
  expect(root.querySelector("[data-reply-headline]")?.textContent).toBe(
    "No. The `shop` package declares no third-party dependencies",
  );
  // No card, so a docked card for the turn hides nothing.
  expect(root.hasAttribute("data-reply-docked")).toBe(false);
});
