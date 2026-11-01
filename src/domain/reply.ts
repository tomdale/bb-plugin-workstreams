/*
 * A reply carries one recap and an ordered body of Markdown and typed
 * information. Parsing is shared by the server and the message renderer;
 * presentation cannot change which text becomes the stored recap.
 */
import type { Heading, List, ListItem, Nodes, Root, RootContent } from "mdast";
import { z } from "zod";
import {
  COMPONENT_FENCE,
  componentText,
  REPLY_KINDS,
  replyComponentSchema,
  replyPartSchema,
  type ReplyPart,
} from "./replyComponents.ts";

export const REPLY_BLOCK = "reply";
export const REPLY_VERSIONS = [1] as const;
export const DETAILS_LABEL = "Details";
export const CARD_LABELS = {
  review: "Review",
  next: "Next",
  waitingOn: "Waiting on",
  links: "Links",
} as const;
const replyItemSchema = z
  .object({ checked: z.boolean().nullable(), markdown: z.string() })
  .strict();
export type ReplyItem = z.infer<typeof replyItemSchema>;
const replyCardSchema = z
  .object({
    state: z.string(),
    timeout: z.string().optional(),
    headline: z.string().optional(),
    results: z.array(replyItemSchema),
    review: z.array(z.string()),
    next: z.array(z.string()),
    waitingOn: z.array(z.string()),
    links: z.array(z.string()),
  })
  .strict();
export type ReplyCard = z.infer<typeof replyCardSchema>;
export const replySchema = z
  .object({
    card: replyCardSchema.optional(),
    headline: z.string().optional(),
    kind: z.enum(REPLY_KINDS).optional(),
    body: z.array(replyPartSchema),
  })
  .strict();
export type Reply = z.infer<typeof replySchema>;
export type ReplyStatus = "streaming" | "closed" | "unclosed";
export type ReplyParseResult =
  { ok: true; data: Reply } | { ok: false; error: string };

type Span = { start: number; end: number };
function span(node: Nodes): Span | null {
  const from = node.position?.start.offset,
    to = node.position?.end.offset;
  return from === undefined || to === undefined
    ? null
    : { start: from, end: to };
}
function nodeText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  return "children" in node
    ? (node.children as Nodes[]).map(nodeText).join("")
    : "";
}
const label = (node: Heading) =>
  nodeText(node)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[:.]$/, "")
    .toLowerCase();
const isHeading = (node: RootContent): node is Heading =>
  node.type === "heading" && node.depth <= 3;
function slice(nodes: RootContent[], source: string): string {
  const first = nodes[0] && span(nodes[0]),
    last = nodes.at(-1) && span(nodes.at(-1)!);
  return first && last ? source.slice(first.start, last.end).trim() : "";
}
function itemMarkdown(item: ListItem, source: string): string {
  const first = item.children[0] && span(item.children[0]),
    last = item.children.at(-1) && span(item.children.at(-1)!);
  if (!first || !last) return "";
  const indent = first.start - (source.lastIndexOf("\n", first.start - 1) + 1);
  return source
    .slice(first.start, last.end)
    .replace(new RegExp(`\\n {0,${indent}}`, "g"), "\n")
    .trim()
    .replace(/^\[[ xX]\]\s+/, "");
}
function listItems(list: List, source: string): ReplyItem[] {
  return list.children.map((item) => ({
    checked: item.checked ?? null,
    markdown: itemMarkdown(item, source),
  }));
}
function sectionLines(nodes: RootContent[], source: string): string[] {
  return nodes
    .flatMap((node) =>
      node.type === "list"
        ? listItems(node, source).map((item) => item.markdown)
        : [slice([node], source)],
    )
    .filter(Boolean);
}
function inlineMarkdown(node: Heading, source: string): string {
  const first = node.children[0] && span(node.children[0]),
    last = node.children.at(-1) && span(node.children.at(-1)!);
  return first && last ? source.slice(first.start, last.end).trim() : "";
}
function codeClosed(source: string): boolean {
  const lines = source.split("\n"),
    marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0]!);
  return (
    lines.length > 1 &&
    Boolean(
      marker &&
      new RegExp(`^ {0,3}${marker[1]![0]}{${marker[1]!.length},}\\s*$`).test(
        lines.at(-1)!,
      ),
    )
  );
}

