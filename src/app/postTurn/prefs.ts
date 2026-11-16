import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../../server/contract.ts";
import {
  parsePresentationPrefs,
  type PresentationPrefs,
} from "../../domain/postTurn/prefs.ts";

/**
 * The Enhanced responses settings. Nothing is saved before the stored value
 * has loaded, and every save returns the stored result.
 */
export function usePresentationPrefs() {
  const rpc = useRpc<RpcContract>();
  const [prefs, setPrefs] = useState<PresentationPrefs | null>(null);
  useEffect(() => {
    let active = true;
    void rpc
      .call("presentationPrefs", null)
      .then((result) => {
        if (active) setPrefs(result.prefs);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [rpc]);
  useRealtime("presentationPrefs", (payload: unknown) => {
    const raw = (payload as { prefs?: unknown } | null)?.prefs;
    if (raw) setPrefs(parsePresentationPrefs(raw));
  });
  const save = useCallback(
    async (patch: Partial<PresentationPrefs>) => {
      const result = await rpc.call("setPresentationPrefs", { patch });
      setPrefs(result.prefs);
    },
    [rpc],
  );
  return { prefs, save };
}
