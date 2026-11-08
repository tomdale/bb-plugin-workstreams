import type { ReactNode } from "react";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { PartTitle, titleMarkdown } from "./PartTitle.tsx";

type Render = (content: string | undefined) => ReactNode;

/**
 * Supporting detail under its own heading, unboxed and always open: the body
 * keeps its Markdown and stays fully readable, because essential caveats can
 * land here too.
 */
export function DetailsBody({
  part,
  md,
}: {
  part: Extract<ReplyPart, { type: "details" }>;
  md: Render;
}) {
  return (
    <section data-reply-details="" className="min-w-0 space-y-1">
      <PartTitle>{md(titleMarkdown(part.title))}</PartTitle>
      <div
        data-reply-details-body=""
        className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
      >
        {md(part.body)}
      </div>
    </section>
  );
}
