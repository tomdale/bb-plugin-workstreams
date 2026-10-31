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

async function readDelivery(
  sdk: PluginBrowserBbSdk,
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
  const records = await sdk.plugins.callRpc({
    pluginId: "subagents",
    method: "list",
    input: { threadId },
    outputSchema: runsSchema,
  });
  return records.runs.some(
    (run) =>
      run.id === delivery.runId &&
      run.ownerThreadId === threadId &&
      run.threadId === delivery.threadId &&
      run.title === delivery.title &&
      run.output === delivery.output,
  )
    ? delivery
    : null;
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
      className="min-w-0 space-y-3 py-2"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{delivery.title}</span>
        <span>{delivery.status}</span>
        <Markdown content={`@thread:${delivery.threadId}`} />
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
    const scan = () => {
      if (!active) return;
      scheduled = false;
      let changed = false;
      for (const [row, { id, host }] of rows) {
        if (
          !row.isConnected ||
          row.dataset.timelineRowId !== id ||
          !row.contains(host)
        ) {
          remove(row);
          changed = true;
        }
      }
      for (const row of document.querySelectorAll<HTMLElement>(
        "[data-timeline-row-id]",
      )) {
        if (rows.has(row)) continue;
        const id = row.dataset.timelineRowId ?? "";
        const match = /(?:^|:)([^:]+):user-seed:(\d+)(?:-(\d+))?$/.exec(id);
        if (!match) continue;
        const host = row.querySelector<HTMLElement>("[data-message-column]");
        const text = (host?.textContent ?? "").trimStart();
        if (
          !host ||
          host.closest("[data-timeline-row-id]") !== row ||
          (!text.startsWith("Subagent ") &&
            !text.startsWith("The user returned control of subagent "))
        )
          continue;
        const entry: { id: string; host: HTMLElement; target?: Target } = {
          id,
          host,
        };
        rows.set(row, entry);
        void readDelivery(
          sdk,
          match[1]!,
          Number(match[2]),
          Number(match[3] ?? 0),
        ).then(
          (delivery) => {
            if (
              !active ||
              !delivery ||
              rows.get(row) !== entry ||
              !row.isConnected ||
              row.dataset.timelineRowId !== id ||
              !row.contains(host)
            )
              return;
            const anchor = document.createElement("div");
            anchor.dataset.wsSubagentAnchor = "";
            row.append(anchor);
            entry.target = { host, id, anchor, delivery };
            update();
          },
          () => {},
        );
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
      <DeliveryBoundary key={target.id}>
        <Delivery target={target} />
      </DeliveryBoundary>,
      target.anchor,
      target.id,
    ),
  );
}
