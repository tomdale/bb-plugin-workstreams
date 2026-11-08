import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import type { InteractionPayload } from "../../server/questions/contracts.ts";

export function usePendingQuestion(threadId: string | null) {
  const rpc = useRpc<RpcContract>();
  const [pending, setPending] = useState<{
    threadId: string;
    id: string;
    recoverable: boolean;
    payload: InteractionPayload;
  } | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    if (!threadId) return;
    const value = await rpc
      .call("question_pending", { threadId })
      .catch(() => undefined);
    if (value !== undefined && version === request.current)
      setPending(value ? { threadId, ...value } : null);
  }, [rpc, threadId]);
  useEffect(() => {
    void load();
    // A stopped waiter may disappear without a plugin realtime notification.
    const timer = setInterval(() => void load(), 2000);
    return () => {
      clearInterval(timer);
      request.current++;
    };
  }, [load]);
  useRealtime("changed", () => void load());
  return pending?.threadId === threadId ? pending : null;
}
