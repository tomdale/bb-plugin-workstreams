/**
 * A thread's user requests as BB records them. Shared by everything that
 * reads what a thread was asked to do: analysis, ownership evidence, and the
 * opening title.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { withoutSubagentDeliveries } from "./requestProvenance.ts";

type Sdk = BbPluginApi["sdk"];

const SYSTEM_PREFIX = "[bb system]";

type InputPart = { type: string; text?: string };

/** The concatenated text blocks of a prompt input. */
export function inputText(input: unknown): string {
  if (!Array.isArray(input)) return "";
  return (input as InputPart[])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/** BB's own messages to a parent thread are not requests from the user. */
export const isUserRequest = (text: string) =>
  text.length > 0 && !text.startsWith(SYSTEM_PREFIX);

/** Control-only replies advance work without redefining its objective. */
export const isSubstantiveRequest = (text: string) =>
  isUserRequest(text) &&
  !/^(?:continue|keep going|go ahead|proceed|yes|yep|ok(?:ay)?|thanks|thank you)[.!\s]*$/i.test(
    text.trim(),
  );

const requestText = (text: string) =>
  text.replace(/^\[bb message from thread:[^\]]*\]\s*/i, "").trim();

/** Selects request positions, so repeating an earlier request still establishes the latest work. */
export function placementRequests(requests: readonly string[]): string[] {
  const substantive = requests.map(requestText).filter(isSubstantiveRequest);
  return [...new Set([0, 1, substantive.length - 1])]
    .filter((index) => index >= 0 && index < substantive.length)
    .map((index) => substantive[index]!);
}

/** Request context shared by category assessments and reviewed topic divisions. */
export async function requestEvidence(
  sdk: Sdk,
  threadId: string,
): Promise<string[]> {
  const [opening, history] = await Promise.all([
    openingRequest(sdk, threadId),
    sdk.threads.promptHistory({ threadId, limit: "50" }),
  ]);
  const recent = history.map((prompt) => inputText(prompt.input)).reverse();
  const requests =
    opening && requestText(recent[0] ?? "") !== requestText(opening)
      ? [opening, ...recent]
      : recent;
  const clean = await withoutSubagentDeliveries(sdk, threadId, requests);
  return placementRequests(clean);
}

/** The first user request among a thread's `client/turn/requested` events. */
export function openingOf(
  requested: readonly { data?: unknown }[],
): string | null {
  return (
    requested
      .map((event) =>
        inputText((event.data as { input?: unknown } | null)?.input),
      )
      .find(isUserRequest) ?? null
  );
}

/** The agent that actually started a root, not an agent that later messaged it. */
export function senderOfStart(
  requested: readonly { data?: unknown }[],
): string | null {
  for (const event of requested) {
    const data = event.data as {
      source?: unknown;
      initiator?: unknown;
      senderThreadId?: unknown;
    } | null;
    if (
      data?.source === "spawn" &&
      data.initiator === "agent" &&
      typeof data.senderThreadId === "string"
    )
      return data.senderThreadId;
  }
  return null;
}

/**
 * The thread's opening request, or null before BB has recorded one. It is
 * recorded when the first turn is requested, before that turn starts.
 */
export async function openingRequest(
  sdk: Sdk,
  threadId: string,
): Promise<string | null> {
  return openingOf(
    await sdk.threads.events.list({
      threadId,
      types: ["client/turn/requested"],
      order: "asc",
      limit: "4",
    }),
  );
}
