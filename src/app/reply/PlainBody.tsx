import { Fragment, type ComponentProps } from "react";
import {
  Markdown,
  UrlLink,
  experimental_FileLink as FileLink,
} from "@get-bb/plugin-sdk/app";
import { fileTarget, type RecapFiles } from "../../domain/recap.ts";
import { normalizeReplyMarkdown } from "./markdown.ts";
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
  const title = (value: string) =>
    md(value.includes("\n") ? value : `### ${value}`);
  switch (part.type) {
    case "text":
      return md(part.body);
    case "pending":
      return <p role="status">Receiving information…</p>;
    case "unparsed":
      return (
        <>
          {md(part.error)}
          {md(part.source)}
        </>
      );
    case "context":
      return (
        <>
          {md(part.topic)}
          {md(part.where)}
          {md(part.background)}
        </>
      );
    case "finding":
      return (
        <>
          {title(part.title)}
          <p>Evidence: {part.certainty}</p>
          {md(part.explanation)}
          {md(part.consequence)}
          {evidence(part.evidence)}
        </>
      );
    case "comparison":
      return (
        <>
          {title(part.title)}
          {part.items.map((item, i) => (
            <Fragment key={i}>
              {md(item.name)}
              {item.recommended ? <p>Recommended</p> : null}
              {md(item.summary)}
              {md(item.qualification)}
              {md(item.detail)}
            </Fragment>
          ))}
        </>
      );
    case "sequence":
      return (
        <>
          {title(part.title)}
          <ol className={`${PLAIN_LIST_CLASS} list-decimal`}>
            {part.steps.map((step, i) => (
              <li key={i}>
                {md(step.title)}
                {step.attention ? <p>Attention</p> : null}
                {md(step.detail)}
              </li>
            ))}
          </ol>
        </>
      );
    case "change":
      return (
        <>
          {title(part.title)}
          {(
            [
              ["Before", part.before],
              ["After", part.after],
              ["Unchanged", part.unchanged],
              ["Limitation", part.limitation],
            ] as const
          ).map(([label, value]) =>
            value ? (
              <Fragment key={label}>
                <p>{label}:</p>
                {md(value)}
              </Fragment>
            ) : null,
          )}
        </>
      );
    case "checks":
      return (
        <>
          {title(part.title)}
          {md(part.scope)}
          {part.testTotals ? (
            <p>
              {part.testTotals.passed} tests passed; {part.testTotals.failed}{" "}
              failed; {part.testTotals.skipped} skipped
            </p>
          ) : null}
          <ul className={`${PLAIN_LIST_CLASS} list-disc`}>
            {part.items.map((item, i) => (
              <li key={i}>
                {md(item.name)}
                <p>Status: {item.status}</p>
                {md(item.detail)}
                {evidence(item.evidence)}
              </li>
            ))}
          </ul>
        </>
      );
    case "delivery":
      return (
        <>
          {title(part.title)}
          {md(part.scope)}
          <ul className={`${PLAIN_LIST_CLASS} list-disc`}>
            {part.stages.map((stage, i) => (
              <li key={i}>
                {md(stage.name)}
                <p>Status: {stage.status}</p>
                {md(stage.detail)}
                {evidence(stage.evidence)}
              </li>
            ))}
          </ul>
        </>
      );
    case "recommendation":
      return (
        <>
          {md(part.choice)}
          {md(part.reason)}
          {md(part.qualification)}
        </>
      );
    case "details":
      return (
        <>
          {title(part.title)}
          {md(part.body)}
        </>
      );
    case "group":
      return (
        <>
          {part.children.flat().map((child, i) => (
            <PlainBody key={i} part={child} document={document} files={files} />
          ))}
        </>
      );
  }
}
