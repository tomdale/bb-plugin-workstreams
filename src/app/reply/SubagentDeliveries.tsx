import {
  Component,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Markdown, useSdk } from "@get-bb/plugin-sdk/app";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { usePortalScopeProps } from "@/lib/portal-scope";
import {
  subagentDelivery,
  type SubagentDelivery,
} from "../../domain/subagentDelivery.ts";
import { ReplyBlock } from "./ReplyBlock.tsx";
import { workspaceStore } from "./workspace.ts";
import { mutationTargetElement } from "../mutationRecords.ts";

const runsSchema = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      ownerThreadId: z.string(),
      threadId: z.string().nullable(),
      title: z.string(),
      output: z.string(),
    }),
  ),
});
type Run = z.infer<typeof runsSchema>["runs"][number];

/**
 * The subagents plugin's runs for an owner thread. `cached` says the list was
 * read before this lookup, so it may predate a run that finished since.
 * Passing that list back as `stale` reads the runs again, unless another
 * lookup already has.
 */
type RunLookup = (
  threadId: string,
  stale?: Promise<Run[]>,
) => { list: Promise<Run[]>; cached: boolean };

/** Owner threads whose run lists stay cached; each holds every run's output. */
const CACHED_RUN_LISTS = 4;

/**
 * Run lists shared by every delivery row checked in one overlay lifetime, so a
 * thread opened with several deliveries asks the subagents plugin once.
 */
function runLookup(sdk: PluginBrowserBbSdk): RunLookup {
  const lists = new Map<string, Promise<Run[]>>();
  return (threadId, stale) => {
    const cached = lists.get(threadId);
    if (cached && cached !== stale) return { list: cached, cached: true };
    const list = sdk.plugins
      .callRpc({
        pluginId: "subagents",
        method: "list",
        input: { threadId },
        outputSchema: runsSchema,
      })
      .then((records) => records.runs);
    lists.delete(threadId);
    lists.set(threadId, list);
    if (lists.size > CACHED_RUN_LISTS) lists.delete(lists.keys().next().value!);
    list.catch(() => {
      if (lists.get(threadId) === list) lists.delete(threadId);
    });
    return { list, cached: false };
  };
}

async function readDelivery(
  sdk: PluginBrowserBbSdk,
  runs: RunLookup,
  threadId: string,
  seq: number,
  groupIndex: number,
): Promise<SubagentDelivery | null> {
  const events = await sdk.threads.events.list({
    threadId,
    types: ["client/turn/requested"],
    afterSeq: String(seq - 1),
    beforeSeq: String(seq + 1),
    limit: "1",
    order: "asc",
  });
  const event = events.find(
    (event) => event.type === "client/turn/requested" && event.seq === seq,
  );
  if (event?.type !== "client/turn/requested") return null;
  const groups = (event.data.inputGroups ?? [event.data.input ?? []])
    .map((group) => group.filter((part) => part.visibility !== "agent-only"))
    .filter((group) =>
      group.some((part) => part.type !== "text" || part.text.length > 0),
    );
  const input = groups[groupIndex];
  if (input?.length !== 1) return null;
  const part = input[0];
  const delivery = part?.type === "text" ? subagentDelivery(part.text) : null;
  if (!delivery) return null;
  const verifies = (list: Run[]) =>
    list.some(
      (run) =>
        run.id === delivery.runId &&
        run.ownerThreadId === threadId &&
        run.threadId === delivery.threadId &&
        run.title === delivery.title &&
        run.output === delivery.output,
    );
  const first = runs(threadId);
  if (!verifies(await first.list)) {
    // A delivery newer than the cached list is checked against a new read.
    if (!first.cached || !verifies(await runs(threadId, first.list).list))
      return null;
  }
  // The card's reply resolves links in the worker's workspace. Knowing it
  // before the card mounts lets the card draw once, complete.
  await workspaceStore(sdk).load(delivery.threadId);
  return delivery;
}

/** BB's key for a retained user-input row: its thread, event, and group. */
const USER_SEED = /(?:^|:)([^:]+):user-seed:(\d+)(?:-(\d+))?$/;
const ROW = "[data-timeline-row-id]";

/** Text a subagent delivery begins with, as BB shows it in the row. */
function mayBeDelivery(text: string): boolean {
  return (
    text.includes("Subagent ") ||
    text.includes("The user returned control of subagent ")
  );
}

type Target = {
  host: HTMLElement;
  id: string;
  anchor: HTMLElement;
  delivery: SubagentDelivery;
};

class DeliveryBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Delivery({ target }: { target: Target }) {
  const { delivery, host, id } = target;
  const scope = usePortalScopeProps();
  useLayoutEffect(() => {
    host.classList.add("ws-subagent-delivery-source");
    return () => host.classList.remove("ws-subagent-delivery-source");
  }, [host]);
  return (
    <section
      data-bb-plugin-root=""
      data-bb-plugin={scope["data-bb-plugin"]}
      data-ws-subagent-delivery=""
      aria-label={`Subagent: ${delivery.title}`}
      className="my-2 min-w-0 space-y-3 rounded-lg border border-border bg-surface-recessed px-4 py-3 text-sm leading-relaxed"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border pb-2 text-xs text-muted-foreground">
        <span>Subagent</span>
        <span className="min-w-0 font-medium text-foreground [overflow-wrap:anywhere]">
          {delivery.title}
        </span>
        <span>{delivery.status}</span>
        <Markdown
          content={`@thread:${delivery.threadId}`}
          className="ml-auto min-w-0 max-w-full text-xs [&_p]:m-0"
        />
      </div>
      {delivery.error ? (
        <p className="text-sm text-destructive">{delivery.error}</p>
      ) : null}
      <ReplyBlock
        data={delivery.reply}
        error={null}
        status="closed"
        source={delivery.output}
        index={0}
        message={{
          id,
          threadId: delivery.threadId,
          turnId: null,
          projectId: null,
        }}
        Original={() => <Markdown content={delivery.output} />}
      />
    </section>
  );
}

