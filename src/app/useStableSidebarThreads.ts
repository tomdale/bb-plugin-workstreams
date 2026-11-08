import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { useMemo, useRef } from "react";
import { shareJson } from "./structuralSharing.ts";

function useSharedValue<T>(value: T): T {
  const previous = useRef(value);
  return useMemo(() => {
    const next = shareJson(previous.current, value);
    previous.current = next;
    return next;
  }, [value]);
}

export function useStableSidebarThreads(
  options?: Parameters<typeof experimental_useSidebarThreads>[0],
): ReturnType<typeof experimental_useSidebarThreads> {
  const snapshot = experimental_useSidebarThreads(options);
  const threads = useSharedValue(snapshot.threads);
  const sections = useSharedValue(snapshot.sections);
  const projects = useSharedValue(snapshot.projects);
  return { ...snapshot, threads, sections, projects };
}
