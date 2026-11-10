/*
 * Views that read their own RPC instead of the `state` snapshot re-read only
 * for the `changed` signals that can concern them (see domain/changes.ts),
 * and when the realtime link comes back, since signals sent while it was
 * down are not replayed.
 */
import { useEffect, useRef } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
} from "@get-bb/plugin-sdk/app";
import { isScopedChange, touchesThread } from "../domain/changes.ts";

function useReconnected(onReconnect: () => void): void {
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  const callback = useRef(onReconnect);
  callback.current = onReconnect;
  useEffect(() => {
    const was = previous.current;
    previous.current = connection;
    if (connection === "connected" && was !== "connected") callback.current();
  }, [connection]);
}

/** Calls `onChange` when this thread's records (recap, question) may have changed. */
export function useThreadChanged(
  threadId: string | null,
  onChange: () => void,
): void {
  useRealtime("changed", (payload) => {
    if (threadId && touchesThread(payload, threadId)) onChange();
  });
  useReconnected(onChange);
}

/**
 * Calls `onChange` for writes that may reach beyond the `state` slices and
 * per-thread records, such as suggestion and organizer changes.
 */
export function useUnscopedChanged(onChange: () => void): void {
  useRealtime("changed", (payload) => {
    if (!isScopedChange(payload)) onChange();
  });
  useReconnected(onChange);
}
