/**
 * The agent's reply body: the prose an agent writes inside a `:::reply` block
 * at the end of a turn, drawn in the recap card's style next to the card.
 * The recap tool stays the only source for the card and the sidebar; this
 * block carries prose only.
 *
 * Pure, so the app's block component, a future server reader, and tests
 * share one definition. The host hands `parse` the block's inside as source
 * text plus its mdast tree, whose node offsets point into that source, so
 * sections are sliced back out of the source as Markdown the app renders.
 */
import type {
  Heading,
  List,
  ListItem,
  Nodes,
  Paragraph,
  Root,
  RootContent,
} from "mdast";
import { z } from "zod";

/** The container name: `:::reply` … `:::`. */
export const REPLY_BLOCK = "reply";
/** Reply versions this plugin draws; a block without `v` is version 1. */
export const REPLY_VERSIONS = [1] as const;

/** Section labels with a fixed meaning, in the order agents write them. */
export const REPLY_LABELS = [
  "Done",
  "Checked",
  "Not done",
  "Needs you",
  "Next",
  "Why",
] as const;
export type ReplyLabel = (typeof REPLY_LABELS)[number];

/** The folded section; overflow from long sections also lands here. */
export const DETAILS_LABEL = "Details";
/** Sections beyond the fixed labels kept in the body; later ones fold. */
export const MAX_FREE_SECTIONS = 2;
/** Per-section limits; the rest of a longer section folds under Details. */
export const MAX_SECTION_ITEMS = 5;
export const MAX_SECTION_SENTENCES = 3;

const replyItemSchema = z
  .object({
    /** A task-list item's box: true `[x]`, false `[ ]`, null for a plain bullet. */
    checked: z.boolean().nullable(),
    markdown: z.string(),
  })
  .strict();
export type ReplyItem = z.infer<typeof replyItemSchema>;

const replySectionSchema = z
  .object({
    label: z.string(),
    kind: z.enum(["fixed", "free"]),
    markdown: z.string(),
    /**
     * Present when the section is a single bulleted list, so the component
     * can draw its own markers instead of Markdown bullets and checkboxes.
     */
    items: z.array(replyItemSchema).optional(),
  })
  .strict();
export type ReplySection = z.infer<typeof replySectionSchema>;

export const replySchema = z
  .object({
    lead: z.string(),
    sections: z.array(replySectionSchema),
    /** Folded Markdown: the agent's Details section plus any overflow. */
    details: z.string().optional(),
  })
  .strict();
export type Reply = z.infer<typeof replySchema>;

export type ReplyStatus = "streaming" | "complete" | "unterminated";
export type ReplyParseResult =
  { ok: true; data: Reply } | { ok: false; error: string };

type Span = { start: number; end: number };

function span(node: { position?: Nodes["position"] }): Span | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return typeof start === "number" && typeof end === "number"
    ? { start, end }
    : null;
}

/** A node's visible text, for heading labels. */
function nodeText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node)
    return (node.children as Nodes[]).map(nodeText).join("");
  return "";
}

/** `### Not done:` and `### not  done` both name the Not done label. */
function normalizeLabel(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[:.]$/, "");
}

const fixedLabel = (label: string): ReplyLabel | undefined =>
  REPLY_LABELS.find((fixed) => fixed.toLowerCase() === label.toLowerCase());

/** Headings at these depths start a section; deeper ones are content. */
const isSectionHeading = (node: RootContent): node is Heading =>
  node.type === "heading" && node.depth <= 3;

type RawSection = { label: string; nodes: RootContent[] };

/**
 * Inline nodes whose text never ends a sentence: a period in code, a link,
 * or math belongs to that span.
 */
const OPAQUE_INLINE = new Set([
  "inlineCode",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "html",
  "inlineMath",
]);

