/**
 * What accepting a suggestion would change: one line per move, "topic now →
 * topic after", with the threads making that move listed beneath it.
 */
import type {
  ChangeMove,
  ChangeOp,
  SuggestionChange,
  TopicPlace,
} from "../../domain/suggestion-change.ts";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
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
  if (change.op === "create" && change.moves.some((move) => move.from))
    return "New parent topic";
  return OPERATION[change.op];
}

export function SuggestionChangeMoves({
  change,
}: {
  change: SuggestionChange;
}) {
  return (
    <ul
      aria-label="Changes"
      className="space-y-2.5 rounded-lg bg-muted/40 px-3 py-2.5"
    >
      {change.moves.map((move, index) => (
        <li key={index}>
          <MoveLine move={move} />
          {move.threads.length ? (
            <ul aria-label="Threads" className="mt-1.5 flex flex-wrap gap-1.5">
              {move.threads.map((thread) => (
                <li key={thread.id} className="flex min-w-0 max-w-full">
                  <ActivityThreadLink
                    threadId={thread.id}
                    fallback={thread.title}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function MoveLine({ move }: { move: ChangeMove }) {
  // Unfiled threads move from no topic; a topic made on its own has no
  // `from` and shows only where it goes.
  const from = move.from ?? (move.threads.length ? "Unfiled" : null);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      {from !== null ? (
        <>
          <span className="sr-only">From </span>
          <Path place={from} side="from" />
          <Icon
            name="ArrowRight"
            fallback="ChevronRight"
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="sr-only">to </span>
        </>
      ) : null}
      <Path place={move.to} side="to" />
      {move.carried ? (
        <span className="text-muted-foreground">
          with {move.carried} {move.carried === 1 ? "thread" : "threads"}
        </span>
      ) : null}
    </p>
  );
}

/** A topic path with its ancestors dimmed, the new topics in it marked. */
function Path({
  place,
  side,
}: {
  place: TopicPlace | "Unfiled";
  side: "from" | "to";
}) {
  if (place === "Unfiled" || place.length === 0)
    return (
      <span className="text-muted-foreground">
        {place === "Unfiled" ? place : "Top level"}
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
            {part.created ? (
              <span className="ml-1 inline-block rounded border border-border px-1 py-px align-[1px] text-[10px] font-medium leading-none text-muted-foreground">
                New
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
