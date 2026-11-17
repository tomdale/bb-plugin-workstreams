/**
 * The presentation loop's model client: AI Gateway's Anthropic Messages
 * endpoint with tools, which accepts screenshots inside tool results. It
 * sends only the tool definitions the loop passes, so the model has no other
 * tool to call.
 */
import { z } from "zod";
import { reportedCost } from "../gateway.ts";
import type { AssistantBlock, ToolModel } from "./driver.ts";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/messages";

const reply = z.object({
  content: z.array(z.looseObject({ type: z.string() })),
  stop_reason: z.string().nullable().optional(),
  usage: z
    .object({ input_tokens: z.number(), output_tokens: z.number() })
    .optional(),
  provider_metadata: z
    .object({
      gateway: z
        .object({ cost: z.union([z.string(), z.number()]).optional() })
        .optional(),
    })
    .optional(),
});

export function gatewayToolModel(options: {
  model: string;
  apiKey: string;
  fetch?: typeof fetch;
}): ToolModel {
  const send = options.fetch ?? fetch;
  return async ({ system, messages, tools, maxTokens, signal }) => {
    const res = await send(GATEWAY_URL, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": options.apiKey,
      },
      body: JSON.stringify({
        model: options.model,
        system,
        messages,
        tools,
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`AI Gateway returned ${res.status}.`);
    const body = reply.parse(await res.json());
    return {
      content: body.content as AssistantBlock[],
      stopReason: body.stop_reason ?? null,
      usage: {
        input: body.usage?.input_tokens ?? 0,
        output: body.usage?.output_tokens ?? 0,
        cost: reportedCost(body.provider_metadata?.gateway?.cost),
      },
    };
  };
}
