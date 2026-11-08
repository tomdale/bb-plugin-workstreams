import { Fragment, type ComponentProps } from "react";
import {
  Markdown,
  UrlLink,
  experimental_FileLink as FileLink,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { fileTarget, type RecapFiles } from "../../domain/recap.ts";
import { normalizeReplyMarkdown } from "./markdown.ts";
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
const CHECK_STATUS_ICON: Record<CheckStatus, string> = {
  passed: "Check",
  failed: "X",
  skipped: "Circle",
  blocked: "Circle",
  untested: "Circle",
};
const CHECK_STATUS_TONE: Record<CheckStatus, string> = {
  passed: "text-(--ws-complete-text)",
  failed: "text-(--ws-failure-text)",
  skipped: "text-muted-foreground",
  blocked: "text-muted-foreground",
  untested: "text-muted-foreground",
};

function CheckStatusMark({ status }: { status: CheckStatus }) {
  return (
    <span
      data-reply-check-status={status}
      className={`inline-flex shrink-0 items-center gap-1.5 text-[0.85em] leading-[1.6] ${CHECK_STATUS_TONE[status]}`}
    >
      <Icon name={CHECK_STATUS_ICON[status]} aria-hidden className="size-3" />
      {CHECK_STATUS_LABEL[status]}
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
    case "change": {
      const notes: [string, string][] = [];
      if (part.unchanged) notes.push(["Unchanged", part.unchanged]);
      if (part.limitation) notes.push(["Limitation", part.limitation]);
      return (
        <div
          data-reply-change=""
          className="@container/change min-w-0 space-y-3"
        >
          {title(part.title)}
          <div
            data-reply-change-pair=""
            className="grid min-w-0 grid-cols-1 divide-y divide-border border-y border-border @min-[32rem]/change:grid-cols-2 @min-[32rem]/change:divide-x @min-[32rem]/change:divide-y-0"
          >
            {(
              [
                ["Before", part.before],
                ["After", part.after],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="min-w-0 px-3 py-3">
                <p className="mb-1.5 mt-0 text-[0.8em] font-medium text-muted-foreground">
                  {label}
                </p>
                <div className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
                  {md(value)}
                </div>
              </div>
            ))}
          </div>
          {notes.length ? (
            <dl className="m-0 divide-y divide-border text-[0.9em]">
              {notes.map(([label, value]) => (
                <div
                  key={label}
                  className="grid min-w-0 gap-1 py-2.5 @min-[24rem]/change:grid-cols-[5rem_minmax(0,1fr)] @min-[24rem]/change:gap-3"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="m-0 min-w-0">{md(value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
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
        <div data-reply-checks="" className="min-w-0 space-y-3">
          <div className="space-y-1">
            {title(part.title)}
            <div className="text-[0.85em] leading-[1.7] text-muted-foreground">
              {md(part.scope)}
            </div>
          </div>
          {totals.length ? (
            <ul
              aria-label="Reported test totals"
              className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0"
            >
              {totals.map(([status, count]) => (
                <li
                  key={status}
                  data-reply-test-total={status}
                  className="flex items-baseline gap-1.5"
                >
                  <span
                    className={`text-[1.35em] font-medium tabular-nums leading-[1.2] ${
                      count === 0
                        ? "text-muted-foreground"
                        : status === "passed"
                          ? "text-(--ws-complete-text)"
                          : status === "failed"
                            ? "text-(--ws-failure-text)"
                            : "text-muted-foreground"
                    }`}
                  >
                    {count.toLocaleString()}
                  </span>
                  <span className="text-[0.8em] text-muted-foreground">
                    {status}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <ul
            data-reply-check-items=""
            className="m-0 list-none divide-y divide-border p-0"
          >
            {part.items.map((item, i) => (
              <li
                key={i}
                data-reply-check-item={item.status}
                className="min-w-0 space-y-1.5 py-3 first:pt-0"
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0 font-medium [&_p]:m-0">
                    {md(item.name)}
                  </div>
                  <CheckStatusMark status={item.status} />
                </div>
                {item.detail ? (
                  <div className="text-[0.9em] text-muted-foreground [&_p]:my-1">
                    {md(item.detail)}
                  </div>
                ) : null}
                {item.evidence?.length ? evidence(item.evidence) : null}
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
