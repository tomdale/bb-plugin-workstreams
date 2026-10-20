/**
 * The agent's reply body: the prose an agent writes inside a ```` ```reply ````
 * fenced block at the end of a turn, drawn in the recap card's style next to
 * the card. The recap tool stays the only source for the card and the
 * sidebar; this block carries prose only.
 *
 * Pure, so the app's fence renderer, a future server reader, and tests share
 * one definition. bb hands the renderer the fence body as a string, so
 * `parse` reads Markdown structure from lines itself: `###` headings split
 * sections, and lines inside inner code fences are never headings. Sections
 * are sliced back out of the body as Markdown the app renders.
 */
import { z } from "zod";

/** The fence language: ```` ```reply ```` … ```` ``` ````. */
export const REPLY_LANGUAGE = "reply";

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

/** The fence's state, as bb's code fence renderer slot reports it. */
export type ReplyStatus = "streaming" | "closed" | "unclosed";
export type ReplyParseResult =
  { ok: true; data: Reply } | { ok: false; error: string };

type Line = { text: string; start: number; end: number };

/** A list item: its lines, the column its content starts at, and its box. */
type Item = {
  start: number;
  end: number;
  lines: Line[];
  contentIndent: number;
};

/** A top-level Markdown block of the body, with offsets into it. */
type Block =
  | { type: "heading"; start: number; end: number; depth: number; text: string }
  | { type: "paragraph"; start: number; end: number }
  | {
      type: "list";
      start: number;
      end: number;
      ordered: boolean;
      items: Item[];
    }
  | { type: "code"; start: number; end: number; closed: boolean }
  | { type: "other"; start: number; end: number };

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const QUOTE_OR_TABLE = /^ {0,3}[>|]/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TASK_BOX = /^\[([ xX])\](?:[ \t]+|$)/;

const isBlank = (line: Line) => line.text.trim() === "";
const indentOf = (text: string) => text.length - text.trimStart().length;

function splitLines(body: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const text of body.split("\n")) {
    lines.push({ text, start, end: start + text.length });
    start += text.length + 1;
  }
  return lines;
}

/** An inner fence opener, or null. A backtick fence's info has no backtick. */
function fenceOpener(text: string): { char: string; size: number } | null {
  const match = FENCE_OPEN.exec(text);
  if (!match) return null;
  const run = match[2]!;
  if (run[0] === "`" && match[3]!.includes("`")) return null;
  return { char: run[0]!, size: run.length };
}

function closesFence(text: string, fence: { char: string; size: number }) {
  const trimmed = text.trim();
  return (
    indentOf(text) <= 3 &&
    trimmed.length >= fence.size &&
    [...trimmed].every((char) => char === fence.char)
  );
}

/** Index of the line that closes the fence opened at `open`, or -1. */
function fenceEnd(lines: Line[], open: number, dedent = 0): number {
  const fence = fenceOpener(lines[open]!.text.slice(dedent))!;
  for (let index = open + 1; index < lines.length; index++) {
    const text = lines[index]!.text;
    if (closesFence(text.slice(Math.min(dedent, indentOf(text))), fence))
      return index;
  }
  return -1;
}

/** Lines that end a paragraph or a list item's lazy continuation. */
const startsBlock = (text: string) =>
  fenceOpener(text) !== null ||
  HEADING.test(text) ||
  LIST_ITEM.test(text) ||
  QUOTE_OR_TABLE.test(text) ||
  THEMATIC_BREAK.test(text);

/**
 * Reads one list starting at `first`: items of the same kind, continuation
 * lines indented to the item's content, lazy lines, and blank lines that a
 * further indented line or item follows. Inner fences stay inside an item.
 */
