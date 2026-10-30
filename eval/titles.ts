import { writeFile } from "node:fs/promises";
import {
  fullAnalysisPrompt,
  parseFullAnalysis,
  parseQuickAnalysis,
  quickAnalysisPrompt,
  quickAnalysisSchema,
  type FullAnalysisInput,
  type QuickAnalysisInput,
} from "../src/domain/analysis.ts";
import {
  gatewayComplete,
  gatewayKey,
} from "../src/server/inference/gateway.ts";
import { GENERIC_VERBS, titleCases } from "./title-cases.ts";

/**
 * Paid evaluation of the titles Quick analysis writes, or with
 * `EVAL_KIND=full` the ones Full analysis settles after a first turn; it
 * never applies results to the plugin. A title passes when it names its case's subject,
 * repeats nothing the sidebar already shows beside it, and fits the visible
 * width of a sidebar row.
 */
const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const kind = process.env.EVAL_KIND ?? "quick";
if (kind !== "quick" && kind !== "full")
  throw new Error("EVAL_KIND must be quick or full");
const model =
  process.env.EVAL_MODEL ??
  (kind === "quick" ? "openai/gpt-6-luna-fast" : "openai/gpt-6-sol-fast");
const reasoningLevel = process.env.EVAL_REASONING_LEVEL ?? "none";
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
  throw new Error("EVAL_REPETITIONS must be between 1 and 20");
/** About what a sidebar row shows before it truncates. */
const VISIBLE = Number(process.env.EVAL_VISIBLE ?? 34);
const queue = Array.from({ length: repetitions }, () => titleCases).flat();

const results: Record<string, unknown>[] = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (cursor < queue.length) {
      const test = queue[cursor++]!;
      const listing = {
        group: test.group ?? null,
        parent: test.parent ?? null,
      };
      const input: QuickAnalysisInput = {
        request: test.request,
        project: null,
        entities: [],
        listing,
      };
      const full: FullAnalysisInput = {
        title: "New thread",
        untitled: true,
        requests: [{ text: test.request, initial: true, id: "request-1" }],
        lastAssistantText: null,
        mode: "full",
        listing,
      };
      const begun = Date.now();
      let goal: string | null = null;
      let error: string | null = null;
      try {
        const completion = await gatewayComplete({
          apiKey,
          model,
          prompt:
            kind === "quick"
              ? quickAnalysisPrompt(input)
              : fullAnalysisPrompt(full),
          reasoningLevel,
          outputSchema:
            kind === "quick" ? quickAnalysisSchema(input) : undefined,
        });
        goal =
          kind === "quick"
            ? parseQuickAnalysis(completion.text, input).goal
            : parseFullAnalysis(completion.text, full).goal;
      } catch (e) {
        error = String(e);
      }
      const title = (goal ?? "").toLowerCase();
      const problems: string[] = [];
      if (error) problems.push(error);
      else if (test.untitled) {
        if (goal) problems.push("titled a request that says nothing");
      } else if (!goal) problems.push("no title");
      else {
        for (const any of test.must)
          if (!any.some((word) => title.includes(word)))
            problems.push(`names none of ${any.join("/")}`);
        for (const word of test.avoid)
          if (title.includes(word)) problems.push(`repeats "${word}"`);
        if (goal.length > VISIBLE) problems.push(`${goal.length} characters`);
      }
      const first = title.split(/\s+/)[0] ?? "";
      results.push({
        id: test.id,
        goal,
        passed: problems.length === 0,
        problems,
        verbFirst: GENERIC_VERBS.includes(first),
        latencyMs: Date.now() - begun,
      });
    }
  }),
);

const lines = titleCases.map((test) => {
  const runs = results.filter((r) => r.id === test.id);
  const pass = runs.filter((r) => r.passed).length;
  const goals = [...new Set(runs.map((r) => r.goal ?? "∅"))].join(" | ");
  return `${pass}/${runs.length} ${test.id}: ${goals}`;
});
const passed = results.filter((r) => r.passed).length;
const titled = results.filter((r) => r.goal) as { goal: string }[];
const lengths = titled.map((r) => r.goal.length).sort((a, b) => a - b);
const verbFirst = results.filter((r) => r.verbFirst).length;
await writeFile(
  process.env.EVAL_OUTPUT ?? "/tmp/title-eval.json",
  JSON.stringify({ model, reasoningLevel, results }, null, 2),
);
console.log(lines.join("\n"));
console.log(
  `${passed}/${results.length} titles ${model}: median ${lengths[Math.floor(lengths.length / 2)] ?? 0} chars, ${verbFirst}/${titled.length} start with a generic verb`,
);
process.exitCode = passed === results.length ? 0 : 1;
