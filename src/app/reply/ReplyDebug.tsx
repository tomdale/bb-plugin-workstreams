import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSdk, type PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { usePortalScopeProps } from "@/lib/portal-scope";
import type { ReplyStatus } from "../../domain/reply.ts";
import { diagnoseReply, type ReplyIssue } from "../../domain/replyDiagnosis.ts";
import { useDebugMode } from "../debug/debug.ts";
import { Code } from "../debug/Inspector.tsx";

export type AssistantRowRef = {
  threadId: string;
  turnId: string | null;
  itemId: string | null;
  seq: number | null;
};

/** Parses a BB timeline assistant row ID into its thread and item or sequence. */
export function parseAssistantRowId(rowId: string): AssistantRowRef | null {
  const structured =
    /(?:^|:)([^:|]+):assistant:kind:assistant\|turn:([^|]+)\|parent:[^|]+\|item:(.+)$/.exec(
      rowId,
    );
  if (structured) {
    return {
      threadId: structured[1]!,
      turnId: structured[2]!,
      itemId: structured[3]!,
      seq: null,
    };
  }
  const simple = /(?:^|:)([^:|]+):assistant:(\d+)$/.exec(rowId);
  if (simple) {
    return {
      threadId: simple[1]!,
      turnId: null,
      itemId: null,
      seq: Number(simple[2]),
    };
  }
  return null;
}

type ThreadCache = {
  byItem: Map<string, string>;
  bySeq: Map<number, string>;
  pending: Promise<void> | null;
};

const sdkCaches = new WeakMap<object, Map<string, ThreadCache>>();

function getThreadCache(
  sdk: PluginBrowserBbSdk,
  threadId: string,
): ThreadCache {
  let byThread = sdkCaches.get(sdk);
  if (!byThread) {
    byThread = new Map();
    sdkCaches.set(sdk, byThread);
  }
  let cache = byThread.get(threadId);
  if (!cache) {
    cache = { byItem: new Map(), bySeq: new Map(), pending: null };
    byThread.set(threadId, cache);
  }
  return cache;
}

function recordEvents(cache: ThreadCache, events: readonly unknown[]): void {
  for (const raw of events) {
    const event = raw as {
      type?: string;
      seq?: number;
      scope?: { kind?: string; turnId?: string };
      data?: {
        item?: { type?: string; id?: string; text?: string };
      };
    };
    if (
      event.type !== "item/completed" ||
      event.data?.item?.type !== "agentMessage" ||
      typeof event.data.item.text !== "string"
    )
      continue;
    const text = event.data.item.text;
    const itemId = event.data.item.id;
    const turnId =
      event.scope?.kind === "turn" ? event.scope.turnId : undefined;
    if (itemId) {
      cache.byItem.set(itemId, text);
      if (turnId) cache.byItem.set(`${turnId}:${itemId}`, text);
    }
    if (typeof event.seq === "number") {
      cache.bySeq.set(event.seq, text);
      cache.bySeq.set(Math.floor(event.seq), text);
    }
  }
}

function lookupCached(
  cache: ThreadCache,
  ref: AssistantRowRef,
): string | undefined {
  if (ref.itemId) {
    if (ref.turnId) {
      const keyed = cache.byItem.get(`${ref.turnId}:${ref.itemId}`);
      if (keyed !== undefined) return keyed;
    }
    return cache.byItem.get(ref.itemId);
  }
  if (ref.seq !== null) return cache.bySeq.get(ref.seq);
  return undefined;
}

