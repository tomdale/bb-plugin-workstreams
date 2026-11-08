import type { ReactNode } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { RecapFiles } from "../../domain/recap.ts";
import type { ReplyPart } from "../../domain/replyComponents.ts";
import { ComparisonBody, RecommendationBody } from "./AdviceBody.tsx";
import { ChangeBody } from "./ChangeBody.tsx";
import { CheckRows, TestTotals } from "./ChecksBody.tsx";
import { ContextBody } from "./ContextBody.tsx";
import { DeliveryStages } from "./DeliveryBody.tsx";
import { DetailsBody } from "./DetailsBody.tsx";
import { Evidence, PlainMarkdown, type ReplyDocument } from "./Evidence.tsx";
import { ActionsBody } from "./ActionsBody.tsx";
import { TableBody } from "./TableBody.tsx";
import { GroupBody } from "./GroupBody.tsx";
import { PANEL_ROW_CLASS, Panel } from "./Panel.tsx";
import { PartTitle, titleMarkdown } from "./PartTitle.tsx";
import { SequenceBody } from "./SequenceBody.tsx";
import { partReportsFailure } from "./status.ts";
import { BODY_CLASS, SECONDARY_CLASS } from "./type.ts";

export { PlainMarkdown };

type Context = {
  document: ReplyDocument;
  files: RecapFiles | null;
  threadId?: string | null;
};

/**
 * The parts whose data is a list of parallel rows, and which therefore draw a
 * panel. A part with one subject — context, a recommendation, supporting
 * detail — draws its label and no frame, and prose is never framed.
 */
const ROW_PARTS = new Set<ReplyPart["type"]>([
  "checks",
  "delivery",
  "sequence",
  "comparison",
  "change",
  "table",
  "references",
  "review",
  "actions",
]);

/**
 * One part of a reply.
 *
 * `framed` is false for a part drawn inside another part's panel, such as a
 * child of a supporting group: that frame is the only frame, so the child draws
 * its rows flush and without a border of its own.
 */
export function PlainBody({
  part,
  document,
  files,
  framed = true,
  threadId = null,
}: Context & { part: ReplyPart; framed?: boolean }) {
  const md = (content: string | undefined) => (
    <PlainMarkdown content={content} document={document} />
  );
  const title = (value: string | undefined) =>
    value ? <PartTitle>{md(titleMarkdown(value))}</PartTitle> : null;
  const panelled = framed && ROW_PARTS.has(part.type);
  /** The part's own marker, on its root whether that root is a panel or not. */
  const mark = (type: string) => ({ [`data-reply-${type}`]: "" });
  const pad = panelled ? PANEL_ROW_CLASS : "";
  const report = (name: string, rows: ReactNode, scope?: string) =>
    panelled ? (
      <Panel
        // slop-ok: 2 Shared reply-list frame already used at this rendering boundary
        part={part.type}
        title={title(name)}
        scope={scope ? md(scope) : undefined}
      >
        {rows}
      </Panel>
    ) : (
      <div {...mark(part.type)} className="min-w-0 [overflow-wrap:anywhere]">
        {title(name)}
        {scope ? (
          <div className={`${SECONDARY_CLASS} text-muted-foreground [&_p]:m-0`}>
            {md(scope)}
          </div>
        ) : null}
        {rows}
      </div>
    );
  switch (part.type) {
    case "text":
      return md(part.body);
    case "directive":
      // A document context disables BB's inherited message directive renderers.
      return <Markdown content={part.source} />;
    case "pending":
      return (
        <p
          role="status"
          className={`m-0 ${SECONDARY_CLASS} text-muted-foreground`}
        >
          Receiving information…
        </p>
      );
    case "unparsed":
      return (
        <>
          {md(part.error)}
          {md(part.source)}
        </>
      );
    case "context":
      return <ContextBody part={part} md={md} />;
    case "comparison": {
      const rows = <ComparisonBody part={part} md={md} />;
      return panelled ? (
        <Panel part="comparison" title={title(part.title)}>
          {rows}
        </Panel>
      ) : (
        <div {...mark("comparison")} className="min-w-0">
          {title(part.title)}
          {rows}
        </div>
      );
    }
    case "sequence": {
      const rows = <SequenceBody part={part} md={md} pad={pad} />;
      return panelled ? (
        <Panel part="sequence" title={title(part.title)}>
          {rows}
        </Panel>
      ) : (
        <div {...mark("sequence")} className="min-w-0">
          {title(part.title)}
          {rows}
        </div>
      );
    }
    case "table":
      return report(
        part.title,
        <TableBody part={part} md={md} pad={panelled ? "px-3.5" : ""} />,
        part.scope,
      );
    case "references":
      return report(
        part.title,
        <div className={pad}>
          <Evidence items={part.items} document={document} files={files} />
        </div>,
      );
    case "review":
      return report(
        part.title,
        <SequenceBody part={part} md={md} pad={pad} />,
        part.scope,
      );
    case "actions":
      return report(
        part.title,
        <ActionsBody part={part} md={md} threadId={threadId} pad={pad} />,
        part.scope,
      );
    case "change": {
      const rows = <ChangeBody part={part} md={md} pad={pad} />;
      return panelled ? (
        <Panel part="change" title={title(part.title)}>
          {rows}
        </Panel>
      ) : (
        <div {...mark("change")} className="min-w-0">
          {title(part.title)}
          {rows}
        </div>
      );
    }
    case "checks": {
      const rows = (
        <CheckRows
          part={part}
          document={document}
          files={files}
          md={md}
          pad={pad}
        />
      );
      return panelled ? (
        <Panel
          part="checks"
          failed={partReportsFailure(part)}
          title={title(part.title)}
          scope={md(part.scope)}
          summary={
            part.testTotals ? <TestTotals totals={part.testTotals} /> : null
          }
        >
          {rows}
        </Panel>
      ) : (
        <div {...mark("checks")} className="min-w-0">
          {title(part.title)}
          <div className={`${SECONDARY_CLASS} text-muted-foreground [&_p]:m-0`}>
            {md(part.scope)}
          </div>
          {part.testTotals ? <TestTotals totals={part.testTotals} /> : null}
          {rows}
        </div>
      );
    }
    case "delivery": {
      const rows = (
        <DeliveryStages
          part={part}
          document={document}
          files={files}
          md={md}
          pad={pad}
        />
      );
      return panelled ? (
        <Panel
          part="delivery"
          failed={partReportsFailure(part)}
          title={title(part.title)}
          scope={md(part.scope)}
        >
          {rows}
        </Panel>
      ) : (
        <div {...mark("delivery")} className="min-w-0">
          {title(part.title)}
          <div className={`${SECONDARY_CLASS} text-muted-foreground [&_p]:m-0`}>
            {md(part.scope)}
          </div>
          {rows}
        </div>
      );
    }
    case "recommendation":
      return <RecommendationBody part={part} md={md} />;
    case "details":
      return <DetailsBody part={part} md={md} />;
    case "group":
      return (
        <GroupBody
          part={part}
          renderChild={(child) => (
            <PlainBody
              part={child}
              document={document}
              files={files}
              framed={false}
              threadId={threadId}
            />
          )}
        />
      );
  }
}

/** A bullet list the reply writes itself: evidence under a check, a step's sources. */
export const PLAIN_LIST_CLASS = `mb-2 pl-5 text-foreground [&>li]:mb-1 ${BODY_CLASS}`;
