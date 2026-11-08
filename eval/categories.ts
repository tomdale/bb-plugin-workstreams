import { writeFile } from "node:fs/promises";
import {
  categoryPrompt,
  categorySchema,
  parseCategories,
} from "../src/domain/categories.ts";
import { DEFAULT_MODELS } from "../src/domain/prefs.ts";
import {
  gatewayComplete,
  gatewayKey,
} from "../src/server/inference/gateway.ts";
import { cases } from "./category-cases.ts";

const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const model = process.env.EVAL_MODEL ?? DEFAULT_MODELS.tidy.model;
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 1);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3)
  throw new Error("EVAL_REPETITIONS must be between 1 and 3");
const budget = Number(process.env.EVAL_BUDGET ?? 5);
if (!Number.isFinite(budget) || budget <= 0 || budget > 10)
  throw new Error("EVAL_BUDGET must be greater than zero and at most $10");
const holdout = process.env.EVAL_HOLDOUT === "1";
const queue = Array.from({ length: repetitions }, () =>
  cases.filter((test) => test.id.startsWith("holdout-") === holdout),
).flat();
const results: Array<{
  id: string;
  passed: boolean;
  cost: number;
  durationMs: number;
  response: string;
  error: string | null;
}> = [];
let spent = 0;
let stopped: string | null = null;
for (const test of queue) {
  // Keep headroom for one bounded in-flight response; there is no parallel fanout.
  if (spent >= budget * 0.75) {
    stopped = `Evaluation budget headroom exhausted after $${spent.toFixed(4)}`;
    break;
  }
  const started = Date.now();
  let response = "";
  let cost = 0;
  let error: string | null = null;
  let passed = false;
  try {
    const completion = await gatewayComplete({
      apiKey,
      model,
      prompt: categoryPrompt(test.input),
      outputSchema: categorySchema(test.input),
      maxTokens: 4096,
      reasoningLevel:
        process.env.EVAL_REASONING_LEVEL ?? DEFAULT_MODELS.tidy.reasoningLevel,
      signal: AbortSignal.timeout(60_000),
    });
    response = completion.text;
    cost = completion.usage.cost;
    spent += cost;
    const decision = parseCategories(response, test.input);
    const actual = (
      decision.keep ? test.input.current!.categories : decision.categories
    )
      .map((category) => [...category.threadIds].sort().join(","))
      .sort();
    const expected = test.partitions
      .map((partition) => [...partition].sort().join(","))
      .sort();
    const chainedNames = decision.keep
      ? []
      : decision.categories
          .map((category) => category.name)
          .filter((name) => /[,&]/.test(name));
    passed =
      JSON.stringify(actual) === JSON.stringify(expected) &&
      (!("keep" in test) || decision.keep === test.keep) &&
      (!test.noChainNames || chainedNames.length === 0);
    if (test.noChainNames && chainedNames.length)
      error = `chained names: ${chainedNames.join("; ")}`;
  } catch (failure) {
    error = String(failure);
  }
  results.push({
    id: test.id,
    passed,
    cost,
    durationMs: Date.now() - started,
    response,
    error,
  });
  console.log(
    `${passed ? "PASS" : "FAIL"} ${test.id} $${cost.toFixed(4)} ${Date.now() - started}ms${error ? ` ${error}` : ""}`,
  );
}
const report = {
  model,
  holdout,
  repetitions,
  spent,
  stopped,
  passed: results.filter((result) => result.passed).length,
  total: results.length,
  results,
};
await writeFile(
  process.env.EVAL_OUTPUT ?? "/tmp/category-eval.json",
  JSON.stringify(report, null, 2),
);
console.log(`${report.passed}/${report.total}; $${spent.toFixed(4)}`);
if (stopped) console.error(stopped);
if (stopped || report.passed !== report.total) process.exitCode = 1;
