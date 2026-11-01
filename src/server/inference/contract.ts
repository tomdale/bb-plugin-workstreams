import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { usageSchema } from "../../domain/trace.ts";

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
   * One typed question to a decision model, whose answers are choices with
   * probabilities rather than generated text.
   */
  evaluate: {
    input: z
      .object({
        state: z.string().min(1).max(80_000),
        questions: z.record(z.string(), z.unknown()),
        model: z
          .string()
          .regex(/^[\w.-]+\/[\w.-]+$/)
          .max(100),
      })
      .strict(),
    output: z.object({
      answers: z.record(
        z.string(),
        z.object({
          type: z.string().optional(),
          choice: z.string().max(1_000).nullable().optional(),
          confidence: z.number().nullable().optional(),
          probabilities: z.record(z.string(), z.number()).nullable().optional(),
        }),
      ),
      usage: usageSchema,
    }),
  },
});
