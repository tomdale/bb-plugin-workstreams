/**
 * Draws each stored enhanced document below the assistant message it was
 * composed for. BB has no slot below a message, so this overlay appends one
 * anchor element to the message's timeline row and portals the document into
 * it. A row qualifies only when its `data-timeline-row-id` equals a stored
 * message id exactly, so a document never lands on a guessed row; when BB's
 * row markup changes, nothing matches and the original response is left as
 * it was.
 *
 * Every view reads stored documents and never composes. Rows are found as
 * they mount, so a virtualized row gets its document back when it scrolls
 * into view, and each pane showing the thread draws its own copy. Anchors,
 * the observer, and portals are removed when the overlay unmounts.
 */
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  experimental_Icon as Icon,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { usePortalScopeProps } from "@/lib/portal-scope";
import type { RpcContract } from "../../server/contract.ts";
import {
  documentText,
  validateDocument,
  type EnhancedDocument,
} from "../../domain/postTurn/document.ts";
import {
  parseAssistantRowId,
  type DocumentWorkstream,
} from "../../domain/postTurn/message.ts";
import { mutationTargetElement } from "../mutationRecords.ts";
import { ActivityThreadLink } from "../page/ActivityThreadLink.tsx";
import { DocumentView, ThreadMention } from "./DocumentView.tsx";

const ROW = "[data-timeline-row-id]";
const ANCHOR = "data-ws-post-turn-anchor";

type Item = {
  messageId: string;
  workstream: DocumentWorkstream | null;
  document: EnhancedDocument;
};

type Target = {
  key: string;
  row: HTMLElement;
  anchor: HTMLElement;
  item: Item;
};

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const drawThread = (threadId: string) => (
  <ActivityThreadLink threadId={threadId} fallback={threadId} />
);

function DocumentPanel({ item }: { item: Item }) {
  const scope = usePortalScopeProps();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div
      data-bb-plugin-root=""
      data-bb-plugin={scope["data-bb-plugin"]}
      data-ws-post-turn=""
      className="mt-4 mb-2"
    >
      <ThreadMention.Provider value={drawThread}>
        <DocumentView
          document={item.document}
          workstream={item.workstream}
          copy={{
            label: copied ? "Copied" : "Copy",
            icon: (
              <Icon name="Copy" aria-hidden className="size-3.5 shrink-0" />
            ),
            onClick: () => {
              // A refused clipboard leaves the label as it was.
              void navigator.clipboard
                ?.writeText(documentText(item.document))
                .then(
                  () => setCopied(true),
                  () => {},
                );
            },
          }}
        />
      </ThreadMention.Provider>
    </div>
  );
}

/** A thread's stored documents by message id; empty while the experiment is off. */
type Lists = Map<string, Promise<Map<string, Item>>>;

