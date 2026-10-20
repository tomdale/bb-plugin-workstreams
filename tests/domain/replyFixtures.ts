/**
 * Builds the input bb hands a message-block plugin, the way bb's app does:
 * parse the whole message with the chat pipeline's remark plugins, take the
 * top-level `:::reply` container, and give its inside as `source` with the
 * tree's offsets moved to point into that source.
 */
import type { Root, RootContent } from "mdast";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { ReplyStatus } from "../../src/domain/reply.ts";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective);

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

export function blockInput(
  message: string,
  { streaming = false }: { streaming?: boolean } = {},
): { source: string; tree: Root; status: ReplyStatus } {
  const root = processor.runSync(processor.parse(message)) as Root;
  const node = root.children.find(
    (child): child is RootContent & { type: "containerDirective" } =>
      child.type === "containerDirective" && child.name === "reply",
  );
  if (!node) throw new Error("no :::reply block in the message");
  const start = node.position!.start.offset!;
  const block = message.slice(start, node.position!.end.offset!);
  const openerEnd = block.indexOf("\n");
  const lastNewline = block.lastIndexOf("\n");
  const closed =
    openerEnd !== -1 &&
    /^[ \t]*:{3,}[ \t]*$/.test(block.slice(lastNewline + 1));
  const innerStart = openerEnd === -1 ? block.length : openerEnd + 1;
  const innerEnd = closed ? lastNewline + 1 : block.length;
  const source = block.slice(innerStart, Math.max(innerStart, innerEnd));
  const tree: Root = { type: "root", children: node.children as RootContent[] };
  shift(tree, start + innerStart);
  return {
    source,
    tree,
    status: closed ? "closed" : streaming ? "streaming" : "unclosed",
  };
}
