import { writeFile } from "node:fs/promises";
import type { TopicAnswer } from "../src/domain/classify.ts";
import {
  parsePlacement,
  placementPrompt,
  placementSchema,
  type PlacementInput,
} from "../src/domain/placement.ts";
import { parseStart, startPrompt, startSchema } from "../src/domain/start.ts";
import {
  parseTurnEnd,
  turnEndPrompt,
  turnEndSchema,
  type TurnEndInput,
} from "../src/domain/turnEnd.ts";
import {
  gatewayKey,
  gatewayComplete,
} from "../src/server/inference/gateway.ts";
import { takesThreads } from "../src/domain/topics.ts";
import { scoreClassification } from "./classification-score.ts";
import { cases } from "./classification-cases.ts";

/** Paid contract evaluation; it never applies model results to the plugin. */
const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const kind = process.env.EVAL_KIND ?? "placement";
if (!["placement", "start", "turn-end"].includes(kind))
  throw new Error("EVAL_KIND must be placement, start, or turn-end");
const model = process.env.EVAL_MODEL ?? "openai/gpt-6.1-sol";
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
          title: test.input.prompt,
          requests: requests.map((r) => r.text),
          project: test.input.project ?? null,
          checkout: null,
          entities,
          hints: [],
          current: null,
          ...test.input.placement,
        };
        // A start reads only the opening request, so the case's requests
        // join into one.
        const start = {
          request: requests.map((r) => r.text).join("\n\n"),
          project: placement.project,
          placement: {
            entities,
            project: placement.project,
            checkout: placement.checkout,
            hints: placement.hints,
            current: placement.current,
          },
        };
        // A turn's end reads the case's requests as a conversation, the
        // generated title as one Workstreams wrote, and its digest.
        const turnEnd: TurnEndInput = {
          title: placement.title ?? test.input.prompt,
          titledBy: "workstreams",
          goal: null,
          digest: placement.digest ?? null,
          requests,
          lastAssistantText: null,
          report: null,
          mode: "full",
          placement: { ...placement, title: null, digest: null },
        };
        const prompt =
          kind === "start"
            ? startPrompt(start)
            : kind === "turn-end"
              ? turnEndPrompt(turnEnd)
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
              kind === "start"
                ? startSchema(start)
                : kind === "turn-end"
                  ? turnEndSchema(turnEnd)
                  : placementSchema(placement),
          });
          response = completion.text;
          cost = completion.usage.cost;
          const parsed =
            kind === "start"
              ? parseStart(response, start)
              : kind === "turn-end"
                ? parseTurnEnd(response, turnEnd)
                : { topic: parsePlacement(response, placement) };
          if ("topicError" in parsed && parsed.topicError)
            throw new Error(parsed.topicError);
          const topic = parsed.topic!;
          if (
            test.scopeShift !== undefined &&
            topic.scopeShift !== test.scopeShift
          )
            throw new Error(
              `Expected scopeShift=${test.scopeShift}, received ${topic.scopeShift}`,
            );
          const value: TopicAnswer = {
            subjectId: topic.subjectId,
            proposed: topic.proposed,
          };
          // Subgroups come only from splits, so placement files work on a
          // new capability in its product while the product has none.
          const inside = test.expectNew?.inside;
          const intoProduct =
            !!inside &&
            value.subjectId === inside &&
            takesThreads(inside, test.input.entities);
          results.push({
            id: test.id,
            expected: test.expected,
            expectedPath,
            value,
            response,
            cost,
            durationMs: Date.now() - started,
            ...(intoProduct
              ? {
                  owner: true,
                  capability: true,
                  hierarchy: true,
                  exact: true,
                  pass: true,
                }
              : scoreClassification(
                  value,
                  test.input,
                  test.expected,
                  cold,
                  test.expectNew,
                )),
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
      accepted,
      acceptance: cold
        ? "root ownership; hierarchy is advisory for single-topic proposals"
        : "the expected topic",
      hierarchyMatches: results.filter((r) => r.hierarchy).length,
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