export function PostTurnDocuments() {
  const rpc = useRpc<RpcContract>();
  const [targets, setTargets] = useState<Target[]>([]);
  /** Set by the effect: drop a thread's cached list (null: every thread) and redraw. */
  const invalidate = useRef<(threadId: string | null) => void>(() => {});
  useRealtime("presentations", (payload: unknown) => {
    const threadId = (payload as { threadId?: unknown } | null)?.threadId;
    if (typeof threadId === "string") invalidate.current(threadId);
  });
  const all = useCallback(() => invalidate.current(null), []);
  useRealtime("presentationPrefs", all);

  useEffect(() => {
    let active = true;
    let counter = 0;
    let scheduled = false;
    let full = true;
    let prune = false;
    const pending = new Set<HTMLElement>();
    const lists: Lists = new Map();
    const drawn = new Map<HTMLElement, Target>();

    const load = (threadId: string) => {
      let list = lists.get(threadId);
      if (!list) {
        list = rpc
          .call("presentations", { threadId })
          .then(({ enabled, items }) => {
            const byId = new Map<string, Item>();
            if (!enabled) return byId;
            for (const entry of items) {
              const valid = validateDocument(entry.document);
              if (valid.ok)
                byId.set(entry.messageId, {
                  messageId: entry.messageId,
                  workstream: entry.workstream,
                  document: valid.document,
                });
            }
            return byId;
          });
        const settled = list;
        // A failed read is retried when a row of the thread next appears.
        settled.catch(() => {
          if (lists.get(threadId) === settled) lists.delete(threadId);
        });
        lists.set(threadId, settled);
      }
      return list;
    };
    const publish = () => setTargets([...drawn.values()]);
    const release = (row: HTMLElement) => {
      drawn.get(row)?.anchor.remove();
      drawn.delete(row);
    };
    const current = (row: HTMLElement, target: Target) =>
      row.isConnected &&
      target.anchor.parentElement === row &&
      row.dataset.timelineRowId === target.item.messageId;

    const judge = async (row: HTMLElement): Promise<boolean> => {
      const id = row.dataset.timelineRowId ?? "";
      const ref = parseAssistantRowId(id);
      if (!ref || drawn.has(row)) return false;
      const host = row.querySelector("[data-message-column]");
      if (!host || host.closest(ROW) !== row) return false;
      const list = load(ref.threadId);
      let items: Map<string, Item>;
      try {
        items = await list;
      } catch {
        return false;
      }
      // A list replaced while it loaded (a change, or the setting turned off)
      // is stale; the full scan that replaced it judges the row again.
      if (lists.get(ref.threadId) !== list) return false;
      const item = items.get(id);
      if (!item || !active || !row.isConnected || drawn.has(row)) return false;
      if (row.dataset.timelineRowId !== id) return false;
      // A stale anchor from an earlier lifetime is replaced, never doubled.
      for (const stale of row.querySelectorAll(`:scope > [${ANCHOR}]`))
        stale.remove();
      const anchor = document.createElement("div");
      anchor.setAttribute(ANCHOR, "");
      row.append(anchor);
      drawn.set(row, { key: `${id}#${++counter}`, row, anchor, item });
      return true;
    };

    const scan = async () => {
      scheduled = false;
      if (!active) return;
      let changed = false;
      if (prune || full) {
        prune = false;
        for (const [row, target] of [...drawn])
          if (!current(row, target)) {
            release(row);
            changed = true;
          }
      }
      const rows = full
        ? [...document.querySelectorAll<HTMLElement>(ROW)]
        : [...pending];
      full = false;
      pending.clear();
      const results = await Promise.all(rows.map(judge));
      if (!active) return;
      if (changed || results.some(Boolean)) publish();
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => void scan());
    };
    const candidate = (row: HTMLElement | null | undefined) => {
      if (row && parseAssistantRowId(row.dataset.timelineRowId ?? ""))
        pending.add(row);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        candidate(mutationTargetElement(record)?.closest<HTMLElement>(ROW));
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches(ROW)) candidate(node);
          else if (node.firstElementChild)
            for (const row of node.querySelectorAll<HTMLElement>(ROW))
              candidate(row);
        }
        if (record.removedNodes.length && drawn.size) prune = true;
      }
      if (pending.size || prune) schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true });
    invalidate.current = (threadId) => {
      if (threadId === null) lists.clear();
      else lists.delete(threadId);
      let changed = false;
      for (const [row, target] of [...drawn])
        if (
          threadId === null ||
          target.item.messageId.startsWith(`${threadId}:`)
        ) {
          release(row);
          changed = true;
        }
      if (changed) publish();
      full = true;
      schedule();
    };
    schedule();
    return () => {
      active = false;
      observer.disconnect();
      invalidate.current = () => {};
      for (const row of [...drawn.keys()]) release(row);
    };
  }, [rpc]);

  return targets.map((target) =>
    createPortal(
      <Boundary key={target.key}>
        <DocumentPanel item={target.item} />
      </Boundary>,
      target.anchor,
      target.key,
    ),
  );
}
