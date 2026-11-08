// @vitest-environment jsdom
import type {
  ExperimentalMessageBlockProps,
  ExperimentalMessageBlockRegistration,
  PluginAppBuilder,
} from "@get-bb/plugin-sdk/app";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantReplyDebug } from "../../src/app/reply/ReplyDebug.tsx";
import { registerReplyBlock } from "../../src/app/reply/register.ts";
import {
  COMPONENT_EXAMPLES,
  componentFence,
} from "../../src/domain/replyExamples.ts";
import type { ReplyComponent } from "../../src/domain/replyComponents.ts";
import { blockInput } from "../domain/replyFixtures.ts";
import { section, sidebarThread } from "./fixtures.ts";

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
    debug?: boolean;
    sectionId?: string;
  } = {},
) {
  const block = registration();
  return renderSlot(block, props(block, message, options.streaming), {
    sdk: SDK,
    openFilePreview: () => true,
    ...(options.sectionId
      ? {
          sidebarThreads: {
            status: "ready" as const,
            threads: [sidebarThread("t1", { sectionId: options.sectionId })],
            sections: [section(options.sectionId, "Release tools")],
          },
        }
      : {}),
    rpc: {
      ...(options.debug !== undefined
        ? { prefs: () => ({ prefs: { advanced: { debug: options.debug } } }) }
        : {}),
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
type Checks = Extract<ReplyComponent, { type: "checks" }>;
const checksWithEvidence = (items: Checks["items"]): Checks =>
  ({ ...COMPONENT_EXAMPLES.checks, type: "checks", items }) as Checks;

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

it("renders every component, in panel order, with no control but copy buttons and folds", () => {
  const source = Object.values(COMPONENT_EXAMPLES)
    .map((component) => componentFence(component))
    .join("\n\n");
  const view = draw(":::reply\n" + source + "\n:::\n");
  const block = view.container.querySelector("[data-reply-block]")!;
  expect(view.container.textContent).not.toContain("\x60\x60\x60workstreams");
  // The lead text, then actions, then the rest as written, then the fold.
  const order = [
    ...block.querySelectorAll(
      ":scope > [data-markdown], :scope > [data-reply-actions], :scope > [data-reply-checks], :scope > [data-reply-delivery], :scope > [data-reply-change], :scope > [data-reply-facts], :scope > [data-reply-table], :scope > [data-reply-details]",
    ),
  ].map((node) =>
    node.hasAttribute("data-markdown")
      ? "text"
      : [...node.attributes]
          .find((a) => a.name.startsWith("data-reply-"))!
          .name.slice("data-reply-".length),
  );
  expect(order).toEqual([
    "text",
    "actions",
    "checks",
    "delivery",
    "change",
    "facts",
    "table",
    "details",
  ]);
  for (const example of Object.values(COMPONENT_EXAMPLES))
    expect(view.container.textContent).toContain(
      "title" in example && example.title ? example.title : "",
    );
  // Every button copies a literal value; every disclosure starts closed.
  for (const button of block.querySelectorAll("button"))
    expect(button.getAttribute("aria-label")).toMatch(/^Copy /);
  for (const fold of block.querySelectorAll("details"))
    expect((fold as HTMLDetailsElement).open).toBe(false);
  expect(block.className).toBe("ws-reply-accent min-w-0 space-y-4 text-sm");
});

it("copies an action's command and a fact's value", async () => {
  const writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  draw(
    `:::reply\n${componentFence(COMPONENT_EXAMPLES.actions)}\n\n${componentFence(COMPONENT_EXAMPLES.facts)}\n:::\n`,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Copy git merge --ff-only feature/percent",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy 3f9c2ab" }));
  expect(writeText.mock.calls).toEqual([
    ["git merge --ff-only feature/percent"],
    ["3f9c2ab"],
  ]);
  await screen.findByRole("button", { name: "Copied 3f9c2ab" });
});

it("counts actions and marks decisions and cautions", () => {
  const view = draw(body(COMPONENT_EXAMPLES.actions));
  const panel = view.container.querySelector("[data-reply-actions]")!;
  expect(panel.querySelector("h3")?.textContent).toBe("Needs you");
  expect(panel.querySelector("[data-reply-actions-count]")?.textContent).toBe(
    "2 steps, 1 decision",
  );
  expect(
    [...panel.querySelectorAll("[data-reply-action]")].map((row) =>
      row.getAttribute("data-reply-action"),
    ),
  ).toEqual(["do", "do", "decide"]);
  expect(
    panel.querySelector('[data-reply-action="decide"]')?.textContent,
  ).toContain("Decide");
  expect(panel.querySelector("[data-reply-caution]")?.textContent).toContain(
    "Caution: Runs a migration",
  );
});

it("keeps failed checks open and folds a list where every check passed", () => {
  const failing = draw(body(COMPONENT_EXAMPLES.checks));
  // One check skipped: the list stays open beneath the tiles.
  expect(
    failing.container.querySelector("[data-reply-checks-fold]"),
  ).toBeNull();
  expect(
    [...failing.container.querySelectorAll("[data-reply-tile]")].map((tile) =>
      tile.getAttribute("data-reply-tile"),
    ),
  ).toEqual(["neutral", "good"]);
  expect(failing.container.textContent).toContain("checks passed, 1 skipped");
  failing.lifecycle.unmount();
  const passing = draw(
    body(
      checksWithEvidence([
        { name: "Unit tests", status: "passed" },
        { name: "Typecheck", status: "passed" },
      ]),
    ),
  );
  const fold = passing.container.querySelector<HTMLDetailsElement>(
    "[data-reply-checks-fold]",
  )!;
  expect(fold.open).toBe(false);
  expect(fold.querySelector("summary")?.textContent).toContain(
    "CI has not run",
  );
  expect(fold.textContent).toContain("Typecheck");
});

it("folds details with a computed summary and keeps their content", () => {
  const view = draw(body(COMPONENT_EXAMPLES.details));
  const fold = view.container.querySelector<HTMLDetailsElement>(
    "[data-reply-details]",
  )!;
  expect(fold.open).toBe(false);
  expect(fold.querySelector("summary")?.textContent).toBe(
    "Why the calculation converts1 code block",
  );
  expect(fold.querySelector("pre code")?.textContent).toContain(
    "percent / 100",
  );
});

it("counts table states and colors only toned rows", () => {
  const view = draw(body(COMPONENT_EXAMPLES.table));
  expect(
    view.container.querySelector("[data-reply-table-count]")?.textContent,
  ).toBe("2 Updated, 1 Check");
  expect(
    [...view.container.querySelectorAll("th")].map((th) => th.textContent),
  ).toEqual(["Caller", "Where", "State"]);
  expect(
    [...view.container.querySelectorAll("[data-reply-table-state]")].map(
      (cell) => cell.getAttribute("data-reply-table-state"),
    ),
  ).toEqual(["good", "good", "attention"]);
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
  const view = draw(
    body(
      checksWithEvidence([
        {
          name: "Unit tests",
          status: "passed",
          evidence: [
            {
              label: "Test source",
              location: "src/coupon.ts",
              line: 12,
              endLine: 16,
            },
          ],
        },
      ]),
    ),
  );
  const link = await screen.findByRole("link", { name: "Test source" });
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
      body(
        checksWithEvidence([
          {
            name: "Unit tests",
            status: "passed",
            evidence: [
              { label: "Literal file", location: path, line: 2, endLine: 4 },
            ],
          },
        ]),
      ),
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
      body(
        checksWithEvidence([
          {
            name: "Unit tests",
            status: "passed",
            evidence: [{ label: "Literal without range", location: path }],
          },
        ]),
      ),
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

it("keeps block Markdown intact within change, action, and evidence fields", () => {
  const source = [
    componentFence({
      type: "change",
      title: "The change",
      before: "```sh\ngit show abc1234\n```",
      after: "> A quoted explanation.\n\n- A list item",
    }),
    componentFence({
      type: "actions",
      items: [
        { action: "First", detail: "```sh\nnpm test\n```" },
        { action: "Second", detail: "The second explanation." },
      ],
    }),
    componentFence(
      checksWithEvidence([
        {
          name: "Unit tests",
          status: "skipped",
          evidence: [
            {
              label: "Evidence excerpt",
              detail: "```text\nA source excerpt\n```",
            },
          ],
        },
      ]),
    ),
  ].join("\n\n");
  const view = draw(`:::reply\n${source}\n:::\n`);
  const code = [...view.container.querySelectorAll("pre code")].map(
    (e) => e.textContent,
  );
  expect(code).toEqual([
    "npm test\n",
    "git show abc1234\n",
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
    body(
      checksWithEvidence([
        {
          name: "Unit tests",
          status: "passed",
          evidence: [
            { label: "Outside relative path", location: "../private.md" },
          ],
        },
      ]),
    ),
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

it("numbers actions and leads check rows with status marks", () => {
  const view = draw(body(COMPONENT_EXAMPLES.actions));
  const steps = view.container.querySelectorAll("[data-reply-action]");
  expect([...steps].map((step) => step.firstElementChild?.textContent)).toEqual(
    ["1", "2", "3"],
  );
  view.lifecycle.unmount();
  const checks = draw(body(COMPONENT_EXAMPLES.checks));
  expect(checks.container.querySelector("[data-reply-tiles]")).not.toBeNull();
  // Each row leads with its status mark, as recap card results do.
  for (const item of checks.container.querySelectorAll(
    "[data-reply-check-item]",
  )) {
    expect(
      item.firstElementChild?.hasAttribute("data-reply-check-status"),
    ).toBe(true);
    expect(item.firstElementChild?.querySelector("svg")).not.toBeNull();
    // Only statuses other than passed repeat their label beside the name.
    const shown = item.querySelector('[aria-hidden="true"]:not(svg)');
    if (item.getAttribute("data-reply-check-item") === "passed")
      expect(shown).toBeNull();
    else expect(shown?.textContent).not.toBe("");
  }
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
    ':::reply{state="review"}\n# Saved work\n- [x] The work is saved\n\n### Review\n- [Review target](https://example.com/review)\n\n### Explanation\nAn explanation.\n\n```workstreams\n{"type":"retiredComponent"}\n:::\n',
  );
  await screen.findByRole("link", { name: "Review target" });
  expect(screen.getByText("The work is saved")).toBeDefined();
  expect(view.container.querySelector("pre")?.textContent).toContain(
    '"retiredComponent"',
  );
  expect(view.container.querySelector("pre")?.textContent).not.toContain(
    "Review target",
  );
});

it("defers partial JSON without hiding the explanation", () => {
  const view = draw(
    ':::reply\nExplanation.\n\n```workstreams\n{"type":"retiredComponent"',
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

it("shows the raw agent output before parsing only in Debug mode", async () => {
  const source = `:::reply\n# Parsed heading\n\n${componentFence(COMPONENT_EXAMPLES.facts)}\n:::\n`;
  const off = draw(source, { debug: false });
  expect(off.container.querySelector("[data-reply-raw]")).toBeNull();
  expect(off.queryByLabelText("Raw agent output")).toBeNull();
  off.lifecycle.unmount();

  const on = draw(source, { debug: true });
  const summary = await on.findByText("Raw agent output");
  const details = summary.closest("details")!;
  expect(details.hasAttribute("data-reply-raw")).toBe(true);
  expect(details.open).toBe(false);
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  expect(on.getByLabelText("Raw agent output").textContent).toBe(source);

  await on.behavior.emitRealtime("prefs", {
    prefs: { advanced: { debug: false } },
  });
  await waitFor(() =>
    expect(on.container.querySelector("[data-reply-raw]")).toBeNull(),
  );
});

it("shows syntax issues and raw output on an unclosed reply in Debug mode", async () => {
  const source = [
    ":::reply",
    "**Make approval a capability tied to a displayed draft.**",
    "",
    componentFence(COMPONENT_EXAMPLES.table),
    "",
    "Final paragraph.",
    ":::reply",
  ].join("\n");
  const view = draw(source, { debug: true });
  expect(view.container.querySelector("[data-original]")).not.toBeNull();
  const summary = await view.findByText("Raw agent output");
  const details = summary.closest("details")!;
  expect(details.getAttribute("data-reply-status")).toBe("unclosed");
  expect(details.textContent).toContain(
    'Closing line is ":::reply" — close ":::reply" with ":::" alone on a line',
  );
  fireEvent.click(summary);
  expect(
    view.getByRole("list", { name: "Reply syntax issues" }).textContent,
  ).toContain('close ":::reply" with ":::" alone on a line');
  expect(view.getByLabelText("Raw agent output").textContent).toBe(source);
});

it("attaches raw output and syntax diagnostics to assistant rows without a ReplyBlock in Debug mode", async () => {
  const broken = `::: reply\n${componentFence(COMPONENT_EXAMPLES.facts)}\n:::`;
  const row = render(
    <div data-timeline-row-id="t1:assistant:kind:assistant|turn:turn1|parent:root|item:item1">
      <div data-message-column="">
        <div data-sidebar-swipe-selectable="true">
          <p>::: reply</p>
        </div>
      </div>
    </div>,
  );
  const overlay = renderSlot(
    { component: AssistantReplyDebug },
    {},
    {
      sdk: {
        ...SDK,
        threads: {
          ...SDK.threads,
          events: {
            list: async () => [
              {
                id: "e1",
                threadId: "t1",
                createdAt: 0,
                type: "item/completed",
                seq: 115,
                scope: { kind: "turn", turnId: "turn1" },
                data: {
                  providerThreadId: "p1",
                  item: {
                    type: "agentMessage",
                    id: "item1",
                    text: broken,
                  },
                },
              },
            ],
          },
        },
      },
      rpc: {
        prefs: () => ({ prefs: { advanced: { debug: true } } }),
      },
    },
  );
  await waitFor(() =>
    expect(row.container.querySelector("[data-reply-raw]")).not.toBeNull(),
  );
  const details = row.container.querySelector<HTMLDetailsElement>(
    "details[data-reply-raw]",
  )!;
  expect(details.getAttribute("data-reply-status")).toBe("missing");
  expect(details.textContent).toContain(
    '"::: reply" has a space after ":::" — write ":::reply" with no space.',
  );
  expect(row.getByLabelText("Raw agent output").textContent).toBe(broken);
  overlay.lifecycle.unmount();
  row.unmount();
});

it("leads delivery stages with status marks in their order", () => {
  const view = draw(body(COMPONENT_EXAMPLES.delivery));
  const list = view.container.querySelector("[data-reply-delivery-stages]");
  expect(list?.tagName).toBe("OL");
  const stages = [
    ...view.container.querySelectorAll("[data-reply-delivery-stage]"),
  ];
  expect(stages.length).toBeGreaterThan(0);
  for (const stage of stages) {
    const mark = stage.querySelector("[data-reply-stage-status]");
    expect(mark?.querySelector("svg")).not.toBeNull();
    // Only statuses other than done repeat their label beside the name.
    const shown = stage.querySelector('span[aria-hidden="true"]:not(:empty)');
    if (stage.getAttribute("data-reply-delivery-stage") === "done")
      expect(shown).toBeNull();
    else expect(shown?.textContent).not.toBe("");
  }
});

it("accents Change labels with the thread's workstream color", async () => {
  const filed = draw(body(COMPONENT_EXAMPLES.change), { sectionId: "sec_a" });
  const block =
    filed.container.querySelector<HTMLElement>("[data-reply-block]")!;
  expect(block.classList).toContain("ws-reply-accent");
  await waitFor(() =>
    expect(block.style.getPropertyValue("--ws-color-light")).toMatch(/^oklch/),
  );
  const label = filed.container.querySelector("[data-reply-change-row] dt");
  expect(label?.className).toContain("--ws-reply-accent");
  filed.lifecycle.unmount();
  // An unfiled thread sets no identity color, so labels fall back to muted.
  const unfiled = draw(body(COMPONENT_EXAMPLES.change));
  expect(
    unfiled.container
      .querySelector<HTMLElement>("[data-reply-block]")!
      .style.getPropertyValue("--ws-color-light"),
  ).toBe("");
});
