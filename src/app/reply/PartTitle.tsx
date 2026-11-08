import type { ReactNode } from "react";

/**
 * A part's title. It keeps the Markdown the agent wrote — inline code, an
 * emphasis — but draws as a heading inside the reply: bold, inline with its
 * scope, and without the margins a document heading carries, so a title, its
 * scope and its first row read as one block.
 */
export const PART_TITLE_CLASS =
  "min-w-0 [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_p]:m-0";

export function PartTitle({ children }: { children: ReactNode }) {
  return (
    <div data-reply-part-title="" className={PART_TITLE_CLASS}>
      {children}
    </div>
  );
}

/** The title as a part writes it: a heading, or the whole Markdown of a block title. */
export const titleMarkdown = (value: string): string =>
  value.includes("\n") ? value : `### ${value}`;
