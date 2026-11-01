import { parse, REPLY_VERSIONS, type Reply } from "./reply.ts";
import { onlyReplyBlock } from "./replyText.ts";

export type SubagentEnvelope = {
  runId: string;
  threadId: string;
  title: string;
  status: string;
  error: string;
  output: string;
};

export type SubagentDelivery = SubagentEnvelope & { reply: Reply };

const title = '"(?:[^"\\\\]|\\\\.)*"';
const runId = "([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})";
const completed = new RegExp(
  `^Subagent (${title}) \\(${runId}\\) (completed|failed|killed|timed-out)\\.`,
);
const returned = new RegExp(
  `^The user returned control of subagent (${title}) \\(${runId}\\)\\.`,
);
const footer = /\nFull transcript: @thread:(thr_[a-z0-9]+)$/;

export function subagentEnvelope(text: string): SubagentEnvelope | null {
  const completion = completed.exec(text);
  const header = completion ?? returned.exec(text);
  const transcript = footer.exec(text.trimEnd());
  if (!header || !transcript || transcript.index < header[0].length)
    return null;
  const separator = text.indexOf("\n", header[0].length);
  if (separator === -1 || separator >= transcript.index) return null;
  let decodedTitle: unknown;
  try {
    decodedTitle = JSON.parse(header[1]!);
  } catch {
    return null;
  }
  if (typeof decodedTitle !== "string") return null;
  return {
    title: decodedTitle,
    runId: header[2]!,
    status: header[3] ?? "returned",
    error: completion ? text.slice(header[0].length, separator).trim() : "",
    threadId: transcript[1]!,
    output: text.slice(separator + 1, transcript.index),
  };
}

export function subagentDelivery(text: string): SubagentDelivery | null {
  const envelope = subagentEnvelope(text);
  if (!envelope) return null;
  const block = onlyReplyBlock(envelope.output);
  if (!block || block.status !== "closed") return null;
  const version = Number(block.attributes.v ?? "1");
  if (!REPLY_VERSIONS.some((supported) => supported === version)) return null;
  const parsed = parse(block, { status: block.status });
  return parsed.ok ? { ...envelope, reply: parsed.data } : null;
}
