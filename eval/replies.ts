/* Paid, tool-free format gate using synthetic facts; never mutates plugin state. */
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  gatewayComplete,
  gatewayKey,
  type Completion,
} from "../src/server/inference/gateway.ts";
import {
  replyInstructions,
  REPLY_COMPONENT_INSTRUCTIONS,
} from "../src/domain/replyInstructions.ts";
import {
  COMPONENT_EXAMPLES,
  componentFence,
} from "../src/domain/replyExamples.ts";
import { onlyReplyBlock } from "../src/domain/replyText.ts";
import { parse, toText } from "../src/domain/reply.ts";
import { recapInputFromCard } from "../src/domain/replyRecap.ts";
import type { ReplyPart } from "../src/domain/replyComponents.ts";

const cases = [
  {
    id: "investigation",
    state: "complete",
    types: ["finding", "comparison", "context"],
    request:
      "Explain why our retry handler reports five attempts when the setting is four. Facts from inspection: maxRetries=4; the loop performs one initial attempt and then four retries. The UI label says Attempts, although its value is the retry count. This was confirmed in the loop and its test, not a production incident. Explain the cause and compare changing the label with changing the loop. You have finished the investigation; do not change code.",
    expected: ["finding", "comparison"],
  },
  {
    id: "change",
    state: "review",
    types: ["change", "checks", "delivery", "group", "context"],
    request:
      "Report the completed fix to the retry setting label. Facts: the label now says Retries; the loop and saved settings are unchanged. Eight local tests passed and one remote integration test was skipped because no credential was available. The change is committed as abc1234 locally, not pushed or deployed. Explain why retaining the loop preserves the initial attempt and the configured retries. The user needs to inspect the label before shipping. No further work is authorized.",
    expected: ["change", "checks", "delivery"],
    totals: { passed: 8, failed: 0, skipped: 1 },
  },
  {
    id: "recommendation",
    state: "complete",
    types: ["recommendation", "comparison", "context"],
    request:
      "Recommend how to fix the retry setting confusion. The loop correctly performs one attempt plus the configured retries; changing it would alter existing behavior. Renaming the label to Retries matches the stored value and docs. Explain your recommendation and compare the trade-offs. It is advice only; do not ask for approval or implement anything.",
    expected: ["recommendation", "comparison"],
  },
  {
    id: "uncertain",
    state: "complete",
    types: ["finding", "context"],
    request:
      "Investigate a report that the retry loop sometimes runs forever. The only evidence available is a configuration file with maxRetries=4. You have no runtime logs, could not reproduce the behavior, and have finished the authorized inspection. Explain what the configuration establishes, what it does not establish, and what evidence would be needed. Do not assert that you found a root cause.",
    expected: ["finding"],
    uncertain: true,
  },
  {
    id: "short",
    state: "complete",
    types: [],
    request:
      "What is the configured retry count? The supplied configuration says maxRetries=4. Answer with that fact only.",
    expected: [],
    short: true,
  },
] as const;
const apiKey = await gatewayKey();
if (!apiKey) throw Error("AI Gateway authentication required");
const model = process.env.EVAL_MODEL ?? "openai/gpt-6-luna";
const output = process.env.EVAL_OUTPUT ?? "/tmp/reply-eval.json";
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 1);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5)
  throw Error("EVAL_REPETITIONS must be 1–5");
