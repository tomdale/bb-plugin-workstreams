// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlainBody } from "../../src/app/reply/PlainBody.tsx";
import type { ReplyPart } from "../../src/domain/replyComponents.ts";

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

const sequence: ReplyPart = {
  type: "sequence",
  title: "Ship the fix",
  steps: [
    { title: "Run the **tests**", detail: "Use `npm test`." },
    { title: "Check the build", attention: true },
    { title: "Push the branch", detail: "Open the PR afterwards." },
  ],
};

function draw(part: ReplyPart) {
  return render(<PlainBody part={part} document={undefined} files={null} />)
    .container;
}

it("renders the steps as an ordered list with numbers in the mark column", () => {
  const view = draw(sequence);
  const root = view.querySelector("[data-reply-sequence]");
  expect(root?.querySelector("h3")?.textContent).toBe("Ship the fix");
  const list = root?.querySelector("ol[data-reply-sequence-steps]");
  expect(list?.className).toContain("list-none");
  const steps = [...(list?.children ?? [])];
  expect(steps.map((step) => step.tagName)).toEqual(["LI", "LI", "LI"]);
  for (const [i, step] of steps.entries()) {
    expect(step.getAttribute("data-reply-sequence-step")).toBe(String(i + 1));
    // The list numbers the steps for assistive technology; the drawn number
    // is decoration.
    const number = step.querySelector("[data-reply-step-number]");
    expect(number?.textContent).toBe(String(i + 1));
    // The drawn number sits in a mark cell hidden from assistive technology.
    expect(number?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(number?.className).toContain("tabular-nums");
  }
});

it("joins every step but the last to the next with a rail", () => {
  const steps = [
    ...draw(sequence).querySelectorAll("[data-reply-sequence-step]"),
  ];
  const rails = steps.map(
    (step) => step.querySelectorAll("[data-reply-rail]").length,
  );
  expect(rails).toEqual([1, 1, 0]);
});

it("keeps the title, then the muted detail, as Markdown", () => {
  const view = draw(sequence);
  const first = view.querySelector('[data-reply-sequence-step="1"]');
  expect(first?.querySelector("strong")?.textContent).toBe("tests");
  const detail = first?.querySelector("[data-reply-step-detail]");
  expect(detail?.className).toContain("text-muted-foreground");
  expect(detail?.querySelector("code")?.textContent).toBe("npm test");
  expect(
    view.querySelector(
      '[data-reply-sequence-step="2"] [data-reply-step-detail]',
    ),
  ).toBeNull();
});

it("labels attention steps with the word in the reply accent", () => {
  const steps = [
    ...draw(sequence).querySelectorAll("[data-reply-sequence-step]"),
  ];
  expect(
    steps.map((step) => step.hasAttribute("data-reply-attention")),
  ).toEqual([false, true, false]);
  const label = steps[1]?.querySelector("[data-reply-step-attention]");
  // Visible and announced, not color alone.
  expect(label?.textContent).toBe("Attention");
  expect(label?.getAttribute("aria-hidden")).toBeNull();
  expect(label?.className).toContain("--ws-reply-accent");
  expect(steps[0]?.querySelector("[data-reply-step-attention]")).toBeNull();
});
