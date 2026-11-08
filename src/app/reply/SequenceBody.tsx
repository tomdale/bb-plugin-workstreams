import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { LABEL_CLASS, MARK_CLASS, MARK_ROW_CLASS } from "../recap/marks.tsx";

type Sequence = Extract<ReplyPart, { type: "sequence" }>;

/**
 * A sequence as recap card steps: each step number sits in the mark column,
 * sized and placed like a stroked mark, and a thin rail joins the numbers so
 * the steps read as one path in order. The list's own numbering carries the
 * order for assistive technology, so the drawn numbers are hidden from it.
 * An attention step shows the word beside its title in the reply accent, the
 * thread's workstream color, rather than a state color.
 */
export function SequenceBody({
  part,
  md,
  title,
}: {
  part: Sequence;
  md: (content: string | undefined) => ReactNode;
  title: (value: string) => ReactNode;
}) {
  const last = part.steps.length - 1;
  return (
    <div data-reply-sequence="" className="min-w-0">
      {title(part.title)}
      <ol data-reply-sequence-steps="" className="m-0 mt-2 list-none p-0">
        {part.steps.map((step, i) => (
          <li
            key={i}
            data-reply-sequence-step={i + 1}
            data-reply-attention={step.attention ? "" : undefined}
            className={`relative ${MARK_ROW_CLASS} ${i < last ? "pb-2" : ""}`}
          >
            {i < last ? (
              <span
                aria-hidden="true"
                className="absolute top-[calc(0.2em+17px)] bottom-[calc(3px-0.2em)] left-[6.5px] w-px bg-border max-md:pointer-coarse:top-[calc(0.2em+19px)] max-md:pointer-coarse:left-[8.5px]"
              />
            ) : null}
            <span
              aria-hidden="true"
              data-reply-step-number=""
              className={`${MARK_CLASS} flex translate-y-px items-end justify-center text-[11px] font-medium leading-none tabular-nums text-muted-foreground max-md:pointer-coarse:text-xs`}
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 [&_p]:m-0">
                {md(step.title)}
                {step.attention ? (
                  <span
                    data-reply-step-attention=""
                    className={`${LABEL_CLASS} pt-0 text-(--ws-reply-accent,var(--muted-foreground))`}
                  >
                    Attention
                  </span>
                ) : null}
              </div>
              {step.detail ? (
                <div
                  data-reply-step-detail=""
                  className="mt-0.5 text-muted-foreground [&_p]:my-0"
                >
                  {md(step.detail)}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
