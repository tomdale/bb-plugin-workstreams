/**
 * A suggestion drawn as the sidebar rows it touches: as they are, an arrow,
 * and as they would be after accepting (`suggestionPreview` in the domain).
 * Workstreams are bold and threads wear a ring, as in the sidebar; nested
 * rows hang from their parent on a tree connector. A row that leaves is dimmed and
 * crossed out; one that lands, appears or changes takes its workstream's
 * color, as the sidebar draws that workstream, and counts are visible
 * threads, in muted text, left off when there are none. A landing row's count opens the threads that
 * arrive.
 */
import { useState, type CSSProperties } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type {
  PreviewRow,
  SuggestionPreview as Preview,
} from "../../domain/suggestion-preview.ts";
import {
  colorForWorkstream,
  workstreamColorStyle,
  type TopicColor,
} from "../../domain/workstreamColor.ts";
import { workstreamHue } from "../../domain/workstreamHue.ts";

/** The topic colors the sidebar draws workstreams in. */
export type PreviewColors = {
  readonly groups: Readonly<Record<string, string>>;
  readonly colors?: Readonly<Record<string, TopicColor>>;
};

export function SuggestionPreview({
  preview,
  colors,
}: {
  preview: Preview;
  colors?: PreviewColors;
}) {
  return (
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-center leading-[18px]">
      <Side rows={preview.before} colors={colors} />
      <Icon
        name="ArrowRight"
        className="size-3.5 justify-self-center text-muted-foreground"
        aria-hidden
      />
      <Side rows={preview.after} colors={colors} />
    </div>
  );
}

/**
 * One side of the drawing. Consecutive nested rows sit in one indented run
 * that draws a tree connector: a trunk down from the parent and a short arm
 * into each row, ending at the last (see `.ws-preview-run`).
 */
function Side({
  rows,
  colors,
}: {
  rows: readonly PreviewRow[];
  colors?: PreviewColors;
}) {
  const runs: { depth: 0 | 1; rows: { row: PreviewRow; key: number }[] }[] = [];
  rows.forEach((row, key) => {
    const last = runs.at(-1);
    if (row.depth === 1 && last?.depth === 1) last.rows.push({ row, key });
    else runs.push({ depth: row.depth, rows: [{ row, key }] });
  });
  return (
    <div className="min-w-0">
      {runs.map((run) =>
        run.depth === 1 ? (
          <div
            key={run.rows[0]!.key}
            className="ws-preview-run ml-[5px] min-w-0 pl-3"
          >
            {run.rows.map(({ row, key }) => (
              <Row key={key} row={row} colors={colors} />
            ))}
          </div>
        ) : (
          <Row key={run.rows[0]!.key} row={run.rows[0]!.row} colors={colors} />
        ),
      )}
    </div>
  );
}

const plural = (n: number) => (n === 1 ? "1 thread" : `${n} threads`);

/**
 * A landing row's workstream color: its topic's, or for a topic with none
 * yet, the hue the sidebar would give its name.
 */
const accentOf = (row: PreviewRow, colors?: PreviewColors) =>
  workstreamColorStyle(
    row.colorTopicId
      ? colorForWorkstream(row.colorTopicId, colors, row.colorTopicId)
      : { hue: workstreamHue(row.name), level: 0 },
  ) as CSSProperties;

function Row({ row, colors }: { row: PreviewRow; colors?: PreviewColors }) {
  const [open, setOpen] = useState(false);
  const landing = row.mark === "new";
  const tone =
    row.mark === "gone"
      ? "text-muted-foreground/60 line-through decoration-1"
      : landing
        ? "text-(--ws-preview-accent)"
        : row.kind === "topic"
          ? "text-muted-foreground"
          : "";
  const count =
    // A count of nothing says nothing; a topic whose threads are all
    // archived moves with none to show.
    !row.count ? null : row.arriving?.length ? (
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} ${plural(row.arriving.length)} arriving in ${row.name}`}
        onClick={() => setOpen(!open)}
        // Quiet like any count until the pointer or focus finds it, then a
        // chip; it stays filled while its threads are listed.
        className="-ml-0.5 -mr-1 cursor-pointer rounded px-1 text-[11px] tabular-nums text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:text-foreground aria-expanded:bg-state-hover aria-expanded:text-foreground"
      >
        {row.count}
      </button>
    ) : (
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {row.count}
      </span>
    );
  return (
    <div
      className={cn("min-w-0", landing && "ws-preview-accent")}
      style={landing ? accentOf(row, colors) : undefined}
    >
      <div className="min-h-[18px] min-w-0 [overflow-wrap:anywhere]">
        <span className={cn(row.kind === "topic" && "font-semibold", tone)}>
          {row.kind === "thread" || row.kind === "threads" ? (
            <span aria-hidden className="ws-preview-ring" />
          ) : null}
          {row.within ? (
            <span className="font-normal">{row.within}: </span>
          ) : null}
          {row.kind === "threads"
            ? plural(row.count ?? 0)
            : row.kind === "more"
              ? `${row.count} more`
              : row.name}
          {row.created ? <span className="sr-only"> (new)</span> : null}
        </span>
        {row.kind === "topic" && count ? <> {count}</> : null}
      </div>
      {open && row.arriving ? (
        <div className="pl-3">
          {row.arriving.map((thread) => (
            <div
              key={thread.id}
              className="truncate text-[12px] text-muted-foreground"
            >
              <span aria-hidden className="ws-preview-ring" />
              {thread.title}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
