/*
 * Paid, tool-free format gate using synthetic facts; never mutates plugin
 * state. The gateway cannot call tools, so each answer returns the recap
 * arguments a tool call would carry, scored by the schema the server accepts.
 */
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
import {
  RECAP_INSTRUCTIONS,
  recapInputSchema,
  recapToolSchema,
  RECAP_TOOL,
  type RecapInput,
} from "../src/domain/recap.ts";
import { onlyReplyBlock } from "../src/domain/replyText.ts";
import { parse, toText } from "../src/domain/reply.ts";
import type { ReplyPart } from "../src/domain/replyComponents.ts";
import { testCountProblems } from "./reply-counts.ts";

const cases = [
  {
    id: "investigation",
    state: "complete",
    types: ["comparison", "context"],
    request:
      "Explain why our retry handler reports five attempts when the setting is four. Facts from inspection: maxRetries=4; the loop performs one initial attempt and then four retries. The UI label says Attempts, although its value is the retry count. This was confirmed in the loop and its test, not a production incident. Explain the cause and compare changing the label with changing the loop. You have finished the investigation; do not change code.",
    expected: ["comparison"],
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
    types: ["context"],
    request:
      "Explain this supplied result: the loop performs one initial attempt and four retries, so five total attempts. This answer uses Structured replies with recaps disabled; explain the result without recap state, result checkboxes, or recap sections.",
    expected: ["context"],
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
/** A recap rejection as the tool reports it: the field path names what to fix. */
const issueText = (issue?: { path: PropertyKey[]; message: string }) =>
  issue
    ? `${issue.path.length ? `${issue.path.map(String).join(".")}: ` : ""}${issue.message}`
    : undefined;
const apiKey = await gatewayKey();
if (!apiKey) throw Error("AI Gateway authentication required");
const model = process.env.EVAL_MODEL ?? "openai/gpt-6-luna";
const output = process.env.EVAL_OUTPUT ?? "/tmp/reply-eval.json";
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 1);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5)
  throw Error("EVAL_REPETITIONS must be 1–5");
/**
 * The recap a tool call carries, in one JSON answer instead of a call. The
 * reply is authored as plain text in its own call: nesting it in this string
 * made models confuse the two evals' JSON with their own fences, which says
 * nothing about the contract being measured. The tool's parameter schema is
 * given as prompt text, not as a constrained output format: under constrained
 * decoding some models leave out optional fields that a real tool call, which
 * shows the model the schema and its descriptions, would include.
 */
