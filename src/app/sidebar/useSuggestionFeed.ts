import { useCallback, useRef, useState } from "react";
import { shareJson } from "../structuralSharing.ts";
import type { SuggestionsStateWire } from "../../server/contract.ts";
import type { useWorkstreams } from "../useWorkstreams.ts";

export type Rpc = ReturnType<typeof useWorkstreams>["rpc"];
export type Suggestion = SuggestionsStateWire["suggestions"][number];

/** How recently read suggestions still count as current when the review opens. */
const FRESH_MS = 1_000;

/**
 * The suggestions the review lists, held above it so they outlive it: the
 * pointer reaching the count reads them before the click, and the review then
 * opens at its final size. Opening on "Loading…" instead would draw a small
 * dialog that jumps to full size.
 */
export function useSuggestionFeed(rpc: Rpc) {
  const [state, setState] = useState<SuggestionsStateWire | null>(null);
  const [loadError, setLoadError] = useState(false);
  const readAt = useRef(0);
  const read = useCallback(async () => {
    readAt.current = Date.now();
    try {
      const next = (await rpc.call("suggestions", null)).state;
      setState((previous) => shareJson(previous, next));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [rpc]);
  /** Reads unless a read just began; what the pointer and the review share. */
  const refresh = useCallback(() => {
    if (Date.now() - readAt.current >= FRESH_MS) void read();
  }, [read]);
  return { state, setState, loadError, read, refresh };
}
export type Feed = ReturnType<typeof useSuggestionFeed>;
