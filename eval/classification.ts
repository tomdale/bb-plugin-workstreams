import { writeFile } from "node:fs/promises";
import type { WorkstreamAnswer } from "../src/domain/classify.ts";
import {
  parseWorkstreamChoice,
  workstreamChoicePrompt,
  workstreamChoiceSchema,
  type WorkstreamChoiceInput,
} from "../src/domain/workstreamChoice.ts";
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
import { takesThreads } from "../src/domain/workstreams.ts";
import { scoreClassification } from "./classification-score.ts";
import { cases } from "./classification-cases.ts";

/** Paid contract evaluation; it never applies model results to the plugin. */
const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const kind = process.env.EVAL_KIND ?? "workstream-choice";
if (!["workstream-choice", "start", "turn-end"].includes(kind))
  throw new Error("EVAL_KIND must be workstream-choice, start, or turn-end");
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
        const workstreams = cold ? [] : test.input.workstreams;
        const requests = (test.input.requests ?? [test.input.prompt]).map(
          (text, i) => ({ text, initial: i === 0, id: `request-${i + 1}` }),
        );
        const choice: WorkstreamChoiceInput = {
          title: test.input.prompt,
          requests: requests.map((r) => r.text),
          project: test.input.project ?? null,
          checkout: null,
          workstreams,
          hints: [],
          current: null,
          ...test.input.choice,
        };
        // A start reads only the opening request, so the case's requests
        // join into one.
        const start = {
          request: requests.map((r) => r.text).join("\n\n"),
          project: choice.project,
          choice: {
            workstreams,
            project: choice.project,
            checkout: choice.checkout,
            hints: choice.hints,
            current: choice.current,
          },
        };
        // A turn's end reads the case's requests as a conversation, the
        // generated title as one Workstreams wrote, and its digest.
        const turnEnd: TurnEndInput = {
          title: choice.title ?? test.input.prompt,
          titledBy: "workstreams",
          goal: null,
          digest: choice.digest ?? null,
          requests,
          lastAssistantText: null,
          report: null,
          mode: "full",
          choice: { ...choice, title: null, digest: null },
        };
        const prompt =
          kind === "start"
            ? startPrompt(start)
            : kind === "turn-end"
              ? turnEndPrompt(turnEnd)
              : workstreamChoicePrompt(choice);
        const started = Date.now();
        let response: string | null = null;
        let cost: number | undefined;
        const expectedPath: string[] = [];
        let ancestor = test.expected;
        while (ancestor) {
          const e = test.input.workstreams.find((e) => e.id === ancestor)!;
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
                  : workstreamChoiceSchema(choice),
          });
          response = completion.text;
          cost = completion.usage.cost;
          const parsed =
            kind === "start"
              ? parseStart(response, start)
              : kind === "turn-end"
                ? parseTurnEnd(response, turnEnd)
                : { workstream: parseWorkstreamChoice(response, choice) };
          if ("workstreamError" in parsed && parsed.workstreamError)
            throw new Error(parsed.workstreamError);
          const workstream = parsed.workstream!;
          if (
            test.scopeShift !== undefined &&
            workstream.scopeShift !== test.scopeShift
          )
            throw new Error(
              `Expected scopeShift=${test.scopeShift}, received ${workstream.scopeShift}`,
            );
          const value: WorkstreamAnswer = {
            workstreamId: workstream.workstreamId,
            proposed: workstream.proposed,
          };
          // Subgroups come only from splits, so placement files work on a
          // new capability in its product while the product has none.
          const inside = test.expectNew?.inside;
          const intoProduct =
            !!inside &&
            value.workstreamId === inside &&
            takesThreads(inside, test.input.workstreams);
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
        ? "top-level ownership; hierarchy is advisory for single-workstream proposals"
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
