/**
 * The thread Info tab and thread context card's "Workstreams Debug"
 * section: the metadata Workstreams generated and accumulated for the
 * thread — the settled goal, the context digest, the topic assignment and
 * its provenance, and the latest analysis run's status, model, and age.
 * Debug mode only; the slots are feature-detected, so bb builds without
 * them skip the registrations.
 */
import type { ReactNode } from "react";
import {
  experimental_InfoSection as InfoSection,
  type ExperimentalThreadContextCardProps,
} from "@get-bb/plugin-sdk/app";
import { relativeAge } from "../../domain/presentation.ts";
import { useSharedServerStateSelector } from "../serverState.ts";
import { useDebugMode } from "./debug.ts";

function Entry({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-0.5 text-xs" data-ws-context-debug-entry={label}>
      <span className="text-muted-foreground">{label}: </span>
      <span className="break-words">{children}</span>
    </div>
  );
}

const PROVENANCE_TITLE: Record<string, string> = {
  manual: "set by you",
  inherited: "inherited",
  full: "settled by Full analysis",
  quick: "guessed by Quick analysis",
};

function DebugEntries({ threadId }: { threadId: string }) {
  const analysis = useSharedServerStateSelector(
    (server) => server.analysis[threadId],
  );
  const assignment = useSharedServerStateSelector(
    (server) => server.catalog?.assignments?.[threadId],
  );
  if (!analysis && !assignment)
    return (
      <div className="py-0.5 text-xs text-muted-foreground">
        No analysis recorded for this thread.
      </div>
    );
  return (
    <div data-ws-context-debug>
      {analysis?.threadGoal ? (
        <Entry label="Goal">{analysis.threadGoal}</Entry>
      ) : null}
      {analysis?.digest ? (
        <Entry label="Digest">{analysis.digest}</Entry>
      ) : null}
      {assignment ? (
        <Entry label="Topic">
          {assignment.status === "unresolved"
            ? "Unresolved"
            : (assignment.label ?? "No topic")}
          {assignment.provenance
            ? ` (${PROVENANCE_TITLE[assignment.provenance] ?? assignment.provenance})`
            : ""}
        </Entry>
      ) : null}
      {analysis?.goal ? (
        <Entry label="Settled title">{analysis.goal}</Entry>
      ) : null}
      {analysis ? (
        <Entry label="Status">
          {analysis.state}
          {analysis.needsYou ? ` — ${analysis.needsYou}` : ""} (
          {analysis.reported ? "reported by the agent" : "inferred"})
        </Entry>
      ) : null}
      {analysis ? (
        <Entry label="Analyzed">
          {relativeAge(analysis.at, Date.now())} by {analysis.model}
        </Entry>
      ) : null}
      {analysis?.topicError ? (
        <Entry label="Topic error">{analysis.topicError}</Entry>
      ) : null}
    </div>
  );
}

/** The thread context card draws the section title itself. */
export function ThreadContextDebugSection({
  threadId,
}: ExperimentalThreadContextCardProps) {
  const debug = useDebugMode();
  if (!debug) return null;
  return <DebugEntries threadId={threadId} />;
}

/** The Info tab's sections render their own chrome. */
export function ThreadInfoDebugSection({
  threadId,
}: ExperimentalThreadContextCardProps) {
  const debug = useDebugMode();
  if (!debug) return null;
  return (
    <InfoSection label="Workstreams Debug">
      <DebugEntries threadId={threadId} />
    </InfoSection>
  );
}
