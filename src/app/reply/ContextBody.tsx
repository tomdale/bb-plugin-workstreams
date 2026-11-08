import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { INHERIT_MARKDOWN, SECONDARY_TEXT } from "./type.ts";

type Render = (content: string | undefined) => ReactNode;

/**
 * An orientation line: the topic in medium weight in the reply accent, the way
 * the sticky goal header shows its workstream above the goal, the reported
 * location smaller and muted beneath it, then any background as ordinary prose.
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
        className={`text-[13px] font-medium leading-[19px] text-(--ws-reply-accent,var(--muted-foreground)) ${INHERIT_MARKDOWN} [&_p]:my-0`}
      >
        {md(part.topic)}
      </div>
      {part.where ? (
        <div data-reply-context-where="" className={`mt-0.5 ${SECONDARY_TEXT}`}>
          {md(part.where)}
        </div>
      ) : null}
      {part.background ? (
        <div
          data-reply-context-background=""
          className="mt-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
        >
          {md(part.background)}
        </div>
      ) : null}
    </div>
  );
}
