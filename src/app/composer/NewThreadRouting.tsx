import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useComposer, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import type { Preview } from "../../server/preview.ts";
import {
  acquireRoutingModel,
  NewWork as NewWorkModel,
  releaseRoutingModel,
  submittedProject,
  submittedIdentity,
  type NewWorkViewState,
} from "./new-work.ts";
import { useDebugMode } from "../debug/debug.ts";
import { NewWorkDebug } from "./NewWorkDebug.tsx";
import { createPortal } from "react-dom";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { useHostPickerRow, useHostPickerRowNote } from "./host-picker-row.ts";
import { WorkstreamPicker } from "./WorkstreamPicker.tsx";
import { takeComposerPreset } from "./preset.ts";
import {
  NO_PROJECT,
  workstreamProject,
  workstreamProjectConflict,
} from "../../domain/topicProject.ts";
import {
  carryPickedWorkstream,
  preserveProjectChoice,
  takeProjectChoice,
} from "./project-choice.ts";
import { ProjectDefaultOffer } from "./ProjectDefaultOffer.tsx";

export function NewThreadRouting() {
  const rpc = useRpc<RpcContract>();
  const composer = useComposer();
  const sdk = useSdk();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [checkedRoot, setCheckedRoot] = useState(false);
  const [model, setModel] = useState<NewWorkModel | null>(null);
  const [composerRoot, setComposerRoot] = useState<HTMLElement | null>(null);
  const composerRef = useRef(composer);
  composerRef.current = composer;

  useEffect(() => {
    const primary = root?.closest<HTMLElement>(
      '[data-app-composer-role="primary"]',
    );
    const scope = composer.scope;
    if (!root) return;
    if (
      !primary ||
      primary.closest('[role="dialog"]') ||
      scope.kind !== "new-thread"
    ) {
      setCheckedRoot(true);
      return;
    }
    setCheckedRoot(true);
    setComposerRoot(primary);
    const draftKey = composer.key;
    // One model per draft, shared by every live banner for it.
    let nativeModel!: NewWorkModel;
    nativeModel = acquireRoutingModel(draftKey, () => {
      nativeModel = new NewWorkModel(
        {
          route: async (prompt, pickedProjectId) =>
            (await rpc.call("preview", {
              prompt,
              pickedProjectId,
              draftKey,
            })) as Preview,
          cancelRoute: () => {
            void rpc.call("previewCancel", { draftKey }).catch(() => {});
          },
          reportIdentity: (report) =>
            rpc.call("draftIdentity", { draftKey, ...report }),
        },
        takeProjectChoice(scope.projectId, draftKey),
      );
      // Opened from a workstream's ＋: the thread starts with its workstream.
      const preset = takeComposerPreset();
      if (preset) nativeModel.selectWorkstream(preset.target, preset.label);
      nativeModel.observe(composer.text);
      nativeModel.observeSelection(composer.selection);
      return nativeModel;
    });
    setModel(nativeModel);
    return () => {
      if (releaseRoutingModel(draftKey, nativeModel))
        carryPickedWorkstream(
          draftKey,
          scope.projectId,
          nativeModel.snapshot(),
        );
      setModel((current) => (current === nativeModel ? null : current));
      setComposerRoot(null);
    };
  }, [composer, composer.scope.kind, root, rpc]);

  useEffect(() => {
    if (!model) return;
    model.observe(composer.text);
    model.observeSelection(composer.selection);
  }, [composer.selection, composer.text, model]);

  const state = useSyncExternalStore(
    model?.subscribeView ?? emptySubscribe,
    model?.viewSnapshot ?? emptySnapshot,
  );
  const workstreamId =
    state.identity?.workstreamId ?? state.identity?.proposal?.parentId;
  const sectionId = state.identity?.sectionId;
  useEffect(() => {
    // A project you chose after the workstream stays for this thread.
    if (!model || (!workstreamId && !sectionId) || state.projectOverride)
      return;
    let live = true;
    void (async () => {
      const tree = await rpc.call("tree", null);
      // A workstream always has a project; with none, it is No project.
      const destination = sectionId ? tree.groups[sectionId] : workstreamId;
      if (!destination || !live) return;
      const projectId = workstreamProject(destination, tree.workstreams);
      const projects = await sdk.projects.list({});
      if (
        !live ||
        (projectId !== NO_PROJECT &&
          !projects.some((project) => project.id === projectId))
      )
        return;
      const { scope, selection } = composerRef.current;
      const current =
        selection?.projectId ??
        (scope.kind === "new-thread" ? scope.projectId : null);
      if (current === projectId) return;
      // The preview's workstream never moves a thread out of its project on a
      // workstream with none; it leaves the thread in no workstream instead.
      if (
        projectId === NO_PROJECT &&
        model.snapshot().identity?.provenance === "automatic"
      ) {
        model.selectIdentity(null, "automatic");
        return;
      }
      model.supplyProject(projectId);
      const release = preserveProjectChoice(projectId, model.snapshot());
      try {
        await composer.setSelection({ projectId });
      } finally {
        release();
      }
    })().catch((error) => {
      if (live) model.reportError(error);
    });
    return () => {
      live = false;
    };
  }, [
    composer,
    model,
    rpc,
    sdk,
    workstreamId,
    sectionId,
    state.identity,
    state.projectOverride,
  ]);

  useEffect(() => {
    // The host composer submits through BB's own thread creation; the
    // destination the pickers show — picked or automatic — travels as submit
    // metadata the server's dispatch hook files.
    const current = model ? model.snapshot() : null;
    if (!model || !current) return;
    const primary = root?.closest<HTMLElement>(
      '[data-app-composer-role="primary"]',
    );
    const form = primary?.querySelector<HTMLFormElement>(
      "form[data-promptbox]",
    );
    if (!form || primary?.closest('[role="dialog"]')) return;
    // The thread starts in the project the composer shows. A workstream you
    // picked may start in any project; an automatic workstream must match its
    // workstream's project, so nothing is sent until one of them changes.
    const projectConflict = async (): Promise<string | null> => {
      const { identity } = model.snapshot();
      const workstreamId = identity?.sectionId ? null : identity?.workstreamId;
      const proposed = identity?.proposal?.parentId;
      if (
        identity?.provenance !== "automatic" ||
        !(workstreamId || proposed || identity.sectionId)
      )
        return null;
      const tree = await rpc.call("tree", null);
      const destination = identity.sectionId
        ? tree.groups[identity.sectionId]
        : (workstreamId ?? proposed);
      const { scope, selection } = composerRef.current;
      const chosen =
        selection?.projectId ??
        (scope.kind === "new-thread" ? scope.projectId : null);
      const conflict = workstreamProjectConflict(
        destination,
        tree.workstreams,
        chosen,
      );
      if (!conflict) return null;
      const projects = await sdk.projects.list({});
      const nameOf = (id: string | null | undefined) =>
        !id || id === NO_PROJECT
          ? "No project"
          : (projects.find((project) => project.id === id)?.name ??
            "an unavailable project");
      return `${identity.label} belongs to ${nameOf(conflict.workstreamProjectId)}, but this thread would start in ${nameOf(chosen)}. Choose that project, or another workstream.`;
    };
    const submit = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void (async () => {
        try {
          const conflict = await projectConflict();
          if (conflict) {
            model.reportError(conflict);
            return;
          }
          const identity = submittedIdentity(model.snapshot());
          const projectChoice = submittedProject(model.snapshot());
          await composerRef.current.submit({
            experimental_data: {
              draftKey: composerRef.current.key,
              ...(projectChoice ? { projectChoice } : {}),
              ...(identity ? { identity } : {}),
            },
          });
        } catch (error) {
          model.reportError(error);
        }
      })();
    };
    form.addEventListener("submit", submit, true);
    return () => form.removeEventListener("submit", submit, true);
  }, [composer, model, root, state.identity, state.decision]);
  // The picker row sits below the prompt box, outside this banner, so on a
  // wide screen the field is portaled into it. A phone's row is full with BB's
  // own project, environment and branch chips, so there the field takes a line
  // of its own in this banner, above the prompt box. The status text is then
  // announced but not drawn; the chip's ✦ pulses while it classifies.
  const compact = useIsCompactViewport();
  const pickerRow = useHostPickerRow(model && !compact ? composerRoot : null);
  // The project note sits under BB's picker row, which names the project.
  const noteSlot = useHostPickerRowNote(model ? composerRoot : null);
  const picker = model ? (
    <>
      <WorkstreamPicker newWork={model} />
      <span
        role="status"
        aria-live="polite"
        className={
          compact ? "sr-only" : "ws-picker-status text-xs text-muted-foreground"
        }
      >
        {state.classifying ? "Organizing…" : ""}
      </span>
    </>
  ) : null;
  const offer = model ? (
    <ProjectDefaultOffer
      newWork={model}
      projectId={
        composer.selection?.projectId ??
        (composer.scope.kind === "new-thread" ? composer.scope.projectId : null)
      }
    />
  ) : null;
  return checkedRoot && !model ? null : (
    <div ref={setRoot}>
      {model ? (
        <div className="ws-native-new-thread-routing">
          {pickerRow ? (
            createPortal(picker, pickerRow)
          ) : (
            <div
              className={
                compact
                  ? "ws-route-strip"
                  : "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3.5"
              }
            >
              {picker}
            </div>
          )}
          {noteSlot ? createPortal(offer, noteSlot) : offer}
          {state.error ? (
            <p key={state.errors} role="alert" className="ws-suggestion-error">
              {state.error}
            </p>
          ) : null}
          <DebugSection newWork={model} />
        </div>
      ) : null}
    </div>
  );
}

/** New work's Debug section, mounted only once the banner is active. */
function DebugSection({ newWork }: { newWork: NewWorkModel }) {
  return useDebugMode("composer") ? <NewWorkDebug newWork={newWork} /> : null;
}

function emptySubscribe() {
  return () => {};
}

const emptySnapshot = () => EMPTY_STATE;
const EMPTY_STATE: NewWorkViewState = {
  identity: null,
  decision: null,
  projectOverride: false,
  classifying: false,
  error: null,
  errors: 0,
};
