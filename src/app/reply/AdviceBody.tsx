import type { ReactNode } from "react";
import { LABEL_CLASS } from "../recap/marks.tsx";
import type { ReplyPart } from "../../domain/replyComponents.ts";

type Md = (content: string | undefined) => ReactNode;
type Comparison = Extract<ReplyPart, { type: "comparison" }>;
type Recommendation = Extract<ReplyPart, { type: "recommendation" }>;

const ACCENT_TEXT = "text-(--ws-reply-accent,var(--muted-foreground))";
const FLUSH = "[&_p]:my-0";

// Columns only when every option fits in one row at about 13rem each;
// otherwise the options stack. Five or more always stack.
const COLUMNS: Record<number, string> = {
  2: "@min-[27rem]/comparison:grid-cols-2",
  3: "@min-[42rem]/comparison:grid-cols-3",
  4: "@min-[56rem]/comparison:grid-cols-4",
};

/**
 * Options side by side when every option gets about 13rem of the reply
 * column, stacked otherwise. Every option spans the same four subgrid rows (name,
 * summary, qualification, detail), and each field sits in its own row, so a
 * field starts at the same height across a visual row of options even when
 * another option omits it.
 */
export function ComparisonBody({
  part,
  md,
  title,
}: {
  part: Comparison;
  md: Md;
  title: (value: string) => ReactNode;
}) {
  return (
    <div data-reply-comparison="" className="@container/comparison min-w-0">
      {title(part.title)}
      <ul
        data-reply-comparison-options=""
        className={`m-0 mt-2 grid list-none grid-cols-1 gap-x-6 p-0 ${COLUMNS[part.items.length] ?? ""}`}
      >
        {part.items.map((item, i) => (
          <li
            key={i}
            data-reply-comparison-option={item.recommended ? "recommended" : ""}
            className={`row-span-4 grid min-w-0 grid-rows-subgrid gap-y-0 border-t pt-2 pb-3 ${
              item.recommended
                ? "border-t-2 border-(--ws-reply-accent,var(--foreground)) pt-[calc(0.5rem-1px)]"
                : "border-border"
            }`}
          >
            <div className="row-start-1 flex min-w-0 flex-wrap items-baseline gap-x-2 font-medium [&_p]:m-0">
              {md(item.name)}
              {item.recommended ? (
                <span
                  data-reply-recommended=""
                  className={`${LABEL_CLASS} pt-0 ${ACCENT_TEXT}`}
                >
                  Recommended
                </span>
              ) : null}
            </div>
            <div className={`row-start-2 mt-0.5 min-w-0 ${FLUSH}`}>
              {md(item.summary)}
            </div>
            {item.qualification ? (
              <div
                data-reply-comparison-qualification=""
                className={`row-start-3 mt-1.5 min-w-0 ${FLUSH}`}
              >
                {md(item.qualification)}
              </div>
            ) : null}
            {item.detail ? (
              <div
                data-reply-comparison-detail=""
                className={`row-start-4 mt-1.5 min-w-0 text-[0.85em] text-muted-foreground ${FLUSH}`}
              >
                {md(item.detail)}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The choice leads as strong text; the reason and any caveat follow as recap
 * card rows, labels in the card's gutter beside each value and stacked above
 * it when narrow.
 */
export function RecommendationBody({
  part,
  md,
}: {
  part: Recommendation;
  md: Md;
}) {
  const rows: [string, string][] = [["Reason", part.reason]];
  if (part.qualification) rows.push(["Caveat", part.qualification]);
  return (
    <div data-reply-recommendation="" className="@container/advice min-w-0">
      <div
        data-reply-recommendation-choice=""
        className="font-semibold [&_p]:my-0"
      >
        {md(part.choice)}
      </div>
      <dl className="m-0 mt-1.5 grid grid-cols-[minmax(3.25rem,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 @max-[24rem]/advice:grid-cols-1">
        {rows.map(([label, value]) => (
          <div
            key={label}
            data-reply-recommendation-row={label.toLowerCase()}
            className="col-span-full grid grid-cols-subgrid gap-y-0.5 @max-[24rem]/advice:grid-cols-1"
          >
            <dt className={`${LABEL_CLASS} whitespace-nowrap ${ACCENT_TEXT}`}>
              {label}
            </dt>
            <dd className={`m-0 min-w-0 ${FLUSH}`}>{md(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
