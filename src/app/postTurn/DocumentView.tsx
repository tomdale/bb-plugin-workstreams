/**
 * Draws an enhanced response document. The appended view in BB and the
 * preview tool's screenshots both render this component, so what the
 * presentation model inspects is what a reader sees.
 *
 * It imports nothing from the BB SDK: the preview host renders it to static
 * markup outside BB, with no script. Anything interactive is supplied by the
 * caller (the Copy action, its icon from BB's icon set, and a plan's Approve
 * and replies), and folded content uses `<details>`, which opens without
 * script.
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
import { Button } from "../../../components/ui/button.tsx";
import {
  checksSummary,
  foldedTotals,
  isPlanDocument,
  plainText,
  scopeQualifier,
  totalsText,
  type Block,
  type EnhancedDocument,
  type Plan,
  type RichText,
} from "../../domain/postTurn/document.ts";
import { splitThreadMentions } from "../../domain/threadMentions.ts";
import type {
  DocumentWorkstream,
  PlanOutcome,
} from "../../domain/postTurn/message.ts";
import { workstreamColorStyle } from "../../domain/workstreamColor.ts";
import { CHECK, Glyph, MARK_CLASS } from "../recap/marks.tsx";
import { STATUS_ROW_CLASS, StatusMark, StatusWord } from "../reply/Panel.tsx";
import { CHECK_STATUS, reportsFailure } from "../reply/status.ts";
import { SECONDARY_CLASS } from "../reply/type.ts";

/** Attribute naming each block's field path, so diagnostics point at it. */
const PATH = "data-doc-path";

const CHEVRON = "M6 4 10 8 6 12";
const CHEVRON_UP = "M4 10 8 6 12 10";
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

/**
 * What a plan's reader can do. Without it, as in the preview, an open plan is
 * drawn with Approve and its replies, which do nothing.
 */
export type PlanControls = {
  outcome: PlanOutcome | null;
  /** An answer on its way: drawn as sent, with every control disabled. */
  sending: { kind: "approve" } | { kind: "reply"; message: string } | null;
  /** Why the last answer was not sent. */
  error: string | null;
  onApprove: () => void;
  onReply: (message: string) => void;
};

function CopyButton({ copy }: { copy: DocumentCopy }) {
  return (
    <button
      type="button"
      onClick={copy.onClick}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] leading-[18px] text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {copy.icon}
      {copy.label}
    </button>
  );
}

/** A plan's divided section, such as Risks or Notes. */
function PlanSection({
  title,
  path,
  children,
}: {
  title: string;
  path: string;
  children: ReactNode;
}) {
  return (
    <section
      {...{ [PATH]: path }}
      className="border-t border-border pt-3.5 pb-4"
    >
      <h4 className="m-0 mb-2 text-[13px] font-semibold leading-4">{title}</h4>
      {children}
    </section>
  );
}

/**
 * A plan awaiting approval, drawn without the document surface: the Plan
 * label, its title and summary, numbered steps, risks, notes, and Approve, all
 * at a reading measure, then the suggested replies across the full width.
 * Once the plan is answered, Approve gives way to a sent line or is disabled,
 * and the replies to the one that was sent or to nothing.
 */
