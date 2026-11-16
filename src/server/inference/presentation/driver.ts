/**
 * The bounded presentation loop. A model gets the finished response and one
 * tool, `preview_document`; it may preview up to the preview budget, then
 * answers with JSON. The answer is accepted only when it is null, or when it
 * is exactly the last candidate whose preview succeeded and it validates
 * again. Anything else, or any limit reached first, yields no document.
 *
 * The loop is independent of the model service and the renderer: the host
 * entry supplies an AI Gateway client and the Chrome preview host, and tests
 * supply fakes.
 */
import {
  canonicalDocument,
  documentText,
  summarizeIssues,
  validateDocument,
  type DocumentIssue,
  type EnhancedDocument,
} from "../../../domain/postTurn/document.ts";
import { PRESENTATION_LIMITS } from "../../../domain/postTurn/limits.ts";
import type { DocumentTopic } from "../../../domain/postTurn/message.ts";
import type { Usage } from "../../../domain/trace.ts";
import {
  PRESENTATION_SYSTEM_PROMPT,
  PREVIEW_TOOL,
  PREVIEW_TOOL_DEFINITION,
  presentationRequest,
} from "./prompt.ts";
import { untilAborted } from "./abort.ts";
import type { PreviewRender } from "./preview.ts";

export type TextBlock = { type: "text"; text: string };
export type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: "image/png"; data: string };
};
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: (TextBlock | ImageBlock)[];
  is_error?: boolean;
};
/** Content a model returns; blocks of other types (reasoning) are kept as sent. */
export type AssistantBlock =
  TextBlock | ToolUseBlock | ({ type: string } & Record<string, unknown>);
export type Message =
  | { role: "user"; content: string | ToolResultBlock[] }
  | { role: "assistant"; content: AssistantBlock[] };

export type ToolModel = (request: {
  system: string;
  messages: readonly Message[];
  tools: readonly (typeof PREVIEW_TOOL_DEFINITION)[];
  maxTokens: number;
  signal: AbortSignal;
}) => Promise<{
  content: AssistantBlock[];
  stopReason: string | null;
  usage: Usage;
}>;

/** Renders a valid candidate; rejects when the preview host fails. */
export type Previewer = (
  document: EnhancedDocument,
  signal: AbortSignal,
) => Promise<PreviewRender>;

export type PresentationInput = {
  response: string;
  title: string;
  topic: DocumentTopic | null;
};

export type PresentationStats = {
  previews: number;
  modelCalls: number;
  usage: Usage;
};

export type PresentationOutcome = PresentationStats &
  (
    | { kind: "document"; document: EnhancedDocument }
    | { kind: "none"; reason: string }
    | { kind: "failed"; reason: string }
  );

type Limits = Record<
  "previews" | "modelCalls" | "deadlineMs" | "previewTimeoutMs" | "maxTokens",
  number
>;

/** The text form returned to the model is cut here; Copy uses the whole text. */
const PREVIEW_TEXT_CHARS = 24_000;

const isToolUse = (block: AssistantBlock): block is ToolUseBlock =>
  block.type === "tool_use" &&
  typeof (block as ToolUseBlock).id === "string" &&
  typeof (block as ToolUseBlock).name === "string";

