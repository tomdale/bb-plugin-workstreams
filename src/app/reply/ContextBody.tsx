import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";

type Render = (content: string | undefined) => ReactNode;

/**
 * An orientation line: the topic as a small label in the reply accent, the
 * way the sticky goal header shows its workstream above the goal, the reported
 * location muted beneath it, then any background as ordinary prose.
 */
export function ContextBody({
  part,
  md,
}: {
  part: Extract<ReplyPart, { type: "context" }>;
  md: Render;
}) {
  return (
    <div data-reply-context="" className="min-w-0">
      <div
        data-reply-context-topic=""
        className="text-[0.85em] font-medium leading-snug text-(--ws-reply-accent,var(--muted-foreground)) [&_p]:my-0"
      >
        {md(part.topic)}
      </div>
      {part.where ? (
        <div
          data-reply-context-where=""
          className="mt-0.5 text-[0.85em] leading-snug text-muted-foreground [&_p]:my-0"
        >
          {md(part.where)}
        </div>
      ) : null}
      {part.background ? (
        <div
          data-reply-context-background=""
          className="mt-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
        >
          {md(part.background)}
        </div>
      ) : null}
    </div>
  );
}
