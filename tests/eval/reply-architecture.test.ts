import { describe, expect, it, vi } from "vitest";
import {
  deterministicReply,
  runSlice,
  sliceNeedsReview,
  TASK,
  UI_EXAMPLES,
} from "../../eval/reply-architecture.ts";
import {
  componentUse,
  corruptionProblems,
  inspectReply,
  readFidelity,
} from "../../eval/reply-architecture-checks.ts";
import type { Completion } from "../../src/server/inference/gateway.ts";

const semantic =
  "## Correction\nUse `(page - 1) * pageSize`.\n\nThe caller counts pages from 1. Corrected offsets are 0 and 20 at pageSize=10. This is a source calculation; tests were not run.";
const reply = deterministicReply(semantic);
const completion = (
  text: string,
  overrides: Partial<Completion> = {},
): Completion => ({
  text,
  reasoning: null,
  stopReason: "stop",
  usage: { input: 10, output: 20, cost: 0.001 },
  ...overrides,
});
const verdict = (id: string) => ({
  id,
  status: "pass",
  reason: "Required meaning preserved",
  issues: [],
});
const judged = (ids = ["direct", "semantic", "presentation"]) =>
  completion(JSON.stringify({ verdicts: ids.map(verdict) }));
const checkCorruption = (source: string) =>
  corruptionProblems(inspectReply(source).components, source);

describe("reply architecture checks", () => {
  it("preserves arbitrary Markdown verbatim in the deterministic path", () => {
    const source = `${semantic}\n\n\`\`\`ts\nconst s = '\"\"\"';\n\`\`\`\n\n:::reply\nNested-looking text.\n:::`;
    const result = inspectReply(deterministicReply(source));
    expect(result.valid).toBe(true);
    expect(result.components).toEqual([{ type: "text", body: source }]);
  });

  it("rejects malformed components, extra text, and unclosed blocks as format errors", () => {
    for (const source of [
      ':::reply\n```workstreams\nfinding(title: "Missing fields")\n```\n:::',
      `Outside\n\n${reply}`,
      ":::reply\nUnclosed",
      ":::reply\n:::",
    ])
      expect(inspectReply(source).valid).toBe(false);
  });

  it.each([
    'workstreams\nrecommendation(choice: "Use X", reason: "Y")',
    'recommendation(choice: "Use X", reason: "Y")',
    'workstreams\nrecommendation(\n  choice: "Use X",\n  reason: "Y"\n)',
  ])(
    "separates parseable Markdown from suspected source leakage: %s",
    (body) => {
      const source = `:::reply\n${body}\n:::`;
      const inspected = inspectReply(source);
      expect(inspected.valid).toBe(true);
      expect(componentUse(inspected.components).status).toBe("none");
      expect(checkCorruption(source)).toContain(
        "Possible unfenced component call in prose",
      );
    },
  );

  it("flags the duplicated-answer delimiter failure independently of valid format", () => {
    const source =
      ':::reply\nFirst answer.\n:::oscar"}:::reply\nSecond answer.\n:::';
    expect(inspectReply(source).valid).toBe(true);
    expect(checkCorruption(source).length).toBeGreaterThan(0);
  });

  it("detects wrong component directives and leaves code examples untouched", () => {
    expect(
      checkCorruption(':::reply\n:::workstreams\ntext(body: "A")\n:::\n:::')
        .length,
    ).toBeGreaterThan(0);
    const source =
      ':::reply\n```text\nrecommendation(choice: "Example", reason: "Example")\n:::reply\n```\n:::';
    expect(checkCorruption(source)).toEqual([]);
  });

  it("inspects prose fields inside typed and grouped components, preserving fenced examples", () => {
    const finding = {
      type: "finding" as const,
      title: "Diagnosis",
      explanation: 'recommendation(choice: "X", reason: "Y")',
      certainty: "inferred" as const,
    };
    expect(corruptionProblems([finding], "")).toContain(
      "Possible unfenced component call in prose",
    );
    expect(
      corruptionProblems(
        [
          {
            type: "group",
            relationship: "supporting",
            children: [finding, { type: "text", body: "Support" }],
          },
        ],
        "",
      ),
    ).toContain("Possible unfenced component call in prose");
    expect(
      corruptionProblems(
        [
          {
            ...finding,
            explanation: `\`\`\`text\n${finding.explanation}\n\`\`\``,
          },
        ],
        "",
      ),
    ).toEqual([]);
  });

  it("reports information component use without calling ordinary Markdown invalid", () => {
    expect(componentUse(inspectReply(reply).components)).toEqual({
      status: "none",
      count: 0,
      types: [],
    });
    const source =
      ':::reply\n```workstreams\nrecommendation(choice: "X", reason: "Y")\n```\n:::';
    expect(componentUse(inspectReply(source).components)).toEqual({
      status: "used",
      count: 1,
      types: ["recommendation"],
    });
    expect(checkCorruption(source)).toEqual([]);
  });

  it("retains a grounded fidelity failure and rejects unsupported quotes or contradictory verdicts", () => {
    const comparisons = [
      {
        id: "direct" as const,
        source: "The change is proposed.",
        answer: "The change is deployed.",
      },
    ];
    const failure = {
      id: "direct",
      status: "fail",
      reason: "Action status changed",
      issues: [
        {
          explanation: "Proposal changed into deployment",
          answerQuote: "deployed",
          sourceQuote: "proposed",
        },
      ],
    };
    expect(
      readFidelity(JSON.stringify({ verdicts: [failure] }), comparisons).get(
        "direct",
      )?.status,
    ).toBe("fail");
    for (const invalid of [
      { ...failure, status: "pass" },
      { ...failure, issues: [] },
      {
        ...failure,
        issues: [{ ...failure.issues[0], answerQuote: "invented quote" }],
      },
      {
        ...failure,
        issues: [{ ...failure.issues[0], sourceQuote: "invented quote" }],
      },
      {
        ...failure,
        issues: [
          { explanation: "Unsupported", answerQuote: "", sourceQuote: "" },
        ],
      },
    ])
      expect(() =>
        readFidelity(JSON.stringify({ verdicts: [invalid] }), comparisons),
      ).toThrow();
    expect(() =>
      readFidelity(
        JSON.stringify({ verdicts: [verdict("semantic")] }),
        comparisons,
      ),
    ).toThrow();
    expect(() =>
      readFidelity(
        JSON.stringify({ verdicts: [failure, failure] }),
        comparisons,
      ),
    ).toThrow();
  });
});

