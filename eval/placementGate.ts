/**
 * Placement gate evaluation: the same cases placement's eval scores, asked as
 * the gate's typed question, so a change to its threshold, question, or model
 * is measured instead of assumed.
 *
 * The gate settles a call only when its answer clears the confidence bar;
 * everything else is what the placement model would answer, so those cases
 * are reported as falling back rather than as failures. An accepted answer
 * that `scoreClassification` rejects fails the run: a gate that admits a
 * wrong topic is worse than no gate.
 *
 *   node eval/placementGate.ts            # warm main split
 *   EVAL_MODEL=baseten/elephant-1 node eval/placementGate.ts
 */
import { writeFile } from "node:fs/promises";
import type { PlacementInput } from "../src/domain/placement.ts";
import {
  parsePlacementGate,
  placementGateQuestion,
} from "../src/domain/placementGate.ts";
import {
  gatewayEvaluate,
  gatewayKey,
} from "../src/server/inference/gateway.ts";
import { scoreClassification } from "./classification-score.ts";
import { cases } from "./classification-cases.ts";

/** Paid contract evaluation; it never applies model results to the plugin. */
const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const model = process.env.EVAL_MODEL ?? "openai/gpt-6-luna-decisions";
const holdout = process.env.EVAL_HOLDOUT === "1";
// Warm evaluation, so the cases a cold run skips apply: they carry their own
// topic tree, which is what a typed question chooses among.
const queue = cases.filter(
  (test) => test.id.startsWith("holdout-") === holdout,
);

const results: Record<string, unknown>[] = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (cursor < queue.length) {
      const test = queue[cursor++]!;
      const placement: PlacementInput = {
        title: test.input.prompt,
        requests: test.input.requests ?? [test.input.prompt],
        project: test.input.project ?? null,
        checkout: null,
        entities: test.input.entities,
        hints: [],
        current: null,
        ...test.input.placement,
      };
      const asked = placementGateQuestion(placement);
      if (!asked) {
        results.push({ id: test.id, expected: test.expected, fellBack: true });
        continue;
      }
      const started = Date.now();
      try {
        const { answers, usage } = await gatewayEvaluate({
          model,
          state: asked.state,
          questions: asked.questions,
          apiKey,
          signal: AbortSignal.timeout(20_000),
        });
        const picked = parsePlacementGate(answers, placement);
        if (!picked) {
          results.push({
            id: test.id,
            expected: test.expected,
            fellBack: true,
            confidence: answers.topic?.confidence ?? null,
            durationMs: Date.now() - started,
            cost: usage.cost,
          });
          continue;
        }
        const value = {
          subjectId: picked.answer.subjectId,
          proposed: picked.answer.proposed,
        };
        results.push({
          id: test.id,
          expected: test.expected,
          value,
          confidence: picked.confidence,
          durationMs: Date.now() - started,
          cost: usage.cost,
          ...scoreClassification(
            value,
            test.input,
            test.expected,
            false,
            test.expectNew,
            "placement",
          ),
        });
      } catch (error) {
        results.push({
          id: test.id,
          expected: test.expected,
          error: String(error),
        });
      }
    }
  }),
);

const settled = results.filter((result) => result.value !== undefined);
const wrong = settled.filter((result) => !result.pass);
const durations = settled
  .map((result) => result.durationMs as number)
  .sort((a, b) => a - b);
const report = {
  model,
  split: holdout ? "holdout" : "main",
  cases: results.length,
  settled: settled.length,
  settledCorrectly: settled.length - wrong.length,
  fellBack: results.filter((result) => result.fellBack).length,
  unasked: results.filter((result) => result.error !== undefined).length,
  wrongAccepts: wrong.map((result) => result.id),
  medianMs: durations[Math.floor((durations.length - 1) / 2)] ?? 0,
  p95Ms: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] ?? 0,
  cost: results.reduce((sum, result) => sum + Number(result.cost ?? 0), 0),
  results,
};
await writeFile(
  process.env.EVAL_OUTPUT ?? "/tmp/placement-gate-eval.json",
  JSON.stringify(report, null, 2),
);
console.log(
  `${settled.length - wrong.length}/${settled.length} settled correctly, ${report.fellBack} fell back, ${wrong.length} wrong accepts, median ${report.medianMs} ms · ${model}`,
);
if (wrong.length) process.exitCode = 1;
