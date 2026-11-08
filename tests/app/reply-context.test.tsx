// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

it("leads a context with its topic in the reply accent and the location beneath", () => {
  const root = draw({
    type: "context",
    topic: "Release **summary**",
    where: "`services/checkout`",
    background: "First paragraph.\n\nSecond paragraph.",
  });
  const context = root.querySelector("[data-reply-context]")!;
  const [topic, where, background] = [...context.children];
  expect(topic!.hasAttribute("data-reply-context-topic")).toBe(true);
  expect(topic!.className).toContain("text-(--ws-reply-accent");
  expect(topic!.querySelector("strong")?.textContent).toBe("summary");
  expect(where!.hasAttribute("data-reply-context-where")).toBe(true);
  expect(where!.className).toContain("text-muted-foreground");
  expect(where!.querySelector("code")?.textContent).toBe("services/checkout");
  expect(background!.hasAttribute("data-reply-context-background")).toBe(true);
  expect(background!.querySelectorAll("p")).toHaveLength(2);
});

it("omits a context's absent location and background", () => {
  const root = draw({ type: "context", topic: "Release summary" });
  expect(root.querySelector("[data-reply-context-topic]")?.textContent).toBe(
    "Release summary",
  );
  expect(root.querySelector("[data-reply-context-where]")).toBeNull();
  expect(root.querySelector("[data-reply-context-background]")).toBeNull();
});

it("gives details a heading and keeps the whole Markdown body open", () => {
  const root = draw({
    type: "details",
    title: "Why it matters",
    body: "The caveat.\n\n- One\n- Two\n\n```sh\nnpm test\n```",
  });
  const section = root.querySelector("section[data-reply-details]")!;
  expect(
    screen.getByRole("heading", { level: 3, name: "Why it matters" }),
  ).toBeDefined();
  const body = section.querySelector("[data-reply-details-body]")!;
  expect(body.querySelectorAll("li")).toHaveLength(2);
  expect(body.querySelector("pre code")?.textContent).toContain("npm test");
  expect(root.querySelector("details, summary, [hidden]")).toBeNull();
});

it("lays peers out as equal cells and keeps a list child together", () => {
  const root = draw({
    type: "group",
    relationship: "peers",
    children: [
      { type: "text", body: "First peer." },
      { type: "text", body: "Second peer." },
      [
        { type: "context", topic: "Third peer" },
        { type: "text", body: "Kept with the third." },
      ],
    ],
  });
  const group = root.querySelector<HTMLElement>('[data-reply-group="peers"]')!;
  const cells = [...group.children];
  expect(cells).toHaveLength(3);
  expect(
    cells.every((cell) => cell.hasAttribute("data-reply-group-child")),
  ).toBe(true);
  // Every cell, list or not, grows from the same basis, so peers share the
  // row equally.
  for (const cell of cells)
    expect(cell.className).toContain("grow basis-[calc((var(--ws-peers-min)");
  expect(cells[2]!.getAttribute("data-reply-group-child")).toBe("list");
  expect(cells[2]!.textContent).toContain("Third peer");
  expect(cells[2]!.textContent).toContain("Kept with the third.");
  // Three 13rem columns and two 1.5rem gaps.
  expect(group.style.getPropertyValue("--ws-peers-min")).toBe("42rem");
});

it("places supporting children beneath the point under one rule", () => {
  const root = draw({
    type: "group",
    relationship: "supporting",
    children: [
      { type: "text", body: "The point." },
      { type: "details", title: "Why", body: "The reason." },
      [
        { type: "text", body: "A qualification." },
        { type: "text", body: "Its continuation." },
      ],
    ],
  });
  const group = root.querySelector('[data-reply-group="supporting"]')!;
  const [point, support] = [...group.children];
  expect(point!.textContent).toBe("The point.");
  expect(support!.hasAttribute("data-reply-group-support")).toBe(true);
  expect(support!.className).toContain("border-l");
  const supporting = [...support!.children];
  expect(supporting).toHaveLength(2);
  expect(supporting[0]!.querySelector("[data-reply-details]")).not.toBeNull();
  expect(supporting[1]!.getAttribute("data-reply-group-child")).toBe("list");
  expect(supporting[1]!.textContent).toContain("Its continuation.");
});
