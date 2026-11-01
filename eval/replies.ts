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
import { testCountProblems, unresolvedCauseQualified } from "./reply-facts.ts";

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
    next: true,
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
    id: "handoff",
    state: "complete",
    types: ["context"],
    request:
      "The user asked for a review of pull request 42 in another repository. That review belongs to @thread:thr_eval_dest, which finished it and posted its findings there; this thread's work is done and the user has not read those findings yet. Report the routing and name the destination. Do not do the review here.",
    expected: ["context"],
    next: true,
  },
  {
    id: "shipped-change",
    state: ["complete", "review"],
    types: ["change", "checks"],
    request:
      "Report a finished fix to the retry setting label. Facts: the label now says Retries; the retry loop and saved settings are unchanged. Five local tests passed with no failures or skips. The change is committed on branch fix/retry-label and nothing is pushed; publishing is the user's decision.",
    expected: ["change"],
    next: true,
  },
  {
    id: "routing",
    state: "complete",
    types: ["context"],
    request:
      "The user asked for a review of pull request 42 in another repository. You opened @thread:thr_eval_dest, which is running that review now, and this thread owns nothing that depends on its result. Report the routing and name the destination thread.",
    expected: ["context"],
    next: true,
  },
  {
    id: "waiting",
    state: "waiting",
    types: [],
    request:
      "The authorized implementation is finished, but this thread owns follow-up on independent verification in @thread:thr_eval_worker. That worker is still running and its result is needed before finishing. Report the actual status and check again in 60 seconds; do not claim all work is complete or ask the user to do the status check.",
    expected: [],
    waiting: true,
  },
  {
    id: "body-only",
    state: null,
    types: ["context", "finding"],
    request:
      "Explain this supplied result: the loop performs one initial attempt and four retries, so five total attempts. This answer uses Structured replies with recaps disabled; explain the result without recap state, result checkboxes, or recap sections.",
    expected: ["finding"],
    bodyOnly: true,
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
/** A response the gateway cut off mid-answer says nothing about the instructions. */
const cutOff = (stopReason: string | null) =>
  stopReason === "length" || stopReason === "max_tokens";
function flatten(parts: ReplyPart[]): ReplyPart[] {
  return parts.flatMap<ReplyPart>((part) =>
    part.type === "group" ? [part, ...part.children.flat()] : [part],
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
      const withRecap = !("bodyOnly" in task && task.bodyOnly);
      completion = await gatewayComplete({
        apiKey,
        model,
        reasoningLevel: process.env.EVAL_REASONING_LEVEL ?? "medium",
        maxTokens: 8192,
        signal: AbortSignal.timeout(90_000),
        outputSchema: envelope.toJSONSchema(),
        // BB delivers tool instructions before the contributed reply contract.
        systemPrompt: `You are answering a person in BB. Return JSON with one field, reply, whose string contains the full human-facing reply following the instructions below. The examples tool has already returned the examples supplied with the task; proceed to the final reply.\n\n${REPLY_COMPONENT_INSTRUCTIONS}\n\n${replyInstructions(withRecap)}`,
        prompt: `The examples tool returned these illustrative component examples:\n${examples}\n\nTask:\n${task.request}`,
      });
      if (cutOff(completion.stopReason)) {
        results.push({
          id: task.id,
          run,
          skipped: true,
          reason: `The answer was cut off at the token limit (${completion.stopReason}); rerun this case.`,
          rawCompletion: completion.text,
          stopReason: completion.stopReason,
          usage: completion.usage,
          durationMs: Math.round(performance.now() - start),
        });
        continue;
      }
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
        if (!withRecap) {
          if (data.card) problems.push("Body-only reply includes recap fields");
        } else if (!recap?.ok) problems.push("No usable recap");
        else if (
          !(Array.isArray(task.state) ? task.state : [task.state]).includes(
            recap.input.state,
          )
        )
          problems.push(
            `Expected ${[task.state].flat().join(" or ")} recap, received ${recap.input.state}`,
          );
        if ("next" in task && task.next && !data.card?.next.length)
          problems.push(
            "Advice identifies an optional improvement without an actionable Next item",
          );
        if (
          "waiting" in task &&
          task.waiting &&
          recap?.ok &&
          recap.input.state === "waiting"
        ) {
          if (
            recap.input.timeout !== 60 ||
            !recap.input.waitingAgents?.some(
              (agent) => agent.threadId === "thr_eval_worker",
            )
          )
            problems.push(
              "Waiting recap omits the supplied worker or polling interval",
            );
          if (
            data.card?.results.length ||
            data.card?.next.length ||
            data.card?.review.length ||
            data.card?.links.length
          )
            problems.push(
              "Waiting recap includes completed results or optional actions",
            );
        }
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
          !unresolvedCauseQualified(parts, toText(data))
        )
          problems.push("No explicit qualification of the unresolved cause");
        if (
          data.card &&
          data.card.state !== "waiting" &&
          data.body.length &&
          !data.card.results.length
        )
          problems.push("Substantive reply has no recap results");
        if ("totals" in task)
          problems.push(...testCountProblems(parts, toText(data), task.totals));
      }
      results.push({
        id: task.id,
        run,
        pass: problems.length === 0,
        problems,
        selectionNotes,
        reply: answer,
        stopReason: completion.stopReason,
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
        stopReason: completion?.stopReason ?? null,
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
        .update(replyInstructions(false))
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
  `${results.filter((result) => "pass" in result && result.pass).length}/${results.filter((result) => "pass" in result).length} reply format cases pass; ${results.flatMap((result) => ("selectionNotes" in result ? result.selectionNotes : [])).length} preferred-component selection notes; ${results.filter((result) => "skipped" in result).length} cut off and unscored; report: ${output}`,
);
const scored = results.filter((result) => "pass" in result);
if (!scored.length || scored.some((result) => !result.pass))
  process.exitCode = 1;
