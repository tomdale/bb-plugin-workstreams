/**
 * A suggestion drawn as the sidebar rows it touches: as they are, an arrow,
 * and as they would be after accepting (`suggestionPreview` in the domain).
 * Workstreams are bold and threads wear a ring, as in the sidebar; nested
 * rows hang from their parent on a └ guide. A row that leaves is dimmed and
 * crossed out; one that lands, appears or changes takes its workstream's
 * color, as the sidebar draws that workstream, and counts are visible
 * threads. A landing row's count opens the threads that arrive.
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

function Side({
  rows,
  colors,
}: {
  rows: readonly PreviewRow[];
  colors?: PreviewColors;
}) {
  return (
    <div className="min-w-0">
      {rows.map((row, index) => (
        <Row key={index} row={row} colors={colors} />
      ))}
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
    row.count === undefined ? null : row.arriving?.length ? (
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} ${plural(row.arriving.length)} arriving in ${row.name}`}
        onClick={() => setOpen(!open)}
        className="-mx-0.5 cursor-pointer rounded px-0.5 text-[11px] tabular-nums text-(--ws-preview-accent) underline decoration-dotted underline-offset-2 hover:bg-state-hover"
      >
        {row.count}
      </button>
    ) : (
      <span
        className={cn(
          "text-[11px] tabular-nums text-muted-foreground",
          landing && "text-(--ws-preview-accent)",
        )}
      >
        {row.count}
      </span>
    );
  return (
    <div
      className={cn(
        "min-w-0",
        landing && "ws-preview-accent",
        row.depth === 1 && "ws-preview-nest",
      )}
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
          {row.created ? "+ " : null}
          {row.kind === "threads"
            ? plural(row.count ?? 0)
            : row.kind === "more"
              ? `${row.count} more`
              : row.name}
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
