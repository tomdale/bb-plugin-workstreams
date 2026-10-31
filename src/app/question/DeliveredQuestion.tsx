import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSdk } from "@get-bb/plugin-sdk/app";
import {
  deliveredQuestionResult,
  DELIVERED_QUESTION_PREFIX,
  RECOVERED_QUESTION_PREFIX,
  questionResultRecord,
  type QuestionHistory,
} from "../../server/questions/history.ts";
import { QuestionHistoryCard } from "./QuestionHistory.tsx";

const prefixes = [DELIVERED_QUESTION_PREFIX, RECOVERED_QUESTION_PREFIX];
function isTransport(text: string) {
  return prefixes.some((prefix) => text.startsWith(prefix));
}

/** User and generated delivery messages have no plugin renderer slot. */
export function deliveredCardRecord(text: string): QuestionHistory | null {
  return questionResultRecord(
    deliveredQuestionResult(text.trimStart()),
    "delivered",
    null,
  );
}

type Target = {
  host: HTMLElement;
  row: HTMLElement;
  duplicate: boolean;
  anchor: HTMLElement;
  text: string;
  record: QuestionHistory | null;
};

export function DeliveredQuestionCards() {
  const sdk = useSdk();
  const [targets, setTargets] = useState<Target[]>([]);
  useEffect(() => {
    const mounted = new Map<HTMLElement, Target>();
    let scheduled = false;
    let active = true;
    const originals = new Map<string, Promise<QuestionHistory | null>>();
    const readOriginal = (target: Target) => {
      const rowId = target.row.dataset.timelineRowId ?? "";
      // BB's retained user-input row key carries its thread and event sequence.
      const match = /(?:^|:)([^:]+):user-seed:(\d+)(?:-\d+)?$/.exec(rowId);
      if (!match) return;
      const existing = originals.get(rowId);
      if (existing) {
        void existing.then((record) => {
          if (active && mounted.get(target.host) === target && record) {
            target.record = record;
            setTargets(
              [...mounted.values()].map((current) => ({ ...current })),
            );
          }
        });
        return;
      }
      const threadId = match[1]!;
      const seq = Number(match[2]);
      const request = sdk.threads.events
        .list({
          threadId,
          types: ["client/turn/requested"],
          afterSeq: String(seq - 1),
          beforeSeq: String(seq + 1),
          limit: "1",
          order: "asc",
        })
        .then((events) => {
          for (const event of events) {
            if (event.type !== "client/turn/requested" || event.seq !== seq)
              continue;
            for (const part of event.data.input ?? []) {
              const record =
                part.type === "text" ? deliveredCardRecord(part.text) : null;
              if (record) return record;
            }
          }
          return null;
        })
        .catch(() => null);
      originals.set(rowId, request);
      void request.then((record) => {
        if (!active || !record) return;
        // A virtualized row may have unmounted while its event was loading.
        for (const current of mounted.values()) {
          if (current.row.dataset.timelineRowId === rowId)
            current.record = record;
        }
        setTargets([...mounted.values()].map((current) => ({ ...current })));
        scan();
      });
    };
    const scan = () => {
      scheduled = false;
      if (!active) return;
      let changed = false;
      for (const [host, target] of mounted) {
        if (!host.isConnected) {
          target.anchor.remove();
          host.classList.remove("ws-delivered-question-source");
          target.row.classList.remove(
            "ws-delivered-question-row",
            "ws-delivered-question-duplicate",
          );
          mounted.delete(host);
          changed = true;
          continue;
        }
        const text = (host.textContent ?? "").trimStart();
        if (text !== target.text) {
          const record = deliveredCardRecord(text);
          const isClippedPreview =
            !record &&
            isTransport(text) &&
            (text.endsWith("…") || text.endsWith("..."));
          if (!record && !isClippedPreview) {
            target.anchor.remove();
            host.classList.remove("ws-delivered-question-source");
            target.row.classList.remove(
              "ws-delivered-question-row",
              "ws-delivered-question-duplicate",
            );
            mounted.delete(host);
            changed = true;
            continue;
          }
          if (record || isClippedPreview) {
            target.text = text;
            target.record = record;
            readOriginal(target);
            changed = true;
          }
        }
      }
      for (const row of document.querySelectorAll<HTMLElement>(
        "[data-timeline-row-id]",
      )) {
        if (row.querySelector(":scope > [data-ws-delivered-anchor]")) continue;
        // Match an element whose own text begins with the transport prefix.
        // The card lives directly in the row, outside clipped message bodies.
        const candidates = Array.from(
          row.querySelectorAll<HTMLElement>("*"),
        ).reverse();
        for (const host of candidates) {
          if (
            host.closest("[data-timeline-row-id]") !== row ||
            host.closest("[data-ws-delivered-anchor]") ||
            mounted.has(host)
          )
            continue;
          const text = (host.textContent ?? "").trimStart();
          if (!isTransport(text)) continue;
          const record = deliveredCardRecord(text);
          // BB's collapsed generated-message preview clips the delivered JSON,
          // so it cannot produce a complete card until the row is expanded.
          // Replace that transport excerpt with a useful inline affordance;
          // clicking it still bubbles to BB's preview expansion handler.
          const isClippedPreview =
            !record &&
            isTransport(text) &&
            (text.endsWith("…") || text.endsWith("..."));
          if (!record && !isClippedPreview) continue;
          const anchor = document.createElement("div");
          anchor.dataset.wsDeliveredAnchor = "";
          row.append(anchor);
          row.classList.add("ws-delivered-question-row");
          host.classList.add("ws-delivered-question-source");
          const target: Target = {
            host,
            row,
            anchor,
            text,
            record,
            duplicate: false,
          };
          mounted.set(host, target);
          readOriginal(target);
          changed = true;
          break;
        }
      }
      for (const target of mounted.values()) {
        let scope = target.row.closest("[data-timeline-row-list]");
        // Forms and recovered inputs can be in different turn groups.
        while (scope?.parentElement?.closest("[data-timeline-row-list]")) {
          scope = scope.parentElement.closest("[data-timeline-row-list]");
        }
        scope ??= target.row.parentElement;
        const signature = target.record
          ? JSON.stringify(target.record.result)
          : null;
        const duplicate =
          !!signature &&
          !!scope &&
          Array.from(
            scope.querySelectorAll<HTMLElement>("[data-ws-question-result]"),
          ).some(
            (card) =>
              !card.closest("[data-ws-delivered-anchor]") &&
              card.dataset.wsQuestionResult === signature,
          );
        if (target.duplicate !== duplicate) {
          target.duplicate = duplicate;
          target.row.classList.toggle(
            "ws-delivered-question-duplicate",
            duplicate,
          );
          changed = true;
        }
      }
      if (changed)
        setTargets([...mounted.values()].map((target) => ({ ...target })));
    };
    const observer = new MutationObserver(() => {
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(scan);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    scan();
    return () => {
      active = false;
      observer.disconnect();
      for (const { host, row, anchor } of mounted.values()) {
        row.classList.remove(
          "ws-delivered-question-row",
          "ws-delivered-question-duplicate",
        );
        host.classList.remove("ws-delivered-question-source");
        anchor.remove();
      }
    };
  }, [sdk]);
  return (
    <>
      {targets.map(({ host, anchor, record, duplicate }, index) =>
        createPortal(
          duplicate ? null : record ? (
            <QuestionHistoryCard record={record} />
          ) : (
            <button
              type="button"
              className="ws-delivered-question-preview"
              onClick={() => host.click()}
            >
              Expand to view the question and answer
            </button>
          ),
          anchor,
          String(index),
        ),
      )}
    </>
  );
}
