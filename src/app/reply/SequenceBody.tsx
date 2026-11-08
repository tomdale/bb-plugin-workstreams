import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { LABEL_CLASS, MARK_CLASS, MARK_ROW_CLASS } from "../recap/marks.tsx";
import { RailCell } from "./Panel.tsx";
import { SECONDARY_TEXT } from "./type.ts";

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
}: {
  part: Sequence;
  md: (content: string | undefined) => ReactNode;
}) {
  const last = part.steps.length - 1;
  return (
    <div className="min-w-0">
      <ol data-reply-sequence-steps="" className="m-0 list-none p-0">
        {part.steps.map((step, i) => (
          <li
            key={i}
            data-reply-sequence-step={i + 1}
            data-reply-attention={step.attention ? "" : undefined}
            className={`${MARK_ROW_CLASS} ${i < last ? "pb-2" : ""}`}
          >
            <RailCell rail={i < last}>
              <span
                data-reply-step-number=""
                className={`${MARK_CLASS} flex w-full items-end justify-center text-[11px] font-medium leading-none tabular-nums text-muted-foreground max-md:pointer-coarse:text-xs`}
              >
                {i + 1}
              </span>
            </RailCell>
            <div className="min-w-0">
              <div
                className={`flex min-w-0 flex-wrap items-baseline gap-x-2 [&_p]:m-0 ${
                  step.attention ? "font-medium" : ""
                }`}
              >
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
                  className={`mt-0.5 ${SECONDARY_TEXT}`}
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
