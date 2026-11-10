import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Markdown,
  useRealtime,
  useRpc,
  useSdk,
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
import { shareJson } from "../structuralSharing.ts";
import { questionChannel } from "../../domain/changes.ts";

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
    flushSync(expand);
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
  // With no room to move up, BB must first refresh its cached scroll extent.
  // Otherwise avoid jumping to the new bottom, which can unmount virtual rows.
  if (target < 5) {
    scroller.scrollTop = max;
    scroller.dispatchEvent(new Event("scroll"));
  }
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
  scroller.scrollTop = Math.max(0, target - 5);
  scroller.dispatchEvent(new Event("scroll"));
  scroller.scrollTop = target;
  scroller.dispatchEvent(new Event("scroll"));
}

export function QuestionHistoryCard({ record }: { record: QuestionHistory }) {
  const scope = usePortalScopeProps();
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLSpanElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const running = useRef<{ animation: Animation; cleanup: () => void } | null>(
    null,
  );

  const stopAnimation = useCallback(() => {
    const current = running.current;
    if (!current) return;
    running.current = null;
    current.animation.onfinish = null;
    current.animation.cancel();
    current.cleanup();
  }, []);
  useEffect(() => stopAnimation, [stopAnimation]);

  const toggle = () => {
    const card = cardRef.current;
    const wrapper = wrapperRef.current;
    if (!card || !wrapper) return;
    const from = card.getBoundingClientRect().height;
    stopAnimation();
    const motion =
      typeof card.animate === "function" &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const animate = (to: number, reserve: boolean, finish: () => void) => {
      if (!motion || Math.abs(from - to) < 1) {
        finish();
        return;
      }
      const oldHeight = wrapper.style.height;
      const oldOverflow = card.style.overflow;
      if (reserve) {
        // Keep the full scroll range while the visible card grows, so BB does
        // not reattach its bottom pin during the animation.
        const style = getComputedStyle(card);
        wrapper.style.height = `${to + parseFloat(style.marginTop || "0") + parseFloat(style.marginBottom || "0")}px`;
      }
      card.style.overflow = "hidden";
      const animation = card.animate(
        [{ height: `${from}px` }, { height: `${to}px` }],
        {
          duration: 220,
          easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        },
      );
      const cleanup = () => {
        wrapper.style.height = oldHeight;
        card.style.overflow = oldOverflow;
      };
      running.current = { animation, cleanup };
      animation.onfinish = () => {
        if (running.current?.animation !== animation) return;
        running.current = null;
        finish();
        cleanup();
      };
    };

    if (expanded && !closing) {
      const summary = summaryRef.current;
      const details = detailsRef.current;
      if (!motion || !summary || !details) {
        setExpanded(false);
        setClosing(false);
        return;
      }
      const summaryMargin = parseFloat(
        getComputedStyle(summary).marginTop || "0",
      );
      const detailMargin = parseFloat(
        getComputedStyle(details).marginTop || "0",
      );
      const to =
        card.getBoundingClientRect().height -
        details.getBoundingClientRect().height -
        detailMargin +
        summary.getBoundingClientRect().height +
        summaryMargin;
      setClosing(true);
      animate(to, false, () => {
        flushSync(() => {
          setExpanded(false);
          setClosing(false);
        });
      });
    } else {
      expandAtReadingPosition(card, () => {
        setExpanded(true);
        setClosing(false);
      });
      animate(card.getBoundingClientRect().height, true, () => {});
    }
  };

  return (
    <div ref={wrapperRef} className="flow-root">
      <div
        ref={cardRef}
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
          aria-expanded={expanded && !closing}
          onClick={toggle}
          className="flex w-full cursor-pointer items-start gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Icon
            name={expanded && !closing ? "ChevronDown" : "ChevronRight"}
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="relative min-w-0 flex-1">
            <span className="block text-xs font-medium text-muted-foreground">
              Question ·{" "}
              {record.status === "unknown"
                ? "Answer unavailable"
                : record.status}
            </span>
            <span
              ref={summaryRef}
              data-ws-question-summary=""
              aria-hidden={expanded || undefined}
              className={cn(
                "mt-2 block space-y-2",
                expanded &&
                  "pointer-events-none invisible absolute inset-x-0 top-0",
              )}
            >
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
          </span>
        </button>
        {expanded ? (
          <div
            ref={detailsRef}
            data-ws-question-details=""
            inert={closing || undefined}
            className="mt-3 space-y-6"
          >
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
                    <ul
                      aria-label="Options offered"
                      className="mt-3 space-y-px"
                    >
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
    </div>
  );
}

/**
 * Reads that found no stored question before a row stops asking. A form's
 * question is stored before its row appears and attached as the form opens,
 * so a row still missing one after this many reads is a form from before
 * questions were stored.
 */
const MISSING_READS = 3;

/** Settled rows, kept so a row that remounts (virtualized scrolling) reads nothing. */
const SETTLED_KEPT = 500;

const settledRows = new WeakMap<object, Map<string, QuestionHistory | null>>();

/** One cache for every row of this plugin client (useSdk is shared). */
function useSettledRows(): Map<string, QuestionHistory | null> {
  const sdk = useSdk();
  let rows = settledRows.get(sdk);
  if (!rows) {
    rows = new Map();
    settledRows.set(sdk, rows);
  }
  return rows;
}

/**
 * Whether a stored record can still change: only a pending question is
 * answered or dismissed later. An `unknown` outcome is how a question that
 * ended without one stays.
 */
const settles = (record: QuestionHistory) => record.status !== "pending";

/** BB owns the form row's position; the plugin renders only its saved body. */
export function QuestionHistoryInline({
  row,
  payload,
  Original,
}: PluginTimelineRendererProps) {
  const rpc = useRpc<RpcContract>();
  const settled = useSettledRows();
  const cacheKey = `${row.threadId}\n${row.id}`;
  const [loaded, setLoaded] = useState<{
    rowId: string;
    record: QuestionHistory | null;
    settled: boolean;
  } | null>(() =>
    settled.has(cacheKey)
      ? { rowId: row.id, record: settled.get(cacheKey)!, settled: true }
      : null,
  );
  const direct = questionResultRecord(payload, row.id, row.startedAt);
  const directRef = useRef(direct);
  directRef.current = direct;
  const finalRef = useRef(false);
  finalRef.current =
    direct !== null || (loaded?.rowId === row.id && loaded.settled);
  const scheduler = useRef({
    key: "",
    generation: 0,
    inFlight: false,
    trailing: false,
    missing: 0,
  });
  const load = useCallback(
    async (initial = false) => {
      const prefix = `${row.threadId}:form:`;
      if (!row.id.startsWith(prefix) || (!initial && finalRef.current)) return;
      const state = scheduler.current;
      const key = row.id;
      if (state.key !== key) {
        state.key = key;
        state.generation++;
        state.inFlight = false;
        state.trailing = false;
        state.missing = 0;
      }
      // A settled record is the stored one; the render prefers it to the
      // payload's, so a remount shows it without reading again.
      if (settled.has(cacheKey)) {
        const record = settled.get(cacheKey)!;
        setLoaded((previous) =>
          previous?.rowId === row.id && previous.settled
            ? previous
            : { rowId: row.id, record, settled: true },
        );
        return;
      }
      if (state.inFlight) {
        state.trailing = true;
        return;
      }
      state.inFlight = true;
      const generation = state.generation;
      try {
        do {
          state.trailing = false;
          const value = await rpc
            .call("question_at", {
              threadId: row.threadId,
              interactionId: row.id.slice(prefix.length),
            })
            .catch(() => null);
          if (state.generation !== generation) return;
          state.missing = value ? 0 : state.missing + 1;
          const done = value ? settles(value) : state.missing >= MISSING_READS;
          if (done) {
            settled.set(cacheKey, value);
            if (settled.size > SETTLED_KEPT)
              settled.delete(settled.keys().next().value!);
          }
          setLoaded((previous) => {
            if (previous?.rowId === row.id) {
              const record = shareJson(previous.record, value);
              return record === previous.record && previous.settled === done
                ? previous
                : { rowId: row.id, record, settled: done };
            }
            return { rowId: row.id, record: value, settled: done };
          });
          if (directRef.current || done) state.trailing = false;
        } while (state.trailing);
      } finally {
        if (state.generation === generation) state.inFlight = false;
      }
    },
    [rpc, row.id, row.threadId, settled, cacheKey],
  );
  useEffect(() => {
    const state = scheduler.current;
    state.generation++;
    state.inFlight = false;
    state.trailing = false;
    state.missing = 0;
    void load(true);
    return () => {
      state.generation++;
      state.inFlight = false;
      state.trailing = false;
    };
  }, [load]);
  useRealtime(questionChannel(row.threadId), () => void load());
  const record = loaded?.rowId === row.id ? loaded.record : null;
  const saved = record?.result ? record : (direct ?? record);
  return saved ? <QuestionHistoryCard record={saved} /> : <Original />;
}
