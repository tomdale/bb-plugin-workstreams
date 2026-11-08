import type { ReactNode } from "react";
import { LABEL_CLASS } from "../recap/marks.tsx";

/**
 * The recap card's labelled rows, drawn in the message flow: a small label in
 * the reply accent in the card's gutter beside each value, and a hairline above
 * every row so the part has an edge where it starts without a frame around it.
 * The gutter is at least the card's 3.25rem and widens to the longest label, so
 * every value starts at the same edge; below 24rem labels stack above values.
 */
export function LabelledRows({
  rows,
  data,
}: {
  /** Each row's label, its value, and the attribute a test finds it by. */
  rows: {
    label: string;
    value: ReactNode;
    data: Record<string, string>;
  }[];
  data?: Record<string, string>;
}) {
  return (
    <div className="@container/rows min-w-0">
      <dl
        {...data}
        className="m-0 grid grid-cols-[minmax(3.25rem,max-content)_minmax(0,1fr)] gap-x-3 @max-[24rem]/rows:grid-cols-1"
      >
        {rows.map(({ label, value, data: rowData }) => (
          <div
            key={label}
            {...rowData}
            className="col-span-full grid grid-cols-subgrid gap-y-0.5 border-t border-border py-1.5 @max-[24rem]/rows:grid-cols-1"
          >
            <dt
              className={`${LABEL_CLASS} whitespace-nowrap text-(--ws-reply-accent,var(--muted-foreground))`}
            >
              {label}
            </dt>
            <dd className="m-0 min-w-0 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