function readList(
  lines: Line[],
  first: number,
): { block: Block; next: number } {
  const ordered = /\d/.test(LIST_ITEM.exec(lines[first]!.text)![2]!);
  const items: Item[] = [];
  let index = first;
  for (;;) {
    const match = LIST_ITEM.exec(lines[index]!.text)!;
    const contentIndent =
      match[3] === "" ? match[0].length + 1 : match[0].length;
    const itemLines = [lines[index]!];
    let next = index + 1;
    while (next < lines.length) {
      const line = lines[next]!;
      if (isBlank(line)) {
        let ahead = next + 1;
        while (ahead < lines.length && isBlank(lines[ahead]!)) ahead++;
        if (
          ahead < lines.length &&
          indentOf(lines[ahead]!.text) >= contentIndent
        ) {
          itemLines.push(...lines.slice(next, ahead));
          next = ahead;
          continue;
        }
        break;
      }
      if (indentOf(line.text) >= contentIndent) {
        if (fenceOpener(line.text.slice(contentIndent))) {
          const close = fenceEnd(lines, next, contentIndent);
          const last = close === -1 ? lines.length - 1 : close;
          itemLines.push(...lines.slice(next, last + 1));
          next = last + 1;
          continue;
        }
        itemLines.push(line);
        next++;
        continue;
      }
      if (startsBlock(line.text) || isBlank(lines[next - 1]!)) break;
      itemLines.push(line);
      next++;
    }
    items.push({
      start: itemLines[0]!.start,
      end: itemLines[itemLines.length - 1]!.end,
      lines: itemLines,
      contentIndent,
    });
    let ahead = next;
    while (ahead < lines.length && isBlank(lines[ahead]!)) ahead++;
    const following =
      ahead < lines.length ? LIST_ITEM.exec(lines[ahead]!.text) : null;
    if (following && /\d/.test(following[2]!) === ordered) {
      index = ahead;
      continue;
    }
    return {
      block: {
        type: "list",
        ordered,
        items,
        start: items[0]!.start,
        end: items[items.length - 1]!.end,
      },
      next,
    };
  }
}

/** Splits the body into top-level blocks; headings in code are not blocks. */
function readBlocks(body: string): Block[] {
  const lines = splitLines(body);
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (isBlank(line)) {
      index++;
      continue;
    }
    if (fenceOpener(line.text)) {
      const close = fenceEnd(lines, index);
      const last = close === -1 ? lines.length - 1 : close;
      blocks.push({
        type: "code",
        start: line.start,
        end: lines[last]!.end,
        closed: close !== -1,
      });
      index = last + 1;
      continue;
    }
    const heading = HEADING.exec(line.text);
    if (heading) {
      blocks.push({
        type: "heading",
        start: line.start,
        end: line.end,
        depth: heading[1]!.length,
        text: heading[2] ?? "",
      });
      index++;
      continue;
    }
    if (LIST_ITEM.test(line.text) && !THEMATIC_BREAK.test(line.text)) {
      const { block, next } = readList(lines, index);
      blocks.push(block);
      index = next;
      continue;
    }
    const other =
      QUOTE_OR_TABLE.test(line.text) || THEMATIC_BREAK.test(line.text);
    let last = index;
    while (
      last + 1 < lines.length &&
      !isBlank(lines[last + 1]!) &&
      (other
        ? QUOTE_OR_TABLE.test(lines[last + 1]!.text)
        : !startsBlock(lines[last + 1]!.text))
    )
      last++;
    blocks.push({
      type: other ? "other" : "paragraph",
      start: line.start,
      end: lines[last]!.end,
    });
    index = last + 1;
  }
  return blocks;
}

/** `### Not done:`, `### **not  done**` and `### Not done.` name Not done. */
function normalizeLabel(text: string): string {
  return text
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[:.]$/, "");
}

const fixedLabel = (label: string): ReplyLabel | undefined =>
  REPLY_LABELS.find((fixed) => fixed.toLowerCase() === label.toLowerCase());

/** Headings at these depths start a section; deeper ones are content. */
const isSectionHeading = (block: Block) =>
  block.type === "heading" && block.depth <= 3;

/**
 * Spans whose text never ends a sentence: a period in code, a link, an
 * autolink, or inline math belongs to that span.
 */
const OPAQUE =
  /(`+)[\s\S]*?\1(?!`)|!?\[[^\]\n]*\]\([^)\n]*\)|<[^>\s]+>|\$[^$\n]+\$/g;

/**
 * Body offsets just after each sentence end inside a paragraph. A sentence
 * ends at `.`, `!` or `?` (plus closing quotes, brackets or emphasis marks)
 * followed by whitespace and a character that does not start with a
 * lowercase letter, so "e.g. this" stays one sentence.
 */
