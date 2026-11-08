import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { detailsSummary } from "../../domain/replyPanel.ts";
import { INHERIT_CLASS } from "./markdown.ts";

type Render = (content: string | undefined) => ReactNode;

/**
 * A native disclosure, closed until the reader opens it: a chevron, the
 * title, and a muted line the caller computes from the folded content, never
 * one the agent wrote. Folds that follow one another share their rules, so a
 * run of them reads as one list.
 */
export function Fold({
  title,
  summary,
  children,
  rule = true,
  ...data
}: {
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  rule?: boolean;
} & Record<`data-${string}`, string>) {
  return (
    <details
      {...data}
      className={`group/fold min-w-0 ${rule ? "border-y border-border [&+&]:-mt-4 [&+&]:border-t-0" : ""}`}
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-1.5 py-1.5 select-none marker:hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <Icon
          name="ChevronRight"
          aria-hidden
          className="size-3.5 shrink-0 self-center text-muted-foreground transition-transform group-open/fold:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 font-medium [&_p]:m-0">{title}</span>
        {summary ? (
          <span
            className={`min-w-0 text-[0.85em] text-muted-foreground [&_p]:m-0 ${INHERIT_CLASS}`}
          >
            {summary}
          </span>
        ) : null}
      </summary>
      <div className="min-w-0 pt-1 pb-3 pl-5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        {children}
      </div>
    </details>
  );
}

/**
 * Reasoning, evidence, and background, folded: the closed line counts what
 * the body holds, so the reader can tell a code listing from a paragraph
 * before opening it.
 */
export function DetailsBody({
  part,
  md,
}: {
  part: Extract<ReplyPart, { type: "details" }>;
  md: Render;
}) {
  return (
    <Fold
      data-reply-details=""
      title={md(part.title)}
      summary={detailsSummary(part.body)}
    >
      <div data-reply-details-body="">{md(part.body)}</div>
    </Fold>
  );
}