const { $schema: _schema, ...recapJson } = z.toJSONSchema(
  recapToolSchema,
) as Record<string, unknown>;
const replyEnvelope = {
  type: "object",
  additionalProperties: false,
  properties: { reply: { type: "string" } },
  required: ["reply"],
} as Record<string, unknown>;
/** Reading is lenient so a rejected recap is scored instead of thrown. */
const readRecap = (text: string): unknown => {
  const parsed: unknown = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? text);
  // A real call has no wrapper, so arguments sent bare are the same answer.
  return typeof parsed === "object" && parsed !== null && "recap" in parsed
    ? (parsed as { recap: unknown }).recap
    : parsed;
};
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
  const withRecap = !("bodyOnly" in task && task.bodyOnly);
  for (let run = 1; run <= repetitions; run++) {
    const start = performance.now();
    let completion: Completion | undefined;
    try {
      const examples = task.types
        .map((type) => componentFence(COMPONENT_EXAMPLES[type]))
        .join("\n\n");
      const reasoningLevel = process.env.EVAL_REASONING_LEVEL ?? "medium";
      const usage = { input: 0, output: 0, cost: 0 };
      const addUsage = (next: Completion) => {
        usage.input += next.usage.input;
        usage.output += next.usage.output;
        usage.cost += next.usage.cost;
      };
      const problems: string[] = [];
      const selectionNotes: string[] = [];
      // The card comes from the call the turn makes before its reply, so the
      // recap arguments are authored first. A rejected call is answered once,
      // as the tool answers it in the turn that made it.
      let accepted: ReturnType<typeof recapInputSchema.safeParse> | null = null;
      let recapResponse: Completion | undefined;
      const rejections: string[] = [];
      if (withRecap) {
        let prompt = `You are ending a turn in BB. Task:\n${task.request}`;
        for (let attempt = 1; attempt <= 2; attempt++) {
          const response = await gatewayComplete({
            apiKey,
            model,
            reasoningLevel,
            maxTokens: 4096,
            signal: AbortSignal.timeout(90_000),
            systemPrompt: [
              `You are ending a turn in BB by calling the ${RECAP_TOOL} tool. Return only a JSON object whose recap field holds exactly the arguments for that call, as the tool's parameter schema describes them.`,
              `Tool parameter schema:\n${JSON.stringify(recapJson)}`,
              RECAP_INSTRUCTIONS,
            ].join("\n\n"),
            prompt,
          });
          addUsage(response);
          if (cutOff(response.stopReason)) {
            problems.push("Recap call was cut off at the token limit; rerun");
            break;
          }
          recapResponse = response;
          let rejection: string;
          try {
            accepted = recapInputSchema.safeParse(readRecap(response.text));
            if (accepted.success) break;
            rejection = issueText(accepted.error.issues[0]) ?? "invalid recap";
          } catch (error) {
            rejection = error instanceof Error ? error.message : String(error);
          }
          rejections.push(rejection);
          prompt = `${prompt}\n\nThe ${RECAP_TOOL} call you sent was rejected: ${rejection}\nSend the corrected arguments only.`;
        }
      }
      completion = await gatewayComplete({
        apiKey,
        model,
        reasoningLevel,
        maxTokens: 8192,
        signal: AbortSignal.timeout(90_000),
        outputSchema: replyEnvelope,
        systemPrompt: [
          "You are answering a person in BB. Return JSON with one field, reply, whose string holds the full human-facing reply following the instructions below. The examples tool has already returned the examples supplied with the task; proceed to the final reply.",
          REPLY_COMPONENT_INSTRUCTIONS,
          replyInstructions(withRecap),
        ].join("\n\n"),
        prompt: [
          `The examples tool returned these illustrative component examples:\n${examples}`,
          `Task:\n${task.request}`,
          withRecap && accepted?.success
            ? `The ${RECAP_TOOL} call you already made carries:\n${JSON.stringify(accepted.data)}`
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join("\n\n"),
      });
      addUsage(completion);
      if (cutOff(completion.stopReason)) {
        results.push({
          id: task.id,
          run,
          skipped: true,
          reason: `The answer was cut off at the token limit (${completion.stopReason}); rerun this case.`,
          rawCompletion: completion.text,
          stopReason: completion.stopReason,
          usage,
          durationMs: Math.round(performance.now() - start),
        });
        continue;
      }
      const answer = z
        .object({ reply: z.string() })
        .parse(JSON.parse(completion.text)).reply;
      const block = onlyReplyBlock(answer);
      const read =
        block?.status === "closed"
          ? parse(block, { status: block.status })
          : null;
      if ("short" in task && task.short) {
        // The request fixes the output, so the reply is that fact alone,
        // without a block, and the recap carries nothing beyond its state.
        const recap = accepted?.success ? accepted.data : null;
        if (answer.includes(":::"))
          problems.push("Fixed-output answer is wrapped in a block");
        if (!/\b4\b/.test(answer) || answer.length > 200)
          problems.push("Fixed-output answer is not the requested fact alone");
        if (!recap)
          problems.push(
            `Recap rejected: ${issueText(accepted?.error?.issues[0]) ?? "missing recap"}`,
          );
        else if (
          recap.latest.length ||
          recap.next.length ||
          recap.links.length ||
          (Array.isArray(recap.review) ? recap.review.length : recap.review) ||
          recap.waitingAgents?.length
        )
          problems.push("Short answer has unnecessary parts or results");
      } else if (!read?.ok) problems.push("No single closed reply block");
      else {
        const data = read.data,
          parts = flatten(data.body),
          types = parts.map((part) => part.type);
        const recap: RecapInput | null = accepted?.success
          ? accepted.data
          : null;
        if (!withRecap) {
          if (data.card) problems.push("Body-only reply includes recap fields");
        } else if (data.card)
          problems.push(
            "The reply block carries recap fields; the tool call sets the card",
          );
        else if (!accepted?.success)
          problems.push(
            `Recap rejected: ${issueText(accepted?.error?.issues[0]) ?? "missing recap"}`,
          );
        else if (
          !(Array.isArray(task.state) ? task.state : [task.state]).includes(
            recap!.state,
          )
        )
          problems.push(
            `Expected ${[task.state].flat().join(" or ")} recap, received ${recap!.state}`,
          );
        if ("next" in task && task.next && !recap?.next.length)
          problems.push(
            "Advice identifies an optional improvement without an actionable Next item",
          );
        if ("waiting" in task && task.waiting && recap?.state === "waiting") {
          if (
            recap.timeout !== 60 ||
            !recap.waitingAgents?.some(
              (agent) => agent.threadId === "thr_eval_worker",
            )
          )
            problems.push(
              "Waiting recap omits the supplied worker or polling interval",
            );
          if (
            recap.latest.length ||
            recap.next.length ||
            recap.links.length ||
            (Array.isArray(recap.review) ? recap.review.length : recap.review)
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
        recap: recapResponse ? readRecap(recapResponse.text) : null,
        recapCompletion: recapResponse?.text ?? null,
        recapRejections: rejections,
        stopReason: completion.stopReason,
        text: read?.ok ? toText(read.data) : null,
        usage,
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
        .update("\0")
        .update(RECAP_INSTRUCTIONS)
        .digest("hex"),
      cases: cases.filter(
        (task) => !process.env.EVAL_CASE || process.env.EVAL_CASE === task.id,
      ),
      reasoning: process.env.EVAL_REASONING_LEVEL ?? "medium",
      method:
        "Tool-free synthetic format gate with examples supplied, not a harness or usability trial; each answer returns the recap arguments a tool call would carry",
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
