import { useCallback } from "react";
import {
  experimental_useSidebarThreadActions,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { usePrefs } from "../prefs.ts";
import {
  threadIndex,
  useSidebarThreadsSelector,
} from "../useStableSidebarThreads.ts";

/** Stable per-thread hue, so a parent's disc keeps its color everywhere. */
function threadHue(id: string): number {
  let hash = 0;
  for (const character of id)
    hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return hash;
}

/**
 * Optional chip in a child thread's header that opens its
 * parent. It reads the live sidebar thread set, so it hides for roots and for
 * parents that are archived or hidden.
 */
export function ParentThreadLink({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const { prefs } = usePrefs();
  const enabled = prefs?.threads.showParentLink ?? false;
  const parent = useSidebarThreadsSelector(
    useCallback(
      ({ threads }) => {
        const index = threadIndex(threads);
        const parentId = index.get(threadId)?.parentThreadId;
        return parentId ? index.get(parentId) : undefined;
      },
      [threadId],
    ),
  );
  const actions = experimental_useSidebarThreadActions();
  if (!enabled || !parent) return null;

  const title = parent.displayTitle;
  return (
    <button
      type="button"
      aria-label={`Back to parent: ${title}`}
      title={title}
      onClick={() => actions.open(parent.id)}
      className={`ws-parent-link${isCompactViewport ? " ws-parent-link-compact" : ""}`}
    >
      <span className="ws-parent-link-chevron" aria-hidden="true">
        ‹
      </span>
      <span
        className="ws-parent-link-disc"
        aria-hidden="true"
        style={{ backgroundColor: `oklch(0.72 0.13 ${threadHue(parent.id)})` }}
      />
      {isCompactViewport ? null : (
        <span className="ws-parent-link-title">{title}</span>
      )}
    </button>
  );
}
