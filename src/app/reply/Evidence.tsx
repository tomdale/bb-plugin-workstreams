import type { ComponentProps } from "react";
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
import { normalizeReplyMarkdown } from "./markdown.ts";
import { BODY_CLASS } from "./type.ts";

export type ReplyDocument = ComponentProps<
  typeof Markdown
>["experimental_document"];

/** Prose inside a part: the reply's own Markdown, at the reply's body size. */
export function PlainMarkdown({
  content,
  document,
}: {
  content: string | undefined;
  document: ReplyDocument;
}) {
  return content ? (
    <Markdown
      content={normalizeReplyMarkdown(content)}
      experimental_document={document}
    />
  ) : null;
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
          <li key={i}>
            {item.location?.startsWith("https://") ? (
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
              item.label
            )}
            <PlainMarkdown content={item.detail} document={document} />
          </li>
        );
      })}
    </ul>
  );
}
