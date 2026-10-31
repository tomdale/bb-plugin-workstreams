import { writeFile } from "node:fs/promises";
import {
  fullAnalysisPrompt,
  fullAnalysisSchema,
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
import { VAGUE_VERBS, followUpCases, titleCases } from "./title-cases.ts";

/**
 * Paid evaluation of the titles Workstreams writes, through the production
 * prompts, schemas, and parsers; it never applies results to the plugin.
 *
 * - `EVAL_KIND=quick` (default): Quick analysis names a thread from its
 *   opening request.
 * - `EVAL_KIND=full`: Full analysis names it after its first turn.
 * - `EVAL_KIND=follow`: Full analysis sees a title Workstreams wrote and a
 *   later request, and keeps the title or renames it.
 *
 * A new title passes when it starts with an -ing verb that says what kind of
 * work it is, names its case's subject, repeats nothing the sidebar already
 * shows beside it, and fits the visible width of a sidebar row. A follow-up
 * passes when it keeps the title for a next step and renames it for a new
 * goal.
 */
const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const kind = process.env.EVAL_KIND ?? "quick";
if (kind !== "quick" && kind !== "full" && kind !== "follow")
  throw new Error("EVAL_KIND must be quick, full, or follow");
const model =
  process.env.EVAL_MODEL ??
  (kind === "quick" ? "openai/gpt-6-luna-fast" : "openai/gpt-6-sol-fast");
const reasoningLevel = process.env.EVAL_REASONING_LEVEL ?? "none";
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
  throw new Error("EVAL_REPETITIONS must be between 1 and 20");
/** About what a sidebar row shows before it truncates. */
const VISIBLE = Number(process.env.EVAL_VISIBLE ?? 34);

type Job = {
  id: string;
  prompt: string;
  schema: Record<string, unknown>;
  parse: (text: string) => string | null;
  check: (title: string | null) => string[];
};

/** What's wrong with a new title, by the case's words. */
function newTitleProblems(
  title: string | null,
  test: { must: string[][]; avoid?: string[]; untitled?: boolean },
): string[] {
  if (test.untitled) return title ? ["titled a request that says nothing"] : [];
  if (!title) return ["no title"];
  const lower = title.toLowerCase();
  const problems: string[] = [];
  for (const any of test.must)
    if (!any.some((word) => lower.includes(word)))
      problems.push(`names none of ${any.join("/")}`);
  for (const word of test.avoid ?? [])
    if (lower.includes(word)) problems.push(`repeats "${word}"`);
  if (title.length > VISIBLE) problems.push(`${title.length} characters`);
  const verb = lower.split(/\s+/)[0] ?? "";
  if (!verb.endsWith("ing")) problems.push("doesn't start with an -ing verb");
  else if (VAGUE_VERBS.includes(verb)) problems.push(`vague verb "${verb}"`);
  return problems;
}

const jobs: Job[] = [];
if (kind === "follow")
  for (const test of followUpCases) {
    const input: FullAnalysisInput = {
      title: test.title,
      titledBy: "workstreams",
      requests: test.requests.map((text, i) => ({ text, initial: i === 0 })),
      lastAssistantText: "Working on the requested step.",
      report: { state: "waiting", headline: "Working", latest: [] },
      mode: "full",
    };
    jobs.push({
      id: test.id,
      prompt: fullAnalysisPrompt(input),
      schema: fullAnalysisSchema(input),
      parse: (text) => parseFullAnalysis(text, input).goal,
      check: (title) =>
        test.expect === "keep"
          ? title && title !== test.title
            ? ["renamed a title whose goal didn't change"]
            : []
          : !title || title === test.title
            ? ["kept a title whose goal changed"]
            : newTitleProblems(title, { must: test.must ?? [] }),
    });
  }
else
  for (const test of titleCases) {
    const listing = { group: test.group ?? null, parent: test.parent ?? null };
    if (kind === "quick") {
      const input: QuickAnalysisInput = {
        request: test.request,
        entities: null,
        listing,
      };
      jobs.push({
        id: test.id,
        prompt: quickAnalysisPrompt(input),
        schema: quickAnalysisSchema(input),
        parse: (text) => parseQuickAnalysis(text, input).goal,
        check: (title) => newTitleProblems(title, test),
      });
    } else {
      const input: FullAnalysisInput = {
        title: test.request.slice(0, 60),
        titledBy: "none",
        requests: [{ text: test.request, initial: true }],
        lastAssistantText: null,
        mode: "full",
        listing,
      };
      jobs.push({
        id: test.id,
        prompt: fullAnalysisPrompt(input),
        schema: fullAnalysisSchema(input),
        parse: (text) => parseFullAnalysis(text, input).goal,
        check: (title) => newTitleProblems(title, test),
      });
    }
  }

const queue = Array.from({ length: repetitions }, () => jobs).flat();
const results: Record<string, unknown>[] = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (cursor < queue.length) {
      const job = queue[cursor++]!;
      const begun = Date.now();
      let goal: string | null = null;
      let problems: string[];
      try {
        const completion = await gatewayComplete({
          apiKey,
          model,
          prompt: job.prompt,
          reasoningLevel,
          outputSchema: job.schema,
        });
        goal = job.parse(completion.text);
        problems = job.check(goal);
      } catch (e) {
        problems = [String(e)];
      }
      results.push({
        id: job.id,
        goal,
        passed: problems.length === 0,
        problems,
        latencyMs: Date.now() - begun,
      });
    }
  }),
);

const lines = jobs.map((job) => {
  const runs = results.filter((r) => r.id === job.id);
  const pass = runs.filter((r) => r.passed).length;
  const goals = [...new Set(runs.map((r) => r.goal ?? "∅"))].join(" | ");
  return `${pass}/${runs.length} ${job.id}: ${goals}`;
});
const passed = results.filter((r) => r.passed).length;
const titled = results.filter((r) => r.goal) as { goal: string }[];
const lengths = titled.map((r) => r.goal.length).sort((a, b) => a - b);
await writeFile(
  process.env.EVAL_OUTPUT ?? "/tmp/title-eval.json",
  JSON.stringify({ kind, model, reasoningLevel, results }, null, 2),
);
console.log(lines.join("\n"));
console.log(
  `${passed}/${results.length} ${kind} titles ${model}: median ${lengths[Math.floor(lengths.length / 2)] ?? 0} chars, ${titled.length} titled`,
);
process.exitCode = passed === results.length ? 0 : 1;
