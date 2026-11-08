import { Fragment, type ComponentProps } from "react";
import {
  Markdown,
  UrlLink,
  experimental_FileLink as FileLink,
} from "@get-bb/plugin-sdk/app";
import { fileTarget, type RecapFiles } from "../../domain/recap.ts";
import { normalizeReplyMarkdown } from "./markdown.ts";
import {
  CHECK,
  Glyph,
  LABEL_CLASS,
  MARK_CLASS,
  MARK_ROW_CLASS,
} from "../recap/marks.tsx";
import {
  evidenceFilePath,
  type ReplyEvidence,
  type ReplyPart,
} from "../../domain/replyComponents.ts";

type Document = ComponentProps<typeof Markdown>["experimental_document"];
type Context = { document: Document; files: RecapFiles | null };
type CheckStatus = Extract<
  ReplyPart,
  { type: "checks" }
>["items"][number]["status"];

const CHECK_STATUS_LABEL: Record<CheckStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  blocked: "Blocked",
  untested: "Not tested",
};
// Stroked marks in the recap card's glyph style; each status has its own
// shape so the list reads without color.
const CHECK_STATUS_PATH: Record<CheckStatus, string> = {
  passed: CHECK,
  failed: "M4.5 4.5 11.5 11.5 M11.5 4.5 4.5 11.5",
  skipped: "M4.5 8H11.5",
  blocked: "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9Z M4.8 11.2 11.2 4.8",
  untested: "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9Z",
};
const CHECK_STATUS_TONE: Record<CheckStatus, string> = {
  passed: "text-(--ws-complete-text)",
  failed: "text-(--ws-failure-text)",
  skipped: "text-muted-foreground",
  blocked: "text-muted-foreground",
  untested: "text-muted-foreground",
};

/** The leading mark; its label is announced but shown only beside the name. */
function CheckStatusMark({ status }: { status: CheckStatus }) {
  return (
    <span
      data-reply-check-status={status}
      className={`flex ${CHECK_STATUS_TONE[status]}`}
    >
      <Glyph path={CHECK_STATUS_PATH[status]} className={MARK_CLASS} />
      <span className="sr-only">{CHECK_STATUS_LABEL[status]}</span>
    </span>
  );
}

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
    case "context":
      return (
        <>
          {md(part.topic)}
          {md(part.where)}
          {md(part.background)}
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
            className={`${LABEL_CLASS} whitespace-nowrap text-muted-foreground`}
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
          {title(part.title)}
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
    case "checks": {
      const totals = part.testTotals
        ? ([
            ["passed", part.testTotals.passed],
            ["failed", part.testTotals.failed],
            ["skipped", part.testTotals.skipped],
          ] as const)
        : [];
      return (
        <div data-reply-checks="" className="min-w-0">
          {title(part.title)}
          <div className="text-[0.85em] text-muted-foreground [&_p]:my-0">
            {md(part.scope)}
          </div>
          {totals.length ? (
            <ul
              aria-label="Reported test totals"
              className="m-0 mt-1 flex list-none flex-wrap gap-x-3 p-0 text-[0.85em] text-muted-foreground"
            >
              {totals.map(([status, count]) => (
                <li key={status} data-reply-test-total={status}>
                  <span
                    className={`font-medium tabular-nums ${
                      count > 0 && status === "passed"
                        ? "text-(--ws-complete-text)"
                        : count > 0 && status === "failed"
                          ? "text-(--ws-failure-text)"
                          : "text-foreground"
                    }`}
                  >
                    {count.toLocaleString()}
                  </span>{" "}
                  {status}
                </li>
              ))}
            </ul>
          ) : null}
          <ul
            data-reply-check-items=""
            className="m-0 mt-3 list-none space-y-1.5 p-0"
          >
            {part.items.map((item, i) => (
              <li
                key={i}
                data-reply-check-item={item.status}
                className={MARK_ROW_CLASS}
              >
                <CheckStatusMark status={item.status} />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 [&_p]:m-0">
                    {md(item.name)}
                    {item.status === "passed" ? null : (
                      <span
                        aria-hidden="true"
                        className={`${LABEL_CLASS} pt-0 ${CHECK_STATUS_TONE[item.status]}`}
                      >
                        {CHECK_STATUS_LABEL[item.status]}
                      </span>
                    )}
                  </div>
                  {item.detail ? (
                    <div className="mt-0.5 text-muted-foreground [&_p]:my-0">
                      {md(item.detail)}
                    </div>
                  ) : null}
                  {item.evidence?.length ? evidence(item.evidence) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    }
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
