import { writeFile } from "node:fs/promises";
import {
  describeEdit,
  parseTidy,
  refusal,
  tidyPrompt,
  tidySchema,
  type ProposedEdit,
  type TidyEdit,
  type TidyInput,
  type TreeState,
} from "../src/domain/tidy.ts";
import {
  gatewayComplete,
  gatewayKey,
} from "../src/server/inference/gateway.ts";
import { cases, matches, type EditPattern } from "./tidy-cases.ts";

/** Paid contract evaluation; it never applies model results to the plugin. */
const apiKey = await gatewayKey();
if (!apiKey) throw new Error("AI Gateway authentication required");
const model = process.env.EVAL_MODEL ?? "anthropic/claude-sonnet-5.5";
const reasoningLevel = process.env.EVAL_REASONING_LEVEL ?? "medium";
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 3);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
  throw new Error("EVAL_REPETITIONS must be between 1 and 20");
const only = process.env.EVAL_CASE;
const queue = Array.from({ length: repetitions }, () =>
  cases.filter((c) => !only || c.id === only),
).flat();

const tree = (input: TidyInput): TreeState => ({
  topics: input.topics,
  held: input.held,
  threadTopic: Object.fromEntries(input.threads.map((t) => [t.id, t.topicId])),
});

/** The topic names and thread titles an edit is about. */
function subjects(edit: TidyEdit, input: TidyInput): string[] {
  const name = (ref: string | null) =>
    input.topics.find((t) => t.id === ref)?.name ?? ref?.replace(/^new:/, "");
  switch (edit.op) {
    case "merge":
      return [name(edit.from), name(edit.into)].filter(Boolean) as string[];
    case "reparent":
    case "rename":
      return [name(edit.topic)].filter(Boolean) as string[];
    case "create":
      return [edit.name, ...edit.children.map(name)].filter(
        Boolean,
      ) as string[];
    case "move":
      return [
        input.threads.find((t) => t.id === edit.thread)?.title ?? "",
        name(edit.topic) ?? "",
      ];
  }
}

/**
 * Whether a reason is about its own edit: it names one of the edit's topics
 * or threads by a distinctive word.
 */
function onTopic(reason: string, edit: TidyEdit, input: TidyInput): boolean {
  const words = subjects(edit, input)
    .flatMap((s) => s.toLowerCase().split(/[^a-z0-9]+/))
    .filter((w) => w.length >= 4);
  const text = reason.toLowerCase();
  return words.some((w) => text.includes(w));
}

const results: Record<string, unknown>[] = [];
let cursor = 0;
const started = Date.now();
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (cursor < queue.length) {
      const test = queue[cursor++]!;
      const prompt = tidyPrompt(test.input);
      const begun = Date.now();
      let edits: ProposedEdit[] = [];
      let error: string | null = null;
      let text = "";
      let cost = 0;
      try {
        const completion = await gatewayComplete({
          apiKey,
          model,
          prompt,
          maxTokens: 12_000,
          reasoningLevel,
          outputSchema: tidySchema(),
        });
        text = completion.text;
        cost = completion.usage.cost;
        // Production drops edits that would break a rule of the tree.
        edits = parseTidy(text, test.input).filter(
          (e) => !refusal(e.edit, tree(test.input)),
        );
      } catch (e) {
        error = String(e);
      }
      const found = (pattern: EditPattern | EditPattern[]) =>
        [pattern].flat().some((p) => edits.some((e) => matches(e.edit, p)));
      const missed = test.expect.filter((p) => !found(p));
      const forbidden = test.forbid.filter((p) => found(p));
      const offTopic = edits.filter(
        (e) => !onTopic(e.reason, e.edit, test.input),
      );
      const misnamed = Object.entries(test.names ?? {}).filter(
        ([topic, name]) =>
          !edits.some(
            (e) =>
              (e.edit.op === "reparent" || e.edit.op === "rename") &&
              e.edit.topic === topic &&
              e.edit.name?.toLowerCase() === name.toLowerCase(),
          ),
      );
      const names = new Map(test.input.topics.map((t) => [t.id, t.name]));
      const describe = (edit: TidyEdit) =>
        `${describeEdit(edit, {
          topic: (ref) => (ref ? (names.get(ref) ?? ref) : "the top level"),
          thread: (id) =>
            test.input.threads.find((t) => t.id === id)?.title ?? id,
        })}`;
      results.push({
        id: test.id,
        passed:
          !error &&
          missed.length === 0 &&
          forbidden.length === 0 &&
          misnamed.length === 0,
        error,
        missed,
        forbidden,
        offTopic: offTopic.map((e) => `${describe(e.edit)} — ${e.reason}`),
        misnamed: misnamed.map(([topic, name]) => `${topic} as ${name}`),
        edits: edits.map((e) => `${describe(e.edit)} — ${e.reason}`),
        latencyMs: Date.now() - begun,
        cost,
        response: text,
      });
    }
  }),
);

const by = (id: string) => results.filter((r) => r.id === id);
const lines = cases
  .filter((c) => !only || c.id === only)
  .map((c) => {
    const runs = by(c.id);
    const pass = runs.filter((r) => r.passed).length;
    const edits = runs.reduce((n, r) => n + (r.edits as string[]).length, 0);
    const off = runs.reduce((n, r) => n + (r.offTopic as string[]).length, 0);
    const named = c.names
      ? ` named ${runs.filter((r) => !(r.misnamed as string[]).length).length}/${runs.length}`
      : "";
    return `${pass}/${runs.length} ${c.id}: ${edits} edits, ${off} off-topic reasons${named}`;
  });
const passed = results.filter((r) => r.passed).length;
const latencies = results
  .map((r) => r.latencyMs as number)
  .sort((a, b) => a - b);
const report = {
  model,
  reasoningLevel,
  repetitions,
  passed,
  total: results.length,
  cost: results.reduce((n, r) => n + (r.cost as number), 0),
  p95Ms: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
  durationMs: Date.now() - started,
  results,
};
await writeFile(
  process.env.EVAL_OUTPUT ?? "/tmp/tidy-eval.json",
  JSON.stringify(report, null, 2),
);
console.log(lines.join("\n"));
console.log(
  `${passed}/${results.length} tidy ${model} (${reasoningLevel}) $${report.cost.toFixed(3)} p95 ${(report.p95Ms / 1000).toFixed(1)}s`,
);
process.exitCode = passed === results.length ? 0 : 1;
