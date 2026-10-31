import type { Nodes } from "mdast";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { ReplyPart } from "../../domain/replyComponents.ts";

const markdown = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective);

const SHARED_SYNTAX = new Set([
  "linkReference",
  "imageReference",
  "footnoteReference",
  "html",
]);
const DOCUMENT_SYNTAX = new Set([...SHARED_SYNTAX, "inlineMath"]);

function containsSyntax(node: Nodes, types: ReadonlySet<string>): boolean {
  return (
    types.has(node.type) ||
    ("children" in node &&
      node.children.some((child) => containsSyntax(child, types)))
  );
}

function hasText(node: Nodes): boolean {
  if (node.type === "image") return false;
  return "value" in node
    ? Boolean(node.value.trim())
    : "children" in node && node.children.some(hasText);
}

/** Block Markdown stays whole so code and references cannot become recap controls. */
export function isInlineProse(source: string): boolean {
  const tree = markdown.parse(source);
  const paragraph = tree.children[0];
  return (
    tree.children.length === 1 &&
    paragraph?.type === "paragraph" &&
    !containsSyntax(paragraph, DOCUMENT_SYNTAX) &&
    hasText(paragraph)
  );
}

/**
 * The first prose paragraph can introduce an article without styling its whole
 * explanation as a lead. Shared Markdown references stay in one document, and
 * the remainder keeps its indentation so code and lists retain their meaning.
 */
export function articleOpening(body: readonly ReplyPart[]): {
  lead?: string;
  body: ReplyPart[];
} {
  const first = body[0];
  if (first?.type !== "text") return { body: [...body] };
  const paragraph = markdown.parse(first.body).children[0];
  if (
    paragraph?.type !== "paragraph" ||
    containsSyntax(paragraph, SHARED_SYNTAX) ||
    !hasText(paragraph)
  )
    return { body: [...body] };
  const start = paragraph.position?.start.offset;
  const end = paragraph.position?.end.offset;
  if (start === undefined || end === undefined) return { body: [...body] };
  const remainder = first.body.slice(end).replace(/^(?:[ \t]*\r?\n)+/, "");
  return {
    lead: first.body.slice(start, end),
    body: [
      ...(remainder ? [{ type: "text" as const, body: remainder }] : []),
      ...body.slice(1),
    ],
  };
}

export const REPLY_STATE = {
  complete: {
    label: "Complete",
    text: "text-(--ws-complete-text)",
    frame: "border-(--ws-complete-border) bg-(--ws-complete-surface)",
  },
  review: {
    label: "Ready for review",
    text: "text-(--ws-review-text)",
    frame: "border-(--ws-review-border) bg-(--ws-review-surface)",
  },
  waiting: {
    label: "Waiting",
    text: "text-(--ws-waiting-text)",
    frame: "border-(--ws-waiting-border) bg-(--ws-waiting-surface)",
  },
} as const;

export function replyState(state: string | undefined) {
  return state && Object.hasOwn(REPLY_STATE, state)
    ? REPLY_STATE[state as keyof typeof REPLY_STATE]
    : undefined;
}
