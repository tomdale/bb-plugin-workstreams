import { writeFile } from "node:fs/promises";
import {
  descriptionPrompt,
  descriptionSchema,
  parseDescription,
  type DescriptionInput,
} from "../src/domain/analysis.ts";
import {
  parseTurnEnd,
  turnEndPrompt,
  turnEndSchema,
  type TurnEndInput,
} from "../src/domain/turnEnd.ts";
import {
  gatewayComplete,
  gatewayKey,
} from "../src/server/inference/gateway.ts";

const original =
  "Make Lumen's review code easier to navigate without changing its behavior.";
const cases: {
  id: string;
  requests: string[];
  current?: string;
  keep?: boolean;
  must: string[][];
  titledBy?: DescriptionInput["titledBy"];
}[] = [
  {
    id: "shortcut",
    requests: [
      "Add a customizable keyboard shortcut for copying the focused thread's link in Lumen. Reuse the existing clipboard action and support split panes.",
    ],
    must: [["link"], ["keyboard", "shortcut"]],
  },
  {
    id: "refactor",
    requests: [
      "Lumen's review module is hard to navigate. Refactor it into cohesive capability modules with workflow-ordered steps, content-named files, and fewer micro-files. Preserve behavior.",
    ],
    must: [
      ["review"],
      ["navigate", "navigation", "read", "understand"],
      ["behavior", "behaviour"],
    ],
  },
  {
    id: "housekeeping",
    current: original,
    keep: true,
    requests: [
      "Refactor Lumen's review code so it is easier to navigate without changing behavior.",
      "The local file links do not resolve. Set the thread to the right directory.",
    ],
    must: [],
  },
  {
    id: "testing",
    current: original,
    keep: true,
    requests: [
      "Refactor Lumen's review code so it is easier to navigate without changing behavior.",
      "Run the full suite with Postgres in Docker and explain any failures.",
    ],
    must: [],
  },
  {
    id: "changed-purpose",
    current:
      "Identify correctness bugs in Lumen's review-status comment implementation.",
    requests: [
      "Review the code for Lumen's GitHub status comments.",
      "Let's design a quieter review comment instead. Show open findings individually and retain resolved findings in a disclosure. Keep existing findings visible until the next review completes.",
    ],
    must: [
      ["findings", "suggestions", "feedback"],
      ["resolved", "history", "historical"],
    ],
  },
  {
    id: "user-title",
    titledBy: "you",
    requests: [
      "Audit the merged Claude action upgrade and transitive dependencies in Lumen. Determine whether to retain it, distinguish regressions from inherited security risks, and recommend mitigations. Keep the checkout read-only.",
    ],
    must: [
      ["upgrade", "action"],
      ["safe", "risk", "security", "retain"],
    ],
  },
];

const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const model = process.env.EVAL_MODEL ?? "openai/gpt-6.1-sol";
/**
 * `turn-end` (default) asks the turn-end call, which also chooses the
 * thread's topic from a small tree; `full` asks Full analysis alone.
 */
const kind = process.env.EVAL_KIND ?? "turn-end";
if (kind !== "full" && kind !== "turn-end")
  throw new Error("EVAL_KIND must be full or turn-end");
const reasoningLevel = process.env.EVAL_REASONING_LEVEL ?? "none";
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
  throw new Error("EVAL_REPETITIONS must be between 1 and 20");
const jobs = Array.from({ length: repetitions }, () => cases).flat();
const results: Record<string, unknown>[] = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (cursor < jobs.length) {
      const test = jobs[cursor++]!;
      const input: DescriptionInput = {
        title: "Reviewing code",
        titledBy: test.titledBy ?? "workstreams",
        goal: test.current ?? null,
        requests: test.requests.map((text, index) => ({
          text,
          initial: index === 0,
        })),
        lastAssistantText: "The thread now points at the right directory.",
        report: {
          state: "complete",
          headline: "Changed directories",
          latest: ["Local links work"],
        },
        mode: "full",
      };
      const turnEnd: TurnEndInput = {
        ...input,
        choice: {
          title: null,
          requests: test.requests,
          project: null,
          checkout: null,
          workstreams: [
            {
              id: "lumen",
              name: "Lumen",
              description: "Code review product",
              parentId: null,
              aliases: [],
            },
            {
              id: "review",
              name: "Review",
              description: "Lumen's review module",
              parentId: "lumen",
              aliases: [],
            },
            {
              id: "docs",
              name: "Docs",
              description: "Lumen documentation",
              parentId: "lumen",
              aliases: [],
            },
          ],
          hints: [],
          current: { label: "Lumen › Review", inherited: false },
        },
      };
      const started = Date.now();
      let response: string | null = null;
      let usage: unknown = null;
      let goal: string | null = null;
      const problems: string[] = [];
      try {
        const completion = await gatewayComplete({
          apiKey,
          model,
          reasoningLevel,
          prompt:
            kind === "full" ? descriptionPrompt(input) : turnEndPrompt(turnEnd),
          outputSchema:
            kind === "full" ? descriptionSchema(input) : turnEndSchema(turnEnd),
        });
        response = completion.text;
        usage = completion.usage;
        const output =
          kind === "full"
            ? parseDescription(response, input)
            : parseTurnEnd(response, turnEnd);
        goal = output.goal ?? test.current ?? null;
        if (!goal) problems.push("no outcome");
        if (test.keep && goal !== test.current)
          problems.push("changed outcome for an intermediate step");
        if (test.titledBy === "you" && output.title !== null)
          problems.push("renamed user title");
        const lower = goal?.toLowerCase() ?? "";
        for (const words of test.must)
          if (!words.some((word) => lower.includes(word)))
            problems.push(`names none of ${words.join("/")}`);
        if (/director|local links/i.test(goal ?? ""))
          problems.push("copied housekeeping recap");
      } catch (error) {
        problems.push(String(error));
      }
      const wordCount = goal?.split(/\s+/).length ?? 0;
      results.push({
        id: test.id,
        passed: problems.length === 0,
        problems,
        goal,
        wordCount,
        notes:
          wordCount && (wordCount < 12 || wordCount > 20)
            ? ["outside the usual 12–20 words"]
            : [],
        response,
        usage,
        latencyMs: Date.now() - started,
      });
    }
  }),
);
const passed = results.filter((result) => result.passed).length;
await writeFile(
  process.env.EVAL_OUTPUT ?? "/tmp/goal-eval.json",
  JSON.stringify({ model, reasoningLevel, repetitions, results }, null, 2),
);
for (const test of cases) {
  const runs = results.filter((result) => result.id === test.id);
  console.log(
    `${runs.filter((run) => run.passed).length}/${runs.length} ${test.id}: ${[...new Set(runs.map((run) => run.goal ?? "∅"))].join(" | ")}`,
  );
}
console.log(
  `${passed}/${results.length} passed; inspect outputs for clarity, success-first wording, and appropriate detail. Heuristics do not measure reader comprehension.`,
);
process.exitCode = passed === results.length && results.length > 0 ? 0 : 1;
