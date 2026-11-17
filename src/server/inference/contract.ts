import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { usageSchema } from "../../domain/trace.ts";
import { PRESENTATION_LIMITS } from "../../domain/postTurn/limits.ts";
import { documentWorkstreamSchema } from "../../domain/postTurn/message.ts";

/** RPC between the plugin server and its `bb.host` entry on the machine. */
export const hostContract = defineRpcContract({
  complete: {
    input: z
      .object({
        prompt: z.string().max(320_000),
        reasoningLevel: z.string().min(1).max(50).optional(),
        outputSchema: z.record(z.string(), z.unknown()).optional(),
        serviceTier: z.string().min(1).max(50).optional(),
        maxTokens: z.number().int().min(1024).max(32768).optional(),
        model: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/)
          .max(100),
      })
      .strict(),
    output: z.object({
      text: z.string().max(200_000),
      usage: usageSchema,
      // Optional so a host bundle built before reasoning capture still answers.
      reasoning: z.string().max(200_000).nullable().optional(),
      stopReason: z.string().max(100).nullable().optional(),
    }),
  },
  /**
   * Composes one enhanced response document: the bounded presentation loop
   * with Chrome previews on this machine. The server validates the returned
   * document again before storing it.
   */
  present: {
    input: z
      .object({
        model: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/)
          .max(100),
        response: z.string().min(1).max(PRESENTATION_LIMITS.responseChars),
        title: z.string().max(PRESENTATION_LIMITS.titleChars),
        workstream: documentWorkstreamSchema.nullable(),
        theme: z.enum(["light", "dark"]),
      })
      .strict(),
    output: z.object({
      kind: z.enum(["document", "none", "failed"]),
      document: z.unknown().optional(),
      reason: z.string().max(2_000).nullable(),
      /** A `failed` composition whose model answered with nothing usable. */
      invalid: z.boolean().optional(),
      previews: z.number().int().min(0),
      modelCalls: z.number().int().min(0),
      usage: usageSchema,
    }),
  },
});
