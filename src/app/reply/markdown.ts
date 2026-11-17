import type { Nodes } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import {
  normalizeRecapFileLinks,
  recapMarkdownSpans,
} from "../../domain/recapFileLinks.ts";
import {
  threadMentionSegments,
  type MentionSegment,
} from "../../domain/threadMentions.ts";

const parser = unified().use(remarkParse).use(remarkMath);

/** Repair prose destinations without changing literal code or math. */
export function normalizeReplyMarkdown(source: string): string {
  if (normalizeRecapFileLinks(source) === source) return source;
  const protectedRanges: { start: number; end: number }[] = [];
  function visit(node: Nodes) {
    if (
      ["code", "inlineCode", "math", "inlineMath", "html"].includes(
        node.type,
      ) &&
      node.position
    ) {
      const start = node.position.start.offset,
        end = node.position.end.offset;
      if (start !== undefined && end !== undefined)
        protectedRanges.push({ start, end });
    } else if ("children" in node) node.children.forEach(visit);
  }
  visit(parser.parse(source));
  let output = "",
    copied = 0;
  for (const span of recapMarkdownSpans(source)) {
    if (
      !span.destination ||
      protectedRanges.some(
        ({ start, end }) => span.index >= start && span.index < end,
      )
    )
      continue;
    output +=
      source.slice(copied, span.index) + normalizeRecapFileLinks(span.text);
    copied = span.index + span.text.length;
  }
  return output + source.slice(copied);
}

/** Prose cut into runs BB's Markdown renders and paragraphs it cannot. */
export type MentionBlock =
  | { kind: "markdown"; text: string }
  | { kind: "paragraph"; segments: MentionSegment[] };

/**
 * Cuts prose at top-level paragraphs that mention a thread, which render as
 * chips; everything else stays in whole Markdown runs, so lists, tables, and
 * quotes keep BB's layout. A mention inside one of those stays text.
 */
export function mentionBlocks(source: string): MentionBlock[] {
  if (!source.includes("@thread:")) return [{ kind: "markdown", text: source }];
  const blocks: MentionBlock[] = [];
  let runStart = 0;
  const flush = (end: number) => {
    const text = source.slice(runStart, end);
    if (text.trim()) blocks.push({ kind: "markdown", text });
  };
  for (const node of parser.parse(source).children) {
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    if (node.type !== "paragraph" || start === undefined || end === undefined)
      continue;
    const segments = threadMentionSegments(source.slice(start, end));
    if (!segments.some((segment) => segment.kind === "thread")) continue;
    flush(start);
    blocks.push({ kind: "paragraph", segments });
    runStart = end;
  }
  flush(source.length);
  return blocks;
}
