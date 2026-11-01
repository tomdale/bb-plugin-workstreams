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
        {
          "data-document": JSON.stringify(props.experimental_document),
          "data-markdown": props.content,
        },
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
function registration(): ExperimentalMessageBlockRegistration {
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
function draw(
  message: string,
  options: {
    streaming?: boolean;
    docked?: { turnId: string; dismissed?: boolean };
  } = {},
) {
  const block = registration();
  return renderSlot(block, props(block, message, options.streaming), {
    sdk: SDK,
    openFilePreview: () => true,
    rpc: {
      state: () => ({
        recaps: options.docked
          ? { t1: { id: "r1", turnId: options.docked.turnId } }
          : {},
        dismissedRecaps: options.docked?.dismissed ? ["r1"] : [],
      }),
    },
  });
}
const body = (
  component: (typeof COMPONENT_EXAMPLES)[keyof typeof COMPONENT_EXAMPLES],
) => `:::reply\n${componentFence(component)}\n:::\n`;

const finding = COMPONENT_EXAMPLES.finding as Extract<
  typeof COMPONENT_EXAMPLES.finding,
  { type: "finding" }
>;

it("renders directives with message context while prose keeps workspace routing", async () => {
  const directive =
    '::inline-vis{source="thread-storage" file="sidebar-section-labels.html"}';
  const view = draw(`:::reply\nBefore.\n\n${directive}\n\nAfter.\n:::\n`);
  await waitFor(() => {
    const prose = view.container.querySelector('[data-markdown="Before."]');
    expect(JSON.parse(prose!.getAttribute("data-document")!)).toMatchObject({
      threadId: "t1",
      rootPath: "/work/shop",
    });
  });
  const markdown = [...view.container.querySelectorAll("[data-markdown]")];
  expect(markdown.map((node) => node.getAttribute("data-markdown"))).toEqual([
    "Before.",
    directive,
    "After.",
  ]);
  expect(markdown[1]!.hasAttribute("data-document")).toBe(false);
  expect(markdown[2]!.hasAttribute("data-document")).toBe(true);
});

it("registers version 1 and the existing readable text view", () => {
  const block = registration();
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
it.each(Object.entries(COMPONENT_EXAMPLES))(
  "renders %s as plain Markdown and native links",
  async (_type, component) => {
    const view = draw(body(component));
    expect(
      view.container.querySelectorAll("[data-markdown]").length,
    ).toBeGreaterThan(0);
    expect(view.container.textContent?.trim().length).toBeGreaterThan(0);
    expect(view.container.textContent).not.toContain("```workstreams");
    expect(
      view.container.querySelector(
        "[data-reply-component], aside, article, button, footer",
      ),
    ).toBeNull();
    expect(view.container.querySelector("[data-reply-block]")?.className).toBe(
      "min-w-0 space-y-4",
    );
  },
);
it.each(Object.entries(COMPOSED_SAMPLES))(
  "renders the %s body without composed treatment",
  async (kind, source) => {
    const view = draw(source, { docked: { turnId: "turn1" } });
    expect(
      view.container
        .querySelector("[data-reply-kind]")
        ?.getAttribute("data-reply-kind"),
    ).toBe(kind);
    expect(
      view.container.querySelectorAll("[data-markdown]").length,
    ).toBeGreaterThan(0);
    expect(
      view.container.querySelector(
        "header, footer, aside, [data-reply-lead], [data-reply-cue]",
      ),
    ).toBeNull();
    expect(view.container.textContent).not.toContain("```workstreams");
  },
);
it("preserves source order rather than moving context above prose", () => {
  const view = draw(
    `:::reply\nOpening explanation.\n\n${componentFence({ type: "context", topic: "Reported task", where: "Reported location" })}\n\nClosing explanation.\n:::\n`,
  );
  const paragraphs = [...view.container.querySelectorAll("p")].map(
    (p) => p.textContent,
  );
  expect(paragraphs).toEqual([
    "Opening explanation.",
    "Reported task",
    "Reported location",
    "Closing explanation.",
  ]);
  expect(
    screen.queryByRole("button", { name: "Show current workspace" }),
  ).toBeNull();
});
it("keeps supporting detail, all checks, and comparison details visible", () => {
  const source = [
    COMPONENT_EXAMPLES.details,
    COMPONENT_EXAMPLES.checks,
    COMPONENT_EXAMPLES.comparison,
  ]
    .map(componentFence)
    .join("\n\n");
  const view = draw(`:::reply\n${source}\n:::\n`);
  expect(view.container.querySelector("pre code")?.textContent).toContain(
    "1000 * (10 / 100)",
  );
  expect(screen.getByText("Unit tests")).toBeDefined();
  expect(screen.getByText("Status: passed")).toBeDefined();
  expect(screen.getByText("Payment integration")).toBeDefined();
  expect(screen.getByText("Status: skipped")).toBeDefined();
  expect(view.container.textContent).toContain("connection remains unverified");
  expect(view.container.textContent).toContain("100-cent discount");
  expect(view.container.querySelector("button, [hidden]")).toBeNull();
});
it("flattens grouped component lists without losing their narrative or sources", () => {
  const view = draw(
    body({
      type: "group",
      relationship: "supporting",
      children: [
        [
          { type: "text", body: "Primary explanation." },
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
  expect(view.container.textContent).toContain("Primary explanation.");
  expect(view.container.textContent).toContain(
    "The calculation subtracts cents",
  );
  expect(view.container.textContent).toContain("Calculation");
  expect(view.container.querySelector("aside, [data-relationship]")).toBeNull();
});
it.each(["    ", "        ", "\t", "  \t"])(
  "preserves indented code after prose (%j)",
  (indent) => {
    const view = draw(
      `:::reply\nAn introduction.\n\n${indent}git show abc1234\n:::\n`,
    );
    expect(view.container.querySelector("pre code")?.textContent).toContain(
      "git show abc1234",
    );
    expect(
      screen.queryByRole("button", { name: "Copy commit abc1234" }),
    ).toBeNull();
  },
);
it("keeps a Markdown reference definition in the same document as its use", () => {
  const view = draw(
    ":::reply\nAn [explanation][source].\n\n[source]: https://example.com/evidence\n:::\n",
  );
  expect(
    screen.getByRole("link", { name: "explanation" }).getAttribute("href"),
  ).toBe("https://example.com/evidence");
  expect(view.container.querySelectorAll("[data-markdown]")).toHaveLength(1);
});
it("routes workspace evidence through native file previews", async () => {
  const view = draw(body(COMPONENT_EXAMPLES.finding));
  const link = await screen.findByRole("link", { name: "Calculation" });
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
  expect(
    view.container
      .querySelector("[data-document]")
      ?.getAttribute("data-document"),
  ).toContain("env1");
});
it.each(["/tmp/Rendered Notes.md", "/tmp/Review #draft? 100%.md"])(
  "preserves literal external evidence paths: %s",
  async (path) => {
    const view = draw(
      body({
        ...finding,
        evidence: [
          { label: "Literal file", location: path, line: 2, endLine: 4 },
        ],
      }),
    );
    const link = await screen.findByRole("link", { name: "Literal file" });
    expect(link.getAttribute("href")).toContain(
      encodeURIComponent(path.slice(path.lastIndexOf("/") + 1)),
    );
    fireEvent.click(link);
    expect(view.inspection.navigateCalls).toContainEqual({
      method: "experimental_openFilePreview",
      options: {
        target: { kind: "host", hostId: "host1", path },
        location: { kind: "range", startLine: 2, endLine: 4 },
      },
    });
  },
);
it.each(["/tmp/Plan#draft.md", "/tmp/Plan#L2", "/tmp/Question?.md"])(
  "preserves literal evidence without an explicit range: %s",
  async (path) => {
    const view = draw(
      body({
        ...finding,
        evidence: [{ label: "Literal without range", location: path }],
      }),
    );
    const link = await screen.findByRole("link", {
      name: "Literal without range",
    });
    expect(link.getAttribute("href")).toContain(
      encodeURIComponent(path.slice(path.lastIndexOf("/") + 1)),
    );
    fireEvent.click(link);
    expect(view.inspection.navigateCalls).toContainEqual({
      method: "experimental_openFilePreview",
      options: {
        target: { kind: "host", hostId: "host1", path },
        location: null,
      },
    });
  },
);

it("keeps block Markdown intact within change, sequence, and evidence fields", () => {
  const source = [
    componentFence({
      type: "change",
      title: "The change",
      before: "```sh\ngit show abc1234\n```",
      after: "> A quoted explanation.\n\n- A list item",
    }),
    componentFence({
      type: "sequence",
      title: "The steps",
      steps: [
        { title: "First", detail: "```sh\nnpm test\n```" },
        { title: "Second", detail: "The second explanation." },
      ],
    }),
    componentFence({
      ...finding,
      evidence: [
        { label: "Evidence excerpt", detail: "```text\nA source excerpt\n```" },
      ],
    }),
  ].join("\n\n");
  const view = draw(`:::reply\n${source}\n:::\n`);
  const code = [...view.container.querySelectorAll("pre code")].map(
    (e) => e.textContent,
  );
  expect(code).toEqual([
    "git show abc1234\n",
    "npm test\n",
    "A source excerpt\n",
  ]);
  expect(view.container.querySelector("blockquote")?.textContent).toContain(
    "A quoted explanation.",
  );
  expect(screen.getByText("A list item")).toBeDefined();
  expect(screen.getByText("The second explanation.")).toBeDefined();
});

it("isolates unterminated Markdown in a field from subsequent content", () => {
  const view = draw(
    `:::reply\n${componentFence({ type: "details", title: "An excerpt", body: "```text\nAn unfinished code fence" })}\n\n[Subsequent target](https://example.com/after)\n:::\n`,
  );
  expect(view.container.querySelector("pre")?.textContent).toContain(
    "An unfinished code fence",
  );
  expect(screen.getByRole("link", { name: "Subsequent target" })).toBeDefined();
});

it("keeps an escaping relative evidence path inert", async () => {
  const view = draw(
    body({
      ...finding,
      evidence: [{ label: "Outside relative path", location: "../private.md" }],
    }),
  );
  await waitFor(() =>
    expect(
      view.container
        .querySelector("[data-document]")
        ?.getAttribute("data-document"),
    ).toContain("env1"),
  );
  expect(
    screen.queryByRole("link", { name: "Outside relative path" }),
  ).toBeNull();
  expect(view.container.textContent).toContain("Outside relative path");
});
it("normalizes a relative prose link and supplies its workspace context", async () => {
  const view = draw(":::reply\nRead [the plan](docs/My Plan.md).\n:::\n");
  const link = screen.getByRole("link", { name: "the plan" });
  expect(link.getAttribute("href")).toBe("docs/My%20Plan.md");
  await waitFor(() =>
    expect(
      view.container
        .querySelector("[data-document]")
        ?.getAttribute("data-document"),
    ).toContain("/work/shop"),
  );
  // BB resolves the encoded relative destination from experimental_document.
  link.setAttribute("href", "file:///work/shop/docs/My%20Plan.md");
  fireEvent.click(link);
  expect(view.inspection.navigateCalls).toContainEqual({
    method: "experimental_openFilePreview",
    options: {
      target: {
        kind: "workspace",
        environmentId: "env1",
        path: "docs/My Plan.md",
      },
      location: null,
    },
  });
});

it("keeps visible ordinary list markers despite host CSS preflight", () => {
  const view = draw(body(COMPONENT_EXAMPLES.sequence));
  expect(view.container.querySelector("ol")?.className).toContain(
    "list-decimal",
  );
  expect(view.container.querySelector("ol")?.className).toContain("pl-5");
  view.lifecycle.unmount();
  const evidence = draw(body(COMPONENT_EXAMPLES.finding));
  expect(evidence.container.querySelector("ul")?.className).toContain(
    "list-disc",
  );
});

it("opens ordinary Markdown file URLs through the public file-preview API", async () => {
  const view = draw(":::reply\n[Notes](file:///tmp/Notes%20File.md#L3)\n:::\n");
  await waitFor(() =>
    expect(
      view.container
        .querySelector("[data-document]")
        ?.getAttribute("data-document"),
    ).toContain("env1"),
  );
  fireEvent.click(screen.getByRole("link", { name: "Notes" }));
  expect(view.inspection.navigateCalls).toContainEqual({
    method: "experimental_openFilePreview",
    options: {
      target: { kind: "host", hostId: "host1", path: "/tmp/Notes File.md" },
      location: { kind: "range", startLine: 3, endLine: 3 },
    },
  });
});
it("preserves malformed component source and the surrounding explanation", () => {
  const view = draw(
    ':::reply\nBefore.\n\n```workstreams\n{"type":"does-not-exist"}\n```\n\nAfter.\n:::\n',
  );
  expect(view.container.textContent).toContain("Before.");
  expect(view.container.textContent).toContain("After.");
  expect(view.container.textContent).toContain("Component not displayed");
  expect(view.container.querySelector("pre")?.textContent).toContain(
    '"does-not-exist"',
  );
});
it("isolates an unterminated component from historical recap fields", async () => {
  const view = draw(
    ':::reply{state="review"}\n# Saved work\n- [x] The work is saved\n\n### Review\n- [Review target](https://example.com/review)\n\n### Explanation\nAn explanation.\n\n```workstreams\n{"type":"finding"}\n:::\n',
  );
  await screen.findByRole("link", { name: "Review target" });
  expect(screen.getByText("The work is saved")).toBeDefined();
  expect(view.container.querySelector("pre")?.textContent).toContain(
    '"finding"',
  );
  expect(view.container.querySelector("pre")?.textContent).not.toContain(
    "Review target",
  );
});

it("defers partial JSON without hiding the explanation", () => {
  const view = draw(
    ':::reply\nExplanation.\n\n```workstreams\n{"type":"finding"',
    { streaming: true },
  );
  expect(view.container.textContent).toContain("Explanation.");
  expect(screen.getByRole("status").textContent).toBe("Receiving information…");
  expect(view.container.querySelector("pre")).toBeNull();
});
it("uses host rendering for an unclosed reply", () => {
  const view = draw(":::reply\nUnfinished reply");
  expect(view.container.querySelector("[data-original]")).not.toBeNull();
  expect(view.container.querySelector("[data-reply-block]")).toBeNull();
});
it("keeps unchecked reported work visible without marking it completed", () => {
  const view = draw(
    ':::reply{state="review"}\n# The change awaits a push\n- [ ] Push the branch\n\n### Review\n- Inspect the diff\n:::\n',
  );
  expect(screen.getByRole("heading", { name: "Not done" })).toBeDefined();
  expect(view.container.textContent).toContain("Push the branch");
});
it.each([
  ["docked", { turnId: "turn1" }, false],
  ["historical", { turnId: "turn2" }, true],
  ["dismissed", { turnId: "turn1", dismissed: true }, true],
  ["no stored recap", undefined, true],
] as const)(
  "preserves %s recap ownership without a styled inline card",
  async (_name, docked, shown) => {
    const source =
      ':::reply{state="complete"}\n# Work is saved\n- [x] A concrete result\n\nA full explanation.\n\n### Next\n- Act: Do the next thing\n:::\n';
    const view = draw(source, { docked });
    await waitFor(() =>
      expect(
        Boolean(screen.queryByRole("heading", { name: "Work is saved" })),
      ).toBe(shown),
    );
    expect(view.container.textContent?.includes("A concrete result")).toBe(
      shown,
    );
    expect(view.container.textContent).toContain("A full explanation.");
    expect(view.container.textContent).not.toContain("Do the next thing");
    expect(view.container.querySelector("footer, button, article")).toBeNull();
  },
);
it.each([
  ["review", "Ready for review", { turnId: "turn2" }],
  ["waiting", "Waiting", { turnId: "turn2" }],
  ["review", "Ready for review", { turnId: "turn1", dismissed: true }],
  ["waiting", "Waiting", { turnId: "turn1", dismissed: true }],
] as const)(
  "keeps %s state visible in a historical or dismissed recap",
  async (state, label, docked) => {
    draw(
      `:::reply{state="${state}" timeout="30"}\n# The work state\n\nAn explanation.\n:::\n`,
      { docked },
    );
    await screen.findByText(label);
  },
);

it("does not duplicate a headline-only answer while its card is docked", async () => {
  const view = draw(
    ':::reply{state="complete"}\n# Python 3.9 or newer\n:::\n',
    { docked: { turnId: "turn1" } },
  );
  await waitFor(() =>
    expect(view.container.querySelector("[data-reply-block]")).toBeNull(),
  );
});
it("keeps the last good parse during a malformed streaming update", () => {
  const block = registration(),
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
it("withholds recap fields while server ownership is unknown", async () => {
  const block = registration();
  let resolve!: (value: unknown) => void;
  const source =
    ':::reply{state="complete"}\n# Work is saved\n- [x] A concrete result\n\nA full explanation.\n:::\n';
  const view = renderSlot(block, props(block, source), {
    sdk: SDK,
    rpc: {
      state: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  });
  expect(view.container.textContent).toContain("A full explanation.");
  expect(view.container.textContent).not.toContain("Work is saved");
  expect(view.container.textContent).not.toContain("A concrete result");
  resolve({ recaps: {}, dismissedRecaps: [] });
  await screen.findByRole("heading", { name: "Work is saved" });
  expect(view.container.textContent).toContain("A concrete result");
});
