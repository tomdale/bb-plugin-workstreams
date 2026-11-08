import type { ComponentProps } from "react";
import {
  Markdown,
  UrlLink,
  experimental_FileLink as FileLink,
} from "@get-bb/plugin-sdk/app";
import { fileTarget, type RecapFiles } from "../../domain/recap.ts";
import { normalizeReplyMarkdown } from "./markdown.ts";
import { ActionsBody } from "./ActionsBody.tsx";
import { DetailsBody } from "./DetailsBody.tsx";
import { FactsBody } from "./FactsBody.tsx";
import { ChecksBody, DeliveryBody } from "./StateBody.tsx";
import { TableBody } from "./TableBody.tsx";
import { arrangeBody } from "../../domain/replyPanel.ts";
import { LABEL_CLASS } from "../recap/marks.tsx";
import { PIECE_TITLE_CLASS } from "./TableBody.tsx";
import {
  evidenceFilePath,
  type ReplyEvidence,
  type ReplyPart,
} from "../../domain/replyComponents.ts";

type Document = ComponentProps<typeof Markdown>["experimental_document"];
type Context = { document: Document; files: RecapFiles | null };

export const PLAIN_LIST_CLASS = "mb-2 pl-5 text-foreground [&>li]:mb-1";

export function PlainMarkdown({
  content,
  document,
}: {
  content: string | undefined;
  document: Document;
}) {
  return content ? (
    <Markdown
      content={normalizeReplyMarkdown(content)}
      experimental_document={document}
    />
  ) : null;
}

function Evidence({
  items,
  document,
  files,
}: Context & { items?: ReplyEvidence[] }) {
  if (!items?.length) return null;
  return (
    <ul className={`${PLAIN_LIST_CLASS} list-disc`}>
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

export function PlainBody({
  part,
  document,
  files,
}: Context & { part: ReplyPart }) {
  const md = (content: string | undefined) => (
    <PlainMarkdown content={content} document={document} />
  );
  const evidence = (items: ReplyEvidence[] | undefined) => (
    <Evidence items={items} document={document} files={files} />
  );
  switch (part.type) {
    case "text":
      return md(part.body);
    case "directive":
      // A document context disables BB's inherited message directive renderers.
      return <Markdown content={part.source} />;
    case "pending":
      return <p role="status">Receiving information…</p>;
    case "unparsed":
      return (
        <>
          {md(part.error)}
          {md(part.source)}
        </>
      );
    case "actions":
      return <ActionsBody part={part} md={md} />;
    case "facts":
      return <FactsBody part={part} md={md} />;
    case "table":
      return <TableBody part={part} md={md} />;
    case "change": {
      const notes: [string, string][] = [];
      if (part.unchanged) notes.push(["Unchanged", part.unchanged]);
      if (part.limitation) notes.push(["Limitation", part.limitation]);
      const row = ([label, value]: [string, string]) => (
        <div
          key={label}
          data-reply-change-row={label.toLowerCase()}
          className="col-span-full grid grid-cols-subgrid gap-y-0.5 py-2 @max-[24rem]/change:grid-cols-1"
        >
          <dt
            className={`${LABEL_CLASS} whitespace-nowrap text-(--ws-reply-accent,var(--muted-foreground))`}
          >
            {label}
          </dt>
          <dd className="m-0 min-w-0 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            {md(value)}
          </dd>
        </div>
      );
      return (
        <div data-reply-change="" className="@container/change min-w-0">
          <h3 className={`${PIECE_TITLE_CLASS} mb-1`}>{md(part.title)}</h3>
          {/* The recap card's label gutter, widened to fit its longest label
              and shared by every row; labels stack above values when narrow. */}
          <dl className="m-0 grid grid-cols-[minmax(3.25rem,max-content)_minmax(0,1fr)] gap-x-3 divide-y divide-border @max-[24rem]/change:grid-cols-1">
            <div
              data-reply-change-pair=""
              className="col-span-full grid grid-cols-subgrid divide-y divide-border"
            >
              {row(["Before", part.before])}
              {row(["After", part.after])}
            </div>
            {notes.map(row)}
          </dl>
        </div>
      );
    }
    case "checks":
      return <ChecksBody part={part} md={md} evidence={evidence} />;
    case "delivery":
      return <DeliveryBody part={part} md={md} evidence={evidence} />;
    case "details":
      return <DetailsBody part={part} md={md} />;
  }
}

/**
 * A reply's headline and body in panel order: the lead, then what needs the
 * reader, then the rest as written, then the folds. The message block and
 * the galleries both draw replies through it.
 */
export function ReplyPanel({
  headline,
  body,
  document,
  files,
}: Context & { headline: string | undefined; body: readonly ReplyPart[] }) {
  return (
    <>
      {headline ? (
        <PlainMarkdown content={`# ${headline}`} document={document} />
      ) : null}
      {arrangeBody(body).map((part, i) => (
        <PlainBody key={i} part={part} document={document} files={files} />
      ))}
    </>
  );
}
