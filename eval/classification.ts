import { writeFile } from "node:fs/promises";
import {
  quickAnalysisPrompt,
  parseQuickAnalysis,
  quickAnalysisSchema,
} from "../src/domain/analysis.ts";
import type { TopicAnswer } from "../src/domain/classify.ts";
import {
  parsePlacement,
  placementPrompt,
  placementSchema,
  type PlacementInput,
} from "../src/domain/placement.ts";
import {
  gatewayKey,
  gatewayComplete,
} from "../src/server/inference/gateway.ts";
import { scoreClassification } from "./classification-score.ts";
import { cases } from "./classification-cases.ts";

/** Paid contract evaluation; it never applies model results to the plugin. */
const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const kind = process.env.EVAL_KIND ?? "placement";
if (kind !== "quick" && kind !== "placement")
  throw new Error("EVAL_KIND must be quick or placement");
const model =
  process.env.EVAL_MODEL ??
  (kind === "quick" ? "openai/gpt-6-luna-fast" : "openai/gpt-6-sol");
const reasoningLevel = process.env.EVAL_REASONING_LEVEL ?? "none";
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 1);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
  throw new Error("EVAL_REPETITIONS must be between 1 and 20");
const cold = process.env.EVAL_COLD === "1";
const holdout = process.env.EVAL_HOLDOUT === "1";
const queue = Array.from({ length: repetitions }, () =>
  cases.filter(
    (c) => c.id.startsWith("holdout-") === holdout && !(cold && c.warmOnly),
  ),
).flat();
const results: Record<string, unknown>[] = [];
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 240_000);
let cursor = 0;
try {
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < queue.length) {
        const test = queue[cursor++]!;
        const entities = cold ? [] : test.input.entities;
        const requests = (test.input.requests ?? [test.input.prompt]).map(
          (text, i) => ({ text, initial: i === 0, id: `request-${i + 1}` }),
        );
        const placement: PlacementInput = {
          title: null,
          requests: requests.map((r) => r.text),
          project: test.input.project ?? null,
          checkout: null,
          entities,
          hints: [],
          current: null,
        };
        const quick = {
          request: requests.map((r) => r.text).join("\n\n"),
          entities,
          project: test.input.project,
        };
        const prompt =
          kind === "quick"
            ? quickAnalysisPrompt(quick)
            : placementPrompt(placement);
        const started = Date.now();
        let response: string | null = null;
        let cost: number | undefined;
        const expectedPath: string[] = [];
        let ancestor = test.expected;
        while (ancestor) {
          const e = test.input.entities.find((e) => e.id === ancestor)!;
          expectedPath.unshift(e.name);
          ancestor = e.parentId;
        }
        try {
          const completion = await gatewayComplete({
            apiKey,
            signal: controller.signal,
            model,
            prompt,
            maxTokens: 4096,
            reasoningLevel,
            outputSchema:
              kind === "quick"
                ? quickAnalysisSchema(quick)
                : placementSchema(placement),
          });
          response = completion.text;
          cost = completion.usage.cost;
          let topic: TopicAnswer;
          if (kind === "quick") {
            const parsed = parseQuickAnalysis(response, quick);
            if (parsed.topicError) throw new Error(parsed.topicError);
            topic = parsed;
          } else topic = parsePlacement(response, placement);
          const value: TopicAnswer = {
            subjectId: topic.subjectId,
            proposed: topic.proposed,
          };
          results.push({
            id: test.id,
            expected: test.expected,
            expectedPath,
            value,
            response,
            cost,
            durationMs: Date.now() - started,
            ...scoreClassification(
              value,
              test.input,
              test.expected,
              cold,
              test.expectNew,
            ),
          });
        } catch (error) {
          results.push({
            id: test.id,
            expected: test.expected,
            expectedPath,
            pass: false,
            response,
            cost,
            durationMs: Date.now() - started,
            error: String(error),
          });
        }
      }
    }),
  );
} finally {
  clearTimeout(timer);
}
const accepted = results.filter((r) => r.pass).length;
const durations = results
  .map((r) => r.durationMs as number)
  .sort((a, b) => a - b);
await writeFile(
  process.env.EVAL_OUTPUT ?? "/tmp/classification-eval.json",
  JSON.stringify(
    {
      model,
      kind,
      reasoningLevel: reasoningLevel ?? "provider-default",
      mode: cold ? "cold" : "warm",
      split: holdout ? "holdout" : "main",
      repetitions,
      acceptedHierarchy: accepted,
      exactMatches: results.filter((r) => r.exact).length,
      total: results.length,
      p95Ms: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)],
      cost: results.reduce((sum, r) => sum + Number(r.cost ?? 0), 0),
      results,
    },
    null,
    2,
  ),
);
console.log(`${accepted}/${results.length} ${kind} ${model}`);
if (accepted !== results.length) process.exitCode = 1;
