/** A run of literal text, or a reference to a thread by id. */
export type MentionPart = string | { threadId: string };

// The same boundaries BB's Markdown uses: not inside a longer word or path.
const MENTION =
  /(?<![\p{L}\p{N}_.+-])@thread:([A-Za-z0-9_-]+)(?![\p{L}\p{N}_/-])/gu;

/**
 * Splits literal text around `@thread:<id>` mentions. The text itself is never
 * interpreted as Markdown, so code spans and links get no special treatment.
 */
export function splitThreadMentions(text: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let at = 0;
  for (const match of text.matchAll(MENTION)) {
    if (match.index > at) parts.push(text.slice(at, match.index));
    parts.push({ threadId: match[1]! });
    at = match.index + match[0].length;
  }
  if (at < text.length || parts.length === 0) parts.push(text.slice(at));
  return parts;
}
