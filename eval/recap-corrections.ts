/* Paid synthetic replay of missed recaps, with real tool selection. */
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { gatewayKey } from "../src/server/inference/gateway.ts";
import {
  RECAP_CORRECTION,
  RECAP_INSTRUCTIONS,
  RECAP_TOOL,
  RECAP_TOOL_DESCRIPTION,
  recapInputSchema,
  recapToolSchema,
} from "../src/domain/recap.ts";
import { replyInstructions } from "../src/domain/replyInstructions.ts";

const baseline = `Your turn ended without a recap. Finish any remaining authorized work, then call ${RECAP_TOOL} to report it. If you need the user's input instead, ask through the available question-card tool; the question ends the turn.`;
const cases = [
  {
    id: "answered",
    request:
      "What is the configured retry count? The configuration says maxRetries=4. Answer with that fact only.",
    prior: ":::reply\nThe configured retry count is 4.\n:::",
    tool: RECAP_TOOL,
  },
  {
    id: "unanswered",
    request:
      "What is the configured retry count? The configuration says maxRetries=4. Answer with that fact only.",
    prior: "I found the configured value in the configuration.",
    tool: RECAP_TOOL,
  },
  {
    id: "question",
    request:
      "I need the retry behavior changed. Ask me whether to allow four retries or none; do not choose for me.",
    prior: ":::reply\nThe retry count needs your decision.\n:::",
    tool: "AskUserQuestion",
  },
] as const;
const apiKey = await gatewayKey();
if (!apiKey) throw Error("AI Gateway authentication required");
const model = process.env.EVAL_MODEL ?? "openai/gpt-6-luna";
const reasoning = process.env.EVAL_REASONING_LEVEL ?? "xhigh";
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 1);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5)
  throw Error("EVAL_REPETITIONS must be 1–5");
const output = process.env.EVAL_OUTPUT ?? "/tmp/recap-corrections-eval.json";
const schema = z.toJSONSchema(recapToolSchema) as Record<string, unknown>;
delete schema.$schema;
const tools = [
  {
    type: "function",
    function: {
      name: RECAP_TOOL,
      description: RECAP_TOOL_DESCRIPTION,
      parameters: schema,
    },
  },
  {
    type: "function",
    function: {
      name: "AskUserQuestion",
      description: "Ask the user a required question and wait for their answer",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
        additionalProperties: false,
      },
    },
  },
];
type Step = {
  text: string | null;
  tool: string | null;
  arguments: unknown;
  valid: boolean;
  finishReason: string;
  usage: unknown;
};
const results: {
  scenario: string;
  run: number;
  variant: string;
  passed: boolean;
  steps: Step[];
}[] = [];
for (const scenario of cases) {
  for (let run = 1; run <= repetitions; run++) {
    for (const [variant, correction] of [
      ["baseline", baseline],
      ["candidate", RECAP_CORRECTION],
    ] as const) {
      const messages = [
        {
          role: "system",
          content: `${RECAP_INSTRUCTIONS}\n${replyInstructions(true)}`,
        },
        { role: "user", content: scenario.request },
        { role: "assistant", content: scenario.prior },
      ];
      const steps: Step[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        messages.push({
          role: "user",
          content: `[Workstreams recap synthetic 1 ${attempt}]\n${correction} Correction ${attempt} of 3.`,
        });
        const response = await fetch(
          "https://ai-gateway.vercel.sh/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              reasoning_effort: reasoning,
              max_tokens: 4096,
              messages,
              tools,
              tool_choice: "auto",
            }),
          },
        );
        if (!response.ok) throw Error(`Gateway returned ${response.status}`);
        const body = (await response.json()) as {
          choices: {
            finish_reason: string;
            message: {
              content: string | null;
              tool_calls?: { function: { name: string; arguments: string } }[];
            };
          }[];
          usage?: unknown;
        };
        const choice = body.choices[0]!;
        const message = choice.message;
        const call = message.tool_calls?.[0]?.function;
        let valid = false;
        let args: unknown = null;
        try {
          args = JSON.parse(call?.arguments ?? "null");
          valid =
            call?.name === RECAP_TOOL
              ? recapInputSchema.safeParse(args).success
              : call?.name === "AskUserQuestion" &&
                z.object({ question: z.string().min(1) }).safeParse(args)
                  .success;
        } catch {
          /* malformed arguments fail the case */
        }
        steps.push({
          text: message.content,
          tool: call?.name ?? null,
          arguments: args,
          valid,
          finishReason: choice.finish_reason,
          usage: body.usage ?? null,
        });
        if (call || choice.finish_reason !== "stop" || !message.content?.trim())
          break;
        messages.push({ role: "assistant", content: message.content });
      }
      const last = steps.at(-1)!;
      const texts = steps
        .map((step) => step.text?.trim() ?? "")
        .filter(Boolean);
      const visible = `${texts.join(" ")} ${JSON.stringify(last.arguments)}`;
      const contentOk =
        scenario.id === "answered"
          ? texts.length === 0
          : scenario.id === "unanswered"
            ? /\b4\b/.test(visible) && texts.length <= 1
            : !texts.includes(scenario.prior);
      const passed = last.tool === scenario.tool && last.valid && contentOk;
      results.push({ scenario: scenario.id, run, variant, passed, steps });
      console.log(
        `${scenario.id} ${run} ${variant}: ${passed ? "pass" : "fail"} (${steps.length} reminders)`,
      );
    }
  }
}
await writeFile(
  output,
  JSON.stringify({ model, reasoning, repetitions, results }, null, 2),
);
console.log(`Report: ${output}`);
if (results.some((result) => result.variant === "candidate" && !result.passed))
  process.exitCode = 1;
