import { useEffect, useRef } from "react";
import { useBbContext, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { readChangedSignal } from "../../domain/changes.ts";
import {
  isStreamDeckCommand,
  STREAM_DECK_CHANNEL,
} from "../../domain/streamDeck.ts";
import type { RpcContract } from "../../server/contract.ts";
import { useStableCallback } from "../useLatest.ts";
import { openNextUpThread } from "./NextUpCommand.tsx";

/**
 * This app's side of the Stream Deck. It tells the server which thread it has
 * open, whenever that changes and whenever the app comes to the front, so the
 * keys can leave that thread out; the server takes the app that reported
 * last as the one in front of the user. It reports again after Workstreams
 * restarts (a `changed` signal with a new epoch), which forgets the report.
 *
 * It also runs the Next key. The server relays the press because only the app
 * knows which thread it has open, and the next thread is the Up Next row after
 * that one, as with the next Up Next command.
 */
export function StreamDeckBridge(): null {
  const { threadId } = useBbContext();
  const rpc = useRpc<RpcContract>();
  const report = useStableCallback(() => {
    void rpc.call("streamDeckViewing", { threadId }).catch(() => {});
  });
  useEffect(report, [report, threadId]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") report();
    };
    window.addEventListener("focus", report);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", report);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [report]);
  const epoch = useRef<string | null>(null);
  useRealtime("changed", (payload) => {
    const signal = readChangedSignal(payload);
    if (!signal || signal.epoch === epoch.current) return;
    const restarted = epoch.current !== null;
    epoch.current = signal.epoch;
    if (restarted) report();
  });
  useRealtime(STREAM_DECK_CHANNEL, (payload) => {
    if (isStreamDeckCommand(payload)) openNextUpThread(threadId);
  });
  return null;
}
