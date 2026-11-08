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
import { FILE, Glyph, LINK } from "../recap/marks.tsx";
import { normalizeReplyMarkdown } from "./markdown.ts";
import { SECONDARY_TEXT } from "./type.ts";

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
 * label with no location, which is still worth reading. It sits under the row
 * at the secondary size, each link led by the recap card's file or web glyph,
 * so it reads as the row's source rather than as another claim.
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
      data-reply-evidence=""
      className={`m-0 mt-1 list-none space-y-0.5 p-0 ${SECONDARY_TEXT}`}
    >
      {items.map((item, i) => {
        const web = item.location?.startsWith("https://") ?? false;
        const path =
          item.location && !web
            ? evidenceFilePath(item.location, files?.root ?? null)
            : null;
        const target = path ? fileTarget(path, files) : null;
        const glyph = web || item.location ? (web ? LINK : FILE) : null;
        return (
          <li key={i} className="flex min-w-0 items-baseline gap-1.5">
            {glyph ? (
              <Glyph
                path={glyph}
                className="h-3 w-3 shrink-0 translate-y-[1.5px] opacity-70"
              />
            ) : null}
            <div className="min-w-0">
              {web ? (
                <UrlLink href={item.location!}>{item.label}</UrlLink>
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
            </div>
          </li>
        );
      })}
    </ul>
  );
}