const envelope = z.object({ reply: z.string() });
const results = [];
function flatten(parts: ReplyPart[]): ReplyPart[] {
  return parts.flatMap<ReplyPart>((part) =>
    part.type === "group" ? [part, ...part.children] : [part],
  );
}
for (const task of cases) {
  if (process.env.EVAL_CASE && process.env.EVAL_CASE !== task.id) continue;
  for (let run = 1; run <= repetitions; run++) {
    const start = performance.now();
    let completion: Completion | undefined;
    try {
      const examples = task.types
        .map((type) => componentFence(COMPONENT_EXAMPLES[type]))
        .join("\n\n");
      completion = await gatewayComplete({
        apiKey,
        model,
        reasoningLevel: process.env.EVAL_REASONING_LEVEL ?? "medium",
        maxTokens: 4096,
        signal: AbortSignal.timeout(90_000),
        outputSchema: envelope.toJSONSchema(),
        // BB delivers tool instructions before the contributed reply contract.
        systemPrompt: `You are answering a person in BB. Return JSON with one field, reply, whose string contains the full human-facing reply following the instructions below. The examples tool has already returned the examples supplied with the task; proceed to the final reply.\n\n${REPLY_COMPONENT_INSTRUCTIONS}\n\n${replyInstructions(true)}`,
        prompt: `The examples tool returned these illustrative component examples:\n${examples}\n\nTask:\n${task.request}`,
      });
      const answer = envelope.parse(JSON.parse(completion.text)).reply;
      const block = onlyReplyBlock(answer);
      const read =
        block?.status === "closed"
          ? parse(block, { status: block.status })
          : null;
      const problems: string[] = [];
      const selectionNotes: string[] = [];
      if (!read?.ok) problems.push("No single closed reply block");
      else {
        const data = read.data,
          parts = flatten(data.body),
          types = parts.map((part) => part.type);
        const recap = data.card ? recapInputFromCard(data.card) : null;
        if (!recap?.ok) problems.push("No usable recap");
        else if (recap.input.state !== task.state)
          problems.push(
            `Expected ${task.state} recap, received ${recap.input.state}`,
          );
        if (
          parts.some(
            (part) => part.type === "unparsed" || part.type === "pending",
          )
        )
          problems.push("Malformed component");
        for (const expected of task.expected)
          if (!types.includes(expected))
            selectionNotes.push(
              `Preferred ${expected} component was not selected`,
            );
        if (
          "short" in task &&
          task.short &&
          (data.body.length ||
            data.card?.results.length ||
            data.card?.review.length ||
            data.card?.next.length ||
            data.card?.links.length ||
            data.card?.waitingOn.length)
        )
          problems.push("Short answer has unnecessary body or results");
        if (
          "uncertain" in task &&
          task.uncertain &&
          !parts.some(
            (part) => part.type === "finding" && part.certainty !== "observed",
          ) &&
          !/no root cause|cause.{0,50}(unknown|unresolved|not established)|cannot.{0,30}(determine|establish)|unverified|not reproduced/i.test(
            toText(data),
          )
        )
          problems.push("No explicit qualification of the unresolved cause");
        if (
          data.card &&
          data.card.state !== "waiting" &&
          data.body.length &&
          !data.card.results.length
        )
          problems.push("Substantive reply has no recap results");
        if ("totals" in task) {
          const checks = parts.find((part) => part.type === "checks");
          const totals =
            checks?.type === "checks" ? checks.testTotals : undefined;
          if (
            !totals ||
            totals.passed !== task.totals.passed ||
            totals.failed !== task.totals.failed ||
            totals.skipped !== task.totals.skipped
          )
            problems.push("Reported test totals differ from supplied facts");
        }
      }
      results.push({
        id: task.id,
        run,
        pass: problems.length === 0,
        problems,
        selectionNotes,
        reply: answer,
        text: read?.ok ? toText(read.data) : null,
        usage: completion.usage,
        durationMs: Math.round(performance.now() - start),
      });
    } catch (error) {
      results.push({
        id: task.id,
        run,
        pass: false,
        problems: [error instanceof Error ? error.message : String(error)],
        rawCompletion: completion?.text ?? null,
        usage: completion?.usage ?? null,
        durationMs: Math.round(performance.now() - start),
      });
    }
  }
}
await writeFile(
  output,
  JSON.stringify(
    {
      model,
      instructionHash: createHash("sha256")
        .update(replyInstructions(true))
        .update("\0")
        .update(REPLY_COMPONENT_INSTRUCTIONS)
        .digest("hex"),
      cases: cases.filter(
        (task) => !process.env.EVAL_CASE || process.env.EVAL_CASE === task.id,
      ),
      reasoning: process.env.EVAL_REASONING_LEVEL ?? "medium",
      method:
        "Tool-free synthetic format gate with examples supplied, not a harness or usability trial",
      results,
    },
    null,
    2,
  ),
);
console.log(
  `${results.filter((result) => result.pass).length}/${results.length} reply format cases pass; ${results.flatMap((result) => ("selectionNotes" in result ? result.selectionNotes : [])).length} preferred-component selection notes; report: ${output}`,
);
if (!results.length || results.some((result) => !result.pass))
  process.exitCode = 1;
