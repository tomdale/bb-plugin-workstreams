/**
 * What each surface tells a debug thread about the result the user clicked.
 * One builder per family keeps the wording of the brief in one place, so a
 * suggestion reads the same whether it was clicked in the sidebar or in
 * Workstreams.
 */
import type { StoredAnalysis } from "../../domain/analysis.ts";
import type { DebugSubject } from "../../domain/debug-thread.ts";
import { workStateLabel } from "../../domain/presentation.ts";
import { changeLines } from "../../domain/suggestion-change.ts";
import type { TraceSummary } from "../../domain/trace.ts";
import type { WorkstreamAssignment } from "../../domain/workstreams.ts";
import type { Preview } from "../../server/preview.ts";
import type { ProjectSuggestion } from "../../server/projectAssociations.ts";
import type { SuggestionsStateWire } from "../../server/contract.ts";
import type { ActivityEntry } from "../page/activityLoader.ts";

type Suggestion = SuggestionsStateWire["suggestions"][number];

const PROVENANCE: Record<string, string> = {
  manual: "set by the user",
  inherited: "inherited from where the thread started",
  full: "chosen automatically from its requests",
  quick: "shown by the composer for an earlier draft",
};

const STATUS: Record<Suggestion["status"], string> = {
  pending: "waiting for a decision",
  accepted: "accepted",
  declined: "declined",
  stale: "out of date, so nothing it names is left to change",
};

/**
 * An organizing suggestion, as the sidebar and Workstreams click it. `where` names
 * the list it was clicked in, since the same suggestion shows in both.
 */
export function suggestionSubject(
  suggestion: Suggestion,
  where: string,
): DebugSubject {
  const moves = suggestion.change
    ? changeLines(suggestion.change)
    : [suggestion.summary];
  return {
    surface: `Organizing suggestions in ${where}`,
    headline: suggestion.headline,
    facts: [
      { label: "Suggestion", value: suggestion.headline },
      {
        label: "Kind",
        value:
          suggestion.kind === "split"
            ? "Split of a workstream"
            : "Suggested change",
      },
      { label: "Status", value: STATUS[suggestion.status] },
      { label: "Reason the model gave", value: suggestion.reason },
      { label: "What accepting it does", value: moves.join("\n") },
      ...(suggestion.problem
        ? [{ label: "Why it can't apply now", value: suggestion.problem }]
        : []),
      ...(suggestion.arrivals.length
        ? [
            {
              label: "Threads that joined since",
              value: suggestion.arrivals.map((t) => t.title).join(", "),
            },
          ]
        : []),
    ],
    calls: { traceIds: [suggestion.traceId] },
  };
}

/** The composer's preview of where a draft would start. */
export function draftSubject(decision: Preview, request: string): DebugSubject {
  return {
    surface: "The new-thread composer's routing preview",
    headline: decision.subject
      ? `New thread routed to ${decision.subject}`
      : "New thread with no workstream yet",
    facts: [
      { label: "Request", value: request },
      ...(decision.title
        ? [{ label: "Title it would start with", value: decision.title }]
        : []),
      {
        label: "Outcome",
        value: `${decision.subject ?? "no workstream yet"} · ${decision.confidence} confidence`,
      },
      { label: "Reason the model gave", value: decision.reason || "none" },
      ...(decision.explanation?.notes.length
        ? [{ label: "Steps", value: decision.explanation.notes.join("\n") }]
        : []),
    ],
    calls: { traceIds: [decision.traceId] },
  };
}

