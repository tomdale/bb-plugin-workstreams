import { z } from "zod";
import {
  interactionPayloadSchema,
  interactionResponseSchema,
  toolInputSchema,
} from "./contracts.ts";
import { buildInteractionPayload } from "./translate.ts";

export const questionResultSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      details: z
        .string()
        .optional()
        .refine((value) => value === undefined || value.trim().length > 0),
      header: z.string(),
      options: z.array(
        z.object({
          label: z.string(),
          description: z.string(),
          preview: z.string().optional(),
        }),
      ),
      multiSelect: z.boolean(),
    }),
  ),
  answers: z.record(z.string(), z.string()),
  response: z.string().optional(),
  submission: interactionResponseSchema.optional(),
  annotations: z
    .record(
      z.string(),
      z.object({
        preview: z.string().optional(),
        notes: z.string().optional(),
        attachments: z
          .array(
            z.object({
              type: z.enum(["localImage", "localFile"]),
              projectId: z.string(),
              path: z.string(),
              name: z.string(),
              mimeType: z.string().optional(),
              sizeBytes: z.number().optional(),
              sourceProjectId: z.string().optional(),
              sourcePath: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});
export const questionHistorySchema = z.object({
  id: z.string(),
  at: z.number().nullable(),
  status: z.enum(["answered", "dismissed", "pending", "unknown"]),
  payload: interactionPayloadSchema,
  result: questionResultSchema.nullable(),
});
export type QuestionHistory = z.infer<typeof questionHistorySchema>;

export function questionResultRecord(
  value: unknown,
  id: string,
  at: number | null,
): QuestionHistory | null {
  const parsed = questionResultSchema.safeParse(value);
  if (!parsed.success) return null;
  const input = toolInputSchema.safeParse({ questions: parsed.data.questions });
  return input.success
    ? {
        id,
        at,
        status: "answered",
        payload: buildInteractionPayload(input.data),
        result: parsed.data,
      }
    : null;
}

export const DELIVERED_QUESTION_PREFIX =
  "Your earlier AskUserQuestion tool call has finished. Its result:";
export const RECOVERED_QUESTION_PREFIX =
  "My answer to your question (recovered after the question tool was interrupted):";

/** Detached answers are ordinary retained inputs, even when their UI row was suppressed. */
export function deliveredQuestionResult(text: string) {
  const prefix = DELIVERED_QUESTION_PREFIX;
  const recovered = RECOVERED_QUESTION_PREFIX;
  let raw: string;
  if (text.startsWith(prefix)) raw = text.slice(prefix.length);
  else if (text.startsWith(recovered)) {
    raw = text.slice(recovered.length).trim();
    const suffix =
      "Use this as my answer and resume the work that depended on it.";
    if (raw.endsWith(suffix)) raw = raw.slice(0, -suffix.length).trimEnd();
  } else return null;
  try {
    const result = questionResultSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
