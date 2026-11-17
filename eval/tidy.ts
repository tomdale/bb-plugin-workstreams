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
  workstreams: input.workstreams,
  held: input.held,
  threadWorkstream: Object.fromEntries(
    input.threads.map((t) => [t.id, t.workstreamId]),
  ),
});

/** The workstream names and thread titles an edit is about. */
function subjects(edit: TidyEdit, input: TidyInput): string[] {
  const name = (ref: string | null) =>
    input.workstreams.find((t) => t.id === ref)?.name ??
    ref?.replace(/^new:/, "");
  switch (edit.op) {
    case "merge":
      return [name(edit.from), name(edit.into)].filter(Boolean) as string[];
    case "move-workstream":
    case "rename":
      return [name(edit.workstream)].filter(Boolean) as string[];
    case "group":
      return [edit.name, ...edit.children.map(name)].filter(
        Boolean,
      ) as string[];
    case "move-thread":
      return [
        input.threads.find((t) => t.id === edit.thread)?.title ?? "",
        name(edit.workstream) ?? "",
      ];
  }
}

/**
 * Whether a reason is about its own edit: it names one of the edit's
 * workstreams or threads by a distinctive word.
 */
function onWorkstream(
  reason: string,
  edit: TidyEdit,
  input: TidyInput,
): boolean {
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
      let refused: { edit: ProposedEdit; why: string }[] = [];
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
        cost = completion.usage.cost ?? 0;
        // Production drops edits that would break a rule of the tree; the
        // report keeps them, since they show where the prompt misleads.
        const parsed = parseTidy(text, test.input);
        refused = parsed.flatMap((e) => {
          const why = refusal(e.edit, tree(test.input));
          return why ? [{ edit: e, why }] : [];
        });
        edits = parsed.filter((e) => !refused.some((r) => r.edit === e));
      } catch (e) {
        error = String(e);
      }
      const found = (pattern: EditPattern | EditPattern[]) =>
        [pattern].flat().some((p) => edits.some((e) => matches(e.edit, p)));
      const missed = test.expect.filter((p) => !found(p));
      const forbidden = test.forbid.filter((p) => found(p));
      const offWorkstream = edits.filter(
        (e) => !onWorkstream(e.reason, e.edit, test.input),
      );
      const misnamed = Object.entries(test.names ?? {}).filter(
        ([workstream, name]) =>
          !edits.some(
            (e) =>
              (e.edit.op === "move-workstream" || e.edit.op === "rename") &&
              e.edit.workstream === workstream &&
              e.edit.name?.toLowerCase() === name.toLowerCase(),
          ),
      );
      const names = new Map(test.input.workstreams.map((t) => [t.id, t.name]));
      const describe = (edit: TidyEdit) =>
        `${describeEdit(edit, {
          workstream: (ref) =>
            ref ? (names.get(ref) ?? ref) : "the top level",
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
        offWorkstream: offWorkstream.map(
          (e) => `${describe(e.edit)} — ${e.reason}`,
        ),
        misnamed: misnamed.map(
          ([workstream, name]) => `${workstream} as ${name}`,
        ),
        edits: edits.map((e) => `${describe(e.edit)} — ${e.reason}`),
        refused: refused.map(
          (r) => `${describe(r.edit.edit)} — ${r.why} — ${r.edit.reason}`,
        ),
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
    const off = runs.reduce(
      (n, r) => n + (r.offWorkstream as string[]).length,
      0,
    );
    const refused = runs.reduce(
      (n, r) => n + (r.refused as string[]).length,
      0,
    );
    const named = c.names
      ? ` named ${runs.filter((r) => !(r.misnamed as string[]).length).length}/${runs.length}`
      : "";
    return `${pass}/${runs.length} ${c.id}: ${edits} edits, ${refused} refused, ${off} unrelated reasons${named}`;
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
