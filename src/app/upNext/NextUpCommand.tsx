import { useEffect } from "react";
import { experimental_useSidebarThreadActions } from "@get-bb/plugin-sdk/app";
import { nextUpNextThread } from "../../domain/archiveNavigation.ts";
import { useSidebarThreadsPublisher } from "../useStableSidebarThreads.ts";
import { useUpNextReader, type UpNextReading } from "../useWorkstreams.ts";

let current: {
  read: () => UpNextReading;
  open: (threadId: string) => void;
} | null = null;

/**
 * The app-wide command reads the live projection and uses BB's sidebar flow.
 *
 * Mounted for the app's whole life, everywhere, including phones, so it also
 * keeps the sidebar's default view fed: single-thread lookups elsewhere read
 * that view without calling the SDK hook (see `useStableSidebarThreads`). It
 * derives nothing until the command runs.
 */
export function NextUpCommandBridge(): null {
  useSidebarThreadsPublisher();
  const read = useUpNextReader();
  const actions = experimental_useSidebarThreadActions();
  useEffect(() => {
    const bridge = {
      read,
      open: (threadId: string) => actions.open(threadId),
    };
    current = bridge;
    return () => {
      if (current === bridge) current = null;
    };
  }, [read, actions]);
  return null;
}

export function openNextUpThread(threadId: string | null): void {
  if (!current) return;
  const { projection, upNext } = current.read();
  const next = nextUpNextThread(projection, threadId, upNext)?.thread.id;
  if (next) current.open(next);
}
