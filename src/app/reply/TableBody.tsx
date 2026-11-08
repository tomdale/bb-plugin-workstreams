import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";

type Table = Extract<ReplyPart, { type: "table" }>;

export function TableBody({
  part,
  md,
  pad = "px-3.5",
}: {
  part: Table;
  md: (content: string | undefined) => ReactNode;
  pad?: string;
}) {
  return (
    <div className={`min-w-0 ${pad}`}>
      <div
        role="region"
        aria-label={part.title}
        tabIndex={0}
        className="min-w-0 overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <table
          aria-label={part.title}
          className="w-full border-collapse text-left"
        >
          <thead>
            <tr>
              {part.columns.map((column, i) => (
                <th
                  key={i}
                  scope="col"
                  className="border-b border-border px-3 py-2 font-medium first:pl-0 last:pr-0 [&_p]:my-0"
                >
                  {md(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {part.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="border-b border-border px-3 py-2 align-top tabular-nums first:pl-0 last:pr-0 [overflow-wrap:anywhere] [&_p]:my-0"
                  >
                    {md(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!part.rows.length ? (
        <p className="mt-2 text-muted-foreground">No rows</p>
      ) : null}
    </div>
  );
}
