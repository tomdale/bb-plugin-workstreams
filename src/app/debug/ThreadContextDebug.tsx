/**
 * The thread Info tab and thread context card's "Workstreams Debug"
 * section: the metadata Workstreams generated and accumulated for the
 * thread — the settled goal, the context digest, the topic assignment and
 * its provenance, and the latest analysis run's status, model, and age.
 * Related journal events and analysis calls appear below, with the model-call
 * inspector one click away. Shown with the debug UI only; the slots are
 * feature-detected, so bb builds without them skip the registrations.
 */
import type { ReactNode } from "react";
import {
  experimental_DetailRow as DetailRow,
  experimental_InfoSection as InfoSection,
  type ExperimentalThreadContextCardProps,
} from "@get-bb/plugin-sdk/app";
import { relativeAge } from "../../domain/presentation.ts";
import {
  useSharedServerStateSelector,
  useThreadRecordSelector,
} from "../serverState.ts";
import { useDebugMode } from "./debug.ts";
import { ThreadActivity } from "./ThreadActivity.tsx";

function Entry({
  label,
  icon,
  children,
}: {
  label: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <DetailRow label={label} icon={icon} align="start">
      <span className="block break-words" data-ws-context-debug-entry={label}>
        {children}
      </span>
    </DetailRow>
  );
}

const PROVENANCE_TITLE: Record<string, string> = {
  manual: "set by you",
  inherited: "inherited",
  full: "settled by Full analysis",
  quick: "guessed by Quick analysis",
};

function DebugEntries({
  threadId,
  surface,
}: {
  threadId: string;
  surface: "card" | "info";
}) {
  const analysis = useSharedServerStateSelector(
    (server) => server.analysis[threadId],
  );
  const assignment = useThreadRecordSelector(
    threadId,
    (record) => record.assignment,
  );
  const className = `flex min-w-0 flex-col gap-1.5${
    surface === "card" ? " px-2" : ""
  }`;
  // The Info tab's DetailCard supplies the dl; the context card does not.
  const Container = surface === "card" ? "dl" : "div";
  if (!analysis && !assignment)
    return (
      <Container className={className} data-ws-context-debug>
        <Entry label="Analysis" icon="Info">
          No analysis recorded for this thread.
        </Entry>
      </Container>
    );
  return (
    <Container className={className} data-ws-context-debug>
      {analysis?.threadGoal ? (
        <Entry label="Goal" icon="Target">
          {analysis.threadGoal}
        </Entry>
      ) : null}
      {analysis?.digest ? (
        <Entry label="Digest" icon="FileText">
          {analysis.digest}
        </Entry>
      ) : null}
      {assignment ? (
        <Entry label="Topic" icon="Folder">
          {assignment.status === "unresolved"
            ? "Unresolved"
            : (assignment.label ?? "No topic")}
          {assignment.provenance
            ? ` (${PROVENANCE_TITLE[assignment.provenance] ?? assignment.provenance})`
            : ""}
        </Entry>
      ) : null}
      {analysis?.goal ? (
        <Entry label="Settled title" icon="Edit">
          {analysis.goal}
        </Entry>
      ) : null}
      {analysis ? (
        <Entry label="Status" icon="ChartColumn">
          {analysis.state}
          {analysis.needsYou ? `: ${analysis.needsYou}` : ""} (
          {analysis.reported ? "reported by the agent" : "inferred"})
        </Entry>
      ) : null}
      {analysis ? (
        <Entry label="Analyzed" icon="Clock">
          {relativeAge(analysis.at, Date.now())} by {analysis.model}
        </Entry>
      ) : null}
      {analysis?.topicError ? (
        <Entry label="Topic error" icon="AlertTriangle">
          {analysis.topicError}
        </Entry>
      ) : null}
    </Container>
  );
}

/** The thread context card draws the section title itself. */
export function ThreadContextDebugSection({
  threadId,
}: ExperimentalThreadContextCardProps) {
  const debug = useDebugMode("threadInfo");
  if (!debug) return null;
  // Core card rows and the host-drawn section heading both use px-2.
  return (
    <>
      <DebugEntries threadId={threadId} surface="card" />
      <ThreadActivity key={threadId} threadId={threadId} surface="card" />
    </>
  );
}

/** The Info tab's sections render their own chrome. */
export function ThreadInfoDebugSection({
  threadId,
}: ExperimentalThreadContextCardProps) {
  const debug = useDebugMode("threadInfo");
  if (!debug) return null;
  return (
    <InfoSection label="Workstreams Debug">
      <DebugEntries threadId={threadId} surface="info" />
      <ThreadActivity key={threadId} threadId={threadId} surface="info" />
    </InfoSection>
  );
}
