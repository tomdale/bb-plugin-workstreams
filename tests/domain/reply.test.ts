import { describe, expect, it } from "vitest";
import { parse, toText, type Reply } from "../../src/domain/reply.ts";
import {
  componentText,
  replyComponentSchema,
  evidenceFilePath,
  evidenceMarkdown,
} from "../../src/domain/replyComponents.ts";
import {
  COMPONENT_EXAMPLES,
  componentFence,
} from "../../src/domain/replyExamples.ts";
import {
  replyInstructions,
  REPLY_COMPONENT_INSTRUCTIONS,
} from "../../src/domain/replyInstructions.ts";
import { blockInput } from "./replyFixtures.ts";
import { onlyReplyBlock, lastReplyBlock } from "../../src/domain/replyText.ts";
import { COMPOSED_SAMPLES, REPLY_SAMPLES } from "./replySamples.ts";

function read(message: string, streaming = false): Reply {
  const { status, ...input } = blockInput(message, { streaming });
  const result = parse(input, { status });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
const block = (body: string) => `:::reply\n${body}\n:::\n`;

describe("composed replies", () => {
  it.each(Object.entries(COMPOSED_SAMPLES))(
    "reads the %s sample and its recap",
    (_sample, message) => {
      const data = read(message);
      expect(data.card?.state).toBeDefined();
      expect(
        data.body.some(
          (part) => part.type === "text" && part.body.includes("\n\n"),
        ),
      ).toBe(true);
      expect(data.body.some((part) => part.type !== "text")).toBe(true);
      expect(JSON.parse(JSON.stringify(data))).toEqual(data);
      expect(toText(data)).not.toContain("```workstreams");
    },
  );

  it.each(Object.entries(COMPONENT_EXAMPLES))(
    "reads and serializes the %s component",
    (_, example) => {
      expect(replyComponentSchema.safeParse(example).success).toBe(true);
      const data = read(block(componentFence(example)));
      expect(data.body).toEqual([example]);
      expect(componentText(example).length).toBeGreaterThan(0);
      expect(toText(data)).toBe(componentText(example));
    },
  );

  it("keeps prose in place on both sides of a component", () => {
    const data = read(
      block(
        `The caller supplies a percentage.\n\n${componentFence(COMPONENT_EXAMPLES.context)}\n\nConvert it before applying the discount.`,
      ),
    );
    expect(data.body.map((part) => part.type)).toEqual([
      "text",
      "context",
      "text",
    ]);
    expect(data.body[0]).toEqual({
      type: "text",
      body: "The caller supplies a percentage.",
    });
    expect(data.body[2]).toEqual({
      type: "text",
      body: "Convert it before applying the discount.",
    });
  });

  it("preserves long explanations and arbitrary headings without implicit disclosure", () => {
    const paragraphs = Array.from(
      { length: 8 },
      (_, i) =>
        `### Explanation ${i + 1}\n\nOne. Two. Three. Four. Five.\n\n${Array.from({ length: 8 }, (_, n) => `- Item ${n + 1}`).join("\n")}`,
    ).join("\n\n");
    expect(read(block(paragraphs)).body).toEqual([
      { type: "text", body: paragraphs },
    ]);
  });

  it("only folds an explicit Details section", () => {
    const data = read(
      block(
        "Main explanation.\n\n### Details\nSupporting notes.\n\n### More explanation\nThis stays visible.",
      ),
    );
    expect(data.body.map((part) => part.type)).toEqual([
      "text",
      "details",
      "text",
    ]);
    expect(data.body[1]).toEqual({
      type: "details",
      title: "Details",
      body: "Supporting notes.",
    });
    expect(toText(data)).toContain("Supporting notes.");
    expect(data.body[2]).toEqual({
      type: "text",
      body: "### More explanation\nThis stays visible.",
    });
  });

  it.each(REPLY_SAMPLES)(
    "keeps the stored sample $kind readable",
    ({ message }) => {
      const data = read(message);
      expect(toText(data)).not.toBe("");
      expect(
        data.body.every(
          (part) => part.type === "text" || part.type === "details",
        ),
      ).toBe(true);
    },
  );

  it("keeps component fences after a recap section in the body", () => {
    const data = read(
      `:::reply{state="review"}\n# The change is ready\n- [x] Kept the caller contract\n\n### Review\n- Inspect the calculation\n\n${componentFence(COMPONENT_EXAMPLES.change)}\n:::\n`,
    );
    expect(data.card?.review).toEqual(["Inspect the calculation"]);
    expect(data.body).toEqual([COMPONENT_EXAMPLES.change]);
  });

  it("preserves meaningful Markdown whitespace inside text components", () => {
    const markdown =
      "    const value = 1;\n\nA paragraph with its full explanation.\n";
    expect(
      read(block(componentFence({ type: "text", body: markdown }))).body,
    ).toEqual([{ type: "text", body: markdown }]);
  });

  it("keeps a component after explicit Details outside the Markdown fold", () => {
    const data = read(
      block(
        `### Details\nSupporting notes.\n\n${componentFence(COMPONENT_EXAMPLES.change)}`,
      ),
    );
    expect(data.body).toEqual([
      { type: "details", title: "Details", body: "Supporting notes." },
      COMPONENT_EXAMPLES.change,
    ]);
  });

  it("preserves checked and unchecked result status in the text view", () => {
    const data = read(
      ':::reply{state="review"}\n# The change is local\n- [x] Committed the change\n- [ ] Push the branch\n\n### Review\n- Inspect the diff\n:::\n',
    );
    expect(data.card?.results).toEqual([
      { checked: true, markdown: "Committed the change" },
    ]);
    expect(toText(data)).toContain("- [x] Committed the change");
    expect(toText(data)).toContain("### Not done\n\n- [ ] Push the branch");
  });

  it.each([
    '::inline-vis{source="thread-storage" file="sidebar-section-labels.html"}',
    '::inline-vis{source="workspace" file="reports/demo.html" height="400"}',
    '::inline-vis{file="notes.md"}',
    '::unknown-preview{file="report.html"}',
  ])("preserves a standalone directive in body order: %s", (directive) => {
    const message = block(`Before.\n\n${directive}\n\nAfter.`);
    const data = read(message);
    expect(data.body).toEqual([
      { type: "text", body: "Before." },
      { type: "directive", source: directive },
      { type: "text", body: "After." },
    ]);
    expect(toText(data)).toBe(`Before.\n\n${directive}\n\nAfter.`);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    const serverInput = lastReplyBlock(message)!;
    expect(parse(serverInput, { status: serverInput.status })).toEqual({
      ok: true,
      data,
    });
  });

  it.each(["Review", "Next", "Waiting on", "Links", "Details"])(
    "keeps a directive after %s in the body",
    (section) => {
      const directive =
        '::inline-vis{source="thread-storage" file="sidebar-section-labels.html"}';
      const data = read(
        `:::reply{state="review"}\n# Preview ready\n- [x] Created the report\n\n### ${section}\n- Inspect the report\n\n${directive}\n\nAfter.\n:::\n`,
      );
      expect(data.body.slice(-2)).toEqual([
        { type: "directive", source: directive },
        { type: "text", body: "After." },
      ]);
      expect(Object.values(data.card!).flat().join("\n")).not.toContain(
        directive,
      );
    },
  );

  it("keeps incomplete and code-quoted directives as literal Markdown", () => {
    const directive = '::inline-vis{file="report.html"}';
    for (const source of [
      `\`${directive}\``,
      `\`\`\`text\n${directive}\n\`\`\``,
      '::inline-vis{source="thread-storage" file="report.html"',
    ])
      expect(read(block(source)).body).toEqual([
        { type: "text", body: source },
      ]);
    expect(read(`:::reply\n${directive}`, true).body).toEqual([
      { type: "directive", source: directive },
    ]);
  });

  it("keeps ordinary code and headings inside it as Markdown", () => {
    const source =
      "### Example\n\n```ts\n// ### not a section\nconst x = 1;\n```";
    expect(read(block(source)).body).toEqual([{ type: "text", body: source }]);
  });

  it("reads a block whose closing line ends in zero-width characters", () => {
    const message = ":::reply\nAn answer.\n:::\u200c";
    expect(onlyReplyBlock(message)?.status).toBe("closed");
    expect(lastReplyBlock(`Lead.\n\n${message}`)?.status).toBe("closed");
  });

  it("reads a block whose closing line ends in punctuation", () => {
    for (const closer of [":::.", ":::!", "::::."])
      expect(
        onlyReplyBlock(
          `${closer.length > 4 ? "::::" : ":::"}reply\nAn answer.\n${closer}`,
        )?.status,
      ).toBe("closed");
  });

  it("keeps a literal ::: line with a longer outer marker", () => {
    const data = read("::::reply\n```md\n:::\n```\n::::\n");
    expect(data.body).toEqual([{ type: "text", body: "```md\n:::\n```" }]);
  });

  it("keeps malformed component source without losing surrounding prose or the recap", () => {
    const source =
      ':::reply{state="complete"}\n# Investigated the failure\n- [x] The source was preserved\n\nBefore.\n\n```workstreams\nnotAComponent(value: "source")\n```\n\nAfter.\n:::\n';
    const data = read(source);
    expect(data.body.map((part) => part.type)).toEqual([
      "text",
      "unparsed",
      "text",
    ]);
    expect(data.body[1]).toMatchObject({
      source: expect.stringContaining('"source"'),
      error: expect.stringContaining("Component not displayed"),
    });
    expect(toText(data)).toContain("Before.");
    expect(toText(data)).toContain("After.");
  });

  it("shows a pending component until its code fence closes", () => {
    const source =
      ':::reply\nAn explanation.\n\n```workstreams\n{"type":"retiredComponent","value":"';
    expect(read(source, true).body.map((part) => part.type)).toEqual([
      "text",
      "pending",
    ]);
    const completeJson =
      ':::reply\n```workstreams\n{"type":"text","body":"Complete JSON but the fence is still open"}';
    expect(read(completeJson, true).body).toEqual([{ type: "pending" }]);
  });

  it("keeps a final unterminated component as source even if its JSON is valid", () => {
    const data = read(
      ':::reply\n```workstreams\n{"type":"text","body":"Complete JSON"}\n:::\n',
    );
    expect(data.body).toEqual([
      {
        type: "unparsed",
        source: '```workstreams\n{"type":"text","body":"Complete JSON"}',
        error: "Component not displayed: close the workstreams code fence.",
      },
    ]);
  });

  it("accepts an empty streaming prefix but rejects an empty closed reply", () => {
    expect(read(":::reply\n", true)).toEqual({ body: [] });
    const input = blockInput(":::reply\n:::\n");
    expect(parse(input)).toMatchObject({ ok: false });
  });

  it("keeps server parsing consistent with the registered reply versions", () => {
    const input = blockInput(
      ':::reply{v="999" state="complete"}\n# Unsupported reply\n:::\n',
    );
    expect(parse(input)).toEqual({
      ok: false,
      error: "Unsupported reply version.",
    });
    expect(read(':::reply{v="1"}\nA supported reply.\n:::\n').body).toEqual([
      { type: "text", body: "A supported reply." },
    ]);
  });

  it("rejects missing source positions rather than guessing offsets", () => {
    expect(
      parse({
        source: "Text",
        tree: {
          type: "root",
          children: [
            { type: "paragraph", children: [{ type: "text", value: "Text" }] },
          ],
        },
      }),
    ).toMatchObject({ ok: false });
  });

  it("keeps a stateless headline separate from a card", () => {
    expect(read(block("# Python 3.9 or newer"))).toEqual({
      headline: "Python 3.9 or newer",
      body: [],
    });
    const data = read(
      ':::reply{state="complete"}\n# Python 3.9 or newer\n:::\n',
    );
    expect(data.body).toEqual([]);
    expect(data.card).toMatchObject({
      state: "complete",
      headline: "Python 3.9 or newer",
    });
  });

  it("text output includes qualifications, test totals, evidence, and recap actions", () => {
    const data = read(COMPOSED_SAMPLES.change);
    const output = toText(data);
    for (const phrase of [
      "Existing saved orders are unchanged",
      "22 tests passed; 0 failed; 1 skipped",
      "credential was unavailable",
      "reports/tests.json",
      "No push was requested",
      "Check callers",
    ])
      expect(output).toContain(phrase);
    expect(toText(null)).toBe("");
    expect(toText({ body: 42 })).toBe("");
  });
});

describe("whole-reply validation", () => {
  const one = ':::reply{state="complete"}\n# One answer\n:::\n';
  it("accepts one closed top-level reply with surrounding whitespace", () => {
    expect(onlyReplyBlock(`\n${one}\n`)?.status).toBe("closed");
    expect(onlyReplyBlock("::::reply\nA reply.\n::::\n")?.status).toBe(
      "closed",
    );
  });
  it.each([
    `Before.\n\n${one}`,
    `${one}\nAfter.`,
    `${one}\n${one}`,
    "```md\n:::reply\nExample\n:::\n```",
    ":::reply-other\nOther block\n:::\n",
  ])("rejects multiple replies or content outside the reply: %s", (message) => {
    expect(onlyReplyBlock(message)).toBeNull();
  });
  it("keeps server recovery separate from the strict authoring check", () => {
    expect(lastReplyBlock(`${one}\nAfter.`)?.attributes.state).toBe("complete");
    expect(lastReplyBlock(`${one}\n${one}`)?.source).toBe("# One answer\n");
  });
  it("requires a closer at least as long as the opener", () => {
    expect(onlyReplyBlock("::::reply\nA reply.\n:::\n")?.status).toBe(
      "unclosed",
    );
    expect(onlyReplyBlock(":::reply\nA reply.\n")?.status).toBe("unclosed");
  });
});

describe("evidence paths", () => {
  it("keeps filesystem reserved characters literal and line coordinates separate", () => {
    expect(evidenceFilePath("notes/Review #draft? 100%.md", "/work/shop")).toBe(
      "/work/shop/notes/Review #draft? 100%.md",
    );
    expect(evidenceFilePath("../notes/Plan#L2", "/work/shop")).toBeNull();
    expect(evidenceFilePath("notes/../Plan#L2", "/work/shop")).toBe(
      "/work/shop/Plan#L2",
    );
    expect(evidenceFilePath("/work/notes/Plan#L2", "/work/shop")).toBe(
      "/work/notes/Plan#L2",
    );
    expect(
      evidenceMarkdown({
        label: "Evidence",
        location: "/tmp/Review #draft? 100%.md",
        line: 2,
        endLine: 4,
      }),
    ).toBe("[Evidence](</tmp/Review%20%23draft%3F%20100%25.md#L2-L4>)");
    expect(evidenceFilePath("file:///tmp/notes.md", "/work")).toBeNull();
    expect(evidenceFilePath("notes.md", null)).toBeNull();
  });
  it.each([
    { line: 0 },
    { line: 3, endLine: 2 },
    { endLine: 4 },
    { location: "https://example.com", line: 2 },
  ])("rejects invalid file-line coordinates %j", (patch) => {
    expect(
      replyComponentSchema.safeParse({
        ...COMPONENT_EXAMPLES.checks,
        items: [
          {
            name: "Unit tests",
            status: "passed",
            evidence: [
              { label: "Source", location: "src/coupon.ts", ...patch },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("component boundary", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "//example.com/secret",
    "../outside.md",
    "reports/../../outside.md",
    "/tmp/a\nb",
  ])("rejects an unsafe evidence target %s", (location) => {
    expect(
      replyComponentSchema.safeParse({
        ...COMPONENT_EXAMPLES.checks,
        items: [
          {
            name: "Unit tests",
            status: "passed",
            evidence: [{ label: "Source", location }],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("rejects executable or styling fields and nested groups", () => {
    expect(
      replyComponentSchema.safeParse({
        ...COMPONENT_EXAMPLES.change,
        color: "red",
      }).success,
    ).toBe(false);
    expect(
      replyComponentSchema.safeParse({
        type: "group",
        relationship: "peers",
        children: [COMPONENT_EXAMPLES.group, COMPONENT_EXAMPLES.change],
      }).success,
    ).toBe(false);
  });
  it("accepts a delivery stage that needs no detail", () => {
    const parsed = replyComponentSchema.safeParse({
      ...COMPONENT_EXAMPLES.delivery,
      stages: [{ name: "Pushed", status: "done" }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(componentText(parsed.data)).toContain("- Pushed: done");
  });
  it("rejects invalid statuses and invented negative counts", () => {
    expect(
      replyComponentSchema.safeParse({
        ...COMPONENT_EXAMPLES.checks,
        testTotals: { passed: -1, failed: 0, skipped: 0 },
      }).success,
    ).toBe(false);
    expect(
      replyComponentSchema.safeParse({
        ...COMPONENT_EXAMPLES.delivery,
        stages: [{ name: "Push", status: "success", detail: "Claim" }],
      }).success,
    ).toBe(false);
  });
});

describe("delivered instructions", () => {
  it.each([true, false])(
    "stays inside the delivery budget with recap tool %s",
    (recap) =>
      expect(replyInstructions(recap).length).toBeLessThanOrEqual(4096),
  );
  it("gives the component guide its own bounded instruction", () =>
    expect(REPLY_COMPONENT_INSTRUCTIONS.length).toBeLessThanOrEqual(4096));
  it("puts the recap call first and the block last", () => {
    const text = replyInstructions(true);
    expect(text).toContain(
      "When the work is done, call WorkstreamsRecap — the card comes from that call — and then write the block",
    );
    // The block carries the substance the card only summarizes.
    expect(text).toContain(
      "which carries the substance the card only summarizes",
    );
    // One block, written as the turn's last text, with nothing after it.
    expect(text).toContain("Write it as the turn's last text");
    expect(text).toContain("no closing sentence or second summary after it");
    // A question-card turn has no recap call, so the block is the last text.
    expect(text).toContain("When required input is missing, skip the recap:");
    expect(text).toContain("a block is the turn's reply, not a progress note");
    expect(text).toContain(
      "Put `:::reply` and its attributes on their own line",
    );
  });
  it.each([true, false])(
    "keeps a block when the request fixes the output, recap tool %s",
    (recap) => {
      const text = replyInstructions(recap);
      expect(text).toContain(
        "A request that fixes the output — one word, exact text, no formatting — still goes in the block, and changes only what the block holds: the asked-for text and nothing else.",
      );
      // Only a session with the recap tool can be asked for a missing recap.
      expect(
        text.includes(
          "A turn that only reports a missing recap ends at that call, with nothing after it.",
        ),
      ).toBe(recap);
    },
  );
  it("teaches an example that parses through the production path", () => {
    const example = /^:::reply(?:\{[^\n]*\})?\n[\s\S]*?\n:::$/m.exec(
      replyInstructions(true),
    )![0];
    const { status, ...input } = blockInput(example);
    const data = parse(input, { status });
    expect(data.ok).toBe(true);
    if (!data.ok) return;
    // The card belongs to the tool call, so the block carries none of it.
    expect(data.data.card).toBeUndefined();
    expect(data.data.body.some((part) => part.type === "change")).toBe(true);
  });
  it("keeps the reply block as the final message when the session has no recap tool", () => {
    const text = replyInstructions(false);
    expect(text).toContain("Write it as the turn's last text");
    expect(text).toContain(
      "When required input is missing, put the explanation",
    );
    expect(text).not.toContain("WorkstreamsRecap");
  });
});
