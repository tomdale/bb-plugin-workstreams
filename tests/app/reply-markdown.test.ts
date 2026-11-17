import { expect, it } from "vitest";
import {
  mentionBlocks,
  normalizeReplyMarkdown,
} from "../../src/app/reply/markdown.ts";

it("encodes relative prose destinations with spaces", () => {
  expect(normalizeReplyMarkdown("Read [the plan](docs/My Plan.md).")).toBe(
    "Read [the plan](docs/My%20Plan.md).",
  );
});
it.each([
  "```md\n[the plan](docs/My Plan.md)\n```",
  "~~~md\n[the plan](docs/My Plan.md)\n~~~",
  "    [the plan](docs/My Plan.md)",
  "`[the plan](docs/My Plan.md)`",
  "$[the plan](docs/My Plan.md)$",
  "$$\n[the plan](docs/My Plan.md)\n$$",
])(
  "keeps literal code/math untouched while repairing surrounding prose (%s)",
  (literal) => {
    const source = `Read [the plan](docs/My Plan.md).\n\n${literal}\n\nRead [the other plan](docs/Other Plan.md).`;
    const result = normalizeReplyMarkdown(source);
    expect(result).toContain(literal);
    expect(result).toContain("[the plan](docs/My%20Plan.md).");
    expect(result).toContain("[the other plan](docs/Other%20Plan.md).");
  },
);
it("repairs a destination without splitting an inline-code link label", () => {
  expect(normalizeReplyMarkdown("Read [`the plan`](docs/My Plan.md).")).toBe(
    "Read [`the plan`](docs/My%20Plan.md).",
  );
});

it("cuts prose only around paragraphs that mention a thread", () => {
  const blocks = mentionBlocks(
    "Intro.\n\n@thread:thr_a runs `code`.\n\n- @thread:thr_b in a list\n\nEnd.",
  );
  expect(blocks.map((block) => block.kind)).toEqual([
    "markdown",
    "paragraph",
    "markdown",
  ]);
  expect(blocks[1]).toEqual({
    kind: "paragraph",
    segments: [
      { kind: "thread", threadId: "thr_a" },
      { kind: "markdown", text: " runs `code`." },
    ],
  });
  expect(blocks[2]).toMatchObject({
    text: expect.stringContaining("- @thread:thr_b in a list"),
  });
});
it("leaves prose with no mention, or only a literal one, whole", () => {
  expect(mentionBlocks("Plain.")).toHaveLength(1);
  expect(mentionBlocks("Say `@thread:thr_a` aloud.")).toEqual([
    { kind: "markdown", text: "Say `@thread:thr_a` aloud." },
  ]);
});