describe("reply architecture slice", () => {
  it("gives both UI authorings the same worked examples and presents the exact semantic source", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(completion(semantic))
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(judged());
    const result = await runSlice(complete);
    expect(complete).toHaveBeenCalledTimes(4);
    expect(complete.mock.calls[0]![0].prompt).toBe(TASK);
    expect(complete.mock.calls[1]![0].prompt).toBe(TASK);
    expect(complete.mock.calls[2]![0].prompt).toBe(semantic);
    for (const index of [0, 2])
      expect(complete.mock.calls[index]![0].systemPrompt).toContain(
        UI_EXAMPLES,
      );
    expect(complete.mock.calls[1]![0].systemPrompt).not.toContain(UI_EXAMPLES);
    expect(complete.mock.calls[3]![0].outputSchema).toBeDefined();
    const comparisons = JSON.parse(
      complete.mock.calls[3]![0].prompt,
    ).comparisons;
    expect(comparisons).toEqual([
      { id: "direct", source: TASK, answer: reply },
      { id: "semantic", source: TASK, answer: semantic },
      { id: "presentation", source: semantic, answer: reply },
    ]);
    expect(result.paths.deterministic.components).toEqual([
      { type: "text", body: semantic },
    ]);
    expect(result.paths.deterministic.checks.fidelity.method).toBe(
      "exact-preservation",
    );
    expect(result.paths.presentation.checks.componentUse.status).toBe("none");
    expect(sliceNeedsReview(result)).toBe(false);
    expect(result.totalCost).toBeCloseTo(0.004);
  });

  it("keeps format, corruption, and fidelity failures independent", async () => {
    const leaked =
      ':::reply\nrecommendation(choice: "Use X", reason: "Y")\n:::';
    const complete = vi
      .fn()
      .mockResolvedValueOnce(completion(leaked))
      .mockResolvedValueOnce(completion(semantic))
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(judged());
    const result = await runSlice(complete);
    expect(result.paths.direct.checks.format.status).toBe("pass");
    expect(result.paths.direct.checks.corruption.status).toBe("fail");
    expect(result.paths.direct.checks.fidelity.status).toBe("pass");
    expect(sliceNeedsReview(result)).toBe(true);
  });

  it("reports a fidelity failure independently of valid syntax and clean prose", async () => {
    const wrong = ":::reply\nThe first page starts at offset 10.\n:::";
    const verdicts = [
      {
        id: "direct",
        status: "fail",
        reason: "The first offset is wrong",
        issues: [
          {
            explanation: "The contract starts at zero",
            answerQuote: "offset 10",
            sourceQuote: "The first page starts at offset 0.",
          },
        ],
      },
      verdict("semantic"),
      verdict("presentation"),
    ];
    const complete = vi
      .fn()
      .mockResolvedValueOnce(completion(wrong))
      .mockResolvedValueOnce(completion(semantic))
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(completion(JSON.stringify({ verdicts })));
    const result = await runSlice(complete);
    expect(result.paths.direct.checks.format.status).toBe("pass");
    expect(result.paths.direct.checks.corruption.status).toBe("pass");
    expect(result.paths.direct.checks.fidelity.status).toBe("fail");
    expect(sliceNeedsReview(result)).toBe(true);
  });

  it("retains direct failure while judging the independent semantic path", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(Error("Gateway unavailable"))
      .mockResolvedValueOnce(completion(semantic))
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(judged(["semantic", "presentation"]));
    const result = await runSlice(complete);
    expect(result.paths.direct.checks.format.status).toBe("blocked");
    expect(result.paths.direct.checks.format.errors).toContain(
      "Gateway unavailable",
    );
    expect(result.paths.direct.checks.fidelity.status).toBe("blocked");
    expect(result.paths.presentation.checks.fidelity.status).toBe("pass");
  });

  it.each([
    completion(""),
    completion(semantic, { stopReason: "length" }),
    completion(semantic, { stopReason: "max_tokens" }),
  ])(
    "retains unusable semantic calls and blocks downstream paths",
    async (failed) => {
      const complete = vi
        .fn()
        .mockResolvedValueOnce(completion(reply))
        .mockResolvedValueOnce(failed)
        .mockResolvedValueOnce(judged(["direct"]));
      const result = await runSlice(complete);
      expect(complete).toHaveBeenCalledTimes(3);
      expect(result.calls.semantic!.completion).toEqual(failed);
      expect(result.paths.deterministic.checks.format.status).toBe("blocked");
      expect(result.paths.presentation.checks.componentUse.status).toBe(
        "blocked",
      );
      expect(result.semanticFidelity.status).toBe("blocked");
      expect(result.totalCost).toBeCloseTo(0.003);
    },
  );

  it("retains truncated presentation separately from valid block syntax", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(completion(semantic))
      .mockResolvedValueOnce(completion(reply, { stopReason: "length" }))
      .mockResolvedValueOnce(judged(["direct", "semantic"]));
    const result = await runSlice(complete);
    expect(result.paths.presentation.checks.format.status).toBe("fail");
    expect(result.paths.presentation.source).toBe(reply);
    expect(result.paths.presentation.checks.fidelity.status).toBe("blocked");
  });

  it.each([completion("Not JSON"), completion("{}", { stopReason: "length" })])(
    "fails closed on unusable fidelity output while retaining authoring results",
    async (badJudge) => {
      const complete = vi
        .fn()
        .mockResolvedValueOnce(completion(reply))
        .mockResolvedValueOnce(completion(semantic))
        .mockResolvedValueOnce(completion(reply))
        .mockResolvedValueOnce(badJudge);
      const result = await runSlice(complete);
      expect(result.paths.direct.checks.format.status).toBe("pass");
      expect(result.paths.direct.checks.fidelity.status).toBe("error");
      expect(result.paths.deterministic.checks.fidelity.status).toBe("pass");
      expect(result.calls.fidelity!.completion).toEqual(badJudge);
      expect(sliceNeedsReview(result)).toBe(true);
    },
  );

  it("requires inspection for a judge's review verdict", async () => {
    const judgedReview = {
      verdicts: [
        verdict("direct"),
        verdict("semantic"),
        {
          ...verdict("presentation"),
          status: "review",
          reason: "Action-status wording is ambiguous",
        },
      ],
    };
    const complete = vi
      .fn()
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(completion(semantic))
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(completion(JSON.stringify(judgedReview)));
    const result = await runSlice(complete);
    expect(result.paths.presentation.checks.fidelity.status).toBe("review");
    expect(sliceNeedsReview(result)).toBe(true);
  });

  it("stops further calls after the reported-cost guard", async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(
        completion(reply, { usage: { input: 10, output: 20, cost: 0.75 } }),
      );
    const result = await runSlice(complete);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.paths.direct.checks.format.status).toBe("pass");
    expect(result.paths.direct.checks.fidelity.status).toBe("error");
    expect(result.paths.presentation.checks.format.status).toBe("blocked");
    expect(sliceNeedsReview(result)).toBe(true);
  });
});
