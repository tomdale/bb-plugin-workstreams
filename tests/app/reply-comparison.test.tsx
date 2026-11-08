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

const draw = (part: ReplyPart) =>
  render(<PlainBody part={part} document={undefined} files={null} />).container;

it("lays out comparison options as a list with each field in its own row", () => {
  const view = draw({
    type: "comparison",
    title: "Choose a layout",
    items: [
      {
        name: "Compact",
        summary: "Keep essential rows.",
        qualification: "Useful when narrow.",
        detail: "Extra results fold.",
        recommended: true,
      },
      { name: "Full", summary: "Keep everything." },
    ],
  });
  const root = view.querySelector("[data-reply-comparison]")!;
  expect(root.querySelector("h3")?.textContent).toBe("Choose a layout");
  const list = root.querySelector("ul[data-reply-comparison-options]")!;
  // Two options get columns only once the container is wide enough.
  expect(list.className).toContain("grid-cols-1");
  expect(list.className).toContain("@min-[27rem]/comparison:grid-cols-2");
  const options = [...list.querySelectorAll(":scope > li")];
  expect(
    options.map((li) => li.getAttribute("data-reply-comparison-option")),
  ).toEqual(["recommended", ""]);

  const [compact, full] = options as [Element, Element];
  const rows = [...compact.children].map((cell) =>
    [...cell.classList].find((name) => name.startsWith("row-start-")),
  );
  expect(rows).toEqual([
    "row-start-1",
    "row-start-2",
    "row-start-3",
    "row-start-4",
  ]);
  expect(compact.textContent).toBe(
    "CompactRecommendedKeep essential rows.Useful when narrow.Extra results fold.",
  );
  const label = compact.querySelector("[data-reply-recommended]")!;
  expect(label.textContent).toBe("Recommended");
  expect(label.className).toContain("--ws-reply-accent");
  expect(label.className).not.toMatch(/ws-(complete|review)/);
  expect(
    compact.querySelector("[data-reply-comparison-detail]")?.className,
  ).toContain("text-muted-foreground");

  // Omitted fields render no cell, and only the recommended option is labeled.
  expect(full.querySelector("[data-reply-recommended]")).toBeNull();
  expect(
    full.querySelector("[data-reply-comparison-qualification]"),
  ).toBeNull();
  expect(full.querySelector("[data-reply-comparison-detail]")).toBeNull();
});

it("stacks five or more comparison options", () => {
  const view = draw({
    type: "comparison",
    title: "Many",
    items: ["A", "B", "C", "D", "E"].map((name) => ({
      name,
      summary: `${name} summary`,
    })),
  });
  const list = view.querySelector("[data-reply-comparison-options]")!;
  expect(list.children).toHaveLength(5);
  expect(list.className).not.toMatch(/:grid-cols-\d/);
});

it("leads a recommendation with its choice, then labeled reason and qualification", () => {
  const view = draw({
    type: "recommendation",
    choice: "Use the compact layout.",
    reason: "It keeps the goal visible.",
    qualification: "Use Full during review.",
  });
  const root = view.querySelector("[data-reply-recommendation]")!;
  const choice = root.querySelector("[data-reply-recommendation-choice]")!;
  expect(choice.textContent).toBe("Use the compact layout.");
  expect(choice.className).toContain("font-semibold");
  expect(root.firstElementChild).toBe(choice);

  const rows = [
    ...root.querySelectorAll("dl > [data-reply-recommendation-row]"),
  ];
  expect(
    rows.map((row) => row.getAttribute("data-reply-recommendation-row")),
  ).toEqual(["reason", "qualification"]);
  expect(
    rows.map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent,
    ]),
  ).toEqual([
    ["Reason", "It keeps the goal visible."],
    ["Qualification", "Use Full during review."],
  ]);
  for (const row of rows) {
    const label = row.querySelector("dt")!.className;
    expect(label).toContain("--ws-reply-accent");
    expect(label).not.toMatch(/ws-(complete|review)/);
  }
});

it("omits the caveat row when a recommendation has no qualification", () => {
  const view = draw({
    type: "recommendation",
    choice: "Ship it.",
    reason: "It works.",
  });
  expect(
    [...view.querySelectorAll("dt")].map((label) => label.textContent),
  ).toEqual(["Reason"]);
});
