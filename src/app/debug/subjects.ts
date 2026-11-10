/**
 * What each surface tells a debug thread about the result the user clicked.
 * One builder per family keeps the wording of the brief in one place, so a
 * suggestion reads the same whether it was clicked in the sidebar or in
 * Topics.
 */
import type { StoredAnalysis } from "../../domain/analysis.ts";
import type { DebugSubject } from "../../domain/debug-thread.ts";
import { workStateLabel } from "../../domain/presentation.ts";
import { changeLines } from "../../domain/suggestion-change.ts";
import type { TraceSummary } from "../../domain/trace.ts";
import type { TopicAssignment } from "../../domain/topics.ts";
import type { Preview } from "../../server/preview.ts";
import type { ProjectSuggestion } from "../../server/projectAssociations.ts";
import type { SuggestionsStateWire } from "../../server/contract.ts";
import type { ActivityEntry } from "../page/activityLoader.ts";

type Suggestion = SuggestionsStateWire["suggestions"][number];

const PROVENANCE: Record<string, string> = {
  manual: "set by the user",
  inherited: "inherited from the workstream's parent",
  full: "settled by Full analysis",
  quick: "guessed by Quick analysis",
};

const STATUS: Record<Suggestion["status"], string> = {
  pending: "waiting for a decision",
  accepted: "accepted",
  declined: "declined",
  stale: "out of date, so nothing it names is left to change",
};

/**
 * An organizing suggestion, as the sidebar and Topics click it. `where` names
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
          suggestion.kind === "split" ? "Split of a workstream" : "Tidy edit",
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
      : "New thread with no topic yet",
    facts: [
      { label: "Request", value: request },
      ...(decision.goal
        ? [{ label: "Title it would start with", value: decision.goal }]
        : []),
      {
        label: "Outcome",
        value: `${decision.subject ?? "no topic yet"} · ${decision.confidence} confidence`,
      },
      { label: "Reason the model gave", value: decision.reason || "none" },
      ...(decision.explanation?.notes.length
        ? [{ label: "Steps", value: decision.explanation.notes.join("\n") }]
        : []),
    ],
    calls: { traceIds: [decision.traceId] },
  };
}

/** A thread's analysis: the workstream it filed it under and its status. */
export function analysisSubject({
  threadId,
  analysis,
  assignment,
}: {
  threadId: string;
  analysis: StoredAnalysis;
  assignment?: TopicAssignment;
}): DebugSubject {
  return {
    surface: "A thread's Info tab and context card",
    headline:
      analysis.goal ?? analysis.threadGoal ?? `Thread ${threadId} analysis`,
    facts: [
      { label: "Thread", value: threadId },
      ...(assignment
        ? [
            {
              label: "Workstream",
              value:
                assignment.status === "unresolved"
                  ? "Unresolved"
                  : `${assignment.label ?? "no topic yet"}${
                      assignment.provenance
                        ? ` (${PROVENANCE[assignment.provenance] ?? assignment.provenance})`
                        : ""
                    }`,
            },
          ]
        : []),
      ...(analysis.topicError
        ? [{ label: "Topic error", value: analysis.topicError }]
        : []),
      ...(analysis.goal
        ? [{ label: "Settled title", value: analysis.goal }]
        : []),
      ...(analysis.threadGoal
        ? [{ label: "Goal", value: analysis.threadGoal }]
        : []),
      ...(analysis.digest ? [{ label: "Digest", value: analysis.digest }] : []),
      {
        label: "Status",
        value: `${workStateLabel(analysis.state, analysis.reported ?? false)}${
          analysis.needsYou ? `: ${analysis.needsYou}` : ""
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

/** A project association Workstreams proposed for a topic. */
export function projectSuggestionSubject(
  suggestion: ProjectSuggestion,
): DebugSubject {
  return {
    surface: "Project associations in Topics",
    headline: `${suggestion.topic}: ${suggestion.fromProject} → ${suggestion.toProject ?? "no project"}`,
    facts: [
      { label: "Workstream", value: suggestion.topic },
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
