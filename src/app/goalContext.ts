import { useSidebarThreadsSelector } from "./useStableSidebarThreads.ts";
import { useCallback, useMemo } from "react";
import {
  colorForWorkstream,
  type TopicColor,
} from "../domain/workstreamColor.ts";
import { useSharedServerStateSelector } from "./serverState.ts";

type GoalContext = {
  /**
   * The thread's name, exactly as the sidebar and every other list show it.
   * Workstreams writes the thread's goal as its title; a title the user or an
   * agent chose stays, and an untitled thread shows BB's placeholder.
   */
  title: string;
  /** The analyzed desired outcome, retained while later turns run. */
  goal: string | null;
  /** The thread's workstream with its identity hue, or null when unfiled. */
  workstream: { name: string; color: TopicColor } | null;
};

/** What a thread is for: its title, desired outcome, and workstream. */
export function useGoalContext(threadId: string | null): GoalContext | null {
  const selected = useSidebarThreadsSelector(
    useCallback(
      ({ threads, sections }) => {
        if (!threadId) return null;
        const thread = threads.find((item) => item.id === threadId);
        if (!thread) return null;
        // Delegates follow their root's workstream, even when BB keeps a
        // different native section on the delegate itself.
        let root = thread;
        const seen = new Set([root.id]);
        while (root.parentThreadId && !seen.has(root.parentThreadId)) {
          const parent = threads.find(
            (item) => item.id === root.parentThreadId,
          );
          if (!parent) break;
          root = parent;
          seen.add(root.id);
        }
        const section = root.sectionId
          ? (sections.find((item) => item.id === root.sectionId) ?? null)
          : null;
        // Only this thread's ancestry and section reach the subscriber. An
        // unrelated thread update therefore leaves the selected value equal.
        return { thread, root, section };
      },
      [threadId],
    ),
  );
  const threadGoal = useSharedServerStateSelector((server) =>
    threadId ? server.analysis[threadId]?.threadGoal : undefined,
  );
  const catalog = useSharedServerStateSelector((server) => server.catalog);
  return useMemo(() => {
    if (!selected) return null;
    const title = selected.thread.displayTitle;
    const goal = threadGoal;
    return {
      title,
      goal: goal && goal !== title ? goal : null,
      workstream: selected.section
        ? {
            name: selected.section.name,
            color: colorForWorkstream(selected.section.id, catalog),
          }
        : null,
    };
  }, [selected, threadGoal, catalog]);
}
