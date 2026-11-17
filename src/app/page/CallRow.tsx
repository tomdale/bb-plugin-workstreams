import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  TRACE_KIND_TITLE,
  TRACE_STATUS_TITLE,
  type TraceKind,
  type TraceSummary,
} from "../../domain/trace.ts";
import { InspectButton } from "../debug/InspectButton.tsx";
import { DebugThreadButton } from "../debug/DebugThreadButton.tsx";
import { modelCallSubject } from "../debug/subjects.ts";
import { ActivityTerm } from "./ActivityTerm.tsx";
import { ActivityThreadLink } from "./ActivityThreadLink.tsx";

const EVENT: Record<TraceKind, { label: string; description: string }> = {
  start: {
    label: "New thread",
    description:
      "From a draft in the composer or a thread's first request, the model titled the thread and, unless it is a child thread, chose its workstream or proposed a new one. The turn's end settles both later.",
  },
  "turn-end": {
    label: "Turn end",
    description:
      "After a turn ended, the model settled the thread's goal and title, its status when the agent didn't report one, and after a new request its workstream. This is an assessment, not proof that a change was applied.",
  },
  categories: {
    label: "Categories",
    description:
      "The model assessed the workstream's current threads and proposed an arrangement into contextual categories. No thread changes workstream.",
  },
  "category-fit": {
    label: "Category check",
    description:
      "The model checked whether threads that arrived in the workstream, or whose work changed, fit its current categories. When one didn't, the categories were rearranged.",
  },
  split: {
    label: "Split suggestion",
    description:
      "The model assessed whether a top-level workstream splits into lasting workstreams, and where each thread would go, for you to accept or decline.",
  },
  tidy: {
    label: "Suggested changes",
    description:
      "The model proposed changes to your workstreams and groups, each with a reason, for you to accept or decline.",
  },
  "workstream-choice": {
    label: "Workstream choice",
    description:
      "The model chose the thread's workstream on its own: within a group you dropped it on, for a preview of automatic moves, or for a thread that had none.",
  },
};
const STATES: Record<string, { label: string; description: string }> = {
  "needs-input": {
    label: "Needs input",
    description:
      "The model found a specific question, choice, or permission request for you, or requested work the turn left unfinished.",
  },
  blocked: {
    label: "Blocked",
    description:
      "The model judged that the agent likely can't continue unless you step in, for example to grant access or fix the environment.",
  },
  review: {
    label: "Ready for review",
    description:
      "A deliverable is ready for you to review, test, merge, or ship.",
  },
  reported: {
    label: "Reported by the agent",
    description:
      "The thread's agent reported how the turn ended, so the model wasn't asked for its status.",
  },
  complete: {
    label: "Complete",
    description:
      "The model judged that the latest request is complete with no outstanding tasks. This is an assessment, not independent verification.",
  },
};

function CallResult({ trace }: { trace: TraceSummary }) {
  if (trace.status !== "ok")
    return (
      <div className="mt-1 text-xs text-destructive">
        <ActivityTerm
          label={TRACE_STATUS_TITLE[trace.status]}
          description={
            trace.status === "invalid"
              ? "The model responded, but its output could not be validated. Workstreams did not use the result."
              : "The request to the model failed before producing a usable result."
          }
        />
        {trace.error ? <p className="mt-1 break-words">{trace.error}</p> : null}
      </div>
    );
  if (!trace.summary)
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Completed · No result summary recorded
      </p>
    );
  // Turn-end summaries start with a known status label. Unknown formats
  // stay intact under Model result rather than being interpreted.
  const [state, ...parts] = trace.summary.split(" · ");
  const lifecycle = trace.kind === "turn-end" ? STATES[state!] : undefined;
  const suggestions = parts.filter((part) => part.startsWith("goal "));
  const subject = parts
    .filter((part) => !suggestions.includes(part))
    .join(" · ");
  if (!lifecycle)
    return (
      <p className="mt-1 break-words text-xs">
        <span className="text-muted-foreground">Model result: </span>
        {trace.summary.replace(/(^| · )goal /g, "$1Title: ")}
      </p>
    );
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span>
        <span className="text-muted-foreground">Work status: </span>
        <ActivityTerm {...lifecycle} />
      </span>
      {subject ? (
        <span className="break-words">
          <span className="text-muted-foreground">Workstream: </span>
          {subject}
        </span>
      ) : null}
      {suggestions.length ? (
        <p className="w-full break-words">
          <span className="text-muted-foreground">Title: </span>
          {suggestions.join(" · ").replace(/(^| · )goal /g, "$1")}
        </p>
      ) : null}
    </div>
  );
}

