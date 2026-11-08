import type { ReactNode } from "react";
import { Glyph, MARK_CLASS } from "../recap/marks.tsx";
import { SECONDARY_TEXT } from "./type.ts";
import type { PanelTone, StatusShape } from "./status.ts";

/**
 * The frame a part draws when it reports results: checks and a delivery. It is
 * the recessed, bordered box subagent deliveries already use, so the edge of a
 * frame in a reply always means that a result is reported inside it. Every
 * other part draws with the recap card's rules, gutters and marks and no frame.
 */

/**
 * The frame carries the reply's body size, so a panel nested in another surface
 * cannot pass a larger size down to its rows.
 */
const PANEL_CLASS =
  "min-w-0 overflow-hidden rounded-lg border bg-surface-recessed text-[13px] leading-[21px]"; // slop-ok: 2 the frame checks, deliveries and subagent deliveries already draw

/**
 * A failure has to be findable before a row is read, so a part's frame and
 * header strip take the tone of its worst row, the way a recap card takes its
 * state's. The title stays neutral, like the card's goal: the rows carry the
 * mark and the word. Parts with nothing failed or blocked stay neutral, which
 * keeps the recap card the loudest object.
 */
const TONES: Record<PanelTone | "neutral", { frame: string; header: string }> =
  {
    neutral: { frame: "border-border", header: "border-border" },
    failure: {
      frame: "border-(--ws-failure-border)",
      header: "border-(--ws-failure-border) bg-(--ws-failure-surface)",
    },
    needsYou: {
      frame: "border-(--ws-needs-you-border)",
      header: "border-(--ws-needs-you-border) bg-(--ws-needs-you-surface)",
    },
  };

/** A row's padding inside a panel, on the design's 14px gutter. */
export const PANEL_ROW_CLASS = "px-3.5 py-2";

export function Panel({
  part,
  tone,
  title,
  scope,
  summary,
  children,
}: {
  /** The part's type, recorded so a test and the gallery can find the frame. */
  part: string;
  /** The worst state among the rows; it tones the frame and header. */
  tone?: PanelTone | null;
  title?: ReactNode;
  scope?: ReactNode;
  /** A tally that summarises state, at the right edge of the header. */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const classes = TONES[tone ?? "neutral"];
  return (
    <section
      // The part's own marker, so a framed part answers to the same attribute
      // whether or not it drew a panel.
      {...{ [`data-reply-${part}`]: "" }}
      data-reply-panel={part}
      data-reply-panel-tone={tone ?? undefined}
      className={`${PANEL_CLASS} ${classes.frame}`}
    >
      {title || scope || summary ? (
        <div
          data-reply-panel-header=""
          className={`flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-b px-3.5 py-2 ${classes.header}`}
        >
          <div className="min-w-0 flex-1 basis-48">
            {title ? (
              <div data-reply-panel-title="" className="text-foreground">
                {title}
              </div>
            ) : null}
            {scope ? (
              <div className={`mt-0.5 min-w-0 ${SECONDARY_TEXT}`}>{scope}</div>
            ) : null}
          </div>
          {summary}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A row's status mark. It is decorative: the word beside the row carries the
 * state, and the shape and the tint are what make a failure findable first.
 */
export function StatusMark({
  status,
  data,
}: {
  status: StatusShape;
  /** The part's own marker attribute, so a test can find the row's raw status. */
  data?: Record<string, string>;
}) {
  return (
    <span {...data} aria-hidden="true" className={`flex ${status.tone}`}>
      <Glyph path={status.path} className={MARK_CLASS} dashed={status.dashed} />
    </span>
  );
}

/**
 * The mark column of a rail. The line joining a row to the next one is drawn
 * inside this cell, so it follows the mark wherever the row's padding puts it.
 */
export function RailCell({
  data,
  rail,
  children,
}: {
  data?: Record<string, string>;
  /** Whether another row follows, which is what the line joins. */
  rail: boolean;
  children: ReactNode;
}) {
  return (
    <span
      {...data}
      aria-hidden="true"
      className="relative flex self-stretch justify-center"
    >
      {children}
      {rail ? (
        <span
          data-reply-rail=""
          className="absolute top-[calc(0.2em+17px)] -bottom-2 left-1/2 w-px bg-border"
        />
      ) : null}
    </span>
  );
}

/**
 * The status word at a row's right edge, where one column can be scanned. An
 * expected outcome's word is read only by assistive technology, so the column
 * shows only the rows that need reading.
 */
export function StatusWord({ status }: { status: StatusShape }) {
  return (
    <span
      data-reply-status-word={status.word}
      className={
        status.quiet
          ? "sr-only"
          : `text-[11px] font-medium leading-[17.6px] ${status.tone}`
      }
    >
      {status.word}
    </span>
  );
}
