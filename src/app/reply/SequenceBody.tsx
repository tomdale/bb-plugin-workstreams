import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { LABEL_CLASS, MARK_CLASS, MARK_ROW_CLASS } from "../recap/marks.tsx";
import { PANEL_ROW_CLASS, RailCell } from "./Panel.tsx";
import { SECONDARY_CLASS } from "./type.ts";

type Sequence = Extract<ReplyPart, { type: "sequence" }>;
type Review = Extract<ReplyPart, { type: "review" }>;
type Step = {
  title: string;
  detail?: string;
  attention?: boolean;
  requires?: string;
  expected?: string;
};

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
  pad = PANEL_ROW_CLASS,
}: {
  part: Sequence | Review;
  md: (content: string | undefined) => ReactNode;
  /** Row padding; a part already inside a frame draws its rows flush. */
  pad?: string;
}) {
  const steps: Step[] = part.steps;
  const last = steps.length - 1;
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <ol data-reply-sequence-steps="" className="m-0 list-none p-0">
        {steps.map((step, i) => (
          <li
            key={i}
            data-reply-sequence-step={i + 1}
            data-reply-attention={step.attention ? "" : undefined}
            className={`${MARK_ROW_CLASS} ${pad} ${i < last ? "pb-2" : ""}`}
          >
            <RailCell rail={i < last}>
              <span
                data-reply-step-number=""
                className={`${MARK_CLASS} flex w-full items-end justify-center text-[11px] font-medium leading-none tabular-nums text-muted-foreground max-md:pointer-coarse:text-xs`}
              >
                {i + 1}
              </span>
            </RailCell>
            <div className="@container/step min-w-0">
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
                  className={`mt-0.5 text-muted-foreground ${SECONDARY_CLASS} [&_p]:m-0`}
                >
                  {md(step.detail)}
                </div>
              ) : null}
              {step.requires || step.expected ? (
                <dl className="m-0 mt-1 grid grid-cols-[minmax(3.25rem,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 @max-[24rem]/step:grid-cols-1">
                  {(
                    [
                      ["Requires", step.requires],
                      ["Expected", step.expected],
                    ] as const
                  ).map(([label, value]) =>
                    value ? (
                      <div
                        key={label}
                        data-reply-step-field={label.toLowerCase()}
                        className="col-span-full grid grid-cols-subgrid gap-y-0.5 @max-[24rem]/step:grid-cols-1"
                      >
                        <dt className={`${LABEL_CLASS} text-muted-foreground`}>
                          {label}
                        </dt>
                        <dd className="m-0 min-w-0 [&_p]:m-0">{md(value)}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
