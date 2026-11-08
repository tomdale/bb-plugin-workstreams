import type { Nodes } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import {
  normalizeRecapFileLinks,
  recapMarkdownSpans,
} from "../../domain/recapFileLinks.ts";

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

/**
 * BB's Markdown sets the foreground color on every block, so a muted or
 * tinted line around it adds this to pass its own color through.
 */
export const INHERIT_CLASS = "[&_.text-foreground]:text-inherit!";
