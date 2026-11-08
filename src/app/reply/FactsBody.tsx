import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { CopyValue } from "./CopyValue.tsx";
import { INHERIT_CLASS } from "./markdown.ts";

type Render = (content: string | undefined) => ReactNode;

/**
 * Values the reader will copy: a muted label column sized to the longest
 * label, every value starting at the same edge in monospace with its copy
 * button, and any note muted after it. Labels stack above values when the
 * reply is narrow.
 */
export function FactsBody({
  part,
  md,
}: {
  part: Extract<ReplyPart, { type: "facts" }>;
  md: Render;
}) {
  return (
    <div data-reply-facts="" className="@container/facts min-w-0">
      <dl className="m-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 @max-[24rem]/facts:grid-cols-1">
        {part.items.map((item, i) => (
          <div
            key={i}
            data-reply-fact=""
            className="col-span-full grid grid-cols-subgrid"
          >
            <dt className="pt-[0.1em] text-[0.85em] text-muted-foreground">
              {item.label}
            </dt>
            <dd className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 [&_p]:m-0">
              <CopyValue value={item.value} />
              {item.note ? (
                <span
                  className={`text-[0.93em] text-muted-foreground ${INHERIT_CLASS}`}
                >
                  {md(item.note)}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
