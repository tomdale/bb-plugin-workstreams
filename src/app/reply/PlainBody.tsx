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
import { PlainMarkdown, type ReplyDocument } from "./Evidence.tsx";
import { GroupBody } from "./GroupBody.tsx";
import { Glyph } from "../recap/marks.tsx";
import { Panel } from "./Panel.tsx";
import { PartTitle, titleMarkdown } from "./PartTitle.tsx";
import { SequenceBody } from "./SequenceBody.tsx";
import { CHECK_STATUS, partTone } from "./status.ts";
import { INHERIT_MARKDOWN, SECONDARY_CLASS } from "./type.ts";

export { PlainMarkdown };

type Context = { document: ReplyDocument; files: RecapFiles | null };

/**
 * One part of a reply.
 *
 * Checks and a delivery report results, so they draw in a frame whose edge
 * takes the tone of their worst row. Every other part draws in the message
 * flow: a titled part as its title above its rows, a part with one subject as
 * its labels, and prose as prose.
 */
export function PlainBody({
  part,
  document,
  files,
}: Context & { part: ReplyPart }) {
  const md = (content: string | undefined) => (
    <PlainMarkdown content={content} document={document} />
  );
  const title = (value: string | undefined) =>
    value ? <PartTitle>{md(titleMarkdown(value))}</PartTitle> : null;
  /** A titled part in the message flow: the title, then its rows. */
  const titled = (type: string, value: string, rows: ReactNode) => (
    <div {...{ [`data-reply-${type}`]: "" }} className="min-w-0 space-y-1.5">
      {title(value)}
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
      // The reason is a failure the reader can act on, so it takes the failure
      // mark and text step; the source below it stays readable as written.
      return (
        <div data-reply-unparsed="" className="min-w-0 space-y-1.5">
          <div
            data-reply-unparsed-reason=""
            className={`flex min-w-0 items-baseline gap-1.5 ${SECONDARY_CLASS} text-(--ws-failure-text) ${INHERIT_MARKDOWN} [&_p]:m-0`}
          >
            <Glyph
              path={CHECK_STATUS.failed.path}
              className="h-3 w-3 shrink-0 translate-y-[1.5px]"
            />
            <div className="min-w-0">{md(part.error)}</div>
          </div>
          {md(part.source)}
        </div>
      );
    case "context":
      return <ContextBody part={part} md={md} />;
    case "comparison":
      return titled(
        "comparison",
        part.title,
        <ComparisonBody part={part} md={md} />,
      );
    case "sequence":
      return titled(
        "sequence",
        part.title,
        <SequenceBody part={part} md={md} />,
      );
    case "change":
      return titled("change", part.title, <ChangeBody part={part} md={md} />);
    case "checks":
      return (
        <Panel
          part="checks"
          tone={partTone(part)}
          title={title(part.title)}
          scope={md(part.scope)}
          summary={
            part.testTotals ? <TestTotals totals={part.testTotals} /> : null
          }
        >
          <CheckRows part={part} document={document} files={files} md={md} />
        </Panel>
      );
    case "delivery":
      return (
        <Panel
          part="delivery"
          tone={partTone(part)}
          title={title(part.title)}
          scope={md(part.scope)}
        >
          <DeliveryStages
            part={part}
            document={document}
            files={files}
            md={md}
          />
        </Panel>
      );
    case "recommendation":
      return <RecommendationBody part={part} md={md} />;
    case "details":
      return <DetailsBody part={part} md={md} />;
    case "group":
      return (
        <GroupBody
          part={part}
          renderChild={(child) => (
            <PlainBody part={child} document={document} files={files} />
          )}
        />
      );
  }
}
