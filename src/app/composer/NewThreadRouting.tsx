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
import { useHostPickerRow } from "./host-picker-row.ts";
import { WorkstreamPicker } from "./WorkstreamPicker.tsx";
import { takeComposerPreset } from "./preset.ts";
import { topicProject } from "../../domain/topicProject.ts";
import { preserveProjectChoice, takeProjectChoice } from "./project-choice.ts";

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
        takeProjectChoice(scope.projectId),
      );
      // Opened from a workstream's ＋: the thread starts with its topic.
      const preset = takeComposerPreset();
      if (preset) nativeModel.selectWorkstream(preset.target, preset.label);
      nativeModel.observe(composer.text);
      nativeModel.observeSelection(composer.selection);
      return nativeModel;
    });
    setModel(nativeModel);
    return () => {
      releaseRoutingModel(draftKey, nativeModel);
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
  const topicId =
    state.identity?.entityId ?? state.identity?.proposal?.parentId;
  const sectionId = state.identity?.sectionId;
  useEffect(() => {
    if (!model || (!topicId && !sectionId)) return;
    let live = true;
    void (async () => {
      const catalog = await rpc.call("catalog", null);
      const projectId = topicProject(
        sectionId ? catalog.groups[sectionId] : topicId,
        catalog.entities,
      );
      if (!projectId || !live) return;
      const projects = await sdk.projects.list({});
      if (!live || !projects.some((project) => project.id === projectId))
        return;
      if (composer.selection?.projectId === projectId) return;
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
  }, [composer, model, rpc, sdk, topicId, sectionId, state.identity]);

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
    const submit = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void (async () => {
        try {
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
        {state.classifying ? "Analyzing…" : ""}
      </span>
    </>
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
  return useDebugMode() ? <NewWorkDebug newWork={newWork} /> : null;
}

function emptySubscribe() {
  return () => {};
}

const emptySnapshot = () => EMPTY_STATE;
const EMPTY_STATE: NewWorkViewState = {
  identity: null,
  decision: null,
  classifying: false,
  error: null,
  errors: 0,
};
