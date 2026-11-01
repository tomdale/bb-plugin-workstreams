import { expect, it } from "vitest";
import { parse } from "../../src/domain/reply.ts";
import { recapInputFromCard } from "../../src/domain/replyRecap.ts";
import { recapSchema, toRecap } from "../../src/domain/recap.ts";
import { blockInput } from "./replyFixtures.ts";

function links(line: string) {
  const reply = parse(
    blockInput(
      `:::reply{state="review"}\n# Review the report\n\n### Review\n- Inspect the report\n\n### Links\n- ${line}\n:::\n`,
    ),
  );
  if (!reply.ok || !reply.data.card) throw new Error("No reply card");
  const input = recapInputFromCard(reply.data.card);
  if (!input.ok) throw new Error(input.error);
  const recap = toRecap(input.input, { id: "r", turnId: "t", at: 1 });
  return recapSchema.parse(JSON.parse(JSON.stringify(recap))).links;
}

it.each([
  [
    "[Report](</work/My Project/report (final).md>)",
    "Report",
    "/work/My Project/report (final).md",
  ],
  [
    "[Report](/work/My Project/report (final).md)",
    "Report",
    "/work/My Project/report (final).md",
  ],
  [
    "[Report](/work/My%20Project/report%20%28final%29.md)",
    "Report",
    "/work/My Project/report (final).md",
  ],
  [
    "[Report](/work/My%2520Project/report.md)",
    "Report",
    "/work/My%20Project/report.md",
  ],
  [
    "[Report](</work/Café Notes/report (v2).md>)",
    "Report",
    "/work/Café Notes/report (v2).md",
  ],
  [
    String.raw`[Report](/work/report\(final\).md)`,
    "Report",
    "/work/report(final).md",
  ],
  [
    '[Report](</work/My Project/report.md> "Tooltip")',
    "Report",
    "/work/My Project/report.md",
  ],
  [
    "/work/My Project/report (final).md",
    "/work/My Project/report (final).md",
    "/work/My Project/report (final).md",
  ],
  [
    "`/work/My Project/report.md`",
    "/work/My Project/report.md",
    "/work/My Project/report.md",
  ],
  [
    "/work/report%20literal.md",
    "/work/report%20literal.md",
    "/work/report%20literal.md",
  ],
  ["[**Report**](/work/report.md)", "**Report**", "/work/report.md"],
  [
    "[Remote](https://example.com/report%20one?q=two#details)",
    "Remote",
    "https://example.com/report%20one?q=two#details",
  ],
])(
  "preserves the target of %s through parsing and storage",
  (line, title, location) => {
    expect(links(line)).toEqual([{ title, location }]);
  },
);

it.each([
  "[Report](javascript:alert(1))",
  "[Report](data:text/plain,hello)",
  "[Report](file:///work/report.md)",
  "[Report](//example.com/report.md)",
  "[Report](report.md)",
  "[Report](</work/report.md)",
  "[Report](/work/report.md) extra text",
  "[One](/work/one.md) [Two](/work/two.md)",
  "[Report](/work/%00report.md)",
  "[Report](/work/%0Areport.md)",
  "[Report](/work/report.md%0A)",
  "[Report](/work/report.md%0D%0A)",
  "[Report](/work/report.md%00)",
  "[Report](/work/%GGreport.md)",
])("omits malformed or unsupported review destination %s", (line) => {
  expect(links(line)).toEqual([]);
});
