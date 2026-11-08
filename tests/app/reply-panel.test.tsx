// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlainBody } from "../../src/app/reply/PlainBody.tsx";
import type {
  ReplyComponent,
  ReplyPart,
} from "../../src/domain/replyComponents.ts";

vi.mock("@get-bb/plugin-sdk/app", async (importActual) => {
  const actual = await importActual<typeof import("@get-bb/plugin-sdk/app")>();
  const React = await import("react");
  const { default: ReactMarkdown } = await import("react-markdown");
  return {
    ...actual,
    Markdown: (props: { content: string }) =>
      React.createElement(ReactMarkdown, { children: props.content }),
  };
});
afterEach(cleanup);

const draw = (part: ReplyPart) =>
  render(<PlainBody part={part} document={undefined} files={null} />).container;

const checks = (
  statuses: ("passed" | "failed" | "blocked")[],
): ReplyComponent => ({
  type: "checks",
  title: "The branch's checks",
  scope: "vitest, run in the task worktree",
  items: statuses.map((status, i) => ({ name: `Check ${i + 1}`, status })),
});

/** One part of each type, to compare what is framed with what is not. */
const ROWS: ReplyComponent[] = [
  checks(["passed"]),
  {
    type: "delivery",
    title: "Where the fix stands",
    scope: "branch fix/queue",
    stages: [{ name: "Committed", status: "done" }],
  },
  {
    type: "sequence",
    title: "Steps",
    steps: [{ title: "One" }, { title: "Two" }],
  },
  {
    type: "comparison",
    title: "Options",
    items: [
      { name: "One", summary: "First." },
      { name: "Two", summary: "Second." },
    ],
  },
  {
    type: "change",
    title: "The change",
    before: "Before it",
    after: "After it",
  },
];
const SINGLE_SUBJECT: ReplyComponent[] = [
  { type: "context", topic: "Queue keys", where: "src/queue.ts" },
  { type: "recommendation", choice: "Ship it", reason: "It is done." },
  { type: "details", title: "Why", body: "Because." },
  { type: "text", body: "Prose." },
  {
    type: "group",
    relationship: "peers",
    children: [
      { type: "text", body: "One." },
      { type: "text", body: "Two." },
    ],
  },
];

it.each(ROWS.map((part) => [part.type, part] as const))(
  "frames %s, whose data is a list of parallel rows",
  (_type, part) => {
    const view = draw(part);
    const panel = view.querySelector("[data-reply-panel]")!;
    expect(panel).not.toBeNull();
    // The frame is the one subagent deliveries already draw.
    expect(panel.className).toContain("rounded-lg");
    expect(panel.className).toContain("bg-surface-recessed");
    expect(panel.className).toContain("border-border");
    // The header carries the part's title and scope, and its rows follow.
    const header = panel.querySelector("[data-reply-panel-header]")!;
    expect(header.className).toContain("border-b");
    const title = (part as { title: string }).title;
    expect(header.querySelector("h3")?.textContent).toBe(title);
  },
);

it.each(SINGLE_SUBJECT.map((part) => [part.type, part] as const))(
  "draws %s, a part with one subject, without a frame",
  (_type, part) => {
    expect(draw(part).querySelector("[data-reply-panel]")).toBeNull();
  },
);

it("keeps prose unframed even beside a panel", () => {
  const view = draw({ type: "text", body: "A paragraph." });
  expect(view.querySelector("[data-reply-panel]")).toBeNull();
  expect(view.querySelector("p")?.textContent).toBe("A paragraph.");
});

it("tones a panel that holds a failure at its frame, its header and its title", () => {
  const failing = draw(checks(["passed", "failed"]));
  const panel = failing.querySelector("[data-reply-panel]")!;
  expect(panel.hasAttribute("data-reply-panel-failure")).toBe(true);
  expect(panel.className).toContain("border-(--ws-failure-border)");
  const header = panel.querySelector("[data-reply-panel-header]")!;
  expect(header.className).toContain("bg-(--ws-failure-surface)");
  expect(header.className).toContain("border-(--ws-failure-border)");
  expect(panel.querySelector("[data-reply-panel-title]")?.className).toContain(
    "text-(--ws-failure-text)",
  );
});

it("tones a panel holding a blocked row, and leaves a passing one neutral", () => {
  const blocked = draw(checks(["passed", "blocked"]));
  expect(
    blocked
      .querySelector("[data-reply-panel]")!
      .hasAttribute("data-reply-panel-failure"),
  ).toBe(true);
  const passing = draw(checks(["passed", "passed"]));
  const panel = passing.querySelector("[data-reply-panel]")!;
  expect(panel.hasAttribute("data-reply-panel-failure")).toBe(false);
  expect(panel.className).toContain("border-border");
  expect(panel.className).not.toContain("--ws-failure");
  expect(panel.querySelector("[data-reply-panel-title]")?.className).toContain(
    "text-foreground",
  );
});

it("prints every row's status word at the row's edge, in its tone", () => {
  const view = draw(checks(["passed", "failed", "blocked"]));
  const words = [...view.querySelectorAll("[data-reply-status-word]")];
  expect(words.map((word) => word.textContent)).toEqual([
    "Passed",
    "Failed",
    "Blocked",
  ]);
  expect(words.map((word) => word.className)).toEqual([
    expect.stringContaining("text-(--ws-complete-text)"),
    expect.stringContaining("text-(--ws-failure-text)"),
    expect.stringContaining("text-(--ws-needs-you-text)"),
  ]);
});

it("draws a stage nobody has reached as a dashed ring, not a warning", () => {
  const view = draw({
    type: "delivery",
    title: "Where the fix stands",
    scope: "branch fix/queue",
    stages: [
      { name: "Committed", status: "done" },
      { name: "Deployed", status: "not-started" },
    ],
  });
  const row = view.querySelector('[data-reply-delivery-stage="not-started"]')!;
  expect(row.querySelector("[data-reply-status-word]")?.textContent).toBe(
    "Not started",
  );
  expect(row.querySelector("[data-reply-status-word]")?.className).toContain(
    "text-muted-foreground",
  );
  // A broken ring: the state has no result to report yet.
  expect(
    row
      .querySelector("[data-reply-stage-status] svg")
      ?.getAttribute("stroke-dasharray"),
  ).toBe("2 2.4");
  // Reaching no stage is not a failure, so the panel keeps its neutral tone.
  expect(
    view
      .querySelector("[data-reply-panel]")!
      .hasAttribute("data-reply-panel-failure"),
  ).toBe(false);
});

it("joins a supporting group into one frame and draws its children unframed", () => {
  const view = draw({
    type: "group",
    relationship: "supporting",
    children: [
      { type: "text", body: "The point." },
      {
        type: "change",
        title: "Why it holds",
        before: "Before",
        after: "After",
      },
    ],
  });
  const panels = view.querySelectorAll("[data-reply-panel]");
  expect(panels).toHaveLength(1);
  // A child inside the group's frame keeps its title and rows, without a
  // second border around them.
  expect(view.querySelector("[data-reply-change]")).not.toBeNull();
  expect(view.querySelector("[data-reply-change] h3")?.textContent).toBe(
    "Why it holds",
  );
});