/** A thread's analysis: the workstream it chose and its status. */
export function analysisSubject({
  threadId,
  analysis,
  assignment,
}: {
  threadId: string;
  analysis: StoredAnalysis;
  assignment?: WorkstreamAssignment;
}): DebugSubject {
  return {
    surface: "A thread's Info tab and context card",
    headline: analysis.title ?? analysis.goal ?? `Thread ${threadId} analysis`,
    facts: [
      { label: "Thread", value: threadId },
      ...(assignment
        ? [
            {
              label: "Workstream",
              value:
                assignment.status === "none"
                  ? "No workstream"
                  : `${assignment.label ?? "no workstream yet"}${
                      assignment.provenance
                        ? ` (${PROVENANCE[assignment.provenance] ?? assignment.provenance})`
                        : ""
                    }`,
            },
          ]
        : []),
      ...(analysis.workstreamError
        ? [{ label: "Workstream error", value: analysis.workstreamError }]
        : []),
      ...(analysis.title
        ? [{ label: "Settled title", value: analysis.title }]
        : []),
      ...(analysis.goal ? [{ label: "Goal", value: analysis.goal }] : []),
      ...(analysis.digest ? [{ label: "Digest", value: analysis.digest }] : []),
      {
        label: "Status",
        value: `${workStateLabel(analysis.state)}${
          analysis.ask ? `: ${analysis.ask}` : ""
        } (${analysis.reported ? "reported by the agent" : "inferred"})`,
      },
      {
        label: "Analyzed",
        value: `${new Date(analysis.at).toLocaleString()} by ${analysis.model}`,
      },
    ],
    calls: { traceIds: [analysis.traceId] },
  };
}

/** One Activity entry: a change Workstreams recorded, and the calls behind it. */
export function activityEntrySubject(
  entry: ActivityEntry,
  action: string,
  source: string,
  status: string,
): DebugSubject {
  return {
    surface: "Activity",
    headline: `${action}: ${entry.rationale}`,
    facts: [
      { label: "Change", value: action },
      { label: "What happened", value: entry.rationale },
      ...(entry.detail ? [{ label: "Detail", value: entry.detail }] : []),
      { label: "Recorded as", value: `${status} · from ${source}` },
      ...(entry.threads.length
        ? [
            {
              label: "Threads",
              value: entry.threads
                .map((thread) => `${thread.name} (${thread.id})`)
                .join("\n"),
            },
          ]
        : []),
      { label: "Activity entry", value: entry.id },
    ],
    // An entry links the calls behind it; a few carry their ids in the list.
    calls: entry.traceIds?.length
      ? { traceIds: entry.traceIds }
      : { link: { kind: "entry", ref: entry.id } },
  };
}

/** One recorded model call, as Activity or a thread's Info tab lists it. */
export function modelCallSubject(trace: TraceSummary): DebugSubject {
  return {
    surface: "Activity",
    headline: `${trace.label}`,
    facts: [
      { label: "Call", value: trace.label },
      { label: "Status", value: trace.status },
      ...(trace.summary
        ? [{ label: "Model's answer", value: trace.summary }]
        : []),
      ...(trace.error ? [{ label: "Error", value: trace.error }] : []),
      { label: "Model", value: trace.model },
      {
        label: "Ran",
        value: `${new Date(trace.at).toLocaleString()} · ${(trace.durationMs / 1000).toFixed(1)}s`,
      },
      ...(trace.threads.length
        ? [{ label: "Threads", value: trace.threads.join("\n") }]
        : []),
    ],
    calls: { traceIds: [trace.id] },
  };
}

/** A project association Workstreams proposed for a workstream. */
export function projectSuggestionSubject(
  suggestion: ProjectSuggestion,
): DebugSubject {
  return {
    surface: "Project associations in Organize",
    headline: `${suggestion.workstream}: ${suggestion.fromProject} → ${suggestion.toProject ?? "no project"}`,
    facts: [
      { label: "Workstream", value: suggestion.workstream },
      {
        label: "Change",
        value: `${suggestion.fromProject} → ${suggestion.toProject ?? "No project"}`,
      },
      { label: "Reason the model gave", value: suggestion.reason },
      {
        label: "Supporting threads",
        value: suggestion.threads
          .map((thread) => `${thread.name} (${thread.id}, ${thread.project})`)
          .join("\n"),
      },
      { label: "Suggestion", value: suggestion.id },
    ],
    // A learned association is evidence, not a model call.
    calls: { traceIds: [] },
  };
}
