/**
 * The thread Info tab and thread context card's "Workstreams debug" section:
 * the metadata Workstreams generated and accumulated for the thread — the
 * settled goal, the context digest, the thread's workstream and its provenance,
 * and the latest analysis run's status, model, and age. Related journal events
 * and analysis calls appear below, with the model-call inspector one click
 * away. Shown with the debug UI only; the slots are feature-detected, so bb
 * builds without them skip the registrations.
 */
import type { ReactNode } from "react";
import {
  experimental_DetailRow as DetailRow,
  experimental_InfoSection as InfoSection,
  type ExperimentalThreadContextCardProps,
} from "@get-bb/plugin-sdk/app";
import { relativeAge, workStateLabel } from "../../domain/presentation.ts";
import {
  useSharedServerStateSelector,
  useThreadRecordSelector,
} from "../serverState.ts";
import { useDebugMode } from "./debug.ts";
import { analysisSubject } from "./subjects.ts";
import { DebugThreadButton } from "./DebugThreadButton.tsx";
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
  manual: "moved there by you",
  inherited: "inherited",
  automatic: "chosen automatically from its requests",
  composer: "shown by the composer for an earlier draft",
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
  const discuss = analysis ? (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>Debug this classification</span>
      <DebugThreadButton
        subject={analysisSubject({ threadId, analysis, assignment })}
      />
    </div>
  ) : null;
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
      {analysis?.goal ? (
        <Entry label="Goal" icon="Target">
          {analysis.goal}
        </Entry>
      ) : null}
      {analysis?.digest ? (
        <Entry label="Digest" icon="FileText">
          {analysis.digest}
        </Entry>
      ) : null}
      {assignment ? (
        <Entry label="Workstream" icon="Folder">
          {assignment.status === "none"
            ? "No workstream"
            : (assignment.label ?? "No workstream")}
          {assignment.provenance
            ? ` (${PROVENANCE_TITLE[assignment.provenance] ?? assignment.provenance})`
            : ""}
        </Entry>
      ) : null}
      {analysis?.title ? (
        <Entry label="Settled title" icon="Edit">
          {analysis.title}
        </Entry>
      ) : null}
      {analysis ? (
        <Entry label="Status" icon="ChartColumn">
          {workStateLabel(analysis.state)}
          {analysis.ask ? `: ${analysis.ask}` : ""} (
          {analysis.reported ? "reported by the agent" : "inferred"})
        </Entry>
      ) : null}
      {analysis ? (
        <Entry label="Analyzed" icon="Clock">
          {relativeAge(analysis.at, Date.now())} by {analysis.model}
        </Entry>
      ) : null}
      {analysis?.workstreamError ? (
        <Entry label="Workstream error" icon="AlertTriangle">
          {analysis.workstreamError}
        </Entry>
      ) : null}
      {discuss}
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
    <InfoSection label="Workstreams debug">
      <DebugEntries threadId={threadId} surface="info" />
      <ThreadActivity key={threadId} threadId={threadId} surface="info" />
    </InfoSection>
  );
}
