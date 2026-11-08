/**
 * Finds the reply block in a whole message's text, as the server reads it.
 * The app gets each block's tree from bb; the server parses the message
 * itself with the same remark plugins bb's chat pipeline uses, takes the
 * last top-level `:::reply` container, and hands `parse` its inside with
 * offsets moved to point into that inside, as bb does.
 */
import type { Root, RootContent } from "mdast";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { REPLY_BLOCK, type ReplyStatus } from "./reply.ts";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective);

/** Parses a message with the remark plugins bb's chat pipeline uses. */
export function parseReplyMarkdown(message: string): Root {
  return processor.runSync(processor.parse(message)) as Root;
}

/** What bb hands a block's `parse`, plus the block's status. */
export type ReplyBlockInput = {
  attributes: Record<string, string>;
  source: string;
  tree: Root;
  status: Exclude<ReplyStatus, "streaming">;
};

function shift(node: unknown, delta: number): void {
  if (typeof node !== "object" || node === null) return;
  const position = (
    node as {
      position?: { start: { offset?: number }; end: { offset?: number } };
    }
  ).position;
  if (position?.start.offset !== undefined) position.start.offset -= delta;
  if (position?.end.offset !== undefined) position.end.offset -= delta;
  for (const child of (node as { children?: unknown[] }).children ?? [])
    shift(child, delta);
}

export function readBlock(
  node: RootContent | undefined,
  message: string,
): ReplyBlockInput | null {
  if (node?.type !== "containerDirective" || node.name !== REPLY_BLOCK)
    return null;
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  if (!node || start === undefined || end === undefined) return null;
  const block = message.slice(start, end);
  const openerEnd = block.indexOf("\n");
  const lastNewline = block.lastIndexOf("\n");
  const markerLength = /^[ \t]*(:{3,})/.exec(block)?.[1]?.length ?? 3;
  const closed =
    openerEnd !== -1 &&
    lastNewline >= openerEnd &&
    new RegExp(`^[ \\t]*:{${markerLength},}[ \\t]*$`).test(
      block.slice(lastNewline + 1).replace(/\r$/, ""),
    );
  const innerStart = openerEnd === -1 ? block.length : openerEnd + 1;
  const innerEnd = closed ? lastNewline + 1 : block.length;
  const source = block.slice(innerStart, Math.max(innerStart, innerEnd));
  // The directive's label paragraph (`:::reply[label]`) is not content.
  const children = (node.children as RootContent[]).filter(
    (child) =>
      child.type !== "paragraph" ||
      (child.data as { directiveLabel?: boolean } | undefined)
        ?.directiveLabel !== true,
  );
  const tree: Root = { type: "root", children };
  shift(tree, start + innerStart);
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.attributes ?? {}))
    if (typeof value === "string") attributes[key] = value;
  return {
    attributes,
    source,
    tree,
    status: closed ? "closed" : "unclosed",
  };
}

/** The server can recover the last top-level reply despite stray text around it. */
export function lastReplyBlock(message: string): ReplyBlockInput | null {
  const root = parseReplyMarkdown(message);
  for (const node of [...root.children].reverse()) {
    const block = readBlock(node, message);
    if (block) return block;
  }
  return null;
}

/** Authored output is one top-level reply, with no other Markdown outside it. */
export function onlyReplyBlock(message: string): ReplyBlockInput | null {
  const root = parseReplyMarkdown(message);
  return root.children.length === 1
    ? readBlock(root.children[0], message)
    : null;
}
