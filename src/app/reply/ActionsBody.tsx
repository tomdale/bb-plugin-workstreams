import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { actionsCount } from "../../domain/replyPanel.ts";
import { Glyph, LABEL_CLASS, MARK_CLASS } from "../recap/marks.tsx";
import { CopyValue } from "./CopyValue.tsx";
import { INHERIT_CLASS } from "./markdown.ts";

type Render = (content: string | undefined) => ReactNode;

/** A stroked warning triangle in the recap card's glyph style. */
export const CAUTION = "M8 2.75 14.25 13.25H1.75Z M8 6.5V9.25 M8 11.4v.01";

/**
 * What the work leaves the reader to do or decide, in the needs-you tint:
 * the one tinted panel in a reply, drawn right after the lead. Each row is a
 * numbered step whose action leads; a decision shows the word Decide, a
 * caution its warning mark, and a command its copy button.
 */
export function ActionsBody({
  part,
  md,
}: {
  part: Extract<ReplyPart, { type: "actions" }>;
  md: Render;
}) {
  return (
    <section
      data-reply-actions=""
      className="min-w-0 rounded-lg border border-(--ws-needs-you-border) bg-(--ws-needs-you-surface)"
    >
      <header className="flex items-baseline justify-between gap-3 px-3 pt-2 pb-1.5">
        <h3 className="m-0 text-[0.93em] font-semibold text-(--ws-needs-you-text)">
          {part.title ?? "Needs you"}
        </h3>
        <span
          data-reply-actions-count=""
          className="text-[0.85em] whitespace-nowrap text-(--ws-needs-you-text) tabular-nums"
        >
          {actionsCount(part)}
        </span>
      </header>
      <ol className="m-0 list-none divide-y divide-(--ws-needs-you-rule) border-t border-(--ws-needs-you-rule) p-0">
        {part.items.map((item, i) => (
          <li
            key={i}
            data-reply-action={item.decide ? "decide" : "do"}
            className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1.5 px-3 py-2"
          >
            <span
              aria-hidden="true"
              className="pt-[0.1em] text-[0.85em] text-muted-foreground tabular-nums"
            >
              {i + 1}
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-medium [&_p]:m-0">
                {item.decide ? (
                  <span
                    className={`${LABEL_CLASS} pt-0 text-(--ws-needs-you-text)`}
                  >
                    Decide
                  </span>
                ) : null}
                {md(item.action)}
              </div>
              {item.detail ? (
                <div
                  className={`text-[0.93em] text-muted-foreground [&_p]:my-0 ${INHERIT_CLASS}`}
                >
                  {md(item.detail)}
                </div>
              ) : null}
              {item.caution ? (
                <div
                  data-reply-caution=""
                  className={`grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5 text-[0.93em] text-(--ws-needs-you-text) [&_p]:my-0 ${INHERIT_CLASS}`}
                >
                  <Glyph path={CAUTION} className={MARK_CLASS} />
                  <div className="min-w-0">
                    <span className="sr-only">Caution: </span>
                    {md(item.caution)}
                  </div>
                </div>
              ) : null}
              {item.copy ? <CopyValue value={item.copy} /> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
