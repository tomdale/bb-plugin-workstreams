import { ThreadTitle, UrlLink } from "@get-bb/plugin-sdk/app";
import { useSidebarThread } from "../useStableSidebarThreads.ts";

/**
 * A thread named by its title, as a link that opens it. A thread the sidebar
 * does not list (a hidden worker thread, an archived one) shows `fallback`.
 */
export function UsageThreadLink({
  threadId,
  fallback,
}: {
  threadId: string;
  fallback?: string;
}) {
  const thread = useSidebarThread(threadId);
  const href =
    thread?.projectId && thread.projectId !== "proj_personal"
      ? `/projects/${encodeURIComponent(thread.projectId)}/threads/${encodeURIComponent(threadId)}`
      : `/threads/${encodeURIComponent(threadId)}`;
  return (
    <UrlLink
      href={href}
      className="rounded-sm text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {thread ? (
        <ThreadTitle threadId={threadId} />
      ) : (
        (fallback ?? "Unavailable thread")
      )}
    </UrlLink>
  );
}
