import { recapMarkdownSpans } from "./recapFileLinks.ts";

/** A piece of prose: Markdown source, or a thread mention drawn as a chip. */
export type MentionSegment =
  { kind: "markdown"; text: string } | { kind: "thread"; threadId: string };

const MENTION = /@thread:([A-Za-z0-9_-]+)/g;

/**
 * Splits prose around `@thread:<id>` mentions. Code spans, link syntax, and
 * bare URLs stay whole, so a mention inside one is literal text. Returns a
 * single Markdown segment when nothing in the prose is a mention.
 */
export function threadMentionSegments(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let pending = "";
  const scan = (chunk: string) => {
    let at = 0;
    for (const match of chunk.matchAll(MENTION)) {
      pending += chunk.slice(at, match.index);
      if (pending) segments.push({ kind: "markdown", text: pending });
      pending = "";
      segments.push({ kind: "thread", threadId: match[1]! });
      at = match.index + match[0].length;
    }
    pending += chunk.slice(at);
  };
  let last = 0;
  for (const span of recapMarkdownSpans(text)) {
    scan(text.slice(last, span.index));
    pending += span.text;
    last = span.index + span.text.length;
  }
  scan(text.slice(last));
  if (pending) segments.push({ kind: "markdown", text: pending });
  return segments;
}