function PlanView({
  plan,
  copy,
  controls,
}: {
  plan: Plan;
  copy: DocumentCopy;
  controls?: PlanControls;
}) {
  const outcome = controls?.outcome ?? null;
  const sending = controls?.sending ?? null;
  const approved = outcome?.kind === "approved" || sending?.kind === "approve";
  const sent =
    outcome?.kind === "replied"
      ? outcome.message
      : sending?.kind === "reply"
        ? sending.message
        : null;
  const open = outcome === null;
  const busy = sending !== null;
  const replies = plan.replies ?? [];
  return (
    <section
      data-ws-document=""
      data-ws-plan=""
      className="@container/plan min-w-0 text-[13px] leading-[21px] text-foreground [overflow-wrap:break-word]"
    >
      <div className="max-w-[420px]">
        <header className="flex min-w-0 items-center gap-3">
          <span className="min-w-0 flex-1 text-[13px] font-semibold leading-4">
            Plan
          </span>
          <CopyButton copy={copy} />
        </header>
        <h3
          {...{ [PATH]: "plan.title" }}
          className="m-0 mt-2 mb-1.5 text-[23px] font-semibold leading-[27px] tracking-[-0.01em] [text-wrap:balance]"
        >
          <Rich text={plan.title} />
        </h3>
        {plan.summary ? (
          <p
            {...{ [PATH]: "plan.summary" }}
            className="m-0 mb-5 text-[15px] leading-[22px] [text-wrap:pretty]"
          >
            <Rich text={plan.summary} />
          </p>
        ) : null}
        <ol role="list" className="m-0 list-none p-0 pb-[18px]">
          {plan.steps.map((step, i) => (
            <li
              key={i}
              {...{ [PATH]: `plan.steps[${i}]` }}
              className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-2.5 pb-4 last:pb-0"
            >
              {i < plan.steps.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute top-6 bottom-0 left-[11.5px] w-px bg-border"
                />
              ) : null}
              <span
                aria-hidden
                className="flex size-6 items-center justify-center rounded-full border border-border text-[12px] leading-4 tabular-nums text-muted-foreground" /* slop-ok: 1 Tom approved the numbered step rail in the plan design */
              >
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="m-0 font-semibold [text-wrap:pretty]">
                  <Rich text={step.title} />
                </p>
                {step.detail ? (
                  <p className="m-0 mt-[3px] text-[12px] leading-4 text-muted-foreground [text-wrap:pretty]">
                    <Rich text={step.detail} />
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {plan.risks ? (
          <PlanSection title="Risks" path="plan.risks">
            <ul className="m-0 list-disc space-y-1.5 pl-5">
              {plan.risks.map((risk, i) => (
                <li key={i} className="[text-wrap:pretty]">
                  <Rich text={risk} />
                </li>
              ))}
            </ul>
          </PlanSection>
        ) : null}
        {plan.notes ? (
          <PlanSection title="Notes" path="plan.notes">
            <div className="flex flex-col gap-2">
              {plan.notes.map((note, i) => (
                <p key={i} className="m-0 [text-wrap:pretty]">
                  {note.label ? (
                    <>
                      <strong className="font-semibold">
                        <Rich text={note.label} />:
                      </strong>{" "}
                    </>
                  ) : null}
                  <Rich text={note.text} />
                </p>
              ))}
            </div>
          </PlanSection>
        ) : null}
        {approved ? (
          <p
            role="status"
            data-plan-approved=""
            className="m-0 flex items-center gap-1.5 border-t border-border pt-4 text-[12px] leading-4 text-muted-foreground"
          >
            <Glyph
              path={CHECK}
              className="h-3.5 w-3.5 shrink-0 text-(--ws-complete-text)"
            />
            Approved
          </p>
        ) : outcome?.kind === "superseded" ? null : (
          <div className="border-t border-border pt-4">
            <Button
              type="button"
              size="sm"
              data-plan-approve=""
              disabled={controls ? !open || busy : undefined}
              onClick={controls?.onApprove}
              className="h-8 px-3 text-[13px] font-semibold"
            >
              Approve
            </Button>
          </div>
        )}
        {controls?.error ? (
          <p
            role="alert"
            className="m-0 mt-2 text-[12px] leading-4 text-destructive"
          >
            {controls.error}
          </p>
        ) : null}
      </div>
      {sent !== null ? (
        <div className="mt-4 flex justify-end">
          <p
            role="status"
            aria-label={`Sent: ${sent}`}
            data-plan-sent=""
            className="m-0 max-w-[85%] rounded-xl border border-border bg-surface-recessed px-3 py-[9px] [text-wrap:pretty]" /* slop-ok: 1 Tom approved the sent reply bubble in the plan design */
          >
            {sent}
          </p>
        </div>
      ) : open && !approved && replies.length ? (
        <div
          role="group"
          aria-label="Suggested replies"
          {...{ [PATH]: "plan.replies" }}
          className="mt-4 grid grid-cols-2 gap-1.5 @min-[40rem]/plan:grid-cols-4"
        >
          {replies.map((reply, i) => (
            <button
              key={i}
              type="button"
              data-plan-reply=""
              disabled={controls ? busy : undefined}
              onClick={() => controls?.onReply(reply)}
              {...{ [PATH]: `plan.replies[${i}]` }}
              className="flex min-h-[34px] min-w-0 cursor-pointer items-center justify-between gap-1 rounded-lg border border-dashed border-input py-[5px] pr-2 pl-2.5 text-left text-[12px] leading-4 text-foreground hover:border-solid hover:border-border hover:bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:hover:border-dashed disabled:hover:border-input disabled:hover:bg-transparent" /* slop-ok: 1 Tom approved dashed reply drafts in the plan design */
            >
              <span className="min-w-0">{reply}</span>
              <Glyph
                path={CHEVRON_UP}
                className="h-3 w-3 shrink-0 text-muted-foreground"
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function DocumentView({
  document,
  workstream,
  copy,
  plan,
}: {
  document: EnhancedDocument;
  workstream: DocumentWorkstream | null;
  copy: DocumentCopy;
  plan?: PlanControls;
}) {
  if (isPlanDocument(document))
    return <PlanView plan={document.plan} copy={copy} controls={plan} />;
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
        <CopyButton copy={copy} />
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
