import { Fragment, memo, useMemo, type ComponentProps } from "react";
import {
  Markdown,
  UrlLink,
  experimental_FileLink as FileLink,
} from "@get-bb/plugin-sdk/app";
import { fileTarget, type RecapFiles } from "../../domain/recap.ts";
import {
  evidenceFilePath,
  type ReplyEvidence,
} from "../../domain/replyComponents.ts";
import { mentionBlocks, normalizeReplyMarkdown } from "./markdown.ts";
import type { MentionSegment } from "../../domain/threadMentions.ts";
import { BODY_CLASS } from "./type.ts";
import { ActivityThreadLink } from "../page/ActivityThreadLink.tsx";

export type ReplyDocument = ComponentProps<
  typeof Markdown
>["experimental_document"];

/** Prose inside a part: the reply's own Markdown, at the reply's body size. */
export const PlainMarkdown = memo(function PlainMarkdown({
  content,
  document,
}: {
  content: string | undefined;
  document: ReplyDocument;
}) {
  const normalized = useMemo(
    () => (content ? normalizeReplyMarkdown(content) : content),
    [content],
  );
  const blocks = useMemo(
    () => (normalized ? mentionBlocks(normalized) : null),
    [normalized],
  );
  if (!normalized) return null;
  if (blocks?.length === 1 && blocks[0]!.kind === "markdown")
    return <Markdown content={normalized} experimental_document={document} />;
  return (
    <>
      {blocks?.map((block, index) =>
        block.kind === "markdown" ? (
          <Markdown
            key={index}
            content={block.text}
            experimental_document={document}
          />
        ) : (
          <MentionParagraph
            key={index}
            segments={block.segments}
            document={document}
          />
        ),
      )}
    </>
  );
});

/**
 * A paragraph holding thread mentions. BB's Markdown draws `@thread:<id>` as
 * text once it has a document, so the mentions render here as the same chips
 * the recap card uses, between inline runs of Markdown.
 */
function MentionParagraph({
  segments,
  document,
}: {
  segments: MentionSegment[];
  document: ReplyDocument;
}) {
  return (
    <div className="my-[0.75em] min-w-0 first:mt-0 last:mb-0">
      {segments.map((segment, index) => {
        if (segment.kind === "thread")
          return (
            <span
              key={index}
              className="-my-[0.5em] inline-block max-w-[16rem] align-middle leading-none [&>a]:text-[0.85em]"
            >
              <ActivityThreadLink
                threadId={segment.threadId}
                fallback={segment.threadId}
              />
            </span>
          );
        // Markdown trims its source, so edge spaces are kept outside it.
        const body = segment.text.trim();
        return (
          <Fragment key={index}>
            {/^\s/.test(segment.text) ? " " : null}
            {body ? (
              <Markdown
                content={body}
                experimental_document={document}
                className="!inline !text-[length:inherit] !leading-[inherit] [&_p]:!m-0 [&_p]:!inline"
              />
            ) : null}
            {/\s$/.test(segment.text) && body ? " " : null}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * Where a row's claim was checked: a link into the workspace or the web, or a
 * label with no location, which is still worth reading.
 */
export function Evidence({
  items,
  document,
  files,
}: {
  items?: ReplyEvidence[];
  document: ReplyDocument;
  files: RecapFiles | null;
}) {
  if (!items?.length) return null;
  return (
    <ul
      className={`mb-0 mt-1 list-disc pl-4 text-foreground [&>li]:mb-0.5 ${BODY_CLASS}`}
    >
      {items.map((item, i) => {
        const path =
          item.location && !item.location.startsWith("https://")
            ? evidenceFilePath(item.location, files?.root ?? null)
            : null;
        const target = path ? fileTarget(path, files) : null;
        return (
          <li
            key={i}
            data-reply-reference=""
            className="min-w-0 [overflow-wrap:anywhere]"
          >
            {item.threadId ? (
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                {item.label}
                <ActivityThreadLink
                  threadId={item.threadId}
                  fallback={item.threadId}
                />
              </span>
            ) : item.location?.startsWith("https://") ? (
              <UrlLink href={item.location}>{item.label}</UrlLink>
            ) : target ? (
              <FileLink
                target={target}
                location={
                  item.line
                    ? {
                        kind: "range",
                        startLine: item.line,
                        endLine: item.endLine ?? item.line,
                      }
                    : null
                }
              >
                {item.label}
              </FileLink>
            ) : (
              <span>
                {item.label}
                {item.location ? (
                  <code className="ml-2 text-[0.85em] text-muted-foreground [overflow-wrap:anywhere]">
                    {item.location}
                    {item.line
                      ? `:${item.line}${item.endLine ? `–${item.endLine}` : ""}`
                      : ""}
                  </code>
                ) : null}
              </span>
            )}
            <PlainMarkdown content={item.detail} document={document} />
          </li>
        );
      })}
    </ul>
  );
}
