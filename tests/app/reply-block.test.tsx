// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type {
  PluginAppBuilder,
  ExperimentalMessageBlockProps,
  ExperimentalMessageBlockRegistration,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { registerReplyBlock } from "../../src/app/reply/register.ts";
import {
  componentFence,
  COMPONENT_EXAMPLES,
  COMPOSED_SAMPLES,
} from "../../src/domain/replyExamples.ts";
import { blockInput } from "../domain/replyFixtures.ts";

vi.mock("@get-bb/plugin-sdk/app", async (importActual) => {
  const actual = await importActual<typeof import("@get-bb/plugin-sdk/app")>();
  const React = await import("react");
  const { default: ReactMarkdown } = await import("react-markdown");
  return {
    ...actual,
    Markdown: (props: React.ComponentProps<typeof actual.Markdown>) =>
      React.createElement(
        "div",
        { "data-document": JSON.stringify(props.experimental_document) },
        React.createElement(ReactMarkdown, {
          children: props.content,
          urlTransform: (url) => url,
        }),
      ),
  };
});
afterEach(cleanup);
const SDK = {
  threads: {
    get: async () => ({
      ...makeThreadResponse({ id: "t1", environmentId: "env1" }),
      environment: { id: "env1", path: "/work/shop", hostId: "host1" },
    }),
  },
};
const Original = () => <div data-original="">Host rendering</div>;
async function registration(): Promise<ExperimentalMessageBlockRegistration> {
  let reply: ExperimentalMessageBlockRegistration | null = null;
  registerReplyBlock({
    slots: {
      experimental_messageBlock: (
        value: ExperimentalMessageBlockRegistration,
      ) => {
        reply = value;
      },
    },
  } as unknown as PluginAppBuilder);
  if (!reply) throw Error("No reply registration");
  return reply;
}
function props(
  block: ExperimentalMessageBlockRegistration,
  message: string,
  streaming = false,
): ExperimentalMessageBlockProps {
  const input = blockInput(message, { streaming });
  const result = block.parse(input, { version: 1, status: input.status });
  return {
    data: result.ok ? result.data : null,
    error: result.ok ? null : result.error,
    status: input.status,
    source: message,
    message: { id: "m1", threadId: "t1", turnId: "turn1", projectId: "p1" },
    index: 0,
    Original,
  };
}
async function draw(
  message: string,
  options: {
    streaming?: boolean;
    docked?: { turnId: string; dismissed?: boolean };
  } = {},
) {
  const block = await registration();
  return renderSlot(block, props(block, message, options.streaming), {
    sdk: SDK,
    ...(options.docked
      ? {
          rpc: {
            state: () => ({
              recaps: { t1: { id: "r1", turnId: options.docked!.turnId } },
              dismissedRecaps: options.docked!.dismissed ? ["r1"] : [],
            }),
          },
        }
      : {}),
  });
}
const body = (
  component: (typeof COMPONENT_EXAMPLES)[keyof typeof COMPONENT_EXAMPLES],
) => `:::reply\n${componentFence(component)}\n:::\n`;

it("registers version 1 and a readable text view", async () => {
  const block = await registration();
  expect(block.versions).toEqual([1]);
  expect(block.toText({ body: [{ type: "text", body: "PASS" }] })).toBe("PASS");
});
it("preserves upstream registration without a message-block slot", async () => {
  expect(() =>
    registerReplyBlock({ slots: {} } as PluginAppBuilder),
  ).not.toThrow();
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  expect(app.composerCustomizations.map((c) => c.id)).toContain("recap");
});
it.each(Object.entries(COMPOSED_SAMPLES))(
  "renders the %s composition and full explanation",
  async (kind, message) => {
    const view = await draw(message, { docked: { turnId: "turn1" } });
    expect(
      view.container
        .querySelector("[data-reply-kind]")
        ?.getAttribute("data-reply-kind"),
    ).toBe(kind);
    expect(
      view.container.querySelectorAll("[data-reply-component]").length,
    ).toBeGreaterThan(0);
    expect(view.container.textContent).not.toContain("```workstreams");
    expect(
      view.container.querySelector("[data-reply-headline]")?.textContent,
    ).toBeTruthy();
    expect(view.container.querySelector("[data-reply-recap]")).toBeNull();
    expect(
      view.container.querySelector("[data-reply-block]")?.className,
    ).not.toMatch(/\bborder\b/);
  },
);
it("places shared context before the headline without shortening the explanation", async () => {
  const message = `:::reply{state="complete"}\n# Found the cause\n- [x] The caller and calculation use different units\n\nA full explanation before the context in the source.\n\n${componentFence(COMPONENT_EXAMPLES.context)}\n:::\n`;
  const view = await draw(message);
  await waitFor(() =>
    expect(
      view.container.querySelector("[data-reply-headline]"),
    ).not.toBeNull(),
  );
  expect(
    view.container
      .querySelector("[data-reply-block]")
      ?.firstElementChild?.getAttribute("data-reply-component"),
  ).toBe("context");
  expect(view.container.textContent).toContain(
    "A full explanation before the context in the source.",
  );
});

