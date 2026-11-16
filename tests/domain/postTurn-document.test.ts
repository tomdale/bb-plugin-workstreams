import { describe, expect, it } from "vitest";
import {
  canonicalDocument,
  checksSummary,
  DOCUMENT_LIMITS,
  documentText,
  foldedTotals,
  validateDocument,
  type EnhancedDocument,
} from "../../src/domain/postTurn/document.ts";
import {
  assistantMessageId,
  parseAssistantRowId,
} from "../../src/domain/postTurn/message.ts";
import {
  isReplyBlock,
  RESPONSE_INSTRUCTIONS,
} from "../../src/domain/postTurn/instructions.ts";
import { CORRECTION, DEPLOYED_CHANGE } from "../fixtures/postTurn.ts";

const issuesOf = (candidate: unknown) => {
  const result = validateDocument(candidate);
  return result.ok ? [] : result.issues;
};
const paragraph = (text: unknown) => ({
  version: 1,
  blocks: [{ type: "paragraph", text }],
});

describe("validateDocument", () => {
  it("accepts both fixture shapes", () => {
    expect(validateDocument(DEPLOYED_CHANGE)).toEqual({
      ok: true,
      document: DEPLOYED_CHANGE,
    });
    expect(validateDocument(CORRECTION).ok).toBe(true);
  });

  it.each([
    ["no version", { blocks: [] }, "version"],
    ["another version", { version: 2, blocks: [] }, "version"],
    ["no blocks", { version: 1, blocks: [] }, "blocks"],
    [
      "an unknown block type",
      { version: 1, blocks: [{ type: "html", html: "<b>x</b>" }] },
      "blocks[0].type",
    ],
    [
      "an event handler field",
      {
        version: 1,
        blocks: [{ type: "paragraph", text: "x", onClick: "alert(1)" }],
      },
      "blocks[0]",
    ],
    [
      "a style field",
      { version: 1, blocks: [{ type: "note", text: "x", style: "color:red" }] },
      "blocks[0]",
    ],
    [
      "a nested unknown field",
      {
        version: 1,
        blocks: [
          {
            type: "checks",
            items: [{ name: "Build", result: "passed", href: "x" }],
          },
        ],
      },
      "blocks[0].items[0]",
    ],
    [
      "an unknown result",
      {
        version: 1,
        blocks: [{ type: "checks", items: [{ name: "Build", result: "ok" }] }],
      },
      "blocks[0].items[0].result",
    ],
    [
      "a negative count",
      {
        version: 1,
        blocks: [
          {
            type: "checks",
            items: [
              { name: "Tests", result: "passed", totals: { passed: -1 } },
            ],
          },
        ],
      },
      "blocks[0].items[0].totals.passed",
    ],
    ["a non-text paragraph", paragraph(42), "blocks[0].text"],
  ])("rejects %s at its field", (_, candidate, path) => {
    const issues = issuesOf(candidate);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((issue) => issue.path)).toContain(path);
  });

  it("rejects content rules with field paths", () => {
    expect(issuesOf(paragraph("  "))).toEqual([
      { path: "blocks[0].text", message: "Text is empty." },
    ]);
    expect(issuesOf(paragraph("Run <script>alert(1)</script>"))[0]).toEqual({
      path: "blocks[0].text",
      message: "HTML is not rendered. Put literal markup in a code span.",
    });
    expect(
      issuesOf(paragraph(["Use ", { code: "<Icon name>" }, " here"])),
    ).toEqual([]);
    expect(issuesOf(paragraph(["a ", "<img src=x>"]))[0]?.path).toBe(
      "blocks[0].text[1]",
    );
    expect(issuesOf(paragraph("bell\u0007"))[0]?.message).toBe(
      "Text contains control characters.",
    );
  });

  it("checks table shape and check consistency", () => {
    expect(
      issuesOf({
        version: 1,
        blocks: [
          { type: "table", columns: ["A", "B"], rows: [["x", 1], ["y"]] },
        ],
      }),
    ).toEqual([
      {
        path: "blocks[0].rows[1]",
        message: "Row has 1 cells; the table has 2 columns.",
      },
    ]);
    expect(
      issuesOf({
        version: 1,
        blocks: [
          {
            type: "checks",
            items: [
              { name: "Tests", result: "passed", totals: { failed: 2 } },
              { name: "Lint", result: "passed", totals: {} },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        path: "blocks[0].items[0].result",
        message: "A check that reports 2 failed tests did not pass.",
      },
      {
        path: "blocks[0].items[1].totals",
        message: "Report at least one count, or omit totals.",
      },
    ]);
  });

  it("bounds size, depth, and count", () => {
    const long = issuesOf(paragraph("x".repeat(DOCUMENT_LIMITS.chars)));
    expect(long).toHaveLength(1);
    expect(long[0]!.path).toBe("(document)");
    expect(
      issuesOf(paragraph("x".repeat(DOCUMENT_LIMITS.text + 1)))[0]?.message,
    ).toMatch(/limit is 1500/);
    const deep = {
      version: 1,
      blocks: [
        {
          type: "section",
          title: "One",
          blocks: [
            {
              type: "section",
              title: "Two",
              blocks: [
                {
                  type: "section",
                  title: "Three",
                  blocks: [{ type: "paragraph", text: "x" }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(issuesOf(deep)).toEqual([
      {
        path: "blocks[0].blocks[0].blocks[0]",
        message: "Sections nest at most 2 deep.",
      },
    ]);
    const many = {
      version: 1,
      blocks: Array.from({ length: DOCUMENT_LIMITS.blocks + 1 }, () => ({
        type: "paragraph",
        text: "x",
      })),
    };
    expect(issuesOf(many)).toEqual([
      { path: "blocks", message: "Use at most 40 blocks in all." },
    ]);
  });

  it("caps the issues it lists", () => {
    const issues = issuesOf({
      version: 1,
      blocks: Array.from({ length: 30 }, () => ({
        type: "paragraph",
        text: " ",
      })),
    });
    expect(issues).toHaveLength(20);
  });

  it("refuses values that are not JSON", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(issuesOf(cyclic)).toEqual([
      { path: "(document)", message: "Not a JSON value." },
    ]);
  });
});

describe("canonicalDocument", () => {
  it("compares documents regardless of key order", () => {
    const reordered = JSON.parse(
      JSON.stringify(CORRECTION, (_, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).reverse())
          : value,
      ),
    );
    expect(canonicalDocument(reordered)).toBe(canonicalDocument(CORRECTION));
    expect(canonicalDocument(DEPLOYED_CHANGE)).not.toBe(
      canonicalDocument(CORRECTION),
    );
  });
});

describe("checks summaries", () => {
  it("derives the folded line from results, never from a claim", () => {
    const checks = (
      DEPLOYED_CHANGE.blocks[0] as {
        blocks: { type: string; items?: unknown }[];
      }
    ).blocks[3] as Extract<
      EnhancedDocument["blocks"][number],
      { type: "checks" }
    >;
    expect(checksSummary(checks.items, "local")).toBe(
      "All four local checks passed",
    );
    expect(foldedTotals(checks.items)).toBe("1 test skipped");
    expect(
      checksSummary([
        { name: "Build", result: "passed" },
        { name: "Tests", result: "failed", totals: { failed: 3 } },
        { name: "Lint", result: "skipped" },
      ]),
    ).toBe("3 checks: 1 passed, 1 failed, 1 skipped");
    expect(
      foldedTotals([
        { name: "Tests", result: "failed", totals: { failed: 3, skipped: 2 } },
      ]),
    ).toBe("3 tests failed, 2 tests skipped");
  });
});

describe("documentText", () => {
  it("includes folded check rows, totals, tables, notes, and code spans", () => {
    expect(documentText(DEPLOYED_CHANGE)).toBe(
      [
        "## Snooze presets now follow you between windows",
        "A preset saved in one window appears in every open window within a second. Editing a preset no longer resets the snoozes that already use it.",
        "- Deleting a preset leaves current snoozes running until they end.\n- The stored shape is unchanged, so `snoozePrefs` needs no migration.",
        "I pushed the change to `main` and reloaded Workstreams.",
        "All four local checks passed:\n- Typecheck: passed\n- Build: passed\n- Plugin smoke check: passed\n- Test suite: passed (2,104 passed, 0 failed, 1 skipped)",
        "Note: Windows opened before the reload pick up presets after their next refresh.",
      ].join("\n\n"),
    );
    const text = documentText(CORRECTION);
    expect(text).toContain(
      "Correction: I overstated how often the summary dropped the deadline.\nThis result no longer supports my earlier suggestion to switch summary models.",
    );
    expect(text).toContain(
      "| Model | Kept the deadline | Runs |\n| --- | --- | --- |\n| Model A | 5 | 5 |\n| Model B | 5 | 5 |\n\nFive runs per model on the revised note.",
    );
    expect(text).toContain(
      "Note: These are small samples, not a general reliability comparison.",
    );
  });

  it("escapes table pipes and code spans that hold backticks", () => {
    const text = documentText({
      version: 1,
      blocks: [
        {
          type: "table",
          columns: ["Pattern"],
          rows: [[[{ code: "a|b `c`" }]]],
        },
      ],
    });
    expect(text).toContain("| `` a\\|b `c` `` |");
  });
});

describe("message identity", () => {
  it("names the row BB draws for a thread's own final message", () => {
    const ref = { threadId: "thr_a", turnId: "turn-1", itemId: "msg_9:x" };
    const id = assistantMessageId(ref);
    expect(id).toBe(
      "thr_a:assistant:kind:assistant|turn:turn-1|parent:root|item:msg_9:x",
    );
    expect(parseAssistantRowId(id)).toEqual(ref);
  });

  it.each([
    "thr_a:user-seed:42",
    "thr_a:assistant:legacy:12",
    "thr_a:assistant:kind:assistant|turn:t|parent:call_1|item:i",
    "thr_p:delegation:call_1:child:thr_a:assistant:kind:assistant|turn:t|parent:root|item:i",
    "thr_a:turn-1:turn",
  ])("ignores %s", (rowId) => {
    expect(parseAssistantRowId(rowId)).toBeNull();
  });
});

describe("response contract", () => {
  it("recognizes a reply block only at the start of a line", () => {
    expect(isReplyBlock(':::reply{state="complete"}\n# Done\n:::')).toBe(true);
    expect(isReplyBlock("Intro\n::::reply\nx\n::::")).toBe(true);
    expect(isReplyBlock("The final reply uses `:::reply`.")).toBe(false);
  });

  it("asks for plain Markdown without reply syntax", () => {
    expect(RESPONSE_INSTRUCTIONS).toMatch(/plain Markdown/);
    expect(RESPONSE_INSTRUCTIONS).toMatch(/write no `:::reply` block/);
    expect(RESPONSE_INSTRUCTIONS.length).toBeLessThan(4096);
  });
});