/**
 * Source offsets just after each sentence end inside a paragraph. A sentence
 * ends at `.`, `!` or `?` (plus closing quotes, brackets or emphasis marks)
 * followed by whitespace and a character that does not start with a
 * lowercase letter, so "e.g. this" stays one sentence. Returns null when an
 * opaque span has no offsets, so the paragraph is never split blindly.
 */
function sentenceEnds(paragraph: Paragraph, source: string): number[] | null {
  const own = span(paragraph);
  if (!own) return null;
  const opaque: Span[] = [];
  const collect = (node: Nodes): boolean => {
    if (OPAQUE_INLINE.has(node.type)) {
      const at = span(node);
      if (!at) return false;
      opaque.push(at);
      return true;
    }
    if ("children" in node)
      return (node.children as Nodes[]).every((child) => collect(child));
    return true;
  };
  if (!paragraph.children.every((child) => collect(child))) return null;
  const text = source.slice(own.start, own.end);
  const ends: number[] = [];
  for (const match of text.matchAll(
    /[.!?]+[*_~"'”’)\]]*(?=\s+[^\s\p{Ll}])/gu,
  )) {
    const at = own.start + match.index;
    if (opaque.some((range) => at >= range.start && at < range.end)) continue;
    ends.push(at + match[0].length);
  }
  return ends;
}

/** A list item's content without its marker or checkbox, dedented. */
function itemMarkdown(item: ListItem, source: string): string | null {
  const first = item.children[0];
  const last = item.children[item.children.length - 1];
  if (!first || !last) return "";
  const from = span(first);
  const to = span(last);
  if (!from || !to) return null;
  const indent = from.start - (source.lastIndexOf("\n", from.start - 1) + 1);
  const continuation = new RegExp(`\\n {0,${indent}}`, "g");
  return source.slice(from.start, to.end).replace(continuation, "\n").trim();
}

function listItems(list: List, source: string): ReplyItem[] | null {
  const items: ReplyItem[] = [];
  for (const item of list.children) {
    const markdown = itemMarkdown(item, source);
    if (markdown === null) return null;
    items.push({ checked: item.checked ?? null, markdown });
  }
  return items;
}

/** Where a section stops in the body, and the overflow that folds. */
type SectionSplit = {
  /** Nodes shown at least in part; the last may be cut at `end`. */
  kept: RootContent[];
  /** Source offset where the shown part ends, when it is cut. */
  end: number | null;
  /** List items shown from a cut list; the rest folded. */
  keptItems: number | null;
  overflow: string | null;
};

/**
 * Splits a section's nodes at the first point past the item or sentence
 * limit. Only top-level list items and paragraph sentences count.
 */
function splitSection(nodes: RootContent[], source: string): SectionSplit {
  let items = MAX_SECTION_ITEMS;
  let sentences = MAX_SECTION_SENTENCES;
  const sectionEnd = span(nodes[nodes.length - 1]!)!.end;
  const cut = (index: number, at: number, keptItems: number | null) => {
    const partial = at > span(nodes[index]!)!.start;
    return {
      kept: nodes.slice(0, partial ? index + 1 : index),
      end: at,
      keptItems: partial ? keptItems : null,
      overflow: source.slice(at, sectionEnd).trim() || null,
    };
  };
  for (const [index, node] of nodes.entries()) {
    if (node.type === "list") {
      if (node.children.length <= items) {
        items -= node.children.length;
        continue;
      }
      const at = span(node.children[items]!)?.start;
      if (at === undefined) continue;
      return cut(index, at, items);
    }
    if (node.type === "paragraph") {
      const ends = sentenceEnds(node, source);
      const count = ends === null ? 1 : ends.length + 1;
      if (count <= sentences) {
        sentences -= count;
        continue;
      }
      const at = sentences === 0 ? span(node)!.start : ends![sentences - 1]!;
      return cut(index, at, null);
    }
  }
  return { kept: nodes, end: null, keptItems: null, overflow: null };
}

function sliceNodes(
  nodes: RootContent[],
  source: string,
  end?: number,
): string {
  const first = nodes[0] && span(nodes[0]);
  const last = nodes[nodes.length - 1] && span(nodes[nodes.length - 1]!);
  if (!first || !last) return "";
  return source.slice(first.start, end ?? last.end).trim();
}

/**
 * Reads a reply block into its lead, labeled sections, and folded details.
 *
 * Rules: the lead (text before the first heading) must be present once the
 * block is complete; at most two sections beyond the fixed labels stay in
 * the body, later ones fold; a section over five list items or three
 * sentences keeps that much and folds the rest. Folded text lands under
 * Details with its section's name. While streaming, a missing lead and an
 * empty last section are accepted so arrived sections can show. An
 * unterminated block is rejected so the host shows the raw text.
 */
export function parse(
  input: { source: string; tree: Root },
  context: { status: ReplyStatus } = { status: "complete" },
): ReplyParseResult {
  if (context.status === "unterminated")
    return { ok: false, error: "The reply has no closing ::: line." };
  const { source, tree } = input;
  const streaming = context.status === "streaming";

  const lead: RootContent[] = [];
  const raw: RawSection[] = [];
  for (const node of tree.children) {
    if (!span(node))
      return { ok: false, error: "The reply's tree has no source offsets." };
    if (isSectionHeading(node)) {
      raw.push({ label: normalizeLabel(nodeText(node)), nodes: [] });
    } else if (raw.length) raw[raw.length - 1]!.nodes.push(node);
    else lead.push(node);
  }

  const leadText = sliceNodes(lead, source);
  if (!leadText && !streaming)
    return {
      ok: false,
      error: "The reply needs one or two sentences before its first heading.",
    };

  const sections: ReplySection[] = [];
  const ownDetails: string[] = [];
  const folded: string[] = [];
  let free = 0;
  for (const [index, section] of raw.entries()) {
    const isLast = index === raw.length - 1;
    if (!section.label) continue;
    if (section.label.toLowerCase() === DETAILS_LABEL.toLowerCase()) {
      const body = sliceNodes(section.nodes, source);
      if (body) ownDetails.push(body);
      continue;
    }
    const fixed = fixedLabel(section.label);
    const label = fixed ?? section.label;
    if (!section.nodes.length) {
      if (streaming && isLast)
        sections.push({ label, kind: fixed ? "fixed" : "free", markdown: "" });
      continue;
    }
    if (!fixed && ++free > MAX_FREE_SECTIONS) {
      folded.push(`**${label}**\n\n${sliceNodes(section.nodes, source)}`);
      continue;
    }
    const { kept, end, keptItems, overflow } = splitSection(
      section.nodes,
      source,
    );
    const markdown = sliceNodes(kept, source, end ?? undefined);
    const only = kept.length === 1 ? kept[0] : undefined;
    const items =
      only?.type === "list" && !only.ordered
        ? listItems(only, source)?.slice(0, keptItems ?? undefined)
        : undefined;
    if (markdown)
      sections.push({
        label,
        kind: fixed ? "fixed" : "free",
        markdown,
        ...(items ? { items } : {}),
      });
    if (overflow) folded.push(`**${label}, continued**\n\n${overflow}`);
  }

  const details = [...ownDetails, ...folded].join("\n\n");
  return {
    ok: true,
    data: {
      lead: leadText,
      sections,
      ...(details ? { details } : {}),
    },
  };
}

/**
 * The reply as plain Markdown, for copy, notifications, and digests. Takes
 * untrusted data and returns an empty string when it is not a reply.
 */
export function toText(data: unknown): string {
  const reply = replySchema.safeParse(data);
  if (!reply.success) return "";
  const { lead, sections, details } = reply.data;
  return [
    lead,
    ...sections
      .filter((section) => section.markdown)
      .map((section) => `**${section.label}**\n${section.markdown}`),
    ...(details ? [`**${DETAILS_LABEL}**\n${details}`] : []),
  ]
    .filter(Boolean)
    .join("\n\n");
}
