/**
 * Whether a message's turn is the one the docked recap card shows. The card
 * reads the thread's stored recap, which a reply block's card fields wrote,
 * so while it is docked the block leaves its headline and results to it.
 */
import { useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";

export function useDockedTurn(
  threadId: string | null,
  turnId: string | null,
): boolean {
  const rpc = useRpc<RpcContract>();
  const [docked, setDocked] = useState(false);
  const version = useRef(0);
  const load = () => {
    const current = ++version.current;
    if (!threadId || !turnId) return setDocked(false);
    void rpc
      .call("recap_get", { threadId })
      .then(({ recap, dismissed }) => {
        if (current === version.current)
          setDocked(!!recap && !dismissed && recap.turnId === turnId);
      })
      .catch(() => {});
  };
  useEffect(load, [rpc, threadId, turnId]);
  useRealtime("changed", load);
  return docked;
}
