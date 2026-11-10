/**
 * A suggestion drawn as the sidebar rows it touches: as they are, an arrow,
 * and as they would be after accepting (`suggestionPreview` in the domain).
 * Workstreams are bold and threads wear a ring, as in the sidebar; nested
 * rows hang from their parent on a └ guide. A row that leaves is crossed out
 * in red, one that lands, appears or changes is green, and counts are
 * visible threads. A landing row's count opens the threads that arrive.
 */
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type {
  PreviewRow,
  SuggestionPreview as Preview,
} from "../../domain/suggestion-preview.ts";

export function SuggestionPreview({ preview }: { preview: Preview }) {
  return (
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-center leading-[18px]">
      <Side rows={preview.before} />
      <Icon
        name="ArrowRight"
        className="size-3.5 justify-self-center text-muted-foreground"
        aria-hidden
      />
      <Side rows={preview.after} />
    </div>
  );
}

function Side({ rows }: { rows: readonly PreviewRow[] }) {
  return (
    <div className="min-w-0">
      {rows.map((row, index) => (
        <Row key={index} row={row} />
      ))}
    </div>
  );
}

const plural = (n: number) => (n === 1 ? "1 thread" : `${n} threads`);

function Row({ row }: { row: PreviewRow }) {
  const [open, setOpen] = useState(false);
  const tone =
    row.mark === "gone"
      ? "text-(--ws-failure-text) line-through decoration-1"
      : row.mark === "new"
        ? "text-(--ws-complete-text)"
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
        className="ws-preview-count -mx-0.5 cursor-pointer rounded px-0.5 text-[11px] tabular-nums text-(--ws-complete-text) underline decoration-dotted underline-offset-2 hover:bg-state-hover"
      >
        {row.count}
      </button>
    ) : (
      <span
        className={cn(
          "text-[11px] tabular-nums text-muted-foreground",
          row.mark === "new" && "text-(--ws-complete-text)",
        )}
      >
        {row.count}
      </span>
    );
  return (
    <div
      className={cn(
        "min-w-0",
        row.depth === 1 && "ws-preview-nest",
        row.depth === 1 && row.mark === "new" && "ws-preview-nest-new",
      )}
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
