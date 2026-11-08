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
): Extract<ReplyComponent, { type: "checks" }> => ({
  type: "checks",
  title: "The branch's checks",
  scope: "vitest, run in the task worktree",
  items: statuses.map((status, i) => ({ name: `Check ${i + 1}`, status })),
});

const delivery = (
  statuses: ("done" | "pending" | "blocked" | "not-started")[],
): ReplyComponent => ({
  type: "delivery",
  title: "Where the fix stands",
  scope: "branch fix/queue",
  stages: statuses.map((status, i) => ({ name: `Stage ${i + 1}`, status })),
});

/** The parts that report results, and so draw a frame. */
const REPORTS: ReplyComponent[] = [checks(["passed"]), delivery(["done"])];

/** Every other part draws in the message flow. */
const IN_FLOW: ReplyComponent[] = [
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
  {
    type: "group",
    relationship: "supporting",
    children: [
      { type: "text", body: "The point." },
      { type: "text", body: "Its support." },
    ],
  },
];

it.each(REPORTS.map((part) => [part.type, part] as const))(
  "frames %s, which reports results",
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

it.each(IN_FLOW.map((part, i) => [`${part.type} ${i}`, part] as const))(
  "draws %s in the message flow, without a frame",
  (_type, part) => {
    expect(draw(part).querySelector("[data-reply-panel]")).toBeNull();
  },
);

it("draws a titled part's title above its rows", () => {
  const view = draw(IN_FLOW[2]!);
  const change = view.querySelector("[data-reply-change]")!;
  expect(change.querySelector("h3")?.textContent).toBe("The change");
  // Each row has a hairline above it, so the part has an edge where it starts.
  const rows = [...change.querySelectorAll("[data-reply-change-row]")];
  expect(rows.map((row) => row.getAttribute("data-reply-change-row"))).toEqual([
    "before",
    "after",
  ]);
  for (const row of rows) expect(row.className).toContain("border-t");
});

it("tones a frame holding a failure at its edge and header, and leaves the title neutral", () => {
  const failing = draw(checks(["passed", "blocked", "failed"]));
  const panel = failing.querySelector("[data-reply-panel]")!;
  expect(panel.getAttribute("data-reply-panel-tone")).toBe("failure");
  expect(panel.className).toContain("border-(--ws-failure-border)");
  const header = panel.querySelector("[data-reply-panel-header]")!;
  expect(header.className).toContain("bg-(--ws-failure-surface)");
  expect(header.className).toContain("border-(--ws-failure-border)");
  expect(panel.querySelector("[data-reply-panel-title]")?.className).toBe(
    "text-foreground",
  );
  // The frame carries the tone, so a failing row is not tinted as well.
  for (const row of panel.querySelectorAll("[data-reply-check-item]"))
    expect(row.className).not.toMatch(/bg-\(--ws/);
});

it("tones a frame whose worst row is blocked as needing someone, not as a failure", () => {
  for (const part of [
    checks(["passed", "blocked"]),
    delivery(["done", "blocked"]),
  ]) {
    const panel = draw(part).querySelector("[data-reply-panel]")!;
    expect(panel.getAttribute("data-reply-panel-tone")).toBe("needsYou");
    expect(panel.className).toContain("border-(--ws-needs-you-border)");
    expect(panel.className).not.toContain("--ws-failure");
    cleanup();
  }
});

it("leaves a frame with nothing failed or blocked neutral", () => {
  const panel = draw(checks(["passed", "passed"])).querySelector(
    "[data-reply-panel]",
  )!;
  expect(panel.hasAttribute("data-reply-panel-tone")).toBe(false);
  expect(panel.className).toContain("border-border");
  expect(panel.className).not.toContain("--ws-");
});

it("prints the status word for every row that needs reading, in its tone", () => {
  const view = draw(checks(["passed", "failed", "blocked"]));
  const words = [...view.querySelectorAll("[data-reply-status-word]")];
  expect(words.map((word) => word.textContent)).toEqual([
    "Passed",
    "Failed",
    "Blocked",
  ]);
  // A pass is the expected outcome: its mark stands alone, and its word is
  // there only for assistive technology.
  expect(words.map((word) => word.className)).toEqual([
    "sr-only",
    expect.stringContaining("text-(--ws-failure-text)"),
    expect.stringContaining("text-(--ws-needs-you-text)"),
  ]);
});

it("draws a stage nobody has reached as a dashed ring, not a warning", () => {
  const view = draw(delivery(["done", "not-started"]));
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
  // Reaching no stage is not a failure, so the frame keeps its neutral tone.
  expect(
    view
      .querySelector("[data-reply-panel]")!
      .hasAttribute("data-reply-panel-tone"),
  ).toBe(false);
});

it("draws a supporting group's children as they draw alone", () => {
  const view = draw({
    type: "group",
    relationship: "supporting",
    children: [{ type: "text", body: "The point." }, checks(["failed"])],
  });
  // The group adds no frame; the checks keep their own, with its tone.
  const panels = [...view.querySelectorAll("[data-reply-panel]")];
  expect(panels.map((panel) => panel.getAttribute("data-reply-panel"))).toEqual(
    ["checks"],
  );
  expect(panels[0]!.getAttribute("data-reply-panel-tone")).toBe("failure");
  const support = view.querySelector("[data-reply-group-support]")!;
  expect(support.contains(panels[0]!)).toBe(true);
});

it("lets secondary text take its size and tone through BB's Markdown", () => {
  const view = draw({
    type: "sequence",
    title: "Steps",
    steps: [{ title: "One", detail: "Why it matters." }],
  });
  const detail = view.querySelector("[data-reply-step-detail]")!;
  // BB's renderer sets text-sm text-foreground on its root and paragraphs, so
  // the wrapper hands its own size and tone down.
  expect(detail.className).toContain("text-muted-foreground");
  expect(detail.className).toContain("[&_.text-foreground]:text-inherit!");
  expect(detail.className).toContain(
    "[&_[data-markdown-preview]]:text-[length:inherit]!",
  );
});
