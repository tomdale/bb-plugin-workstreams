/**
 * Tells the server whether this bb draws reply blocks. Only the tomdale/bb
 * fork has the message-block slot; the server turns on reply-block recaps
 * (no recap tool, the merged instruction) only after a client has reported
 * it, so an agent on upstream bb never writes blocks nobody can draw. The
 * report repeats whenever the realtime link comes back, and the server keeps
 * the last one, so a reload starts from what the running clients draw.
 */
import { useEffect } from "react";
import { useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import { replyBlocksDrawn } from "./register.ts";

export function ClientReport(): null {
  const rpc = useRpc<RpcContract>();
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    if (connection !== "connected") return;
    void rpc
      .call("reportClient", { messageBlocks: replyBlocksDrawn() })
      .catch(() => {});
  }, [rpc, connection]);
  return null;
}
