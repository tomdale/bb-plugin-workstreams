/**
 * The brief a debug thread opens with: the AI-generated result the user was
 * looking at, what it says, and the recorded model calls behind it. A reader
 * of that thread is an agent working in this plugin's project, so the brief
 * carries the exact prompt and response rather than a summary of them.
 *
 * Pure, so the app that composes the brief and the tests that check it share
 * one definition.
 */
import {
  TRACE_KIND_TITLE,
  TRACE_STATUS_TITLE,
  type Trace,
  type TraceLink,
} from "./trace.ts";

/**
 * Which recorded calls belong to a subject: the ids a surface already knows,
 * or the link they are stored under (an Activity entry's own, say).
 */
export type DebugCalls =
  | { readonly traceIds: readonly (string | null | undefined)[] }
  | { readonly link: TraceLink };

export type DebugSubject = {
  /** The surface the user was looking at, in a reader's words. */
  readonly surface: string;
  /** The suggestion in one line; also the thread's title. */
  readonly headline: string;
  /** What the suggestion says, in the order a reader wants it. */
  readonly facts: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  /** The calls behind it. */
  readonly calls: DebugCalls;
};

const PREFIX = "Debug: ";
const TITLE_MAX = 90;
const UNTITLED = "Workstreams result";

/** One line, so a headline carrying newlines cannot break the title. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** `Debug: ` plus the headline, clipped to a title bar's worth. */
export function debugThreadTitle(subject: DebugSubject): string {
  const headline = oneLine(subject.headline) || UNTITLED;
  const room = TITLE_MAX - PREFIX.length;
  const clipped =
    headline.length <= room ? headline : `${headline.slice(0, room - 1)}…`;
  return `${PREFIX}${clipped}`;
}

/**
 * A fence longer than any run of backticks inside `content`, so a prompt or
 * response that carries Markdown cannot end the block early.
 */
function fence(content: string, language: string): string[] {
  const longest = Math.max(
    0,
    ...(content.match(/`+/g) ?? []).map((run) => run.length),
  );
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return [`${ticks}${language}`, content, ticks];
}

/** JSON as the brief shows it; empty when the call recorded nothing. */
function json(value: unknown, empty: string): string[] {
  if (value === null || value === undefined) return [];
  const text = JSON.stringify(value, null, 2);
  return text === undefined ? [empty] : fence(text, "json");
}

function callSection(call: Trace): string[] {
  const when = new Date(call.at).toLocaleString();
  const lines = [
    `### ${TRACE_KIND_TITLE[call.kind]}: ${call.label}`,
    `- ${when} · ${call.model} · ${(call.durationMs / 1000).toFixed(1)}s · ${TRACE_STATUS_TITLE[call.status]}`,
  ];
  if (call.summary) lines.push(`- Model's answer: ${call.summary}`);
  if (call.usage)
    lines.push(
      `- Usage: ${call.usage.input.toLocaleString()} in / ${call.usage.output.toLocaleString()} out · $${call.usage.cost.toFixed(4)}`,
    );
  lines.push(
    `- Trace \`${call.id}\`; \`bb workstreams trace ${call.id}\` prints it again.`,
  );
  if (call.error) lines.push("", "#### Error", ...fence(call.error, "text"));
  lines.push("", "#### Prompt", ...fence(call.prompt, "text"));
  if (call.response !== null)
    lines.push("", "#### Raw response", ...fence(call.response, "text"));
  if (call.reasoning)
    lines.push("", "#### Reasoning", ...fence(call.reasoning, "text"));
  if (call.parsed !== null) {
    const parsed = json(call.parsed, "No parsed result.");
    if (parsed.length) lines.push("", "#### Parsed result", ...parsed);
  }
  if (call.outcome !== null) {
    const did = json(call.outcome, "Nothing was recorded.");
    if (did.length) lines.push("", "#### What Workstreams did", ...did);
  }
  return lines;
}

/**
 * The opening message: what the user saw, what to do with it, and one section
 * per recorded call.
 */
export function debugThreadMessage(
  subject: DebugSubject,
  calls: readonly Trace[],
): string {
  const facts = subject.facts
    .filter((fact) => fact.value.trim().length > 0)
    // A value's own newlines stay inside its line, so the list holds together.
    .map((fact) => `- ${fact.label}: ${fact.value.split("\n").join("\n  ")}`);
  const lines = [
    "A Workstreams debug thread. Workstreams generated the result below and I want to understand it.",
    "",
    "## The result",
    `- Where: ${subject.surface}`,
    ...facts,
    "",
    "## What to do",
    "Diagnose why this came out the way it did. If the prompt, the output schema, or the code that applied the answer is at fault, name the change and where it lives. Nothing in this thread changes Workstreams' stored suggestions or organization by itself.",
  ];
  if (!calls.length)
    lines.push(
      "",
      "## Model calls",
      "None was recorded for this result: recording was off when it ran, it has since left the retention window, or the result needed no model.",
    );
  else for (const call of calls) lines.push("", ...callSection(call));
  return `${lines.join("\n").trimEnd()}\n`;
}

/** The trace ids a subject names, in order, without the absent ones. */
export function debugTraceIds(calls: DebugCalls): string[] | null {
  return "traceIds" in calls
    ? calls.traceIds.filter((id): id is string => Boolean(id))
    : null;
}