/** Malformed components remain readable source; they cannot erase the prose or recap. */
export function parse(
  input: {
    source: string;
    tree: Root;
    attributes?: Readonly<Record<string, string>>;
  },
  context: { status: ReplyStatus } = { status: "closed" },
): ReplyParseResult {
  const { source, tree, attributes } = input;
  if (
    attributes?.v !== undefined &&
    !REPLY_VERSIONS.some((version) => version === Number(attributes.v))
  )
    return { ok: false, error: "Unsupported reply version." };
  if (tree.children.some((node) => !span(node)))
    return { ok: false, error: "The reply's tree has no source offsets." };
  const partial = context.status !== "closed";
  let headline: string | undefined;
  const card: ReplyCard | undefined =
    attributes?.state === undefined
      ? undefined
      : {
          state: attributes.state,
          ...(attributes.timeout !== undefined
            ? { timeout: attributes.timeout }
            : {}),
          results: [],
          review: [],
          next: [],
          waitingOn: [],
          links: [],
        };
  const body: ReplyPart[] = [];
  let buffer: RootContent[] = [];
  let resultsNext = false;
  const flush = () => {
    const markdown = slice(buffer, source);
    if (markdown) body.push({ type: "text", body: markdown });
    buffer = [];
  };
  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i]!;
    if (
      !headline &&
      node.type === "heading" &&
      node.depth === 1 &&
      !body.length &&
      !buffer.length
    ) {
      headline = inlineMarkdown(node, source);
      if (card) card.headline = headline;
      resultsNext = Boolean(card);
      continue;
    }
    if (resultsNext && node.type === "list" && card) {
      const items = listItems(node, source);
      card.results = items.filter((item) => item.checked !== false);
      const unfinished = items.filter((item) => item.checked === false);
      if (unfinished.length)
        body.push({
          type: "text",
          body: `### Not done\n\n${unfinished.map((item) => `- [ ] ${item.markdown}`).join("\n")}`,
        });
      resultsNext = false;
      continue;
    }
    resultsNext = false;
    const field =
      card && isHeading(node)
        ? (Object.keys(CARD_LABELS) as (keyof typeof CARD_LABELS)[]).find(
            (key) => CARD_LABELS[key].toLowerCase() === label(node),
          )
        : undefined;
    if (field && card) {
      flush();
      const nodes: RootContent[] = [];
      while (tree.children[i + 1] && !isHeading(tree.children[i + 1]!)) {
        const next = tree.children[i + 1]!;
        if (
          next.type === "leafDirective" ||
          (next.type === "code" && next.lang === COMPONENT_FENCE)
        )
          break;
        nodes.push(tree.children[++i]!);
      }
      card[field].push(...sectionLines(nodes, source));
      continue;
    }
    if (isHeading(node) && label(node) === DETAILS_LABEL.toLowerCase()) {
      flush();
      const nodes: RootContent[] = [];
      while (tree.children[i + 1] && !isHeading(tree.children[i + 1]!)) {
        const next = tree.children[i + 1]!;
        if (
          next.type === "leafDirective" ||
          (next.type === "code" && next.lang === COMPONENT_FENCE)
        )
          break;
        nodes.push(tree.children[++i]!);
      }
      const markdown = slice(nodes, source);
      if (markdown)
        body.push({ type: "details", title: DETAILS_LABEL, body: markdown });
      continue;
    }
    if (node.type === "leafDirective") {
      flush();
      body.push({ type: "directive", source: slice([node], source) });
      continue;
    }
    if (node.type === "code" && node.lang === COMPONENT_FENCE) {
      flush();
      const raw = slice([node], source);
      if (!codeClosed(raw)) {
        body.push(
          partial
            ? { type: "pending" }
            : {
                type: "unparsed",
                source: raw,
                error:
                  "Component not displayed: close the workstreams code fence.",
              },
        );
        continue;
      }
      try {
        const parsed = replyComponentSchema.safeParse(JSON.parse(node.value));
        if (parsed.success) body.push(parsed.data);
        else
          body.push({
            type: "unparsed",
            source: raw,
            error: `Component not displayed: ${parsed.error.issues[0]?.message ?? "invalid fields"}`,
          });
      } catch {
        body.push({
          type: "unparsed",
          source: raw,
          error:
            "Component not displayed: use a JSON object inside the workstreams fence.",
        });
      }
      continue;
    }
    buffer.push(node);
  }
  flush();
  if (!headline && !body.length && !partial)
    return { ok: false, error: "The reply is empty." };
  const kind = z.enum(REPLY_KINDS).safeParse(attributes?.kind);
  return {
    ok: true,
    data: {
      ...(card ? { card } : headline ? { headline } : {}),
      ...(kind.success ? { kind: kind.data } : {}),
      body,
    },
  };
}

/** The readable text view includes folded evidence and every component field. */
export function toText(data: unknown): string {
  const parsed = replySchema.safeParse(data);
  if (!parsed.success) return "";
  const { card, headline, body } = parsed.data;
  return [
    headline ?? card?.headline,
    ...(card?.results.map(
      (item) =>
        `- ${item.checked === null ? "" : item.checked ? "[x] " : "[ ] "}${item.markdown}`,
    ) ?? []),
    ...body.map(componentText),
    ...(card
      ? (Object.keys(CARD_LABELS) as (keyof typeof CARD_LABELS)[])
          .filter((key) => card[key].length)
          .map(
            (key) =>
              `### ${CARD_LABELS[key]}\n\n${card[key].map((line) => `- ${line}`).join("\n")}`,
          )
      : []),
  ]
    .filter(Boolean)
    .join("\n\n");
}
