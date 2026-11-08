import { describe, expect, it } from "vitest";
import { compileComponents } from "../../src/domain/replyCompile.ts";
import {
  componentText,
  replyComponentSchema,
} from "../../src/domain/replyComponents.ts";
import {
  COMPONENT_EXAMPLES,
  componentFence,
} from "../../src/domain/replyExamples.ts";
import { parse } from "../../src/domain/reply.ts";
import { onlyReplyBlock } from "../../src/domain/replyText.ts";

const read = (source: string) => {
  const block = onlyReplyBlock(`:::reply\n${source}\n:::`)!;
  const result = parse(block);
  if (!result.ok) throw Error(result.error);
  return result.data.body;
};

describe("native report components", () => {
  it.each(["table", "references", "review", "actions"] as const)(
    "round-trips %s through a real reply",
    (name) => {
      expect(read(componentFence(COMPONENT_EXAMPLES[name]))).toEqual([
        COMPONENT_EXAMPLES[name],
      ]);
    },
  );

  it("requires rectangular tables without losing their neighbors", () => {
    const parts = compileComponents(
      'text(body: "Before")\ntable(title: "Bad", columns: ["A", "B"], rows: [["only one"]])\ntext(body: "After")',
    );
    expect(parts.map((part) => part.ok)).toEqual([true, false, true]);
    expect(parts[1]).toMatchObject({
      error: expect.stringContaining("one cell per column"),
    });
  });

  it("accepts empty tables and empty cells", () => {
    for (const rows of [[], [["", "value"]]])
      expect(
        replyComponentSchema.safeParse({
          type: "table",
          title: "Values",
          columns: ["A", "B"],
          rows,
        }).success,
      ).toBe(true);
    expect(
      componentText({
        type: "table",
        title: "Empty",
        columns: ["A"],
        rows: [],
      }),
    ).toContain("No rows");
  });

  it("preserves multiline cells and escapes table separators in the text view", () => {
    const part = {
      type: "table" as const,
      title: "Values",
      columns: ["A"],
      rows: [["left | right\nnext line"]],
    };
    expect(read(componentFence(part))).toEqual([part]);
    expect(componentText(part)).toContain("left \\| right<br>next line");
  });

  it("allows complete lists beyond recap and ordinary component limits", () => {
    const cases = [
      {
        type: "references",
        title: "Files",
        items: Array.from({ length: 40 }, (_, i) => ({
          label: `File ${i}`,
          location: `src/file-${i}.ts`,
        })),
      },
      {
        type: "review",
        title: "Review",
        steps: Array.from({ length: 40 }, (_, i) => ({
          title: `Step ${i}`,
          expected: `Result ${i}`,
        })),
      },
      {
        type: "actions",
        title: "Next actions",
        items: Array.from({ length: 40 }, (_, i) => ({
          title: `Option ${i}`,
          owner: "User",
          permission: "Optional",
        })),
      },
    ];
    for (const value of cases) {
      const parsed = replyComponentSchema.parse(value);
      expect(read(componentFence(parsed))).toEqual([parsed]);
      expect(componentText(parsed)).toContain("39");
    }
  });

  it("bounds report size instead of silently truncating it", () => {
    expect(
      replyComponentSchema.safeParse({
        type: "references",
        title: "Files",
        items: Array.from({ length: 257 }, () => ({ label: "File" })),
      }).success,
    ).toBe(false);
    expect(
      replyComponentSchema.safeParse({
        type: "table",
        title: "Wide",
        columns: Array.from({ length: 13 }, () => "Column"),
        rows: [],
      }).success,
    ).toBe(false);
  });

  it("applies file confinement and line validation to every reference", () => {
    for (const item of [
      { label: "Escape", location: "../secret" },
      { label: "Script", location: "javascript:alert(1)" },
      { label: "Range", location: "src/file.ts", line: 8, endLine: 2 },
    ])
      expect(
        replyComponentSchema.safeParse({
          type: "references",
          title: "References",
          items: [item],
        }).success,
      ).toBe(false);
  });

  it("preserves thread references and rejects conflicting targets", () => {
    const part = {
      type: "references" as const,
      title: "Owners",
      items: [
        {
          label: "Implementation owner",
          threadId: "thr_review_owner",
          detail: "Reports back here",
        },
      ],
    };
    expect(read(componentFence(part))).toEqual([part]);
    expect(componentText(part)).toContain("@thread:thr_review_owner");
    expect(
      replyComponentSchema.safeParse({
        ...part,
        items: [{ ...part.items[0], location: "src/file.ts" }],
      }).success,
    ).toBe(false);
  });

  it("retains conditions, owners, permissions, expected results, and full request text", () => {
    const actions = {
      type: "actions" as const,
      title: "Next",
      scope: "Proposed",
      items: [
        {
          title: "Ask for a fix",
          detail: "Targeted correction",
          owner: "Agent",
          condition: "If review fails",
          permission: "New request required",
          message: "Fix the reported mismatch",
          recommended: true,
        },
      ],
    };
    const review = {
      type: "review" as const,
      title: "Review",
      scope: "Unperformed",
      steps: [
        {
          title: "Open the panel",
          detail: "Use the reported version",
          requires: "Disposable thread",
          expected: "One row",
        },
      ],
    };
    for (const value of [actions, review]) {
      expect(read(componentFence(value))).toEqual([value]);
      const text = componentText(value);
      for (const field of value.type === "actions"
        ? [
            "Proposed",
            "Targeted correction",
            "Agent",
            "If review fails",
            "New request required",
            "Fix the reported mismatch",
            "Recommended",
          ]
        : [
            "Unperformed",
            "Use the reported version",
            "Disposable thread",
            "One row",
          ])
        expect(text).toContain(field);
    }
  });
});
