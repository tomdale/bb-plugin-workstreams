/**
 * The button the debug UI adds beside an AI-generated result: it starts a
 * thread about that one result in Workstreams' own project, with the
 * suggestion, its facts, and the recorded model calls in the opening message,
 * then opens it. It renders nothing while the debug UI is off.
 *
 * The inspector beside it answers "what did the model see?"; this answers
 * "why did it do that, and what do we change?", which needs somewhere to reply.
 */
import { useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  debugThreadMessage,
  debugThreadTitle,
  type DebugCalls,
  type DebugSubject,
} from "../../domain/debug-thread.ts";
import type { Trace } from "../../domain/trace.ts";
import type { RpcContract } from "../../server/contract.ts";
import { useDebugMode } from "./debug.ts";

/** Calls beyond this many would not fit in one message a reader can follow. */
const MAX_CALLS = 6;

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * The recorded calls to put in the brief: the ids the surface named, or the
 * ones linked to it, with the ones no longer stored dropped.
 */
async function loadCalls(rpc: Rpc, calls: DebugCalls): Promise<Trace[]> {
  const ids =
    "link" in calls
      ? (
          await rpc.call("traces", { link: calls.link, limit: MAX_CALLS })
        ).traces.map((trace) => trace.id)
      : calls.traceIds
          .filter((id): id is string => Boolean(id))
          .slice(0, MAX_CALLS);
  const loaded = await Promise.all(
    ids.map((id) =>
      rpc.call("trace", { id }).then(
        ({ trace }) => trace,
        () => null,
      ),
    ),
  );
  return loaded.filter((trace): trace is Trace => trace !== null);
}

export function DebugThreadButton({
  subject,
  className,
}: {
  subject: DebugSubject;
  className?: string;
}) {
  const debug = useDebugMode("discuss");
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);
  const label = "Debug this in a new thread";
  if (!debug) return null;
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const calls = await loadCalls(rpc, subject.calls);
      const { threadId } = await rpc.call("debugThread", {
        title: debugThreadTitle(subject),
        message: debugThreadMessage(subject, calls),
      });
      navigate.toThread(threadId);
    } catch (cause) {
      toast.error(`Couldn't start a debug thread: ${message(cause)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      disabled={busy}
      data-workstreams-discuss=""
      // Rows and blocks around it navigate, drag, or focus on these.
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void start();
      }}
      className={cn(
        "inline-flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-inherit opacity-55 hover:bg-current/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-default disabled:opacity-100",
        className,
      )}
    >
      <Icon
        name="ChildThread"
        aria-hidden
        className={cn(
          "size-3.5",
          busy && "animate-pulse motion-reduce:animate-none",
        )}
      />
    </button>
  );
}
