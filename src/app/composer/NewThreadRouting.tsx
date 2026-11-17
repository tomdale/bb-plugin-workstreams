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
} from "../../domain/workstreamProject.ts";
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
    // One model per draft, shared by every live banner for it and kept across
    // the remount a project change causes.
    const nativeModel = acquireRoutingModel(
      draftKey,
      () =>
        new NewWorkModel({
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
        }),
    );
    // Opened from a workstream's ＋: the thread starts in that workstream.
    const preset = takeComposerPreset();
    if (preset) nativeModel.selectWorkstream(preset.target, preset.label);
    nativeModel.observe(composer.text);
    nativeModel.observeSelection(composer.selection);
    setModel(nativeModel);
    // BB clears the draft after sending it; the next draft starts over.
    const unsubscribe = composer.onSubmitted(() => nativeModel.markSubmitted());
    return () => {
      unsubscribe();
      releaseRoutingModel(draftKey, nativeModel);
      setModel((current) => (current === nativeModel ? null : current));
      setComposerRoot(null);
    };
  }, [composer, composer.scope.kind, root, rpc]);

  // Separate effects, so a kept-alive view re-reports its selection only when
  // its own selection changes, not on every keystroke.
  useEffect(() => {
    model?.observe(composer.text);
  }, [composer.text, model]);
  useEffect(() => {
    model?.observeSelection(composer.selection);
  }, [composer.selection, model]);

  const state = useSyncExternalStore(
    model?.subscribeView ?? emptySubscribe,
    model?.viewSnapshot ?? emptySnapshot,
  );
  const workstreamId =
    state.identity?.workstreamId ?? state.identity?.proposal?.parentId;
  const sectionId = state.identity?.sectionId;
  useEffect(() => {
    // A workstream supplies a default only until you choose a project yourself.
    if (!model || (!workstreamId && !sectionId) || state.projectOverride)
      return;
    // Sending waits from the lookup on, so a draft sent meanwhile starts in
    // the workstream's project.
    const move = model.beginProjectMove();
    let live = true;
    let applying = false;
    void (async () => {
      try {
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
        const current = shownProject(model, composerRef.current);
        // The project may have been chosen while the default was loading, or
        // another view of this draft may be applying the same default.
        if (
          current === projectId ||
          model.snapshot().projectOverride ||
          model.movingProject(projectId)
        )
          return;
        model.supplyProject(projectId);
        move.target(projectId);
        applying = true;
        await composer.setSelection({ projectId });
      } finally {
        move.end();
      }
    })().catch((error) => {
      if (live) model.reportError(error);
    });
    return () => {
      live = false;
      // A switch already requested runs on; the composer reports its landing.
      if (!applying) move.end();
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
    if (!model) return;
    const settle = () => {
      // A workstream default requested before you chose a project can land
      // after your choice; your project wins.
      const restore = model.takeRestore();
      if (restore) {
        const move = model.beginProjectMove();
        move.target(restore);
        void composerRef.current
          .setSelection({ projectId: restore })
          .catch((error: unknown) => model.reportError(error))
          .finally(move.end);
        return;
      }
      // A send held while the project moved goes out once it lands.
      if (model.takeSubmitRequest()) void send(model, composerRef.current);
    };
    settle();
    return model.subscribe(settle);
  }, [model]);

  useEffect(() => {
    // The host composer submits through BB's own thread creation; the
    // destination the pickers show — picked or automatic — travels as submit
    // metadata the server's dispatch hook moves the thread by.
    if (!model) return;
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
      if (model.movingProject()) model.requestSubmit();
      else void send(model, composerRef.current);
    };
    // BB's Enter sends without a form event. While the project is about to
    // move, hold that Enter and send once it lands.
    const keydown = (event: KeyboardEvent) => {
      if (!model.movingProject() || !sendsDraft(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      model.requestSubmit();
    };
    form.addEventListener("submit", submit, true);
    form.addEventListener("keydown", keydown, true);
    return () => {
      form.removeEventListener("submit", submit, true);
      form.removeEventListener("keydown", keydown, true);
    };
  }, [model, root]);
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
            <p key={state.errors} role="alert" className="ws-composer-error">
              {state.error}
            </p>
          ) : null}
          <DebugSection newWork={model} />
        </div>
      ) : null}
    </div>
  );
}

/** The project the composer shows. */
function shownProject(
  model: NewWorkModel,
  composer: ReturnType<typeof useComposer>,
): string | null {
  const { scope } = composer;
  return (
    model.snapshot().selection?.projectId ??
    composer.selection?.projectId ??
    (scope.kind === "new-thread" ? scope.projectId : null)
  );
}

/** Sends the draft with the workstream and project the composer shows. */
async function send(
  model: NewWorkModel,
  composer: ReturnType<typeof useComposer>,
) {
  try {
    const identity = submittedIdentity(model.snapshot());
    const projectChoice = submittedProject(model.snapshot());
    await composer.submit({
      experimental_data: {
        draftKey: composer.key,
        ...(projectChoice ? { projectChoice } : {}),
        ...(identity ? { identity } : {}),
      },
    });
  } catch (error) {
    model.reportError(error);
  }
}

/**
 * Whether a key sends the draft in BB's New thread composer: Enter, or
 * Mod+Enter, outside an input method's composition. Shift+Enter is a newline.
 */
function sendsDraft(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.isComposing &&
    event.keyCode !== 229
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
