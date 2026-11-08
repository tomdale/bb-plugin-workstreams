import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { Evidence, type ReplyDocument } from "./Evidence.tsx";
import { PANEL_ROW_CLASS, RailCell, StatusMark, StatusWord } from "./Panel.tsx";
import { STAGE_STATUS, reportsFailure } from "./status.ts";
import { ROW_NAME_CLASS, SECONDARY_TEXT } from "./type.ts";

/* The mark, the stage's own content, and its status word at the edge, where a
   scan down one column finds every stage that needs someone. */
const STAGE_ROW_CLASS =
  "grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-x-2.5 max-md:pointer-coarse:grid-cols-[1.125rem_minmax(0,1fr)_auto]";

/**
 * A delivery as a rail of stages, each with the word its status reports: what
 * has happened, what still waits, and what nobody has reached. The list's own
 * order carries the path for assistive technology, so the drawn marks are
 * decoration.
 */
export function DeliveryStages({
  part,
  document,
  files,
  md,
}: {
  part: Extract<ReplyPart, { type: "delivery" }>;
  document: ReplyDocument;
  files: Parameters<typeof Evidence>[0]["files"];
  md: (content: string | undefined) => ReactNode;
}) {
  const last = part.stages.length - 1;
  return (
    <ol
      data-reply-delivery-stages=""
      aria-label="Stages"
      className="m-0 list-none p-0"
    >
      {part.stages.map((stage, i) => {
        const status = STAGE_STATUS[stage.status];
        return (
          <li
            key={i}
            data-reply-delivery-stage={stage.status}
            className={`${STAGE_ROW_CLASS} ${PANEL_ROW_CLASS}`}
          >
            <RailCell rail={i < last}>
              <StatusMark
                status={status}
                data={{ "data-reply-stage-status": stage.status }}
              />
            </RailCell>
            <div className="min-w-0">
              <div
                className={`min-w-0 ${ROW_NAME_CLASS} ${
                  reportsFailure(stage.status) ? "font-medium" : ""
                } [&_p]:m-0`}
              >
                {md(stage.name)}
              </div>
              {stage.detail ? (
                <div
                  data-reply-stage-detail=""
                  className={`mt-0.5 min-w-0 ${SECONDARY_TEXT}`}
                >
                  {md(stage.detail)}
                </div>
              ) : null}
              <Evidence
                items={stage.evidence}
                document={document}
                files={files}
              />
            </div>
            <StatusWord status={status} />
          </li>
        );
      })}
    </ol>
  );
}
