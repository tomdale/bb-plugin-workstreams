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
function hasTransport(text: string) {
  return prefixes.some((prefix) => text.includes(prefix));
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
  signature: string | null;
  preview: boolean;
  scope: HTMLElement | null;
};

function syncSourceConcealment(target: Target) {
  const concealed = target.record !== null || target.preview;
  target.row.classList.toggle("ws-delivered-question-row", concealed);
  target.host.classList.toggle("ws-delivered-question-source", concealed);
}

function scopeForRow(row: HTMLElement): HTMLElement | null {
  let scope = row.closest<HTMLElement>("[data-timeline-row-list]");
  // Forms and recovered inputs can be in different turn groups.
  while (scope?.parentElement?.closest("[data-timeline-row-list]")) {
    scope = scope.parentElement.closest("[data-timeline-row-list]");
  }
  return scope ?? row.parentElement;
}

export function DeliveredQuestionCards() {
  const sdk = useSdk();
  const [targets, setTargets] = useState<Target[]>([]);
  useEffect(() => {
    const mounted = new Map<HTMLElement, Target>();
    const byRow = new Map<HTMLElement, Target>();
    const byAnchor = new Map<HTMLElement, Target>();
    const byScope = new Map<HTMLElement, Set<Target>>();
    const pendingRows = new Set<HTMLElement>();
    const pendingScopes = new Set<HTMLElement>();
    let scheduled = false;
    let active = true;
    let changed = false;
    const originals = new Map<string, Promise<QuestionHistory | null>>();
    /**
     * Rows whose text quotes a transport prefix without hosting a card, by the
     * text length they were searched at. Searching one walks every descendant,
     * so a row that only quotes the prefix is searched again only once its
     * text changes.
     */
    const quoting = new WeakMap<HTMLElement, number>();
    /** Row text the observer already read, for the scan it schedules. */
    const pendingText = new Map<HTMLElement, string>();

    const publish = () => {
      setTargets([...mounted.values()].map((target) => ({ ...target })));
    };
    const setRecord = (target: Target, record: QuestionHistory | null) => {
      target.record = record;
      target.signature = record ? JSON.stringify(record.result) : null;
    };
    const updateScope = (target: Target, affected: Set<HTMLElement>) => {
      const next = scopeForRow(target.row);
      if (target.scope === next) {
        if (next) affected.add(next);
        return;
      }
      if (target.scope) {
        affected.add(target.scope);
        const previous = byScope.get(target.scope);
        previous?.delete(target);
        if (!previous?.size) byScope.delete(target.scope);
      }
      target.scope = next;
      if (next) {
        affected.add(next);
        let scoped = byScope.get(next);
        if (!scoped) {
          scoped = new Set();
          byScope.set(next, scoped);
        }
        scoped.add(target);
      }
    };
    const removeTarget = (target: Target, affected: Set<HTMLElement>) => {
      target.anchor.remove();
      target.host.classList.remove("ws-delivered-question-source");
      target.row.classList.remove(
        "ws-delivered-question-row",
        "ws-delivered-question-duplicate",
      );
      mounted.delete(target.host);
      byRow.delete(target.row);
      byAnchor.delete(target.anchor);
      if (target.scope) {
        affected.add(target.scope);
        const scoped = byScope.get(target.scope);
        scoped?.delete(target);
        if (!scoped?.size) byScope.delete(target.scope);
      }
      changed = true;
    };
    const schedule = (
      rows: Iterable<HTMLElement> = [],
      scopes: Iterable<HTMLElement> = [],
    ) => {
      for (const row of rows) pendingRows.add(row);
      for (const scope of scopes) pendingScopes.add(scope);
      if (scheduled || (!pendingRows.size && !pendingScopes.size)) return;
      scheduled = true;
      queueMicrotask(() => scan(pendingRows, pendingScopes));
    };
    const readOriginal = (target: Target) => {
      const rowId = target.row.dataset.timelineRowId ?? "";
      const match = retainedUserSeed(target.row);
      if (!match) return;
      const update = (record: QuestionHistory | null) => {
        if (!active || !record || mounted.get(target.host) !== target) return;
        setRecord(target, record);
        syncSourceConcealment(target);
        publish();
        if (target.scope) schedule([], [target.scope]);
      };
      const existing = originals.get(rowId);
      if (existing) {
        void existing.then(update);
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
            setRecord(current, record);
            syncSourceConcealment(current);
          }
        }
        publish();
        schedule(
          [],
          [...mounted.values()]
            .filter(
              (current) =>
                current.row.dataset.timelineRowId === rowId && current.scope,
            )
            .map((current) => current.scope!),
        );
      });
    };
    const scan = (
      rows: Iterable<HTMLElement>,
      scopes: Iterable<HTMLElement>,
    ) => {
      scheduled = false;
      if (!active) return;
      const dirtyRows = [...rows];
      const affected = new Set(scopes);
      const texts = new Map(pendingText);
      pendingRows.clear();
      pendingScopes.clear();
      pendingText.clear();
      changed = false;

      for (const row of dirtyRows) {
        let target = byRow.get(row);
        if (target && (!target.host.isConnected || !row.isConnected)) {
          removeTarget(target, affected);
          target = undefined;
        }
        if (target) {
          updateScope(target, affected);
          const text = (target.host.textContent ?? "").trimStart();
          if (text !== target.text) {
            const record = deliveredCardRecord(text);
            const isClippedPreview =
              !record &&
              isTransport(text) &&
              (text.endsWith("…") || text.endsWith("..."));
            const canReadOriginal =
              isTransport(text) && retainedUserSeed(target.row) !== null;
            if (!record && !isClippedPreview && !canReadOriginal) {
              removeTarget(target, affected);
              target = undefined;
            } else {
              target.text = text;
              setRecord(target, record);
              target.preview = isClippedPreview;
              syncSourceConcealment(target);
              readOriginal(target);
              changed = true;
            }
          }
        }
        if (
          target ||
          !row.isConnected ||
          row.querySelector(":scope > [data-ws-delivered-anchor]")
        )
          continue;
        const rowText = texts.get(row) ?? row.textContent ?? "";
        // Most timeline mutations are ordinary prose. Check the aggregate row
        // before enumerating every descendant looking for a transport host.
        if (!hasTransport(rowText) || quoting.get(row) === rowText.length)
          continue;
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
          target = {
            host,
            row,
            anchor,
            text,
            record,
            signature: record ? JSON.stringify(record.result) : null,
            duplicate: false,
            preview: isClippedPreview,
            scope: null,
          };
          // A malformed retained source stays visible unless its exact event
          // yields a card. Clipped previews already have an expansion fallback.
          syncSourceConcealment(target);
          mounted.set(host, target);
          byRow.set(row, target);
          byAnchor.set(anchor, target);
          updateScope(target, affected);
          readOriginal(target);
          changed = true;
          break;
        }
        if (target) quoting.delete(row);
        else quoting.set(row, rowText.length);
      }

      for (const scope of affected) {
        const scoped = byScope.get(scope);
        if (!scope.isConnected || !scoped?.size) continue;
        const signatures = new Set<string>();
        for (const card of scope.querySelectorAll<HTMLElement>(
          "[data-ws-question-result]",
        )) {
          if (
            !card.closest("[data-ws-delivered-anchor]") &&
            card.dataset.wsQuestionResult
          )
            signatures.add(card.dataset.wsQuestionResult);
        }
        for (const target of scoped) {
          const duplicate =
            !!target.signature && signatures.has(target.signature);
          if (target.duplicate !== duplicate) {
            target.duplicate = duplicate;
            target.row.classList.toggle(
              "ws-delivered-question-duplicate",
              duplicate,
            );
            changed = true;
          }
        }
      }
      if (changed) publish();
    };
    const scopeForElement = (element: Element | null) => {
      const row = element?.closest<HTMLElement>("[data-timeline-row-id]");
      return row ? scopeForRow(row) : null;
    };
    const observer = new MutationObserver((records) => {
      const rows = new Set<HTMLElement>();
      const scopes = new Set<HTMLElement>();
      const touched = new Set<HTMLElement>();
      // Duplicate cards and anchors matter only once a card is mounted.
      const tracking = mounted.size > 0;
      for (const record of records) {
        const element = mutationTargetElement(record);
        if (
          tracking &&
          (record.attributeName === "data-ws-question-result" ||
            element?.closest("[data-ws-question-result]") ||
            changedSubtreesMatch(record, "[data-ws-question-result]"))
        ) {
          const scope = scopeForElement(element);
          if (scope) scopes.add(scope);
        }
        const row = element?.closest<HTMLElement>("[data-timeline-row-id]");
        if (row) touched.add(row);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches("[data-timeline-row-id]")) {
            touched.add(node as HTMLElement);
          } else if (node.firstElementChild) {
            for (const row of node.querySelectorAll<HTMLElement>(
              "[data-timeline-row-id]",
            ))
              touched.add(row);
          }
        }
        if (!tracking) continue;
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches("[data-timeline-row-id]")) {
            const target = byRow.get(node as HTMLElement);
            if (target) {
              rows.add(target.row);
              if (target.scope) scopes.add(target.scope);
            }
          }
          // A removed parent can carry several virtualized rows. Only removed
          // subtrees are searched, and only for anchors this component added.
          const anchors = node.matches("[data-ws-delivered-anchor]")
            ? [node]
            : Array.from(
                node.querySelectorAll<HTMLElement>(
                  "[data-ws-delivered-anchor]",
                ),
              );
          for (const anchor of anchors) {
            const target = byAnchor.get(anchor as HTMLElement);
            if (target) {
              rows.add(target.row);
              if (target.scope) scopes.add(target.scope);
            }
          }
        }
      }
      // A streaming row reports one record per chunk. Read each row's text
      // once per delivery, whatever number of records name it.
      for (const row of touched) {
        const target = byRow.get(row);
        if (target) {
          rows.add(row);
          if (target.scope) scopes.add(target.scope);
          continue;
        }
        const text = row.textContent ?? "";
        if (!hasTransport(text) || quoting.get(row) === text.length) continue;
        rows.add(row);
        pendingText.set(row, text);
      }
      if (rows.size || scopes.size) schedule(rows, scopes);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-ws-question-result"],
    });
    scan(document.querySelectorAll<HTMLElement>("[data-timeline-row-id]"), []);
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
