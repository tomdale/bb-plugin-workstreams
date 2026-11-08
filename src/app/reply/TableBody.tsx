import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { tableCounts } from "../../domain/replyPanel.ts";
import { StatusDot } from "../primitives/StatusDot.tsx";

/** A piece's own title: body size, semibold, below the reply's headline. */
export const PIECE_TITLE_CLASS = "m-0 text-[1em] font-semibold [&_p]:m-0";

type Render = (content: string | undefined) => ReactNode;
type Tone = NonNullable<
  Extract<ReplyPart, { type: "table" }>["rows"][number]["tone"]
>;

const TONE_DOT: Record<Tone, string> = {
  good: "bg-(--ws-complete)",
  attention: "bg-(--ws-needs-you)",
  bad: "bg-(--ws-failure)",
};
const TONE_TEXT: Record<Tone, string> = {
  good: "text-(--ws-complete-text)",
  attention: "text-(--ws-needs-you-text)",
  bad: "text-(--ws-failure-text)",
};

/**
 * Items that differ in state: a title with the computed count of each state
 * word, then rows on hairline rules with the state last. A toned state takes
 * its color on a dot and the word; an untoned one stays muted. When the
 * reply is narrow each row stacks its cells under their column labels.
 */
export function TableBody({
  part,
  md,
}: {
  part: Extract<ReplyPart, { type: "table" }>;
  md: Render;
}) {
  const states = part.rows.some((row) => row.state);
  const columns = states ? [...part.columns, "State"] : part.columns;
  // Narrow: each row stacks; its first cell leads as the row's name, the
  // other cells follow as label and value pairs, and the state comes last.
  const narrow = "@max-[30rem]/table:block @max-[30rem]/table:py-0";
  const pair =
    "@max-[30rem]/table:grid @max-[30rem]/table:grid-cols-[minmax(4.5rem,max-content)_minmax(0,1fr)] @max-[30rem]/table:gap-x-3 @max-[30rem]/table:py-0 @max-[30rem]/table:before:pt-[0.1em] @max-[30rem]/table:before:text-[0.85em] @max-[30rem]/table:before:text-muted-foreground @max-[30rem]/table:before:content-[attr(data-label)]";
  return (
    <section data-reply-table="" className="@container/table min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={PIECE_TITLE_CLASS}>{md(part.title)}</h3>
        <span
          data-reply-table-count=""
          className="text-right text-[0.85em] text-muted-foreground"
        >
          {tableCounts(part)}
        </span>
      </div>
      <table className="mt-1.5 w-full border-collapse text-left @max-[30rem]/table:block">
        <thead className="@max-[30rem]/table:sr-only">
          <tr>
            {columns.map((column, i) => (
              <th
                key={i}
                scope="col"
                className="border-b border-border py-1 pr-3 text-[0.85em] font-normal text-muted-foreground last:pr-0"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="@max-[30rem]/table:block">
          {part.rows.map((row, i) => (
            <tr
              key={i}
              data-reply-table-row={row.tone ?? ""}
              className="border-b border-border @max-[30rem]/table:block @max-[30rem]/table:space-y-1 @max-[30rem]/table:py-2"
            >
              {row.cells.map((value, j) => (
                <td
                  key={j}
                  data-label={part.columns[j]}
                  className={`min-w-0 py-1.5 pr-3 align-top break-words [&_p]:m-0 ${j === 0 ? `font-medium ${narrow}` : pair}`}
                >
                  {md(value)}
                </td>
              ))}
              {states ? (
                <td
                  data-label="State"
                  data-reply-table-state={row.tone ?? ""}
                  className={`py-1.5 align-top whitespace-nowrap ${narrow}`}
                >
                  {row.state ? (
                    <span
                      className={`inline-flex items-center gap-1.5 ${row.tone ? TONE_TEXT[row.tone] : "text-muted-foreground"}`}
                    >
                      {row.tone ? (
                        <StatusDot size="sm" tone={TONE_DOT[row.tone]} />
                      ) : null}
                      {row.state}
                    </span>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