it("distinguishes a reported location from the current workspace used for links", async () => {
  const view = await draw(
    body({
      type: "context",
      topic: "Deployment review",
      where: "Production · canary",
      background: "The result concerns a deployment, not just the checkout.",
    }),
  );
  const workspace = await screen.findByRole("button", {
    name: "Show current workspace",
  });
  expect(view.container.textContent).not.toContain("/work/shop");
  expect(view.container.textContent).toContain(
    "Reported location: Production · canary",
  );
  fireEvent.click(workspace);
  expect(await screen.findByText("/work/shop")).toBeDefined();
});

it("keeps long prose and headings visible without a generated Details fold", async () => {
  const text = Array.from(
    { length: 8 },
    (_, i) =>
      `### Point ${i}\n\nSentence one. Sentence two. Sentence three. Sentence four.`,
  ).join("\n\n");
  const view = await draw(`:::reply\n${text}\n:::\n`);
  expect(view.container.querySelectorAll("h3")).toHaveLength(8);
  expect(view.container.textContent).toContain("Point 7");
  expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
});
it.each(["    ", "        ", "\t", "  \t"])(
  "keeps indented code literal after the article lead (%j)",
  async (indent) => {
    const view = await draw(
      `:::reply{state="complete"}\n# A code example\n\nAn introduction.\n\n${indent}git show abc1234\n:::\n`,
    );
    expect(view.container.querySelector("[data-reply-lead]")?.textContent).toBe(
      "An introduction.",
    );
    expect(view.container.querySelector("pre code")?.textContent).toContain(
      "git show abc1234",
    );
    expect(
      screen.queryByRole("button", { name: "Copy commit abc1234" }),
    ).toBeNull();
  },
);

it("keeps several supporting components beside one primary explanation", async () => {
  const view = await draw(
    body({
      type: "group",
      relationship: "supporting",
      children: [
        { type: "text", body: "The primary explanation stays together." },
        COMPONENT_EXAMPLES.finding as Extract<
          typeof COMPONENT_EXAMPLES.finding,
          { type: "finding" }
        >,
        COMPONENT_EXAMPLES.checks as Extract<
          typeof COMPONENT_EXAMPLES.checks,
          { type: "checks" }
        >,
      ],
    }),
  );
  const aside = screen.getByRole("complementary", {
    name: "Supporting information",
  });
  expect(aside.children).toHaveLength(2);
  expect(aside.textContent).toContain("The calculation subtracts cents");
  expect(aside.textContent).toContain("Local checks");
  expect(aside.textContent).not.toContain(
    "The primary explanation stays together",
  );
  expect(view.container.textContent).toContain(
    "The primary explanation stays together",
  );
});

it("keeps multiple primary components together beside supporting evidence", async () => {
  const view = await draw(
    body({
      type: "group",
      relationship: "supporting",
      children: [
        [
          { type: "text", body: "The primary explanation." },
          COMPONENT_EXAMPLES.sequence as Extract<
            typeof COMPONENT_EXAMPLES.sequence,
            { type: "sequence" }
          >,
        ],
        COMPONENT_EXAMPLES.finding as Extract<
          typeof COMPONENT_EXAMPLES.finding,
          { type: "finding" }
        >,
      ],
    }),
  );
  const group = view.container.querySelector("[data-relationship=supporting]")!;
  const primary = group.firstElementChild!;
  expect(primary.textContent).toContain("The primary explanation.");
  expect(
    primary.querySelector("[data-reply-component=sequence]"),
  ).not.toBeNull();
  const aside = screen.getByRole("complementary", {
    name: "Supporting information",
  });
  expect(aside.textContent).toContain("The calculation subtracts cents");
  expect(aside.textContent).not.toContain("The primary explanation.");
});

