import type { ReactNode } from "react";
import type { ReplyPart, TestTotals } from "../../domain/replyComponents.ts";
import { Evidence, type ReplyDocument } from "./Evidence.tsx";
import { PANEL_ROW_CLASS, StatusMark, StatusWord } from "./Panel.tsx";
import { CHECK_STATUS, reportsFailure, type CheckStatus } from "./status.ts";
import { ROW_NAME_CLASS, SECONDARY_CLASS } from "./type.ts";

/* The mark, the row's own content, and its status word at the edge, where one
   scan down a single column finds every failure. */
export const STATUS_ROW_CLASS =
  "grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-x-2.5 max-md:pointer-coarse:grid-cols-[1.125rem_minmax(0,1fr)_auto]";

/** A row that reports something to act on takes its tone's tint. */
const ROW_TINT: Partial<Record<CheckStatus, string>> = {
  failed: "bg-(--ws-failure-surface)",
  blocked: "bg-(--ws-needs-you-surface)",
};

const TOTAL_STATUSES = ["passed", "failed", "skipped"] as const;

/**
 * The reported totals, at the right edge of a checks header. Only the counts the
 * reply reported are printed, so the row never claims a count nobody made. A
 * zero count is muted, so a clean run shows no red word.
 */
export function TestTotals({ totals }: { totals: TestTotals }) {
  const shown = TOTAL_STATUSES.filter((status) => totals[status] !== undefined);
  if (!shown.length) return null;
  return (
    <div
      aria-label="Reported test totals"
      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
    >
      <span className="text-[11px] font-medium leading-[17.6px] text-muted-foreground">
        Tests
      </span>
      {shown.map((status) => {
        const count = totals[status]!;
        return (
          <span
            key={status}
            data-reply-test-total={status}
            className={`inline-flex items-baseline gap-1 text-[11.5px] font-medium leading-[18px] ${
              count > 0 ? CHECK_STATUS[status].tone : "text-muted-foreground"
            }`}
          >
            <b className="font-medium tabular-nums">{count.toLocaleString()}</b>
            {CHECK_STATUS[status].word.toLowerCase()}
          </span>
        );
      })}
    </div>
  );
}

/**
 * One row per check: its mark, its name, detail and evidence, and its status
 * word at the right edge. A failed or blocked row takes its tone's tint and a
 * heavier name, so the row reads as failing before the word is found.
 */
export function CheckRows({
  part,
  document,
  files,
  md,
  pad = PANEL_ROW_CLASS,
}: {
  part: Extract<ReplyPart, { type: "checks" }>;
  document: ReplyDocument;
  files: Parameters<typeof Evidence>[0]["files"];
  md: (content: string | undefined) => ReactNode;
  /** Row padding; a part already inside a frame draws its rows flush. */
  pad?: string;
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
            className={`${STATUS_ROW_CLASS} ${pad} ${ROW_TINT[item.status] ?? ""}`}
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
                  className={`mt-0.5 min-w-0 text-muted-foreground ${SECONDARY_CLASS} [&_p]:m-0`}
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
