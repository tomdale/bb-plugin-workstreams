import { expect, it } from "vitest";
import { normalizeReplyMarkdown } from "../../src/app/reply/markdown.ts";

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
