/**
 * Which pull request's view the Workstreams page shows, so the sidebar can mark
 * its row as the open one. The page and the sidebar run in this plugin's one
 * client bundle, so a module value carries it (as `overview/route.ts` does for
 * a workstream's Overview).
 */
import { useSyncExternalStore } from "react";

let open: string | null = null;
const listeners = new Set<() => void>();

/** The page reports the pull request it shows, or null when it shows none. */
export function setOpenPullRequest(id: string | null): void {
  if (open === id) return;
  open = id;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => open;

/** Whether the page shows this pull request. */
export function useOpenPullRequest(id: string): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot) === id;
}
