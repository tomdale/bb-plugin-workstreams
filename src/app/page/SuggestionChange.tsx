/**
 * What accepting a suggestion would change, one row per thread or topic: the
 * item, the topic holding it now, and the topic it would move to. Columns
 * share one template, so rows line up across every suggestion in the list.
 */
import { useState } from "react";
import type {
  ChangeOp,
  ChangeRow,
  SuggestionChange,
  TopicPlace,
} from "../../domain/suggestion-change.ts";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { TAG_ICON } from "../workstream-icon.ts";
import { ActivityThreadLink } from "./ActivityThreadLink.tsx";
import { ghostButton } from "./controls.ts";

/** Rows shown before "Show more", so a big split stays one glance tall. */
const ROWS_SHOWN = 5;

const OPERATION: Record<ChangeOp, string> = {
  refile: "Refile thread",
  split: "Split topic",
  file: "File threads in subtopics",
  merge: "Merge topics",
  reparent: "Move topic",
  rename: "Rename topic",
  create: "New topic",
};

/** The operation a suggestion performs, as its heading. */
export function changeHeading(change: SuggestionChange): string {
  if (change.op === "create" && change.rows.some((row) => row.from !== null))
    return "New parent topic";
  return OPERATION[change.op];
}

export function SuggestionChangeRows({ change }: { change: SuggestionChange }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = expanded ? 0 : Math.max(0, change.rows.length - ROWS_SHOWN);
  const rows = hidden ? change.rows.slice(0, ROWS_SHOWN) : change.rows;
  return (
    <div className="@container/change">
      <ul
        aria-label="Changes"
        className="grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_auto_minmax(0,4fr)] items-center gap-x-3 gap-y-1.5 text-xs @max-[30rem]/change:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @max-[30rem]/change:gap-y-1"
      >
        {rows.map((row, index) => (
          <li
            key={row.kind === "thread" ? row.id : `${row.name}:${index}`}
            className="col-span-full grid grid-cols-subgrid items-center @max-[30rem]/change:pt-1"
          >
            <div className="min-w-0 @max-[30rem]/change:col-span-full">
              <Subject row={row} />
            </div>
            <Place place={row.from} row={row} side="from" />
            <Icon
              name="ArrowRight"
              fallback="ChevronRight"
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <Place place={row.to} row={row} side="to" />
          </li>
        ))}
      </ul>
      {hidden ? (
        <button
          type="button"
          className={cn(ghostButton, "mt-1 -ml-3 h-6")}
          onClick={() => setExpanded(true)}
        >
          Show {hidden} more
        </button>
      ) : null}
    </div>
  );
}

function Subject({ row }: { row: ChangeRow }) {
  if (row.kind === "thread")
    return (
      <div className="flex min-w-0">
        <ActivityThreadLink threadId={row.id} fallback={row.title} />
      </div>
    );
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Icon
        name={TAG_ICON}
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 truncate font-medium text-foreground">
        <span className="sr-only">Topic </span>
        {row.name}
      </span>
      {row.created ? <NewBadge /> : null}
      {row.threads > 0 ? (
        <span className="shrink-0 text-muted-foreground">
          {row.threads} {row.threads === 1 ? "thread" : "threads"}
        </span>
      ) : null}
    </div>
  );
}

/** Where a row's item sits on one side of the change. */
function Place({
  place,
  row,
  side,
}: {
  place: TopicPlace | null;
  row: ChangeRow;
  side: "from" | "to";
}) {
  const label = (
    <span className="sr-only">{side === "from" ? "now in" : "moves to"} </span>
  );
  const quiet = (text: string) => (
    <span className="min-w-0 text-muted-foreground">
      {label}
      {text}
    </span>
  );
  // Only a thread is Unfiled; a topic is nowhere before a suggestion makes it.
  if (place === null) return quiet(row.kind === "thread" ? "Unfiled" : "—");
  if (place.length === 0) return quiet("Top level");
  return (
    <span className="min-w-0 break-words">
      {label}
      {place.map((part, index) => {
        const last = index === place.length - 1;
        return (
          <span key={index}>
            {index > 0 ? (
              <span aria-hidden className="text-muted-foreground/60">
                {" › "}
              </span>
            ) : null}
            <span
              className={cn(
                !last
                  ? "text-muted-foreground/70"
                  : side === "to"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
              )}
            >
              {part.name}
            </span>
            {part.created ? <NewBadge /> : null}
          </span>
        );
      })}
    </span>
  );
}

function NewBadge() {
  return (
    <span className="ml-1 inline-block shrink-0 rounded bg-muted px-1 py-px align-[1px] text-[10px] font-medium leading-none text-muted-foreground">
      New
    </span>
  );
}
