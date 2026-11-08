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
import {
  changedSubtreesMatch,
  mutationTargetElement,
} from "../mutationRecords.ts";

const prefixes = [DELIVERED_QUESTION_PREFIX, RECOVERED_QUESTION_PREFIX];
function isTransport(text: string) {
  return prefixes.some((prefix) => text.startsWith(prefix));
}

// BB's retained user-input row key carries its thread and event sequence.
function retainedUserSeed(row: HTMLElement) {
  return /(?:^|:)([^:]+):user-seed:(\d+)(?:-(\d+))?$/.exec(
    row.dataset.timelineRowId ?? "",
  );
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
  preview: boolean;
};

function syncSourceConcealment(target: Target) {
  const concealed = target.record !== null || target.preview;
  target.row.classList.toggle("ws-delivered-question-row", concealed);
  target.host.classList.toggle("ws-delivered-question-source", concealed);
}

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
      const match = retainedUserSeed(target.row);
      if (!match) return;
      const existing = originals.get(rowId);
      if (existing) {
        void existing.then((record) => {
          if (active && mounted.get(target.host) === target && record) {
            target.record = record;
            syncSourceConcealment(target);
            setTargets(
              [...mounted.values()].map((current) => ({ ...current })),
            );
          }
        });
        return;
      }
      const threadId = match[1]!;
      const seq = Number(match[2]);
      const groupIndex = Number(match[3] ?? 0);
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
            const groups = (event.data.inputGroups ?? [event.data.input ?? []])
              .map((group) =>
                group.filter((part) => part.visibility !== "agent-only"),
              )
              .filter((group) =>
                group.some(
                  (part) => part.type !== "text" || part.text.length > 0,
                ),
              );
            for (const part of groups[groupIndex] ?? []) {
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
          if (current.row.dataset.timelineRowId === rowId) {
            current.record = record;
            syncSourceConcealment(current);
          }
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
          const canReadOriginal =
            isTransport(text) && retainedUserSeed(target.row) !== null;
          if (!record && !isClippedPreview && !canReadOriginal) {
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
          if (record || isClippedPreview || canReadOriginal) {
            target.text = text;
            target.record = record;
            target.preview = isClippedPreview;
            syncSourceConcealment(target);
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
          // User-message Markdown can strip JSON escapes or rewrite its text.
          // Retained rows have an exact event to read even without an ellipsis.
          const canReadOriginal = retainedUserSeed(row) !== null;
          if (!record && !isClippedPreview && !canReadOriginal) continue;
          const anchor = document.createElement("div");
          anchor.dataset.wsDeliveredAnchor = "";
          row.append(anchor);
          const target: Target = {
            host,
            row,
            anchor,
            text,
            record,
            duplicate: false,
            preview: isClippedPreview,
          };
          // A malformed retained source stays visible unless its exact event
          // yields a card. Clipped previews already have an expansion fallback.
          syncSourceConcealment(target);
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
    const observer = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        if (record.attributeName === "data-ws-question-result") return true;
        if (mutationTargetElement(record)?.closest("[data-ws-question-result]"))
          return true;
        if (
          changedSubtreesMatch(record, "[data-timeline-row-id]") ||
          changedSubtreesMatch(record, "[data-ws-question-result]")
        )
          return true;
        const row = mutationTargetElement(record)?.closest<HTMLElement>(
          "[data-timeline-row-id]",
        );
        if (!row) return false;
        for (const target of mounted.values()) {
          if (target.row === row) return true;
        }
        return prefixes.some((prefix) =>
          (row.textContent ?? "").includes(prefix),
        );
      });
      if (relevant && !scheduled) {
        scheduled = true;
        queueMicrotask(scan);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-ws-question-result"],
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
      {targets.map(({ host, anchor, record, duplicate, preview }, index) =>
        createPortal(
          duplicate ? null : record ? (
            <QuestionHistoryCard record={record} />
          ) : preview ? (
            <button
              type="button"
              className="ws-delivered-question-preview"
              onClick={() => host.click()}
            >
              Expand to view the question and answer
            </button>
          ) : null,
          anchor,
          String(index),
        ),
      )}
    </>
  );
}
