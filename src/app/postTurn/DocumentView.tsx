/**
 * Draws an enhanced response document. The appended view in BB and the
 * preview tool's screenshots both render this component, so what the
 * presentation model inspects is what a reader sees.
 *
 * It imports nothing from the BB SDK: the preview host renders it to static
 * markup outside BB, with no script. Anything interactive is supplied by the
 * caller (the Copy action, and its icon from BB's icon set), and folded
 * content uses `<details>`, which opens without script.
 *
 * Every string is rendered as React text, so a document's content can never
 * become markup.
 */
import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  checksSummary,
  foldedTotals,
  plainText,
  scopeQualifier,
  totalsText,
  type Block,
  type EnhancedDocument,
  type RichText,
} from "../../domain/postTurn/document.ts";
import { splitThreadMentions } from "../../domain/threadMentions.ts";
import type { DocumentWorkstream } from "../../domain/postTurn/message.ts";
import { workstreamColorStyle } from "../../domain/workstreamColor.ts";
import { Glyph, MARK_CLASS } from "../recap/marks.tsx";
import { STATUS_ROW_CLASS, StatusMark, StatusWord } from "../reply/Panel.tsx";
import { CHECK_STATUS, reportsFailure } from "../reply/status.ts";
import { SECONDARY_CLASS } from "../reply/type.ts";

/** Attribute naming each block's field path, so diagnostics point at it. */
const PATH = "data-doc-path";

const CHEVRON = "M6 4 10 8 6 12";
const INFO =
  "M8 2.75a5.25 5.25 0 1 0 0 10.5 5.25 5.25 0 1 0 0-10.5Z M8 7.25v3.5 M8 5.25v.01";

/**
 * Draws a thread mention. The caller supplies it because a thread chip needs
 * the SDK; without one, as in the preview, a mention stays the text it was
 * written as.
 */
export const ThreadMention = createContext<
  ((threadId: string) => ReactNode) | null
>(null);

/** A literal string, with each `@thread:<id>` mention drawn by `ThreadMention`. */
function Literal({ text }: { text: string }) {
  const mention = useContext(ThreadMention);
  if (!mention) return <>{text}</>;
  return (
    <>
      {splitThreadMentions(text).map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <span
            key={i}
            className="-my-[0.5em] inline-block max-w-[16rem] align-middle leading-none [&>a]:text-[0.85em]"
          >
            {mention(part.threadId)}
          </span>
        ),
      )}
    </>
  );
}

function Rich({ text }: { text: RichText }) {
  if (typeof text === "string") return <Literal text={text} />;
  return (
    <>
      {text.map((span, i) =>
        typeof span === "string" ? (
          <span key={i}>
            <Literal text={span} />
          </span>
        ) : (
          <code
            key={i}
            className="rounded-sm bg-surface-recessed px-1 py-px font-mono text-[12px]"
          >
            {span.code}
          </code>
        ),
      )}
    </>
  );
}

