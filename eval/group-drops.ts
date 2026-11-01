import { writeFile } from "node:fs/promises";
import {
  placementPrompt,
  placementSchema,
  parsePlacement,
  type PlacementInput,
} from "../src/domain/placement.ts";
import {
  gatewayKey,
  gatewayComplete,
} from "../src/server/inference/gateway.ts";
import { DEFAULT_MODELS } from "../src/domain/prefs.ts";

// Synthetic workstream moves: the old owner and checkout must not override the user's destination.
const entities = [
  {
    id: "personal",
    name: "Personal",
    parentId: null,
    description: "Personal tools and configuration",
    aliases: [],
  },
  {
    id: "plugin",
    name: "Workstreams Plugin",
    parentId: null,
    description: "Organizing BB threads",
    aliases: [],
  },
  {
    id: "labels",
    name: "Thread Labels",
    parentId: "plugin",
    description: "Thread title generation and updates",
    aliases: [],
  },
  {
    id: "sidebar",
    name: "Sidebar",
    parentId: "plugin",
    description: "Group layout and thread navigation",
    aliases: [],
  },
  {
    id: "questions",
    name: "Questions",
    parentId: "plugin",
    description: "Question cards and input forms",
    aliases: [],
  },
  {
    id: "other",
    name: "Other Product",
    parentId: null,
    description: "Another product's title generation",
    aliases: [],
  },
];
const cases = [
  {
    id: "title-lifecycle",
    title: "Explaining workstream title lifecycles",
    requests: ["Explain how Workstreams generates and updates thread titles"],
    expected: "labels",
  },
  {
    id: "group-drag",
    title: "Supporting group drag",
    requests: ["Let me drag a thread between workstream groups"],
    expected: "sidebar",
  },
  {
    id: "question-card",
    title: "Fixing question answers",
    requests: ["The Workstreams question card loses my selected answer"],
    expected: "questions",
  },
  {
    id: "wrong-checkout",
    title: "Shortening thread titles",
    requests: ["Shorten the thread titles in the Workstreams plugin sidebar"],
    expected: "labels",
  },
];
const model = process.env.EVAL_MODEL ?? DEFAULT_MODELS.placement.model;
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
  throw new Error("EVAL_REPETITIONS must be 1–20");
const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const results: Record<string, unknown>[] = [];
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 240_000);
try {
  for (let n = 0; n < repetitions; n++)
    for (const test of cases) {
      const input: PlacementInput = {
        ...test,
        within: "plugin",
        entities,
        project: "Personal Tools",
        checkout: "/workspace/personal-tools",
        hints: ["The thread previously belonged to Personal."],
        current: { label: "Personal", inherited: false },
      };
      const start = Date.now();
      let response: string | null = null;
      let cost: number | null = null;
      try {
        const answer = await gatewayComplete({
          apiKey,
          signal: controller.signal,
          model,
          prompt: placementPrompt(input),
          outputSchema: placementSchema(input),
          maxTokens: 2048,
          reasoningLevel: "none",
        });
        response = answer.text;
        cost = answer.usage.cost ?? null;
        const parsed = parsePlacement(response, input);
        results.push({
          id: test.id,
          expected: test.expected,
          chosen: parsed.subjectId,
          pass: parsed.subjectId === test.expected,
          response,
          cost,
          durationMs: Date.now() - start,
        });
      } catch (error) {
        results.push({
          id: test.id,
          pass: false,
          error: String(error),
          response,
          cost,
          durationMs: Date.now() - start,
        });
      }
    }
} finally {
  clearTimeout(timer);
}
const durations = results
  .map((r) => Number(r.durationMs))
  .sort((a, b) => a - b);
const report = {
  model,
  repetitions,
  total: results.length,
  passed: results.filter((r) => r.pass).length,
  cost: results.reduce((sum, r) => sum + Number(r.cost ?? 0), 0),
  p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
  results,
};
await writeFile(
  process.env.EVAL_OUTPUT ?? "/tmp/group-drops-eval.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ...report, results: undefined }));
if (report.passed !== report.total) process.exitCode = 1;
