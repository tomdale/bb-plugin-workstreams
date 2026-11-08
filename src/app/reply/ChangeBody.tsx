import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { LabelledRows } from "./rows.tsx";

/**
 * A change as labelled rows: what was there, what is there now, what stayed
 * the same, and what it does not cover. The labels share one gutter, so the
 * difference between the rows is read down one edge rather than out of four
 * sentences.
 */
export function ChangeBody({
  part,
  md,
}: {
  part: Extract<ReplyPart, { type: "change" }>;
  md: (content: string | undefined) => ReactNode;
}) {
  const rows: [string, string | undefined][] = [
    ["Before", part.before],
    ["After", part.after],
    ["Unchanged", part.unchanged],
    ["Limitation", part.limitation],
  ];
  return (
    <LabelledRows
      rows={rows
        .filter((row): row is [string, string] => Boolean(row[1]))
        .map(([label, value]) => ({
          label,
          value: md(value),
          data: { "data-reply-change-row": label.toLowerCase() },
        }))}
    />
  );
}
