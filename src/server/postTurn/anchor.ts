/**
 * Finds the assistant message a turn ended with, by identity rather than by
 * text. `thread.idle` reports only the final text, so the lookup reads the
 * thread's events: the latest root turn, how it ended, and the last root
 * `agentMessage` item inside it. BB's own final-output read selects the same
 * item, so the text must match the idle event's; a mismatch means the thread
 * moved on between the event and the read, and the lookup gives up rather
 * than guess.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  assistantMessageId,
  type AssistantMessageRef,
} from "../../domain/postTurn/message.ts";

type Sdk = BbPluginApi["sdk"];

export type FinalMessage = AssistantMessageRef & {
  messageId: string;
  text: string;
  seq: number;
};

export type FinalMessageLookup =
  { ok: true; message: FinalMessage } | { ok: false; reason: string };

/**
 * Turn events read back from the thread's end. Nested turns count too, so a
 * root turn that started more than this many nested turns is not found and gets
 * no document.
 */
const TURN_WINDOW = "100";
/**
 * Items read per page from a turn's end, newest first. Tool items carry their
 * output, so pages stay small; the final message is usually on the first.
 */
const ITEM_PAGE = 20;
const ITEM_PAGES = 5;

type LooseEvent = {
  type?: string;
  seq?: number;
  scope?: { kind?: string; turnId?: string };
  data?: {
    parentToolCallId?: string;
    status?: string;
    item?: {
      type?: string;
      id?: string;
      text?: string;
      parentToolCallId?: string;
    };
  };
};

const turnOf = (event: LooseEvent) =>
  event.scope?.kind === "turn" ? (event.scope.turnId ?? null) : null;

/**
 * The final message of the latest finished root turn, or of `options.turnId`.
 * A turn that started after it and is still running (a recap reminder, a
 * queued message) does not hide it. `expected` is the finished response's
 * text; it is required unless a turn is named.
 */
export async function findFinalMessage(
  sdk: Sdk,
  threadId: string,
  expected: string | null,
  options: { signal?: AbortSignal; turnId?: string } = {},
): Promise<FinalMessageLookup> {
  if (!options.turnId && !expected?.trim())
    return { ok: false, reason: "The turn ended without a final response." };
  const list = (args: Record<string, string | string[]>) =>
    sdk.threads.events.list({
      threadId,
      ...args,
      ...(options.signal ? { signal: options.signal } : {}),
    } as Parameters<Sdk["threads"]["events"]["list"]>[0]) as Promise<
      LooseEvent[]
    >;
  const [starts, ends] = await Promise.all([
    list({ types: ["turn/started"], order: "desc", limit: TURN_WINDOW }),
    list({ types: ["turn/completed"], order: "desc", limit: TURN_WINDOW }),
  ]);
  const roots = starts.filter(
    (event) =>
      event.type === "turn/started" &&
      typeof event.seq === "number" &&
      turnOf(event) !== null &&
      !event.data?.parentToolCallId,
  );
  if (!roots.length)
    return { ok: false, reason: "The thread has no agent turn." };
  const endOf = (turnId: string) =>
    ends.find(
      (event) =>
        event.type === "turn/completed" &&
        typeof event.seq === "number" &&
        turnOf(event) === turnId,
    );
  const started = options.turnId
    ? roots.find((event) => turnOf(event) === options.turnId)
    : roots.find((event) => endOf(turnOf(event)!));
  if (!started)
    return {
      ok: false,
      reason: options.turnId
        ? "No recent root turn has that id."
        : "No recent root turn has finished.",
    };
  const turnId = turnOf(started)!;
  const completed = endOf(turnId);
  if (!completed) return { ok: false, reason: "That turn has not finished." };
  if (completed.data?.status !== "completed")
    return {
      ok: false,
      reason: `The turn ended ${completed.data?.status ?? "without a status"}.`,
    };
  const isFinal = (event: LooseEvent) =>
    event.type === "item/completed" &&
    turnOf(event) === turnId &&
    event.data?.item?.type === "agentMessage" &&
    !event.data.item.parentToolCallId &&
    typeof event.data.item.id === "string" &&
    typeof event.data.item.text === "string" &&
    event.data.item.text.trim().length > 0;
  let final: LooseEvent | undefined;
  let before = completed.seq;
  for (let page = 0; page < ITEM_PAGES && !final; page++) {
    const items = await list({
      types: ["item/completed"],
      afterSeq: String(started.seq),
      beforeSeq: String(before),
      order: "desc",
      limit: String(ITEM_PAGE),
    });
    final = items.find(isFinal);
    const oldest = items.at(-1)?.seq;
    if (items.length < ITEM_PAGE || typeof oldest !== "number") break;
    before = oldest;
  }
  const item = final?.data?.item;
  if (!final || typeof final.seq !== "number" || !item?.id || !item.text)
    return {
      ok: false,
      reason: "The turn has no final assistant message.",
    };
  if (expected !== null && item.text !== expected)
    return {
      ok: false,
      reason:
        "The turn's final message differs from the finished response; the thread changed.",
    };
  const ref = { threadId, turnId, itemId: item.id };
  return {
    ok: true,
    message: {
      ...ref,
      messageId: assistantMessageId(ref),
      text: item.text,
      seq: final.seq,
    },
  };
}
