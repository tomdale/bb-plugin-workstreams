import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  Markdown,
  useRealtime,
  useRpc,
  type PluginTimelineRendererProps,
} from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import type { QuestionHistory } from "../../server/questions/history.ts";
import { questionResultRecord } from "../../server/questions/history.ts";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { QuestionAttachment } from "./QuestionAttachment.tsx";
import {
  QUESTION_CARD_CLASS,
  PROMPT_CLASS,
  MARKDOWN_CLASS,
  DETAILS_CLASS,
  QuestionOptionRow,
  QuestionOptionPreview,
} from "./question-presentation.tsx";
import { formatQuestionText } from "./question-markdown.ts";

// BB's timeline pins layout changes to the bottom. A synthetic scroll session
// lets its position keeper detach after the card grows; otherwise the disclosure
// moves upward by the expanded height. Keep this scoped to the owning scroller
// and only run it when the reader was at the bottom.
function expandAtReadingPosition(card: HTMLElement, expand: () => void) {
  const scroller = card.closest<HTMLElement>(".thread-scrollbar");
  const atBottom =
    scroller &&
    scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 4;
  if (!scroller || !atBottom) {
    expand();
    return;
  }
  const top = card.getBoundingClientRect().top;
  flushSync(expand);
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const target = Math.max(
    0,
    Math.min(max, scroller.scrollTop + card.getBoundingClientRect().top - top),
  );
  if (max - target <= 4) return;
  // Let BB refresh its scroll extent before moving away from the bottom.
  scroller.scrollTop = max;
  scroller.dispatchEvent(new Event("scroll"));
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
  scroller.scrollTop = Math.max(0, target - 5);
  scroller.dispatchEvent(new Event("scroll"));
  scroller.scrollTop = target;
  scroller.dispatchEvent(new Event("scroll"));
}