function Checks({
  block,
  path,
}: {
  block: Extract<Block, { type: "checks" }>;
  path: string;
}) {
  const failing = block.items.some((item) => reportsFailure(item.result));
  const qualifier = scopeQualifier(block.scope);
  const summary = block.title
    ? plainText(block.title)
    : checksSummary(block.items, qualifier);
  const folded = foldedTotals(block.items);
  return (
    <details
      {...{ [PATH]: path }}
      data-doc-checks=""
      open={failing || undefined}
      className={`group/checks min-w-0 rounded-lg border ${
        failing ? "border-(--ws-failed-border)" : "border-border"
      }`}
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-2 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <Glyph
          path={CHEVRON}
          className={`${MARK_CLASS} shrink-0 self-start text-muted-foreground transition-transform group-open/checks:rotate-90`}
        />
        <span
          className={`min-w-0 flex-1 font-medium ${
            failing ? "text-(--ws-failed-text)" : "text-foreground"
          }`}
        >
          {summary}
        </span>
        {folded ? (
          <span
            data-doc-folded-totals=""
            className={`shrink-0 text-muted-foreground ${SECONDARY_CLASS}`}
          >
            {folded}
          </span>
        ) : null}
      </summary>
      {block.scope && !qualifier ? (
        <p
          className={`m-0 px-3.5 pb-1 text-muted-foreground ${SECONDARY_CLASS}`}
        >
          <Rich text={block.scope} />
        </p>
      ) : null}
      <ul className="m-0 list-none divide-y divide-border border-t border-border p-0">
        {block.items.map((item, i) => {
          const status = CHECK_STATUS[item.result];
          return (
            <li
              key={i}
              {...{ [PATH]: `${path}.items[${i}]` }}
              className={`${STATUS_ROW_CLASS} px-3.5 py-2`}
            >
              <StatusMark status={status} />
              <div className="min-w-0">
                <div
                  className={reportsFailure(item.result) ? "font-medium" : ""}
                >
                  <Rich text={item.name} />
                </div>
                {item.totals ? (
                  <div
                    className={`mt-0.5 tabular-nums text-muted-foreground ${SECONDARY_CLASS}`}
                  >
                    {totalsText(item.totals)}
                  </div>
                ) : null}
                {item.detail ? (
                  <div
                    className={`mt-0.5 text-muted-foreground ${SECONDARY_CLASS}`}
                  >
                    <Rich text={item.detail} />
                  </div>
                ) : null}
              </div>
              <StatusWord status={status} />
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Table({
  block,
  path,
}: {
  block: Extract<Block, { type: "table" }>;
  path: string;
}) {
  const label = block.title ? plainText(block.title) : undefined;
  return (
    <figure {...{ [PATH]: path }} className="m-0 min-w-0">
      {block.title ? (
        <figcaption className="mb-1 font-medium text-foreground">
          <Rich text={block.title} />
        </figcaption>
      ) : null}
      <div
        role="region"
        aria-label={label ?? "Table"}
        tabIndex={0}
        data-doc-scroll=""
        className="min-w-0 overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {block.columns.map((column, i) => (
                <th
                  key={i}
                  scope="col"
                  className="border-b border-border py-2 pr-4 align-bottom font-medium whitespace-nowrap text-muted-foreground last:pr-0"
                >
                  <Rich text={column} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i} {...{ [PATH]: `${path}.rows[${i}]` }}>
                {row.map((value, j) => (
                  <td
                    key={j}
                    className={`border-b border-border py-2 pr-4 align-top tabular-nums last:pr-0 ${
                      typeof value === "number" ? "whitespace-nowrap" : ""
                    }`}
                  >
                    {typeof value === "number" ? (
                      value.toLocaleString("en-US")
                    ) : (
                      <Rich text={value} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.caption ? (
        <p className={`m-0 mt-2 text-muted-foreground ${SECONDARY_CLASS}`}>
          <Rich text={block.caption} />
        </p>
      ) : null}
    </figure>
  );
}

/**
 * Blocks in order. The first top-level section's title is the document's
 * headline, in the workstream's color; later top-level sections take a plain
 * heading, and a nested section a smaller one.
 */
function Blocks({
  blocks,
  path,
  depth,
}: {
  blocks: readonly Block[];
  path: string;
  depth: number;
}) {
  const headline =
    depth === 0 ? blocks.findIndex((block) => block.type === "section") : -1;
  return (
    <>
      {blocks.map((block, i) => {
        const at = `${path}[${i}]`;
        const data = { [PATH]: at };
        switch (block.type) {
          case "paragraph":
            return (
              <p key={i} {...data} className="m-0">
                <Rich text={block.text} />
              </p>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={i}
                {...data}
                className={`m-0 space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
              >
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Rich text={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "note":
            return (
              <div
                key={i}
                {...data}
                data-doc-note=""
                className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-2.5 rounded-lg border border-(--ws-review-border) bg-(--ws-review-surface) px-3.5 py-2.5" /* slop-ok: 1 Tom approved this bordered note in the C07 design */
              >
                <Glyph
                  path={INFO}
                  className={`${MARK_CLASS} text-(--ws-review-text)`}
                />
                <p className="m-0">
                  <Rich text={block.text} />
                </p>
              </div>
            );
          case "callout":
            return (
              <div
                key={i}
                {...data}
                data-doc-callout=""
                className="rounded-lg border border-(--ws-review-border) bg-(--ws-review-surface) px-4 py-3" /* slop-ok: 1 Tom approved this bordered callout in the C11 design */
              >
                {block.label ? (
                  <p
                    className={`m-0 font-medium text-(--ws-review-text) ${SECONDARY_CLASS}`}
                  >
                    <Rich text={block.label} />
                  </p>
                ) : null}
                <p className="m-0 text-[15px] font-semibold leading-[22px] text-foreground">
                  <Rich text={block.title} />
                </p>
                {block.text ? (
                  <p className="m-0 mt-1 text-muted-foreground">
                    <Rich text={block.text} />
                  </p>
                ) : null}
              </div>
            );
          case "checks":
            return <Checks key={i} block={block} path={at} />;
          case "table":
            return <Table key={i} block={block} path={at} />;
          case "section":
            return (
              <section
                key={i}
                {...data}
                className="flex min-w-0 flex-col gap-3"
              >
                {headline === i ? (
                  <h3 className="ws-workstream-name m-0 text-[16px] font-semibold leading-[23px]">
                    <Rich text={block.title} />
                  </h3>
                ) : depth === 0 ? (
                  <h3 className="m-0 text-[15px] font-semibold leading-[22px] text-foreground">
                    <Rich text={block.title} />
                  </h3>
                ) : (
                  <h4 className="m-0 text-[13px] font-semibold leading-[19px] text-foreground">
                    <Rich text={block.title} />
                  </h4>
                )}
                <Blocks
                  blocks={block.blocks}
                  path={`${at}.blocks`}
                  depth={depth + 1}
                />
              </section>
            );
        }
      })}
    </>
  );
}

export type DocumentCopy = {
  label: string;
  icon: ReactNode;
  /** Absent in the preview, where the button is drawn but does nothing. */
  onClick?: () => void;
};

export function DocumentView({
  document,
  workstream,
  copy,
}: {
  document: EnhancedDocument;
  workstream: DocumentWorkstream | null;
  copy: DocumentCopy;
}) {
  const style = (
    workstream?.color ? workstreamColorStyle(workstream.color) : {}
  ) as CSSProperties;
  return (
    <section
      data-ws-document=""
      style={style}
      className="min-w-0 text-[13px] leading-[21px] text-foreground"
    >
      <header className="flex min-w-0 items-center gap-3 pb-2">
        <span className="ws-workstream-name min-w-0 flex-1 truncate text-[12px] font-medium leading-[18px]">
          {workstream?.name}
        </span>
        <button
          type="button"
          onClick={copy.onClick}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] leading-[18px] text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {copy.icon}
          {copy.label}
        </button>
      </header>
      <div
        data-doc-body=""
        className="flex min-w-0 flex-col gap-3 rounded-lg bg-surface-raised px-4 py-3.5 [overflow-wrap:break-word]" /* slop-ok: 1 Tom approved the filled, borderless document surface */
      >
        <Blocks blocks={document.blocks} path="blocks" depth={0} />
      </div>
    </section>
  );
}
