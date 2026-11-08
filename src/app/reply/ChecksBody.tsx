import { Fragment, type ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { Evidence, type ReplyDocument } from "./Evidence.tsx";
import { PANEL_ROW_CLASS, StatusMark, StatusWord } from "./Panel.tsx";
import { CHECK_STATUS, reportsFailure } from "./status.ts";
import { ROW_NAME_CLASS, SECONDARY_TEXT } from "./type.ts";

/* The mark, the row's own content, and its status word at the edge, where one
   scan down a single column finds every failure. */
export const STATUS_ROW_CLASS =
  "grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-x-2.5 max-md:pointer-coarse:grid-cols-[1.125rem_minmax(0,1fr)_auto]";

const TOTAL_STATUSES = ["passed", "failed", "skipped"] as const;

/**
 * The reported totals, at the right edge of a checks header, as one short
 * sentence: "8 tests passed, 0 failed, 1 skipped". A count above zero takes its
 * status's tone and a zero stays muted, so a clean run shows no red word.
 */
export function TestTotals({
  totals,
}: {
  totals: { passed: number; failed: number; skipped: number };
}) {
  return (
    <p
      aria-label="Reported test totals"
      className="m-0 text-[11.5px] font-medium leading-[18px] text-muted-foreground"
    >
      {TOTAL_STATUSES.map((status, i) => {
        const count = totals[status];
        const word = CHECK_STATUS[status].word.toLowerCase();
        return (
          <Fragment key={status}>
            {i ? ", " : null}
            <span
              data-reply-test-total={status}
              className={count > 0 ? CHECK_STATUS[status].tone : undefined}
            >
              <span className="tabular-nums">{count.toLocaleString()}</span>{" "}
              {i ? word : `${count === 1 ? "test" : "tests"} ${word}`}
            </span>
          </Fragment>
        );
      })}
    </p>
  );
}

/**
 * One row per check: its mark, its name, detail and evidence, and its status
 * word at the right edge. A failed or blocked row takes a heavier name; the
 * frame around the rows carries the tone, so the row itself is not tinted.
 */
export function CheckRows({
  part,
  document,
  files,
  md,
}: {
  part: Extract<ReplyPart, { type: "checks" }>;
  document: ReplyDocument;
  files: Parameters<typeof Evidence>[0]["files"];
  md: (content: string | undefined) => ReactNode;
}) {
  return (
    <ul
      data-reply-check-items=""
      className="m-0 list-none divide-y divide-border p-0"
    >
      {part.items.map((item, i) => {
        const status = CHECK_STATUS[item.status];
        return (
          <li
            key={i}
            data-reply-check-item={item.status}
            className={`${STATUS_ROW_CLASS} ${PANEL_ROW_CLASS}`}
          >
            <StatusMark
              status={status}
              data={{ "data-reply-check-status": item.status }}
            />
            <div className="min-w-0">
              <div
                data-reply-check-name=""
                className={`min-w-0 ${ROW_NAME_CLASS} ${
                  reportsFailure(item.status) ? "font-medium" : ""
                } [&_p]:m-0`}
              >
                {md(item.name)}
              </div>
              {item.detail ? (
                <div
                  data-reply-check-detail=""
                  className={`mt-0.5 min-w-0 ${SECONDARY_TEXT}`}
                >
                  {md(item.detail)}
                </div>
              ) : null}
              <Evidence
                items={item.evidence}
                document={document}
                files={files}
              />
            </div>
            <StatusWord status={status} />
          </li>
        );
      })}
    </ul>
  );
}
