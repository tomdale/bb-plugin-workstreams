/**
 * The line under the New thread composer's picker row when you picked a topic
 * and then chose a project other than its workstream's. The thread starts in
 * the project you chose; this line offers to make that project the
 * workstream's default. Ignoring it leaves the workstream as it is.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { RpcContract } from "../../server/contract.ts";
import {
  NO_PROJECT,
  workstreamProjectConflict,
} from "../../domain/topicProject.ts";
import type { NewWork, NewWorkViewState } from "./new-work.ts";

type Offer = {
  /** The topic choice and project this offer answers. */
  identity: NewWorkViewState["identity"];
  topicId: string;
  label: string;
  projectId: string;
  projectName: string;
};

export function ProjectDefaultOffer({
  newWork,
  projectId,
}: {
  newWork: NewWork;
  /** The project the composer shows. */
  projectId: string | null;
}) {
  const rpc = useRpc<RpcContract>();
  const sdk = useSdk();
  const state = useSyncExternalStore(
    newWork.subscribeView,
    newWork.viewSnapshot,
  );
  const identity = state.identity;
  // Only an existing topic you picked has a project to change.
  const active =
    !!state.projectOverride &&
    identity?.provenance !== "automatic" &&
    !!(identity?.sectionId || identity?.entityId);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [saved, setSaved] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active || !identity || !projectId) return;
    let live = true;
    void (async () => {
      const catalog = await rpc.call("catalog", null);
      const topicId = identity.sectionId
        ? catalog.groups[identity.sectionId]
        : identity.entityId;
      const conflict =
        topicId &&
        workstreamProjectConflict(topicId, catalog.entities, projectId);
      if (!live) return;
      if (!topicId || !conflict) {
        setOffer(null);
        return;
      }
      const projects = await sdk.projects.list({});
      if (!live) return;
      const nameOf = (id: string) =>
        id === NO_PROJECT
          ? "No project"
          : (projects.find((project) => project.id === id)?.name ?? null);
      const projectName = nameOf(projectId);
      setOffer(
        projectName
          ? {
              identity,
              topicId,
              label: identity.label,
              projectId,
              projectName,
            }
          : null,
      );
    })().catch(() => {
      if (live) setOffer(null);
    });
    return () => {
      live = false;
    };
  }, [active, identity, projectId, rpc, sdk]);

  // An offer or confirmation for an earlier topic or project is stale.
  const current = (shown: Offer | null) =>
    active && shown?.identity === identity && shown.projectId === projectId
      ? shown
      : null;
  const confirmed = current(saved);
  const offered = current(offer);
  if (confirmed)
    return (
      <p role="status" className="ws-project-offer">
        {confirmed.projectName} is now the default for {confirmed.label}.
      </p>
    );
  if (!offered) return null;
  const save = async () => {
    setBusy(true);
    try {
      await rpc.call("catalogUpdateMetadata", {
        entityId: offered.topicId,
        // No project on a topic is its own choice, not learning.
        projectId: offered.projectId === NO_PROJECT ? null : offered.projectId,
      });
      setSaved(offered);
    } catch (error) {
      newWork.reportError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <p className="ws-project-offer">
      <Button
        type="button"
        variant="link"
        disabled={busy}
        onClick={() => void save()}
        className="h-auto whitespace-normal p-0 text-left text-xs font-normal text-muted-foreground hover:text-foreground"
      >
        Set {offered.projectName} as default for {offered.label}
      </Button>
    </p>
  );
}
