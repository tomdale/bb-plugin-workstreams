import type { ReactNode } from "react";
import { LABEL_CLASS } from "../recap/marks.tsx";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { PANEL_ROW_CLASS } from "./Panel.tsx";

const LABEL_TONE = "text-(--ws-reply-accent,var(--muted-foreground))";

/**
 * A change as four labelled rows behind one hairline: what was there, what is
 * there now, what stayed the same, and what it does not cover. The labels share
 * the recap card's column so the difference between the rows is read down one
 * edge rather than out of four sentences.
 */
export function ChangeBody({
  part,
  md,
  pad = PANEL_ROW_CLASS,
}: {
  part: Extract<ReplyPart, { type: "change" }>;
  md: (content: string | undefined) => ReactNode;
  /** Row padding; a part already inside a frame draws its rows flush. */
  pad?: string;
}) {
  const notes: [string, string][] = [];
  if (part.unchanged) notes.push(["Unchanged", part.unchanged]);
  if (part.limitation) notes.push(["Limitation", part.limitation]);
  const row = ([label, value]: [string, string]) => (
    <div
      key={label}
      data-reply-change-row={label.toLowerCase()}
      className={`col-span-full grid grid-cols-subgrid gap-y-0.5 ${pad} @max-[24rem]/change:grid-cols-1`}
    >
      <dt className={`${LABEL_CLASS} whitespace-nowrap ${LABEL_TONE}`}>
        {label}
      </dt>
      <dd className="m-0 min-w-0 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        {md(value)}
      </dd>
    </div>
  );
  return (
    <div className="@container/change min-w-0">
      {/* The recap card's label gutter, widened to fit its longest label and
          shared by every row; labels stack above values when narrow. */}
      <dl className="m-0 grid grid-cols-[minmax(3.25rem,max-content)_minmax(0,1fr)] gap-x-3 divide-y divide-border @max-[24rem]/change:grid-cols-1">
        <div
          data-reply-change-pair=""
          className="col-span-full grid grid-cols-subgrid divide-y divide-border"
        >
          {row(["Before", part.before])}
          {row(["After", part.after])}
        </div>
        {notes.map(row)}
      </dl>
    </div>
  );
}
