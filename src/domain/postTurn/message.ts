/**
 * The identity of the assistant message an enhanced document belongs to.
 *
 * BB names a thread's assistant message `<thread>:assistant:<key>`, where the
 * key joins the turn, the parent tool call (`root` for the thread's own turn),
 * and the provider's item id (`@bb/thread-view`'s buffered-text identity). A
 * top-level timeline row's `data-timeline-row-id` is that message id exactly;
 * a row nested under a delegation prefixes it, so an exact match finds only
 * the thread's own final message.
 *
 * This format is BB's internal one, not a public contract. The server derives
 * the id from the turn and item it read, and the app only draws beside a row
 * whose id equals it; if BB changes the format nothing matches and nothing is
 * drawn, while the original response stays as it was.
 */
import { z } from "zod";
import type { EnhancedDocument } from "./document.ts";

export type AssistantMessageRef = {
  threadId: string;
  turnId: string;
  itemId: string;
};

export function assistantMessageId(ref: AssistantMessageRef): string {
  return `${ref.threadId}:assistant:kind:assistant|turn:${ref.turnId}|parent:root|item:${ref.itemId}`;
}

const ROOT_ASSISTANT_ROW =
  /^([^:|]+):assistant:kind:assistant\|turn:([^|]+)\|parent:root\|item:(.+)$/;

/** The message a top-level assistant row shows, or null for any other row. */
export function parseAssistantRowId(rowId: string): AssistantMessageRef | null {
  const match = ROOT_ASSISTANT_ROW.exec(rowId);
  return match
    ? { threadId: match[1]!, turnId: match[2]!, itemId: match[3]! }
    : null;
}

/** The workstream a document was composed under, as its header shows it. */
export const documentWorkstreamSchema = z.object({
  name: z.string().min(1).max(200),
  color: z
    .object({
      hue: z.number(),
      level: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    })
    .nullable(),
});
export type DocumentWorkstream = z.infer<typeof documentWorkstreamSchema>;

/** One stored enhanced document, keyed by the message it follows. */
export type StoredPresentation = {
  messageId: string;
  threadId: string;
  turnId: string;
  workstream: DocumentWorkstream | null;
  document: EnhancedDocument;
  createdAt: number;
};

/**
 * What became of a plan document: approved, answered with one of its
 * suggested replies, or passed by a newer turn before either. A plan with no
 * outcome is open, and only an open plan offers Approve and its replies.
 */
export const planOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approved") }),
  z.object({ kind: z.literal("replied"), message: z.string() }),
  z.object({ kind: z.literal("superseded") }),
]);
export type PlanOutcome = z.infer<typeof planOutcomeSchema>;
