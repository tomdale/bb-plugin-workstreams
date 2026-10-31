import { expect, it } from "vitest";
import {
  articleOpening,
  isInlineProse,
  replyState,
} from "../../src/app/reply/opening.ts";
import type { ReplyPart } from "../../src/domain/replyComponents.ts";

it("separates only the introductory paragraph and preserves the explanation", () => {
  const parts: ReplyPart[] = [
    {
      type: "text",
      body: "The **answer** uses `percentages`.\n\nThe full explanation stays here.\n\nAnother paragraph.",
    },
    { type: "details", title: "Evidence", body: "Supporting text." },
  ];
  const result = articleOpening(parts);
  expect(result.lead).toBe("The **answer** uses `percentages`.");
  expect(result.body).toEqual([
    {
      type: "text",
      body: "The full explanation stays here.\n\nAnother paragraph.",
    },
    parts[1],
  ]);
  expect(parts[0]).toEqual({
    type: "text",
    body: "The **answer** uses `percentages`.\n\nThe full explanation stays here.\n\nAnother paragraph.",
  });
});

it("does not remove indentation from code after the lead", () => {
  expect(
    articleOpening([
      {
        type: "text",
        body: "An introduction.\n\n    const total = 900;\n    use(total);",
      },
    ]),
  ).toEqual({
    lead: "An introduction.",
    body: [{ type: "text", body: "    const total = 900;\n    use(total);" }],
  });
});

it.each([
  "### A section\n\nAn explanation.",
  "- A list item\n- Another item",
  "1. A step\n2. Another step",
  "> A quotation",
  "```ts\nconst total = 900;\n```",
  "| Check | Result |\n| --- | --- |\n| Unit | Passed |",
  "$$\nx^2\n$$",
  '::inline-vis{file="example.html"}',
  "![A rendering test](example.png)",
  "A [reference][source].\n\n[source]: https://example.com",
  "A footnote[^note].\n\n[^note]: Supporting text.",
  "An <em>HTML fragment</em>.",
])("keeps a non-prose or shared-syntax opening together: %s", (body) => {
  const parts: ReplyPart[] = [{ type: "text", body }];
  expect(articleOpening(parts)).toEqual({ body: parts });
});

it("keeps headings in the remainder without treating the whole document as a lead", () => {
  expect(
    articleOpening([
      { type: "text", body: "An introduction.\n\n### Why\n\nThe reasoning." },
    ]),
  ).toEqual({
    lead: "An introduction.",
    body: [{ type: "text", body: "### Why\n\nThe reasoning." }],
  });
});

it("leaves an information-first composition in its chosen order", () => {
  const parts: ReplyPart[] = [
    {
      type: "finding",
      title: "A cause",
      explanation: "A complete finding.",
      certainty: "unknown",
    },
    { type: "text", body: "The explanation follows." },
  ];
  expect(articleOpening(parts)).toEqual({ body: parts });
});

it.each([
  "    git show abc1234",
  "\tgit show abc1234",
  "```text\nabc1234\n```",
  "An inline $abc1234$ expression.",
  "$$\nabc1234\n$$",
  "---",
  "<pre>abc1234</pre>",
])("keeps document syntax out of recap token controls: %s", (source) => {
  expect(isInlineProse(source)).toBe(false);
});

it("allows ordinary inline prose to retain recap references", () => {
  expect(isInlineProse("See commit abc1234 and **its explanation**.")).toBe(
    true,
  );
});

it("uses truthful work-state labels without inventing a cause or deployment", () => {
  expect(replyState("complete")?.label).toBe("Complete");
  expect(replyState("review")?.label).toBe("Ready for review");
  expect(replyState("waiting")?.label).toBe("Waiting");
  expect(replyState("deployed")).toBeUndefined();
  expect(replyState("toString")).toBeUndefined();
});
