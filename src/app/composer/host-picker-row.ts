/**
 * Places the New thread composer's own elements in and beside BB's picker
 * row, so they read as part of BB's composer. `useHostPickerRow` puts the
 * Topic field in the row, before the project picker. `useHostPickerRowNote`
 * puts a line directly under the row, for notes about the pickers' values.
 *
 * BB offers plugins no slot there. Each hook keeps one anchor element of ours
 * in place, located by BB's `data-promptbox-project-control` marker (or the
 * stock NewThreadPromptBox structure when no project picker shows), and
 * re-inserts it whenever BB re-renders the composer. BB's React only inserts
 * and removes its own nodes, so the extra child is left alone. If the markup
 * changes and the row can't be found, the hook returns null and the caller
 * renders the element itself.
 *
 * Anchors are also marked as plugin roots. The plugin's utility classes are
 * scoped to plugin roots, and the row belongs to BB, so without the marker
 * only the classes BB's own stylesheet happens to define would style what is
 * portaled there.
 */
import { useLayoutEffect, useState } from "react";
import { usePortalScopeProps } from "@/lib/portal-scope";

const ROW_GROUP =
  "[data-promptbox-shell] > [data-promptbox] + div > :first-child";

function pickerGroup(root: HTMLElement): Element | null {
  return (
    root.querySelector("[data-promptbox-project-control]")?.parentElement ??
    root.querySelector(ROW_GROUP)
  );
}

/** At the start of the row's left group. */
function inPickerRow(root: HTMLElement, anchor: HTMLElement): boolean {
  const group = pickerGroup(root);
  if (!group) return false;
  if (group.firstChild !== anchor) group.insertBefore(anchor, group.firstChild);
  return true;
}

/** Right after the row, as its next sibling. */
function underPickerRow(root: HTMLElement, anchor: HTMLElement): boolean {
  const row = pickerGroup(root)?.parentElement;
  if (!row) return false;
  if (row.nextSibling !== anchor) row.after(anchor);
  return true;
}

export function useHostPickerRow(root: HTMLElement | null): HTMLElement | null {
  return useHostAnchor(root, "data-ws-workstream-slot", inPickerRow);
}

export function useHostPickerRowNote(
  root: HTMLElement | null,
): HTMLElement | null {
  return useHostAnchor(root, "data-ws-picker-note-slot", underPickerRow);
}

function useHostAnchor(
  root: HTMLElement | null,
  marker: string,
  place: (root: HTMLElement, anchor: HTMLElement) => boolean,
): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const pluginId = usePortalScopeProps()["data-bb-plugin"];
  useLayoutEffect(() => {
    if (!root) return;
    const anchor = document.createElement("span");
    anchor.setAttribute(marker, "");
    anchor.setAttribute("data-bb-plugin-root", "");
    if (pluginId !== undefined) anchor.setAttribute("data-bb-plugin", pluginId);
    anchor.style.display = "contents";
    const update = () => {
      if (place(root, anchor)) {
        setTarget(anchor);
        return;
      }
      anchor.remove();
      setTarget(null);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      anchor.remove();
      setTarget(null);
    };
  }, [root, pluginId, marker, place]);
  return target;
}
