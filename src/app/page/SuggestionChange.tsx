/**
 * What a suggestion changes, below its headline. A suggestion moving several
 * threads lists each destination group once, with the threads that go there;
 * anything else is one "group now → group after" line. Each moving thread
 * appears once.
 */
import type {
  ChangeMove,
  SuggestionChange,
  TopicPlace,
} from "../../domain/suggestion-change.ts";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

export function SuggestionChangeBody({ change }: { change: SuggestionChange }) {
  const threads = change.moves.reduce((n, m) => n + m.threads.length, 0);
  const destinations =
    (change.op === "split" || change.op === "file") && threads > 1;
  return destinations ? (
    <Destinations moves={change.moves} />
  ) : (
    <div className="space-y-1">
      {change.moves.map((move, index) => (
        <MoveLine key={index} move={move} listThreads={change.op === "merge"} />
      ))}
    </div>
  );
}

/** One row per destination group: its name, then the threads going there. */
function Destinations({ moves }: { moves: readonly ChangeMove[] }) {
  const rows = new Map<
    string,
    { to: TopicPlace; threads: { title: string; from: string | null }[] }
  >();
  for (const move of moves) {
    const key = JSON.stringify(move.to);
    const row = rows.get(key) ?? { to: move.to, threads: [] };
    // A thread from somewhere other than the group being split says so.
    const elsewhere =
      JSON.stringify(move.from) !== JSON.stringify(move.to.slice(0, -1));
    for (const thread of move.threads)
      row.threads.push({
        title: thread.title,
        from: elsewhere ? (move.from?.at(-1)?.name ?? "Unfiled") : null,
      });
    rows.set(key, row);
  }
  return (
    <ul className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {[...rows.values()].map(({ to, threads }) => {
        const group = to.at(-1)!;
        return (
          <li
            key={JSON.stringify(to)}
            className="col-span-full grid grid-cols-subgrid"
          >
            <span className="font-medium text-foreground">
              <span
                aria-hidden
                className="inline-block w-3 text-muted-foreground"
              >
                {group.created ? "+" : ""}
              </span>
              {group.name}
              {group.created ? (
                <span className="sr-only"> (new group)</span>
              ) : null}
            </span>
            <span className="text-muted-foreground">
              {threads.map((thread, i) => (
                <span key={i}>
                  {i > 0 ? <span aria-hidden> · </span> : null}
                  {thread.title}
                  {thread.from ? (
                    <span className="text-muted-foreground/70">
                      {" "}
                      (from {thread.from})
                    </span>
                  ) : null}
                </span>
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MoveLine({
  move,
  listThreads,
}: {
  move: ChangeMove;
  listThreads: boolean;
}) {
  // A topic made on its own has no `from` and shows only where it goes.
  const from = move.from ?? (move.threads.length ? "Unfiled" : null);
  return (
    <div className="text-xs">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
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
            · {move.carried} {move.carried === 1 ? "thread" : "threads"} move
            with it
          </span>
        ) : null}
      </p>
      {listThreads && move.threads.length ? (
        <p className="mt-0.5 text-muted-foreground">
          {move.threads.map((t) => t.title).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

/** A group path, its ancestors dimmed; a group accepting creates is marked. */
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
              <span className="text-muted-foreground"> (new)</span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
