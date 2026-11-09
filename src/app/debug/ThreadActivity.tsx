import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { relativeAge } from "../../domain/presentation.ts";
import { TRACE_KIND_TITLE, type TraceSummary } from "../../domain/trace.ts";
import type { RpcContract } from "../../server/contract.ts";
import type { JournalEntry } from "../../server/journal.ts";
import { shareJson } from "../structuralSharing.ts";
import type { InspectTarget } from "./debug.ts";
import { TraceInspector } from "./Inspector.tsx";

const ACTION_LABEL: Record<JournalEntry["action"], string> = {
  move: "Move",
  "create-workstream": "New workstream",
  "rename-workstream": "Rename",
  "delete-workstream": "Delete",
  undo: "Undo",
  batch: "Reorganize",
  categories: "Categories",
  "edit-workstream": "Edit",
  "project-association": "Project",
  route: "New thread",
  retitle: "Updated title",
  "remove-topic": "Removed topic",
  suggestion: "Suggestion",
};

type ActivityResult = {
  entries: JournalEntry[];
  traces: TraceSummary[];
};

type ActivityItem = {
  key: string;
  at: number;
  label: string;
  detail: string;
  failed: boolean;
  target: InspectTarget;
};

const FULL_ANALYSIS_OUTCOMES: Record<string, string> = {
  review: "ready for review",
  "needs decision": "needs your decision",
  blocked: "blocked",
  "in progress": "in progress",
  reported: "reported by the agent",
  done: "done",
};

function traceDetail(trace: TraceSummary): string {
  if (trace.error) return trace.error;
  const summary = trace.summary?.split(" · ")[0];
  if (!summary) return trace.label;
  const outcome =
    trace.kind === "full-analysis"
      ? FULL_ANALYSIS_OUTCOMES[summary]
      : undefined;
  return outcome ? `Work status: ${outcome}` : summary;
}

function itemsOf(result: ActivityResult | null): ActivityItem[] {
  if (!result) return [];
  return [
    ...result.entries.map((entry) => ({
      key: `entry:${entry.id}`,
      at: entry.at,
      label: ACTION_LABEL[entry.action],
      detail: entry.rationale,
      failed: entry.status === "failed" || entry.status === "partial",
      target: {
        link: { kind: "entry", ref: entry.id },
      } satisfies InspectTarget,
    })),
    ...result.traces.map((trace) => ({
      key: `trace:${trace.id}`,
      at: trace.at,
      label: TRACE_KIND_TITLE[trace.kind],
      detail: traceDetail(trace),
      failed: trace.status !== "ok",
      target: { traceIds: [trace.id] } satisfies InspectTarget,
    })),
  ].sort((a, b) => b.at - a.at);
}

/*
 * The thread-scoped activity list sits below Workstreams' accumulated metadata.
 * It reuses the trace inspector rather than duplicating prompt and response
 * rendering in the narrower Info tab and context card.
 */
export function ThreadActivity({
  threadId,
  surface,
}: {
  threadId: string;
  surface: "card" | "info";
}) {
  const rpc = useRpc<RpcContract>();
  const [result, setResult] = useState<ActivityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ActivityItem | null>(null);
  const [open, setOpen] = useState(false);
  const generation = useRef(0);
  const active = useRef<Promise<void> | null>(null);
  const trailing = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);

  const load = useCallback((): Promise<void> => {
    if (active.current) {
      trailing.current = true;
      return active.current;
    }
    const request = ++generation.current;
    const running = (async () => {
      try {
        const next = await rpc.call("threadActivity", { threadId });
        if (request !== generation.current) return;
        setResult((previous) => shareJson(previous, next));
        setError(null);
      } catch (cause) {
        if (request === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    active.current = running;
    void running.then(() => {
      if (active.current !== running) return;
      active.current = null;
      if (!trailing.current) return;
      trailing.current = false;
      void load();
    });
    return running;
  }, [rpc, threadId]);

  useEffect(() => {
    setResult(null);
    setError(null);
    void load();
    return () => {
      generation.current++;
      active.current = null;
      trailing.current = false;
    };
  }, [load]);

  useRealtime(
    "changed",
    useCallback(() => {
      void load();
    }, [load]),
  );

  const items = useMemo(() => itemsOf(result), [result]);
  const now = Date.now();

  return (
    <div
      className={cn("mt-4", surface === "card" && "px-2")}
      data-ws-thread-activity
    >
      <h4
        ref={heading}
        tabIndex={-1}
        className="mb-1 px-1 text-xs font-medium text-muted-foreground"
      >
        Activity
      </h4>
      {error ? (
        <p role="alert" className="px-1 py-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {!result && !error ? (
        <p className="px-1 py-1 text-xs text-muted-foreground">
          Loading activity…
        </p>
      ) : null}
      {result && items.length === 0 && !error ? (
        <p className="px-1 py-1 text-xs text-muted-foreground">
          No activity recorded for this thread.
        </p>
      ) : null}
      <ul
        aria-label="Thread activity"
        className="mt-1 divide-y divide-border/60"
      >
        {items.map((item) => {
          const date = new Date(item.at);
          return (
            <li key={item.key}>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open && selected?.key === item.key}
                onClick={(event) => {
                  returnFocus.current = event.currentTarget;
                  setSelected(item);
                  setOpen(true);
                }}
                className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-sm px-1 py-2 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {item.label}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block break-words text-xs text-muted-foreground",
                      item.failed && "text-destructive",
                    )}
                  >
                    {item.detail}
                  </span>
                </span>
                <time
                  dateTime={date.toISOString()}
                  aria-label={date.toLocaleString()}
                  className="min-w-7 pt-0.5 text-right text-[11px] tabular-nums text-muted-foreground"
                >
                  {relativeAge(item.at, now)}
                </time>
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? (
        <TraceInspector
          open={open}
          onOpenChange={setOpen}
          target={selected.target}
          title={`${selected.label}: ${selected.detail}`}
          returnFocus={() => {
            const button = returnFocus.current;
            if (button?.isConnected) button.focus();
            else heading.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
