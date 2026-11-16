import { writeFile } from "node:fs/promises";
import {
  applyCategoryFit,
  categoryFitPrompt,
  categoryFitSchema,
  categoryPrompt,
  categorySchema,
  mostlySingletons,
  parseCategories,
  parseCategoryFit,
  type CategoryFitInput,
} from "../src/domain/categories.ts";
import { DEFAULT_MODELS } from "../src/domain/prefs.ts";
import {
  gatewayComplete,
  gatewayKey,
} from "../src/server/inference/gateway.ts";
import { cases } from "./category-cases.ts";

const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const model =
  process.env.EVAL_MODEL ??
  (process.env.EVAL_KIND === "fit"
    ? DEFAULT_MODELS.newThread.model
    : DEFAULT_MODELS.category.model);
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 1);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3)
  throw new Error("EVAL_REPETITIONS must be between 1 and 3");
const budget = Number(process.env.EVAL_BUDGET ?? 5);
if (!Number.isFinite(budget) || budget <= 0 || budget > 10)
  throw new Error("EVAL_BUDGET must be greater than zero and at most $10");
const holdout = process.env.EVAL_HOLDOUT === "1";
/**
 * `rearrange` (default) asks for a whole arrangement; `fit` asks the fit check
 * on every case with a current arrangement and threads that arrived or whose
 * work changed. A case passes the fit check when its expected partitions
 * follow from the current categories and the check files every thread into
 * them, or when they don't and the check sends it to a rearrangement.
 */
const kind = process.env.EVAL_KIND ?? "rearrange";
if (kind !== "rearrange" && kind !== "fit")
  throw new Error("EVAL_KIND must be rearrange or fit");
/** The fit check's input for a case, or null when production asks none. */
function fitInput(test: (typeof cases)[number]): CategoryFitInput | null {
  const current = test.input.current;
  if (!current || !current.categories.length || mostlySingletons(current))
    return null;
  const filed = new Set(current.categories.flatMap((c) => c.threadIds));
  const changed = test.input.roots
    .filter((root) => !filed.has(root.id) || root.workKey !== "request-1")
    .map((root) => root.id);
  return changed.length ? { ...test.input, current, changed } : null;
}
const partitionKey = (partitions: string[][]) =>
  JSON.stringify(
    partitions.map((partition) => [...partition].sort().join(",")).sort(),
  );
const queue = Array.from({ length: repetitions }, () =>
  cases.filter(
    (test) =>
      test.id.startsWith("holdout-") === holdout &&
      (kind === "rearrange" || fitInput(test) !== null),
  ),
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
    if (kind === "fit") {
      const input = fitInput(test)!;
      const completion = await gatewayComplete({
        apiKey,
        model,
        prompt: categoryFitPrompt(input),
        outputSchema: categoryFitSchema(input),
        maxTokens: 2048,
        reasoningLevel: process.env.EVAL_REASONING_LEVEL ?? "none",
        signal: AbortSignal.timeout(60_000),
      });
      response = completion.text;
      cost = completion.usage.cost;
      spent += cost;
      const fit = parseCategoryFit(response, input);
      const next = applyCategoryFit(input, fit);
      // Whether the expected arrangement keeps every current category's
      // other members together: then filing into them can reach it.
      const reachable = (() => {
        const filed = new Set(input.changed);
        const expected = test.partitions.map((p) => new Set(p));
        // A new category can't come from filing into the current ones.
        const staying = new Set(
          input.current.categories
            .flatMap((category) => category.threadIds)
            .filter((id) => !filed.has(id)),
        );
        if (
          expected.some(
            (partition) => ![...partition].some((id) => staying.has(id)),
          )
        )
          return false;
        return input.current.categories.every((category) => {
          const stay = category.threadIds.filter((id) => !filed.has(id));
          return (
            stay.length === 0 ||
            expected.some((partition) => stay.every((id) => partition.has(id)))
          );
        });
      })();
      passed = reachable
        ? next !== null &&
          partitionKey(next.categories.map((c) => c.threadIds)) ===
            partitionKey(test.partitions)
        : next === null;
      if (!passed)
        error = next
          ? `filed: ${JSON.stringify(fit)}`
          : "sent to a rearrangement";
      throw null;
    }
    const completion = await gatewayComplete({
      apiKey,
      model,
      prompt: categoryPrompt(test.input),
      outputSchema: categorySchema(test.input),
      maxTokens: 4096,
      reasoningLevel:
        process.env.EVAL_REASONING_LEVEL ??
        DEFAULT_MODELS.category.reasoningLevel,
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
          .filter((name) => /,|\band\b/.test(name));
    passed =
      JSON.stringify(actual) === JSON.stringify(expected) &&
      (!("keep" in test) || decision.keep === test.keep) &&
      (!test.noChainNames || chainedNames.length === 0);
    if (test.noChainNames && chainedNames.length)
      error = `names joining scopes without "&": ${chainedNames.join("; ")}`;
  } catch (failure) {
    if (failure !== null) error = String(failure);
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
  kind,
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