/** The final answer's JSON, allowing one surrounding code fence. */
function parseAnswer(
  content: readonly AssistantBlock[],
): { ok: true; value: unknown } | { ok: false } {
  const text = content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*)\n```$/.exec(text);
  try {
    return { ok: true, value: JSON.parse(fenced ? fenced[1]! : text) };
  } catch {
    return { ok: false };
  }
}

const json = (value: unknown): TextBlock => ({
  type: "text",
  text: JSON.stringify(value),
});

export async function runPresentation(options: {
  input: PresentationInput;
  model: ToolModel;
  preview: Previewer;
  signal: AbortSignal;
  limits?: Partial<Limits>;
}): Promise<PresentationOutcome> {
  const limits: Limits = { ...PRESENTATION_LIMITS, ...options.limits };
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(limits.deadlineMs),
  ]);
  const usage: Usage = { input: 0, output: 0, cost: 0 };
  let previews = 0;
  let modelCalls = 0;
  /** The last candidate whose preview succeeded, canonical. */
  let previewed: string | null = null;
  const stats = () => ({ previews, modelCalls, usage: { ...usage } });
  const failed = (reason: string): PresentationOutcome => ({
    kind: "failed",
    reason,
    ...stats(),
  });
  const messages: Message[] = [
    { role: "user", content: presentationRequest(options.input) },
  ];

  const runPreview = async (call: ToolUseBlock): Promise<ToolResultBlock> => {
    const result = (
      content: (TextBlock | ImageBlock)[],
      error = false,
    ): ToolResultBlock => ({
      type: "tool_result",
      tool_use_id: call.id,
      content,
      ...(error ? { is_error: true } : {}),
    });
    if (call.name !== PREVIEW_TOOL)
      return result(
        [json({ ok: false, error: `No tool named ${call.name}.` })],
        true,
      );
    if (previews >= limits.previews)
      return result(
        [
          json({
            ok: false,
            error:
              "No previews left. Answer with the last document that previewed successfully, or null.",
          }),
        ],
        true,
      );
    previews++;
    const left = limits.previews - previews;
    const candidate =
      call.input && typeof call.input === "object"
        ? (call.input as { document?: unknown }).document
        : undefined;
    const valid = validateDocument(candidate);
    if (!valid.ok)
      return result(
        [
          json({
            ok: false,
            issues: valid.issues satisfies DocumentIssue[],
            previewsLeft: left,
          }),
        ],
        true,
      );
    let render: PreviewRender;
    try {
      const bound = AbortSignal.any([
        signal,
        AbortSignal.timeout(limits.previewTimeoutMs),
      ]);
      render = await untilAborted(
        options.preview(valid.document, bound),
        bound,
      );
    } catch (error) {
      if (signal.aborted) throw error;
      return result(
        [
          json({
            ok: false,
            error: `The preview could not be drawn: ${error instanceof Error ? error.message : String(error)}`,
            previewsLeft: left,
          }),
        ],
        true,
      );
    }
    previewed = canonicalDocument(valid.document);
    const text = documentText(valid.document);
    const content: (TextBlock | ImageBlock)[] = [
      json({
        ok: true,
        previewsLeft: left,
        rendered: render.captures.map(
          ({ viewport, width, height, truncated }) => ({
            viewport,
            width,
            height,
            truncated,
          }),
        ),
        diagnostics: render.diagnostics,
        folded: render.folded,
        text:
          text.length > PREVIEW_TEXT_CHARS
            ? `${text.slice(0, PREVIEW_TEXT_CHARS)}\n[text form cut at ${PREVIEW_TEXT_CHARS} characters]`
            : text,
      }),
    ];
    for (const capture of render.captures)
      content.push(
        {
          type: "text",
          text: `${capture.viewport === "desktop" ? "Desktop" : "Narrow"}, ${capture.width}px wide${capture.truncated ? ", cut off at the capture limit" : ""}:`,
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: capture.png,
          },
        },
      );
    return result(content);
  };

  try {
    while (modelCalls < limits.modelCalls) {
      modelCalls++;
      const reply = await untilAborted(
        options.model({
          system: PRESENTATION_SYSTEM_PROMPT,
          messages: [...messages],
          tools: [PREVIEW_TOOL_DEFINITION],
          maxTokens: limits.maxTokens,
          signal,
        }),
        signal,
      );
      usage.input += reply.usage.input;
      usage.output += reply.usage.output;
      usage.cost += reply.usage.cost;
      messages.push({ role: "assistant", content: reply.content });
      const calls = reply.content.filter(isToolUse);
      if (calls.length) {
        const results: ToolResultBlock[] = [];
        for (const call of calls) results.push(await runPreview(call));
        messages.push({ role: "user", content: results });
        continue;
      }
      if (reply.stopReason === "max_tokens")
        return failed("The model's answer was cut off at its token limit.");
      const answer = parseAnswer(reply.content);
      if (!answer.ok) return failed("The final answer was not JSON.");
      if (answer.value === null)
        return {
          kind: "none",
          reason: "The model chose to add no document.",
          ...stats(),
        };
      const valid = validateDocument(answer.value);
      if (!valid.ok)
        return failed(
          `The final document is invalid: ${summarizeIssues(valid.issues)}`,
        );
      if (previewed === null)
        return failed("The final document was never previewed.");
      if (canonicalDocument(valid.document) !== previewed)
        return failed(
          "The final document differs from the last one that previewed successfully.",
        );
      return { kind: "document", document: valid.document, ...stats() };
    }
    return failed(
      `The model used all ${limits.modelCalls} calls without a final answer.`,
    );
  } catch (error) {
    if (options.signal.aborted) return failed("Cancelled.");
    if (signal.aborted)
      return failed(
        `Composition passed its ${Math.round(limits.deadlineMs / 1000)}-second deadline.`,
      );
    return failed(error instanceof Error ? error.message : String(error));
  }
}