it("uses a local disclosure for explicitly supporting Markdown", async () => {
  const view = await draw(body(COMPONENT_EXAMPLES.details));
  const toggle = screen.getByRole("button", { name: "Supporting calculation" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(view.container.querySelector("pre")).toBeNull();
  fireEvent.click(toggle);
  expect(view.container.querySelector("pre code")?.textContent).toContain(
    "1000 * (10 / 100)",
  );
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
});
it("shows unresolved and skipped checks while passed checks are folded", async () => {
  const view = await draw(body(COMPONENT_EXAMPLES.checks));
  expect(view.container.textContent).toContain("Payment integration");
  expect(view.container.textContent).toContain("Skipped");
  expect(view.container.textContent).toContain("connection remains unverified");
  expect(screen.queryByText("Unit tests")).toBeNull();
  expect(screen.getByLabelText("Reported test totals").textContent).toContain(
    "22",
  );
  fireEvent.click(screen.getByRole("button", { name: "1 check passed" }));
  expect(screen.getByText("Unit tests")).toBeDefined();
});
it("renders comparison qualifications outside the optional detail", async () => {
  const view = await draw(body(COMPONENT_EXAMPLES.comparison));
  expect(view.container.textContent).toContain(
    "Requires checking and updating every caller",
  );
  expect(view.container.textContent).toContain(
    "Choose this only if callers already know",
  );
  expect(view.container.textContent).not.toContain("100-cent discount");
  fireEvent.click(
    screen.getByRole("button", { name: "Details: Change the caller contract" }),
  );
  expect(view.container.textContent).toContain("100-cent discount");
});
it("renders evidence as a workspace-aware link with code formatting", async () => {
  const view = await draw(body(COMPONENT_EXAMPLES.finding));
  await waitFor(() =>
    expect(
      view.container
        .querySelector("[data-document]")
        ?.getAttribute("data-document"),
    ).toContain("env1"),
  );
  const link = screen.getByRole("link", { name: "Calculation" });
  expect(link.getAttribute("href")).toContain("coupon.ts");
  fireEvent.click(link);
  expect(view.inspection.navigateCalls).toContainEqual({
    method: "experimental_openFilePreview",
    options: {
      target: {
        kind: "workspace",
        environmentId: "env1",
        path: "src/coupon.ts",
      },
      location: { kind: "range", startLine: 12, endLine: 16 },
    },
  });
  expect(view.container.querySelector("code")?.textContent).toBe("10");
});
it("opens an evidence file with spaces outside the workspace through the host", async () => {
  const component = {
    ...COMPONENT_EXAMPLES.finding,
    evidence: [
      {
        label: "Rendering notes",
        location: "/tmp/Rendered Notes.md",
        line: 2,
        endLine: 4,
      },
    ],
  };
  const view = await draw(body(component));
  const link = await screen.findByRole("link", { name: "Rendering notes" });
  expect(link.getAttribute("href")).toContain("Rendered%20Notes.md");
  fireEvent.click(link);
  expect(view.inspection.navigateCalls).toContainEqual({
    method: "experimental_openFilePreview",
    options: {
      target: { kind: "host", hostId: "host1", path: "/tmp/Rendered Notes.md" },
      location: { kind: "range", startLine: 2, endLine: 4 },
    },
  });
});

it("preserves reserved characters in an evidence filename", async () => {
  const component = {
    ...COMPONENT_EXAMPLES.finding,
    evidence: [
      { label: "Literal filename", location: "/tmp/Review #draft? 100%.md" },
    ],
  };
  const view = await draw(body(component));
  const link = await screen.findByRole("link", { name: "Literal filename" });
  expect(link.getAttribute("href")).toContain("%23draft%3F%20100%25.md");
  fireEvent.click(link);
  expect(view.inspection.navigateCalls).toContainEqual({
    method: "experimental_openFilePreview",
    options: {
      target: {
        kind: "host",
        hostId: "host1",
        path: "/tmp/Review #draft? 100%.md",
      },
      location: null,
    },
  });
});

it("opens a Markdown file URL through the public file-preview API", async () => {
  const view = await draw(
    ":::reply\n[Notes](file:///tmp/Notes%20File.md#L3)\n:::\n",
  );
  await waitFor(() =>
    expect(
      view.container
        .querySelector("[data-document]")
        ?.getAttribute("data-document"),
    ).toContain("env1"),
  );
  const link = screen.getByRole("link", { name: "Notes" });
  expect(link.getAttribute("href")).toBe("file:///tmp/Notes%20File.md#L3");
  fireEvent.click(link);
  expect(view.inspection.navigateCalls).toContainEqual({
    method: "experimental_openFilePreview",
    options: {
      target: { kind: "host", hostId: "host1", path: "/tmp/Notes File.md" },
      location: { kind: "range", startLine: 3, endLine: 3 },
    },
  });
});

it("keeps malformed component source visible alongside readable prose", async () => {
  const view = await draw(
    ':::reply\nBefore.\n\n```workstreams\n{"type":"does-not-exist"}\n```\n\nAfter.\n:::\n',
  );
  expect(view.container.textContent).toContain("Before.");
  expect(view.container.textContent).toContain("After.");
  expect(view.container.querySelector("pre")?.textContent).toContain(
    '"does-not-exist"',
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Component not displayed",
  );
});
it("defers a partial component without hiding the explanation", async () => {
  const view = await draw(
    ':::reply\nExplanation.\n\n```workstreams\n{"type":"finding"',
    { streaming: true },
  );
  expect(view.container.textContent).toContain("Explanation.");
  expect(screen.getByRole("status").textContent).toBe("Receiving information…");
  expect(view.container.querySelector("pre")).toBeNull();
});
it("uses host rendering for an unclosed reply", async () => {
  const view = await draw(":::reply\nUnfinished reply");
  expect(view.container.querySelector("[data-original]")).not.toBeNull();
  expect(view.container.querySelector("[data-reply-block]")).toBeNull();
});
it("does not mark an unchecked reported result as completed", async () => {
  const view = await draw(
    ':::reply{state="review"}\n# The change awaits a push\n- [ ] Push the branch\n\n### Review\n- Inspect the diff\n:::\n',
  );
  expect(view.container.querySelector("[data-reply-results]")).toBeNull();
  expect(screen.getByRole("heading", { name: "Not done" })).toBeDefined();
  expect(view.container.textContent).toContain("Push the branch");
});

it("draws card fields for past turns, with no duplicate send actions", async () => {
  const view = await draw(COMPOSED_SAMPLES.change);
  await waitFor(() =>
    expect(view.container.querySelector("[data-reply-recap]")).not.toBeNull(),
  );
  expect(
    view.container.querySelector("[data-reply-results]")?.textContent,
  ).toContain("whole percentages");
  const article = view.container.querySelector("[data-reply-block]")!;
  expect(article.lastElementChild?.hasAttribute("data-reply-recap")).toBe(true);
  expect(view.container.textContent).not.toContain("Check callers");
  expect(screen.getByRole("heading", { name: "Review" })).toBeDefined();
});
it("shows card fields after dismissal or when another turn owns the docked recap", async () => {
  for (const docked of [
    { turnId: "turn1", dismissed: true },
    { turnId: "turn2" },
  ]) {
    const view = await draw(COMPOSED_SAMPLES.change, { docked });
    await waitFor(() =>
      expect(
        view.container.querySelector("[data-reply-headline]"),
      ).not.toBeNull(),
    );
    view.lifecycle.unmount();
  }
});
it("does not duplicate a headline-only answer while its card is docked", async () => {
  const view = await draw(
    ':::reply{state="complete"}\n# Python 3.9 or newer\n:::\n',
    { docked: { turnId: "turn1" } },
  );
  await waitFor(() =>
    expect(view.container.querySelector("[data-reply-block]")).toBeNull(),
  );
});
it("keeps the last good parse during a malformed streaming update", async () => {
  const block = await registration(),
    base = props(block, ":::reply\nAn explanation.\n", true);
  const view = renderSlot(block, base, { sdk: SDK });
  view.lifecycle.rerender(
    <block.component {...base} data={null} error="pending" />,
  );
  expect(view.container.textContent).toContain("An explanation.");
  view.lifecycle.rerender(
    <block.component {...base} data={null} error="bad" status="closed" />,
  );
  expect(view.container.querySelector("[data-reply-block]")).toBeNull();
});
it("draws the docked layout while the server state is still unknown", async () => {
  const block = await registration();
  let resolve!: (value: unknown) => void;
  const view = renderSlot(block, props(block, COMPOSED_SAMPLES.change), {
    sdk: SDK,
    rpc: {
      state: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  });
  expect(
    view.container.querySelector("[data-reply-headline]")?.textContent,
  ).toContain("coupon applies");
  expect(view.container.querySelector("[data-reply-recap]")).toBeNull();
  expect(view.container.textContent).toContain("caller contract unchanged");
  resolve({ recaps: {}, dismissedRecaps: [] });
  await waitFor(() =>
    expect(view.container.querySelector("[data-reply-recap]")).not.toBeNull(),
  );
});