export function QuestionHistoryCard({ record }: { record: QuestionHistory }) {
  const scope = usePortalScopeProps();
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      data-bb-plugin-root=""
      data-bb-plugin={scope["data-bb-plugin"]}
      data-ws-question-history=""
      data-ws-question-result={
        record.result ? JSON.stringify(record.result) : undefined
      }
      className={cn(QUESTION_CARD_CLASS, "my-2")}
      role="region"
      aria-label="Question and answer"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(event) => {
          if (expanded) {
            setExpanded(false);
          } else {
            expandAtReadingPosition(event.currentTarget.parentElement!, () =>
              setExpanded(true),
            );
          }
        }}
        className="flex w-full cursor-pointer items-start gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-muted-foreground">
            Question ·{" "}
            {record.status === "unknown" ? "Answer unavailable" : record.status}
          </span>
          {!expanded ? (
            <span className="mt-2 block space-y-2">
              {record.payload.questions.map((q) => {
                const submitted = record.result?.submission?.answers[q.id];
                const annotation = record.result?.annotations?.[q.prompt];
                const attachments =
                  submitted?.attachments ?? annotation?.attachments ?? [];
                const parts = submitted
                  ? [
                      ...submitted.selected.map(
                        (value) =>
                          q.options.find((option) => option.value === value)
                            ?.label ?? value,
                      ),
                      submitted.freeText,
                      ...attachments.map((attachment) => attachment.name),
                    ].filter(Boolean)
                  : [
                      record.result?.answers[q.prompt],
                      ...attachments.map((attachment) => attachment.name),
                    ].filter(Boolean);
                return (
                  <span key={q.id} className="block min-w-0 text-sm">
                    <span className="line-clamp-2 font-medium [overflow-wrap:anywhere]">
                      {q.prompt}
                    </span>
                    <span className="line-clamp-2 text-muted-foreground [overflow-wrap:anywhere]">
                      {parts.join(" · ") ||
                        (record.status === "dismissed"
                          ? "Dismissed without an answer or approval"
                          : record.status === "pending"
                            ? "Awaiting your answer"
                            : "No answer was retained")}
                    </span>
                  </span>
                );
              })}
            </span>
          ) : null}
        </span>
      </button>
      {expanded ? (
        <div className="mt-3 space-y-6">
          {record.payload.questions.map((q) => {
            const submitted = record.result?.submission?.answers[q.id];
            const annotation = record.result?.annotations?.[q.prompt];
            const answer = record.result?.answers[q.prompt];
            const attachments =
              submitted?.attachments ?? annotation?.attachments ?? [];
            return (
              <section key={q.id} className="min-w-0">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {q.shortLabel}
                  {q.multiSelect ? " · Select multiple" : ""}
                </p>
                <div
                  role="heading"
                  aria-level={2}
                  className={cn(
                    "font-medium tracking-[-0.006em]",
                    PROMPT_CLASS,
                  )}
                >
                  <Markdown content={q.prompt} className={MARKDOWN_CLASS} />
                </div>
                {q.details ? (
                  <div className="mt-2 text-[13px] leading-[1.5] max-md:pointer-coarse:text-sm">
                    <Markdown
                      content={formatQuestionText(q.details)}
                      className={DETAILS_CLASS}
                    />
                  </div>
                ) : null}
                {q.options.length ? (
                  <ul aria-label="Options offered" className="mt-3 space-y-px">
                    {q.options.map((o) => (
                      <li key={o.value}>
                        <QuestionOptionRow
                          readOnly
                          checked={
                            submitted?.selected.includes(o.value) ?? false
                          }
                          label={o.label}
                          description={o.description}
                          multiSelect={q.multiSelect}
                        />
                        {o.preview ? (
                          <QuestionOptionPreview preview={o.preview} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 space-y-2 rounded-md border border-border bg-background/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Your answer
                  </p>
                  {submitted?.selected.length ? (
                    <ul className="space-y-1 text-sm font-medium">
                      {submitted.selected.map((value) => (
                        <li key={value}>
                          {q.options.find((o) => o.value === value)?.label ??
                            value}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {submitted?.freeText ? (
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {submitted.freeText}
                    </p>
                  ) : null}
                  {!submitted && answer ? (
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {answer}
                    </p>
                  ) : null}
                  {!submitted &&
                  annotation?.preview &&
                  !q.options.some((o) => o.preview === annotation.preview) ? (
                    <QuestionOptionPreview preview={annotation.preview} />
                  ) : null}
                  {attachments.length ? (
                    <ul
                      aria-label="Attached files"
                      className="flex flex-wrap gap-2"
                    >
                      {attachments.map((attachment, index) => (
                        <QuestionAttachment
                          key={`${attachment.projectId}:${attachment.path}:${index}`}
                          attachment={attachment}
                        />
                      ))}
                    </ul>
                  ) : null}
                  {!submitted?.selected.length &&
                  !submitted?.freeText &&
                  !answer &&
                  !attachments.length ? (
                    <p className="text-sm">
                      {record.status === "dismissed"
                        ? "Dismissed without an answer or approval"
                        : record.status === "pending"
                          ? "Awaiting your answer"
                          : "No answer was retained"}
                    </p>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** BB owns the form row's position; the plugin renders only its saved body. */
export function QuestionHistoryInline({
  row,
  payload,
  Original,
}: PluginTimelineRendererProps) {
  const rpc = useRpc<RpcContract>();
  const [loaded, setLoaded] = useState<{
    rowId: string;
    record: QuestionHistory | null;
  } | null>(null);
  const direct = questionResultRecord(payload, row.id, row.startedAt);
  const load = useCallback(async () => {
    const prefix = `${row.threadId}:form:`;
    if (!row.id.startsWith(prefix)) return;
    const value = await rpc
      .call("question_at", {
        threadId: row.threadId,
        interactionId: row.id.slice(prefix.length),
      })
      .catch(() => null);
    setLoaded({ rowId: row.id, record: value });
  }, [rpc, row.id, row.threadId]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("changed", () => void load());
  const record = loaded?.rowId === row.id ? loaded.record : null;
  const saved = record?.result ? record : (direct ?? record);
  return saved ? <QuestionHistoryCard record={saved} /> : <Original />;
}
