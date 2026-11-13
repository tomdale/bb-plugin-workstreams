/**
 * Which workstream's Overview the Workstreams page shows, so the sidebar can
 * mark that workstream's header as the open one. The page and the sidebar run
 * in this plugin's one client bundle, so a module value carries it.
 */
import { useSyncExternalStore } from "react";

let open: string | null = null;
const listeners = new Set<() => void>();

/** The page reports the Overview it shows, or null when it shows none. */
export function setOpenOverview(id: string | null): void {
  if (open === id) return;
  open = id;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => open;

/** Whether the page shows this workstream's Overview. */
export function useOverviewOpen(id: string): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot) === id;
}

/** The sub-path of a workstream's Overview under the Workstreams page. */
export const overviewSubPath = (id: string) =>
  `overview/${encodeURIComponent(id)}`;