export function SubagentDeliveries() {
  const sdk = useSdk();
  const [targets, setTargets] = useState<Target[]>([]);
  useEffect(() => {
    let active = true;
    let scheduled = false;
    let prune = false;
    const pending = new Set<HTMLElement>();
    const runs = runLookup(sdk);
    /** Each row's verified delivery, by row id, so a remount reads nothing. */
    const verdicts = new Map<string, Promise<SubagentDelivery | null>>();
    /**
     * Rows that are not deliveries: their rendered text does not read as one,
     * or their event did not verify. A user-input row's text never changes.
     */
    const ordinary = new Set<string>();
    /** Rows with a delivery pending or drawn. */
    const rows = new Map<
      HTMLElement,
      { id: string; host: HTMLElement; target?: Target }
    >();
    const remove = (row: HTMLElement) => {
      const target = rows.get(row)?.target;
      target?.host.classList.remove("ws-subagent-delivery-source");
      target?.anchor.remove();
      rows.delete(row);
    };
    const update = () =>
      setTargets([...rows.values()].flatMap(({ target }) => target ?? []));
    const current = (row: HTMLElement) => {
      const entry = rows.get(row);
      return (
        !!entry &&
        row.isConnected &&
        row.dataset.timelineRowId === entry.id &&
        row.contains(entry.host)
      );
    };
    const verdict = (id: string, match: RegExpExecArray) => {
      let read = verdicts.get(id);
      if (!read) {
        read = readDelivery(
          sdk,
          runs,
          match[1]!,
          Number(match[2]),
          Number(match[3] ?? 0),
        );
        verdicts.set(id, read);
        // A failed read is retried when the row next appears.
        read.catch(() => {
          if (verdicts.get(id) === read) verdicts.delete(id);
        });
      }
      return read;
    };
    /** Drop a row's stale delivery; true when it had drawn a card. */
    const release = (row: HTMLElement): boolean => {
      const drawn = !!rows.get(row)?.target;
      remove(row);
      return drawn;
    };
    /** Start reading a row that has not been judged yet. */
    const judge = (row: HTMLElement) => {
      const id = row.dataset.timelineRowId ?? "";
      const match = USER_SEED.exec(id);
      if (!match || ordinary.has(id)) return;
      const host = row.querySelector<HTMLElement>("[data-message-column]");
      if (!host || host.closest(ROW) !== row) return;
      const text = host.textContent ?? "";
      // An empty body has not rendered yet; judge it when its text arrives.
      if (!text) return;
      if (!mayBeDelivery(text)) {
        ordinary.add(id);
        return;
      }
      const entry: { id: string; host: HTMLElement; target?: Target } = {
        id,
        host,
      };
      rows.set(row, entry);
      void verdict(id, match).then(
        (delivery) => {
          if (!active || rows.get(row) !== entry) return;
          if (!delivery) {
            ordinary.add(id);
            rows.delete(row);
            return;
          }
          if (!current(row)) return;
          const anchor = document.createElement("div");
          anchor.dataset.wsSubagentAnchor = "";
          row.append(anchor);
          entry.target = { host, id, anchor, delivery };
          update();
        },
        () => {
          if (rows.get(row) === entry) rows.delete(row);
        },
      );
    };
    const scan = () => {
      scheduled = false;
      if (!active) return;
      let changed = false;
      if (prune) {
        prune = false;
        for (const row of [...rows.keys()]) {
          if (current(row)) continue;
          changed = release(row) || changed;
          if (row.isConnected) pending.add(row);
        }
      }
      for (const row of pending) {
        if (rows.has(row)) {
          if (current(row)) continue;
          // A retained row whose body BB remounted, or a recycled row, is
          // judged again as what it shows now.
          changed = release(row) || changed;
        }
        if (row.isConnected) judge(row);
      }
      pending.clear();
      if (changed) update();
    };
    const schedule = () => {
      if (scheduled || (!pending.size && !prune)) return;
      scheduled = true;
      queueMicrotask(scan);
    };
    const candidate = (row: HTMLElement | null | undefined) => {
      if (!row) return;
      const id = row.dataset.timelineRowId ?? "";
      if (rows.has(row) || (!ordinary.has(id) && USER_SEED.test(id)))
        pending.add(row);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        // Text arriving in, or a body replacing, a row already on screen.
        candidate(mutationTargetElement(record)?.closest<HTMLElement>(ROW));
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches(ROW)) candidate(node);
          else if (node.firstElementChild)
            for (const row of node.querySelectorAll<HTMLElement>(ROW))
              candidate(row);
        }
        // A removed row, or a removed parent of several virtualized rows,
        // detaches the deliveries drawn in it. Only tracked rows are checked.
        if (record.removedNodes.length && rows.size) prune = true;
      }
      schedule();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    for (const row of document.querySelectorAll<HTMLElement>(ROW))
      candidate(row);
    scan();
    return () => {
      active = false;
      observer.disconnect();
      for (const row of [...rows.keys()]) remove(row);
    };
  }, [sdk]);
  return targets.map((target) =>
    createPortal(
      <DeliveryBoundary key={target.id}>
        <Delivery target={target} />
      </DeliveryBoundary>,
      target.anchor,
      target.id,
    ),
  );
}
