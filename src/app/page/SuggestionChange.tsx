/**
 * What accepting a suggestion would change. Rows that make the same move
 * share one line, "topic now → topic after", with the threads and topics
 * that make it listed below, so a split reads as a few destinations rather
 * than one line per thread.
 */
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

type Move = {
  from: TopicPlace | null;
  to: TopicPlace;
  /** What `from: null` means: Unfiled for a thread, not yet made for a topic. */
  kind: ChangeRow["kind"];
  items: ChangeRow[];
};

/** Rows grouped by the move they make, in the order they first appear. */
function moves(rows: readonly ChangeRow[]): Move[] {
  const out = new Map<string, Move>();
  for (const row of rows) {
    const key = JSON.stringify([row.from ?? row.kind, row.to]);
    const move = out.get(key);
    if (move) move.items.push(row);
    else
      out.set(key, {
        from: row.from,
        to: row.to,
        kind: row.kind,
        items: [row],
      });
  }
  return [...out.values()];
}

export function SuggestionChangeRows({ change }: { change: SuggestionChange }) {
  return (
    <div className="space-y-2.5 rounded-lg bg-muted/40 px-3 py-2.5">
      {moves(change.rows).map((move, index) => (
        <div key={index}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span className="sr-only">From </span>
            <Place place={move.from} kind={move.kind} side="from" />
            <Icon
              name="ArrowRight"
              fallback="ChevronRight"
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="sr-only">to </span>
            <Place place={move.to} kind={move.kind} side="to" />
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {move.items.map((row, i) => (
              <li
                key={row.kind === "thread" ? row.id : `${row.name}:${i}`}
                className="flex min-w-0 max-w-full"
              >
                <Item row={row} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Item({ row }: { row: ChangeRow }) {
  if (row.kind === "thread")
    return <ActivityThreadLink threadId={row.id} fallback={row.title} />;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-raised/50 py-0.5 pl-1 pr-1.5 text-xs leading-4 text-foreground">
      <Icon
        name={TAG_ICON}
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="sr-only">Topic </span>
      <span className="min-w-0 truncate">{row.name}</span>
      {row.created ? <NewBadge /> : null}
      {row.threads > 0 ? (
        <span className="shrink-0 text-muted-foreground">
          · {row.threads} {row.threads === 1 ? "thread" : "threads"}
        </span>
      ) : null}
    </span>
  );
}

/** A topic path, its ancestors dimmed; or what having none means. */
function Place({
  place,
  kind,
  side,
}: {
  place: TopicPlace | null;
  kind: ChangeRow["kind"];
  side: "from" | "to";
}) {
  if (place === null || place.length === 0)
    return (
      <span className="text-muted-foreground">
        {place ? "Top level" : kind === "thread" ? "Unfiled" : "Nowhere yet"}
      </span>
    );
  return (
    <span className="min-w-0 break-words">
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
