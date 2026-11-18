/*
 * BB disables its composer pickers while a native interaction is pending.
 * While a Workstreams question is portaled into that composer, SDK pickers
 * occupy the native controls' positions and update the same composer selection.
 * The plugin hides BB's native nodes without removing them, so BB can reconcile
 * them; cleanup restores their visibility.
 */
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_PermissionModePicker as PermissionModePicker,
  useComposer,
  type PluginSidebarThread,
  type ExperimentalProviderModelPickerRouting,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { usePortalScopeProps } from "@/lib/portal-scope";

type PickerSlots = {
  model: HTMLElement | null;
  permission: HTMLElement | null;
};
const emptySlots: PickerSlots = { model: null, permission: null };
const replaced = "data-ws-question-picker-replaced";

function useQuestionPickerSlots(
  anchor: HTMLElement | null,
  enabled: boolean,
  permissionEditable: boolean,
): PickerSlots {
  const [slots, setSlots] = useState(emptySlots);
  const pluginId = usePortalScopeProps()["data-bb-plugin"];
  useLayoutEffect(() => {
    const root = anchor?.closest<HTMLElement>("[data-app-composer]");
    if (!root || !enabled) return;
    const native: Record<keyof PickerSlots, HTMLButtonElement | null> = {
      model: null,
      permission: null,
    };
    const makeSlot = (kind: keyof PickerSlots) => {
      const slot = document.createElement("span");
      slot.setAttribute("data-ws-question-picker", kind);
      slot.setAttribute("data-bb-plugin-root", "");
      if (pluginId !== undefined) slot.setAttribute("data-bb-plugin", pluginId);
      slot.style.display = "contents";
      return slot;
    };
    const targets = {
      model: makeSlot("model"),
      permission: makeSlot("permission"),
    };
    const place = (
      kind: keyof PickerSlots,
      selector: string,
      allowed: boolean,
    ): HTMLElement | null => {
      const control = allowed
        ? (Array.from(
            root.querySelectorAll<HTMLButtonElement>(
              `[data-follow-up-composer] ${selector}`,
            ),
          ).find(
            (node) =>
              !node.closest("[data-ws-question-picker]") &&
              node.closest("[data-app-composer]") === root,
          ) ?? null)
        : null;
      const target = control?.disabled ? control : null;
      if (native[kind] !== target) {
        native[kind]?.removeAttribute(replaced);
        native[kind] = target;
      }
      if (!target) {
        targets[kind].remove();
        return null;
      }
      target.setAttribute(replaced, "");
      if (target.previousSibling !== targets[kind])
        target.before(targets[kind]);
      return targets[kind];
    };
    const update = () => {
      const portaled = Array.from(
        root.querySelectorAll(".ws-question-portaled"),
      ).some((node) => node.closest("[data-app-composer]") === root);
      const next = {
        model: place(
          "model",
          'button[aria-label^="Provider, model and reasoning"]',
          portaled,
        ),
        permission: place(
          "permission",
          'button[aria-label="Permission mode"]',
          portaled &&
            permissionEditable &&
            root.dataset.appComposerRole === "primary",
        ),
      };
      setSlots((current) =>
        current.model === next.model && current.permission === next.permission
          ? current
          : next,
      );
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "data-app-composer-role"],
    });
    return () => {
      observer.disconnect();
      for (const kind of ["model", "permission"] as const) {
        native[kind]?.removeAttribute(replaced);
        targets[kind].remove();
      }
      setSlots(emptySlots);
    };
  }, [anchor, enabled, permissionEditable, pluginId]);
  return slots;
}

export function QuestionComposerPickers({
  anchor,
  thread,
}: {
  anchor: HTMLElement | null;
  thread: PluginSidebarThread | undefined;
}) {
  const composer = useComposer();
  const selection = composer.selection;
  const enabled =
    composer.scope.kind === "thread" &&
    thread?.id === composer.scope.threadId &&
    !thread.isArchived &&
    Boolean(
      selection?.providerId && selection.model && selection.reasoningLevel,
    );
  const permissionEditable =
    Boolean(selection?.permissionMode) &&
    thread?.activity.planMode === 0 &&
    !composer.draft.mentions.some(
      (mention) =>
        mention.kind === "command" &&
        mention.trigger === "/" &&
        mention.name === "plan",
    );
  const slots = useQuestionPickerSlots(anchor, enabled, permissionEditable);
  if (
    !enabled ||
    !selection?.providerId ||
    !selection.model ||
    !selection.reasoningLevel
  )
    return null;
  const routing: ExperimentalProviderModelPickerRouting | undefined = thread
    ?.environment?.id
    ? { kind: "environment", environmentId: thread.environment.id }
    : thread?.host
      ? { kind: "host", hostId: thread.host.id }
      : undefined;
  const select = (next: Parameters<typeof composer.setSelection>[0]) => {
    void composer.setSelection(next).catch(() => {
      toast.error("Couldn't change the next message's settings.");
    });
  };
  return (
    <>
      {slots.model
        ? createPortal(
            <ProviderModelPicker
              value={{
                providerId: selection.providerId,
                model: selection.model,
                reasoningLevel: selection.reasoningLevel,
                ...(selection.serviceTier
                  ? { serviceTier: selection.serviceTier }
                  : {}),
              }}
              routing={routing}
              onChange={select}
              className="font-normal"
            />,
            slots.model,
          )
        : null}
      {slots.permission && selection.permissionMode
        ? createPortal(
            <PermissionModePicker
              providerId={selection.providerId}
              value={selection.permissionMode}
              routing={routing}
              onChange={(permissionMode) => select({ permissionMode })}
              className="h-6 max-md:pointer-coarse:h-11 max-md:pointer-coarse:px-2"
            />,
            slots.permission,
          )
        : null}
    </>
  );
}
