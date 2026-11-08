import type { ReactNode } from "react";
import type { ReplyEvidence, ReplyPart } from "../../domain/replyComponents.ts";
import {
  checksSettled,
  checksTiles,
  deliveryCount,
  type Tile,
} from "../../domain/replyPanel.ts";
import {
  CHECK,
  Glyph,
  LABEL_CLASS,
  MARK_CLASS,
  MARK_ROW_CLASS,
} from "../recap/marks.tsx";
import { Fold } from "./DetailsBody.tsx";
import { PIECE_TITLE_CLASS } from "./TableBody.tsx";
import { INHERIT_CLASS } from "./markdown.ts";

type Render = (content: string | undefined) => ReactNode;
type EvidenceList = (items: ReplyEvidence[] | undefined) => ReactNode;
type Checks = Extract<ReplyPart, { type: "checks" }>;
type Delivery = Extract<ReplyPart, { type: "delivery" }>;
type CheckStatus = Checks["items"][number]["status"];
type StageStatus = Delivery["stages"][number]["status"];

const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  blocked: "Blocked",
  untested: "Not tested",
};
const FAILED = "M4.5 4.5 11.5 11.5 M11.5 4.5 4.5 11.5";
const BLOCKED =
  "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9Z M4.8 11.2 11.2 4.8";
// Stroked marks in the recap card's glyph style; each status has its own
// shape so a list reads without color.
const CHECK_STATUS_PATH: Record<CheckStatus, string> = {
  passed: CHECK,
  failed: FAILED,
  skipped: "M4.5 8H11.5",
  blocked: BLOCKED,
  untested: "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9Z",
};
const CHECK_STATUS_TONE: Record<CheckStatus, string> = {
  passed: "text-(--ws-complete-text)",
  failed: "text-(--ws-failure-text)",
  skipped: "text-muted-foreground",
  blocked: "text-muted-foreground",
  untested: "text-muted-foreground",
};
const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  done: "Done",
  pending: "Pending",
  blocked: "Blocked",
  unknown: "Unknown",
};
// Done and blocked share their check counterparts' shapes; pending is a
// clock and unknown a question mark.
const STAGE_STATUS_PATH: Record<StageStatus, string> = {
  done: CHECK,
  pending: "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9Z M8 5.75V8l1.5 1",
  blocked: BLOCKED,
  unknown:
    "M5.3 5.8a2.7 2.7 0 1 1 3.85 2.45c-.75.4-1.15.95-1.15 1.75v.2 M8 12.9v.01",
};
const STAGE_STATUS_TONE: Record<StageStatus, string> = {
  done: CHECK_STATUS_TONE.passed,
  pending: "text-muted-foreground",
  blocked: "text-muted-foreground",
  unknown: "text-muted-foreground",
};
const TILE_TONE: Record<Tile["tone"], { mark: string; value: string }> = {
  good: { mark: "text-(--ws-complete-text)", value: "" },
  bad: {
    mark: "text-(--ws-failure-text)",
    value: "text-(--ws-failure-text)",
  },
  neutral: { mark: "text-muted-foreground", value: "" },
};

/** A status mark whose label is announced but drawn only beside the name. */
function Mark({
  path,
  tone,
  label,
  ...data
}: { path: string; tone: string; label: string } & Record<
  `data-${string}`,
  string
>) {
  return (
    <span {...data} className={`flex ${tone}`}>
      <Glyph path={path} className={MARK_CLASS} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A title with its scope muted beside it, wrapping beneath when narrow. */
function Heading({
  title,
  scope,
  md,
}: {
  title: string;
  scope: string;
  md: Render;
}) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 [&_p]:m-0">
      <span className={PIECE_TITLE_CLASS}>{md(title)}</span>
      <span
        className={`text-[0.85em] font-normal text-muted-foreground ${INHERIT_CLASS}`}
      >
        {md(scope)}
      </span>
    </span>
  );
}