export async function readAssistantMessage(
  sdk: PluginBrowserBbSdk,
  ref: AssistantRowRef,
): Promise<string | null> {
  const list = sdk.threads?.events?.list;
  if (typeof list !== "function") return null;
  const cache = getThreadCache(sdk, ref.threadId);
  const existing = lookupCached(cache, ref);
  if (existing !== undefined) return existing;
  if (!cache.pending) {
    cache.pending = list({
      threadId: ref.threadId,
      types: ["item/completed"],
      limit: "100",
      order: "desc",
    })
      .then((events) => {
        recordEvents(cache, events);
      })
      .catch(() => {})
      .finally(() => {
        cache.pending = null;
      });
  }
  await cache.pending;
  const afterBatch = lookupCached(cache, ref);
  if (afterBatch !== undefined) return afterBatch;
  if (ref.seq !== null) {
    try {
      const exact = await list({
        threadId: ref.threadId,
        types: ["item/completed"],
        afterSeq: String(ref.seq - 1),
        beforeSeq: String(ref.seq + 1),
        limit: "1",
        order: "asc",
      });
      recordEvents(cache, exact);
      return lookupCached(cache, ref) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Loads the complete raw `agentMessage` text for a timeline row when Debug
 * mode is on, so stray content outside `:::reply` is included.
 */
export function useAssistantMessageText(rowId: string | null): string | null {
  const sdk = useSdk();
  const [loaded, setLoaded] = useState<{
    rowId: string;
    text: string;
  } | null>(null);
  useEffect(() => {
    if (!rowId) return;
    const ref = parseAssistantRowId(rowId);
    if (!ref) return;
    let live = true;
    void readAssistantMessage(sdk, ref).then((text) => {
      if (live && text !== null) setLoaded({ rowId, text });
    });
    return () => {
      live = false;
    };
  }, [sdk, rowId]);
  return loaded?.rowId === rowId ? loaded.text : null;
}

function formatIssue(issue: ReplyIssue): string {
  return `${issue.line ? `Line ${issue.line}: ` : ""}${issue.message}`;
}

export function ReplyDebug({
  source,
  status = "closed",
  error = null,
}: {
  source: string;
  status?: ReplyStatus;
  error?: string | null;
}) {
  const diagnosis = diagnoseReply(source, { status, error });
  const firstIssue = diagnosis.issues[0];
  return (
    <details
      data-reply-raw=""
      data-reply-status={diagnosis.status}
      className="group/raw text-xs text-muted-foreground"
    >
      <summary className="flex max-w-full w-fit cursor-pointer select-none list-none items-center gap-1.5 rounded py-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <Icon name="Bug" aria-hidden className="size-3.5 shrink-0" />
        <span className="shrink-0">Raw agent output</span>
        {firstIssue ? (
          <span className="min-w-0 truncate text-(--ws-failure-text) group-open/raw:hidden">
            · {formatIssue(firstIssue)}
            {diagnosis.issues.length > 1
              ? ` (+${diagnosis.issues.length - 1} more)`
              : ""}
          </span>
        ) : null}
        <span
          aria-hidden
          className="inline-block shrink-0 transition-transform group-open/raw:rotate-90"
        >
          ›
        </span>
      </summary>
      <div className="mt-1.5 space-y-2 text-foreground">
        {diagnosis.issues.length ? (
          <ul
            aria-label="Reply syntax issues"
            className="list-disc space-y-1 pl-4 text-(--ws-failure-text)"
          >
            {diagnosis.issues.map((issue, i) => (
              <li key={i}>{formatIssue(issue)}</li>
            ))}
          </ul>
        ) : null}
        <Code content={source} label="Raw agent output" />
      </div>
    </details>
  );
}

type FallbackTarget = {
  id: string;
  anchor: HTMLElement;
  source: string;
};

function hasOwnReplyDebug(row: HTMLElement): boolean {
  return Array.from(row.querySelectorAll<HTMLElement>("[data-reply-raw]")).some(
    (node) => !node.closest("[data-ws-assistant-debug]"),
  );
}

function ActiveAssistantReplyDebug() {
  const sdk = useSdk();
  const scope = usePortalScopeProps();
  const [targets, setTargets] = useState<FallbackTarget[]>([]);
  useEffect(() => {
    let active = true;
    let scheduled = false;
    const rows = new Map<
      HTMLElement,
      { id: string; host: HTMLElement; target?: FallbackTarget }
    >();
    const remove = (row: HTMLElement) => {
      rows.get(row)?.target?.anchor.remove();
      rows.delete(row);
    };
    const update = () =>
      setTargets([...rows.values()].flatMap(({ target }) => target ?? []));
    const scan = () => {
      if (!active) return;
      scheduled = false;
      let changed = false;
      for (const [row, { id, host, target }] of rows) {
        if (
          !row.isConnected ||
          row.dataset.timelineRowId !== id ||
          !row.contains(host) ||
          hasOwnReplyDebug(row)
        ) {
          remove(row);
          if (target) changed = true;
        }
      }
      for (const row of document.querySelectorAll<HTMLElement>(
        "[data-timeline-row-id]",
      )) {
        if (rows.has(row) || hasOwnReplyDebug(row)) continue;
        const id = row.dataset.timelineRowId ?? "";
        const ref = parseAssistantRowId(id);
        if (!ref) continue;
        const host = row.querySelector<HTMLElement>("[data-message-column]");
        if (!host || host.closest("[data-timeline-row-id]") !== row) continue;
        const entry: {
          id: string;
          host: HTMLElement;
          target?: FallbackTarget;
        } = { id, host };
        rows.set(row, entry);
        void readAssistantMessage(sdk, ref).then((source) => {
          if (
            !active ||
            source === null ||
            rows.get(row) !== entry ||
            !row.isConnected ||
            row.dataset.timelineRowId !== id ||
            !row.contains(host) ||
            hasOwnReplyDebug(row)
          ) {
            if (rows.get(row) === entry) rows.delete(row);
            return;
          }
          const prose =
            host.querySelector<HTMLElement>(
              "[data-sidebar-swipe-selectable]",
            ) ?? host;
          const anchor = document.createElement("div");
          anchor.dataset.wsAssistantDebug = "";
          prose.append(anchor);
          entry.target = { id, anchor, source };
          update();
        });
      }
      if (changed) update();
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
      for (const row of rows.keys()) remove(row);
    };
  }, [sdk]);

  return targets.map((target) =>
    createPortal(
      <div
        data-bb-plugin-root=""
        data-bb-plugin={scope["data-bb-plugin"]}
        className="mt-2"
      >
        <ReplyDebug source={target.source} status="closed" error={null} />
      </div>,
      target.anchor,
      target.id,
    ),
  );
}

/**
 * Attaches the raw output and syntax diagnosis disclosure to assistant
 * timeline rows that did not mount `ReplyBlock` (for example when `:::reply`
 * was omitted or its opener was malformed).
 */
export function AssistantReplyDebug() {
  const debug = useDebugMode("replies");
  return debug ? <ActiveAssistantReplyDebug /> : null;
}