function sentenceEnds(body: string, start: number, end: number): number[] {
  const text = body.slice(start, end);
  const opaque = [...text.matchAll(OPAQUE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const ends: number[] = [];
  for (const match of text.matchAll(
    /[.!?]+[*_~"'”’)\]]*(?=\s+[^\s\p{Ll}])/gu,
  )) {
    const at = match.index;
    if (opaque.some((range) => at >= range.start && at < range.end)) continue;
    ends.push(start + at + match[0].length);
  }
  return ends;
}

/** A list item's content without its marker or box, dedented. */
function itemOf(item: Item): ReplyItem {
  const [first, ...rest] = item.lines;
  let content = first!.text.slice(
    Math.min(item.contentIndent, first!.text.length),
  );
  let indent = item.contentIndent;
  const box = TASK_BOX.exec(content);
  if (box) {
    content = content.slice(box[0].length);
    indent += box[0].length;
  }
  const continuation = rest.map((line) =>
    line.text.slice(Math.min(indent, indentOf(line.text))),
  );
  return {
    checked: box ? box[1] !== " " : null,
    markdown: [content, ...continuation].join("\n").trim(),
  };
}

/** Where a section stops in the body, and the overflow that folds. */
type SectionSplit = {
  /** Blocks shown at least in part; the last may be cut at `end`. */
  kept: Block[];
  /** Body offset where the shown part ends, when it is cut. */
  end: number | null;
  /** List items shown from a cut list; the rest folded. */
  keptItems: number | null;
  overflow: string | null;
};

/**
 * Splits a section's blocks at the first point past the item or sentence
 * limit. Only top-level list items and paragraph sentences count.
 */
function splitSection(blocks: Block[], body: string): SectionSplit {
  let items = MAX_SECTION_ITEMS;
  let sentences = MAX_SECTION_SENTENCES;
  const sectionEnd = blocks[blocks.length - 1]!.end;
  const cut = (index: number, at: number, keptItems: number | null) => {
    const partial = at > blocks[index]!.start;
    return {
      kept: blocks.slice(0, partial ? index + 1 : index),
      end: at,
      keptItems: partial ? keptItems : null,
      overflow: body.slice(at, sectionEnd).trim() || null,
    };
  };
  for (const [index, block] of blocks.entries()) {
    if (block.type === "list") {
      if (block.items.length <= items) {
        items -= block.items.length;
        continue;
      }
      return cut(index, block.items[items]!.start, items);
    }
    if (block.type === "paragraph") {
      const ends = sentenceEnds(body, block.start, block.end);
      const count = ends.length + 1;
      if (count <= sentences) {
        sentences -= count;
        continue;
      }
      const at = sentences === 0 ? block.start : ends[sentences - 1]!;
      return cut(index, at, null);
    }
  }
  return { kept: blocks, end: null, keptItems: null, overflow: null };
}

function sliceBlocks(blocks: Block[], body: string, end?: number): string {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first || !last) return "";
  return body.slice(first.start, end ?? last.end).trim();
}

/**
 * Reads a reply fence body into its lead, labeled sections, and folded
 * details.
 *
 * Rules: the lead (text before the first heading) must be present once the
 * fence is closed; at most two sections beyond the fixed labels stay in the
 * body, later ones fold; a section over five list items or three sentences
 * keeps that much and folds the rest. Folded text lands under Details with
 * its section's name. While streaming, a missing lead and an empty last
 * section are accepted so arrived sections can show. An unclosed fence, or a
 * closed one with an inner code block left open (the outer fence was too
 * short, so bb ended it early), is rejected so the app shows bb's code block.
 */
export function parse(
  body: string,
  context: { status: ReplyStatus } = { status: "closed" },
): ReplyParseResult {
  if (context.status === "unclosed")
    return { ok: false, error: "The reply has no closing fence." };
  const streaming = context.status === "streaming";
  const text = body.replace(/\r\n?/g, "\n");
  const blocks = readBlocks(text);
  if (
    !streaming &&
    blocks.some((block) => block.type === "code" && !block.closed)
  )
    return {
      ok: false,
      error:
        "A code block inside the reply never closes; the reply's fence needs more backticks than any fence inside it.",
    };

  const lead: Block[] = [];
  const raw: { label: string; blocks: Block[] }[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && isSectionHeading(block))
      raw.push({ label: normalizeLabel(block.text), blocks: [] });
    else if (raw.length) raw[raw.length - 1]!.blocks.push(block);
    else lead.push(block);
  }

  const leadText = sliceBlocks(lead, text);
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
      const details = sliceBlocks(section.blocks, text);
      if (details) ownDetails.push(details);
      continue;
    }
    const fixed = fixedLabel(section.label);
    const label = fixed ?? section.label;
    if (!section.blocks.length) {
      if (streaming && isLast)
        sections.push({ label, kind: fixed ? "fixed" : "free", markdown: "" });
      continue;
    }
    if (!fixed && ++free > MAX_FREE_SECTIONS) {
      folded.push(`**${label}**\n\n${sliceBlocks(section.blocks, text)}`);
      continue;
    }
    const { kept, end, keptItems, overflow } = splitSection(
      section.blocks,
      text,
    );
    const markdown = sliceBlocks(kept, text, end ?? undefined);
    const only = kept.length === 1 ? kept[0] : undefined;
    const items =
      only?.type === "list" && !only.ordered
        ? only.items.slice(0, keptItems ?? undefined).map(itemOf)
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