export const CallRow = memo(function CallRow({
  trace,
}: {
  trace: TraceSummary;
}) {
  const event = EVENT[trace.kind];
  const time = useMemo(() => {
    const date = new Date(trace.at);
    const localized = date.toLocaleString();
    return {
      iso: date.toISOString(),
      localized,
      clock: date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }, [trace.at]);
  return (
    <li
      className={cn(
        "grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 rounded-md bg-state-hover/30 py-3 pl-2 pr-2 text-sm sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-3",
        trace.status !== "ok" && "bg-destructive/5",
      )}
    >
      <time
        className="pt-0.5 text-xs tabular-nums text-muted-foreground"
        dateTime={time.iso}
        title={time.localized}
        aria-label={time.localized}
      >
        {time.clock}
      </time>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground">
          <ActivityTerm {...event} />
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px]">
            Model
          </span>
          {trace.replayOf ? (
            <ActivityTerm
              label="Replay"
              description="The recorded prompt was run again for comparison. A replay does not change Workstreams state."
            />
          ) : null}
        </div>
        <div className="mt-1 break-words font-medium text-foreground">
          {trace.label === TRACE_KIND_TITLE[trace.kind] ? (
            <span className="font-normal text-muted-foreground">
              No request text recorded
            </span>
          ) : (
            trace.label
          )}
        </div>
        <CallResult trace={trace} />
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            Technical details
          </summary>
          <dl className="mt-2 grid grid-cols-1 gap-y-1 rounded-md bg-state-hover/40 p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
            <dt>Model</dt>
            <dd className="break-all" translate="no">
              {trace.model}
            </dd>
            <dt>Duration</dt>
            <dd className="tabular-nums">
              {(trace.durationMs / 1000).toFixed(1)} seconds
            </dd>
            <dt>
              <ActivityTerm
                label="Input tokens"
                description="Units of text sent to the model, including the prompt and context. Token counts measure model usage, not words."
              />
            </dt>
            <dd className="tabular-nums">
              {trace.usage
                ? trace.usage.input.toLocaleString()
                : "Not reported"}
            </dd>
            <dt>
              <ActivityTerm
                label="Output tokens"
                description="Units of text generated by the model in its response."
              />
            </dt>
            <dd className="tabular-nums">
              {trace.usage
                ? trace.usage.output.toLocaleString()
                : "Not reported"}
            </dd>
            <dt>Reported cost</dt>
            <dd className="tabular-nums">
              {trace.usage && trace.usage.cost !== null
                ? new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: "USD",
                    minimumFractionDigits: 4,
                  }).format(trace.usage.cost)
                : "Not reported"}
            </dd>
          </dl>
          {trace.threads.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span>Related threads:</span>
              {trace.threads.map((id) => (
                <ActivityThreadLink key={id} threadId={id} />
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-1">
            <span>Inspect prompt &amp; response</span>
            <InspectButton
              target={{ traceIds: [trace.id] }}
              title={`${TRACE_KIND_TITLE[trace.kind]}: ${trace.label}`}
              label="Inspect this model call"
            />
            <DebugThreadButton subject={modelCallSubject(trace)} />
          </div>
        </details>
      </div>
    </li>
  );
});
