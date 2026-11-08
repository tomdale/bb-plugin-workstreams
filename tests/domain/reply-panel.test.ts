import { describe, expect, it } from "vitest";
import type { ReplyPart } from "../../src/domain/replyComponents.ts";
import { COMPONENT_EXAMPLES } from "../../src/domain/replyExamples.ts";
import {
  actionsCount,
  arrangeBody,
  checksSettled,
  checksTiles,
  deliveryCount,
  detailsSummary,
  tableCounts,
} from "../../src/domain/replyPanel.ts";

const text = (body: string): ReplyPart => ({ type: "text", body });
const { actions, checks, delivery, details, facts, table } = COMPONENT_EXAMPLES;
type Of<T extends ReplyPart["type"]> = Extract<ReplyPart, { type: T }>;

describe("panel order", () => {
  it("draws the lead, then actions, then the rest as written, then folds", () => {
    const body: ReplyPart[] = [
      text("Lead."),
      text("More lead."),
      details,
      checks,
      text("Glue."),
      actions,
      facts,
      { type: "unparsed", source: "x", error: "Bad" },
    ];
    expect(arrangeBody(body)).toEqual([
      text("Lead."),
      text("More lead."),
      actions,
      checks,
      text("Glue."),
      facts,
      { type: "unparsed", source: "x", error: "Bad" },
      details,
    ]);
  });

  it("draws actions first when the reply has no lead", () => {
    expect(arrangeBody([table, actions]).map((part) => part.type)).toEqual([
      "actions",
      "table",
    ]);
  });
});

describe("computed counts", () => {
  it("counts steps and decisions separately", () => {
    expect(actionsCount(actions as Of<"actions">)).toBe("2 steps, 1 decision");
    expect(
      actionsCount({ type: "actions", items: [{ action: "Merge" }] }),
    ).toBe("1 step");
    expect(
      actionsCount({
        type: "actions",
        items: [{ action: "Choose", decide: true }],
      }),
    ).toBe("1 decision");
  });

  it("turns a failure red and a full pass green, and names what did not pass", () => {
    const base = checks as Of<"checks">;
    expect(checksTiles(base)).toEqual([
      { value: "1 of 2", label: "checks passed, 1 skipped", tone: "neutral" },
      { value: "212", label: "tests passed, 1 skipped", tone: "good" },
    ]);
    expect(checksSettled(base)).toBe(false);
    const failed: Of<"checks"> = {
      ...base,
      testTotals: { passed: 1200, failed: 2, skipped: 0 },
      items: [
        { name: "A", status: "failed" },
        { name: "B", status: "untested" },
        { name: "C", status: "blocked" },
      ],
    };
    expect(checksTiles(failed)).toEqual([
      {
        value: "0 of 3",
        label: "checks passed, 1 failed, 1 blocked, 1 not tested",
        tone: "bad",
      },
      { value: "1,200", label: "tests passed, 2 failed", tone: "bad" },
    ]);
    const passed: Of<"checks"> = {
      type: "checks",
      title: "T",
      scope: "S",
      items: [{ name: "A", status: "passed" }],
    };
    expect(checksTiles(passed)).toEqual([
      { value: "1 of 1", label: "check passed", tone: "good" },
    ]);
    expect(checksSettled(passed)).toBe(true);
  });

  it("counts delivery stages done and table rows by state", () => {
    expect(deliveryCount(delivery as Of<"delivery">)).toBe("2 of 3 done");
    expect(tableCounts(table as Of<"table">)).toBe("2 Updated, 1 Check");
    expect(
      tableCounts({
        type: "table",
        title: "T",
        columns: ["A"],
        rows: [{ cells: ["x"] }, { cells: ["y"] }],
      }),
    ).toBe("2 rows");
  });
});

describe("details summary", () => {
  it.each([
    [(details as Of<"details">).body, "1 code block"],
    ["One.\n\nTwo.\n\nThree.", "3 paragraphs"],
    ["- [a](a.md)\n- [b](b.md)", "2 links"],
    [
      "1. First\n2. Second\n3. Third with [a link](https://x.dev)",
      "1 link, 3 list items",
    ],
    ["| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |", "2 table rows"],
    [
      "```ts\nconst a = '- not a list';\n```\n\n```sh\nnpm test\n```\n\nSee https://x.dev",
      "2 code blocks, 1 link",
    ],
  ])("summarizes %j as %s", (body, summary) => {
    expect(detailsSummary(body)).toBe(summary);
  });
});