/** The counted tiles: one row of cells on one hairline border, wrapping when narrow. */
function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl
      data-reply-tiles=""
      className="m-0 flex flex-wrap overflow-hidden rounded-lg border border-border"
    >
      {tiles.map((tile, i) => (
        <div
          key={i}
          data-reply-tile={tile.tone}
          className="flex min-w-[9rem] flex-1 flex-col-reverse border-border px-3 py-2 not-first:border-l"
        >
          <dt className="mt-0.5 text-[0.85em] text-muted-foreground">
            {tile.label}
          </dt>
          <dd
            className={`m-0 flex items-center gap-1.5 text-[1.15em] leading-tight font-semibold tabular-nums ${TILE_TONE[tile.tone].value}`}
          >
            {tile.tone === "neutral" ? null : (
              <Glyph
                path={tile.tone === "good" ? CHECK : FAILED}
                className={`h-3.5 w-3.5 shrink-0 ${TILE_TONE[tile.tone].mark}`}
              />
            )}
            {tile.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Checks as counted tiles, then the list. When every check passed the list
 * folds behind its title and scope; anything failed, skipped, blocked, or
 * untested keeps it open, so a problem is never one click away.
 */
export function ChecksBody({
  part,
  md,
  evidence,
}: {
  part: Checks;
  md: Render;
  evidence: EvidenceList;
}) {
  const list = (
    <ul data-reply-check-items="" className="m-0 list-none space-y-1.5 p-0">
      {part.items.map((item, i) => (
        <li
          key={i}
          data-reply-check-item={item.status}
          className={MARK_ROW_CLASS}
        >
          <Mark
            data-reply-check-status={item.status}
            path={CHECK_STATUS_PATH[item.status]}
            tone={CHECK_STATUS_TONE[item.status]}
            label={CHECK_STATUS_LABEL[item.status]}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 [&_p]:m-0">
              {md(item.name)}
              {item.status === "passed" ? null : (
                <span
                  aria-hidden="true"
                  className={`${LABEL_CLASS} pt-0 ${CHECK_STATUS_TONE[item.status]}`}
                >
                  {CHECK_STATUS_LABEL[item.status]}
                </span>
              )}
            </div>
            {item.detail ? (
              <div
                className={`mt-0.5 text-[0.93em] text-muted-foreground [&_p]:my-0 ${INHERIT_CLASS}`}
              >
                {md(item.detail)}
              </div>
            ) : null}
            {item.evidence?.length ? evidence(item.evidence) : null}
          </div>
        </li>
      ))}
    </ul>
  );
  const heading = <Heading title={part.title} scope={part.scope} md={md} />;
  return (
    <section data-reply-checks="" className="min-w-0 space-y-1.5">
      <Tiles tiles={checksTiles(part)} />
      {checksSettled(part) ? (
        <Fold data-reply-checks-fold="" rule={false} title={heading}>
          {list}
        </Fold>
      ) : (
        <>
          <div className="pt-1">{heading}</div>
          {list}
        </>
      )}
    </section>
  );
}

/**
 * Delivery as one row of stage marks joined by short rules, read left to
 * right, with the computed count beside the title. Notes on unfinished
 * stages stay open beneath; notes on finished ones fold.
 */
export function DeliveryBody({
  part,
  md,
  evidence,
}: {
  part: Delivery;
  md: Render;
  evidence: EvidenceList;
}) {
  const noted = part.stages.filter(
    (stage) => stage.detail || stage.evidence?.length,
  );
  const open = noted.filter((stage) => stage.status !== "done");
  const settled = noted.filter((stage) => stage.status === "done");
  const notes = (stages: typeof noted) => (
    <ul className="m-0 list-none space-y-1 p-0">
      {stages.map((stage, i) => (
        <li
          key={i}
          data-reply-delivery-note={stage.status}
          className="text-[0.93em] [&_p]:my-0"
        >
          <div
            className={`flex flex-wrap items-baseline gap-x-2 text-muted-foreground ${INHERIT_CLASS}`}
          >
            <span className="text-foreground">{md(stage.name)}</span>
            {stage.detail ? <span>{md(stage.detail)}</span> : null}
          </div>
          {stage.evidence?.length ? evidence(stage.evidence) : null}
        </li>
      ))}
    </ul>
  );
  return (
    <section data-reply-delivery="" className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Heading title={part.title} scope={part.scope} md={md} />
        <span
          data-reply-delivery-count=""
          className="text-[0.85em] whitespace-nowrap text-muted-foreground tabular-nums"
        >
          {deliveryCount(part)}
        </span>
      </div>
      <ol
        data-reply-delivery-stages=""
        className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0"
      >
        {part.stages.map((stage, i) => (
          <li
            key={i}
            data-reply-delivery-stage={stage.status}
            className="flex items-center gap-2"
          >
            {i > 0 ? (
              <span aria-hidden="true" className="h-px w-3 bg-border" />
            ) : null}
            <span className="flex items-baseline gap-1.5">
              <span className="self-start">
                <Mark
                  data-reply-stage-status={stage.status}
                  path={STAGE_STATUS_PATH[stage.status]}
                  tone={STAGE_STATUS_TONE[stage.status]}
                  label={STAGE_STATUS_LABEL[stage.status]}
                />
              </span>
              <span className="[&_p]:m-0">{md(stage.name)}</span>
              {stage.status === "done" ? null : (
                <span
                  aria-hidden="true"
                  className={`${LABEL_CLASS} pt-0 ${STAGE_STATUS_TONE[stage.status]}`}
                >
                  {STAGE_STATUS_LABEL[stage.status]}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {open.length ? <div className="pt-0.5">{notes(open)}</div> : null}
      {settled.length ? (
        <Fold
          data-reply-delivery-fold=""
          rule={false}
          title="Done stages"
          summary={`${settled.length} ${settled.length === 1 ? "note" : "notes"}`}
        >
          {notes(settled)}
        </Fold>
      ) : null}
    </section>
  );
}
