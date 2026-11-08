import { describe, expect, it, vi } from "vitest";
import {
  correctionMentioned,
  deterministicReply,
  inspectReply,
  runSlice,
  TASK,
} from "../../eval/reply-architecture.ts";
import type { Completion } from "../../src/server/inference/gateway.ts";

const semantic =
  "## Correction\nUse `(page - 1) * pageSize`.\n\n## Reason\nThe caller counts pages from 1. Corrected offsets are 0 and 20. This is a source calculation; tests were not run.";
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

describe("reply architecture slice", () => {
  it("preserves arbitrary Markdown verbatim in the deterministic path", () => {
    const source = `${semantic}\n\n\`\`\`ts\nconst s = '\"\"\"';\n\`\`\`\n\n:::reply\nNested-looking text.\n:::`;
    const result = inspectReply(deterministicReply(source));
    expect(result.valid).toBe(true);
    expect(result.components).toEqual([{ type: "text", body: source }]);
  });

  it("rejects malformed components, extra text, and unclosed blocks", () => {
    for (const source of [
      ':::reply\n```workstreams\nfinding(title: "Missing fields")\n```\n:::',
      `Outside\n\n${reply}`,
      ":::reply\nUnclosed",
      ":::reply\n:::",
    ])
      expect(inspectReply(source).valid).toBe(false);
  });

  it("flags a bare workstreams marker and component calls that render as prose", () => {
    const result = inspectReply(
      ':::reply\nworkstreams\nrecommendation(choice: "Use the correction", reason: "One-based pages")\n:::',
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Possible unfenced component source rendered as prose",
    );
    expect(
      inspectReply(":::reply\nThe correction uses one-based pages.\n:::").valid,
    ).toBe(true);
  });

  it("runs two task authorings and presents exactly the semantic response", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(completion(semantic))
      .mockResolvedValueOnce(completion(reply));
    const result = await runSlice(complete);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(complete.mock.calls[0]![0].prompt).toBe(TASK);
    expect(complete.mock.calls[1]![0].prompt).toBe(TASK);
    expect(complete.mock.calls[2]![0].prompt).toBe(semantic);
    expect(complete.mock.calls[0]![0].systemPrompt).not.toBe(
      complete.mock.calls[1]![0].systemPrompt,
    );
    expect(Object.values(result.paths).every((path) => path.valid)).toBe(true);
    expect(result.paths.deterministic.components).toEqual([
      { type: "text", body: semantic },
    ]);
    expect(result.semanticCorrectionMentioned).toBe(true);
    expect(result.totalCost).toBeCloseTo(0.003);
  });

  it("retains direct failure while continuing the independent semantic path", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(Error("Gateway unavailable"))
      .mockResolvedValueOnce(completion(semantic))
      .mockResolvedValueOnce(completion(reply));
    const result = await runSlice(complete);
    expect(result.paths.direct.valid).toBe(false);
    expect(result.paths.direct.errors).toContain("Gateway unavailable");
    expect(result.paths.deterministic.valid).toBe(true);
    expect(result.paths.presentation.valid).toBe(true);
  });

  it.each([
    completion(""),
    completion(semantic, { stopReason: "length" }),
    completion(semantic, { stopReason: "max_tokens" }),
  ])(
    "keeps unusable semantic calls and blocks downstream presentation",
    async (failed) => {
      const complete = vi
        .fn()
        .mockResolvedValueOnce(completion(reply))
        .mockResolvedValueOnce(failed);
      const result = await runSlice(complete);
      expect(complete).toHaveBeenCalledTimes(2);
      expect(result.calls.semantic!.completion).toEqual(failed);
      expect(result.paths.deterministic.valid).toBe(false);
      expect(result.paths.presentation.valid).toBe(false);
      expect(result.totalCost).toBeCloseTo(0.002);
    },
  );

  it("retains token-limited presentation even when its block parses", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(completion(reply))
      .mockResolvedValueOnce(completion(semantic))
      .mockResolvedValueOnce(completion(reply, { stopReason: "length" }));
    const result = await runSlice(complete);
    expect(result.paths.presentation.valid).toBe(false);
    expect(result.paths.presentation.source).toBe(reply);
    expect(result.paths.presentation.errors).toContain(
      "Response reached token limit",
    );
  });

  it("stops further calls after the reported-cost guard", async () => {
    const complete = vi.fn().mockResolvedValue(
      completion(reply, {
        usage: { input: 10, output: 20, cost: 0.75 },
      }),
    );
    const result = await runSlice(complete);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.paths.direct.valid).toBe(true);
    expect(result.paths.deterministic.valid).toBe(false);
    expect(result.paths.presentation.valid).toBe(false);
  });

  it("reports a lexical correction cue without calling it correctness", () => {
    expect(correctionMentioned("`(page - 1) * pageSize`")).toBe(true);
    expect(correctionMentioned("page * pageSize")).toBe(false);
    expect(correctionMentioned("Do not use (page - 1) * pageSize")).toBe(true);
  });
});
