import { useCallback, useState } from "react";
import type { SnoozeWhen } from "../../domain/snooze.ts";
import { snoozeThreads } from "../snooze/actions.ts";
import {
  CurrentSnoozeMenuItems,
  plainMenuKit,
} from "../snooze/SnoozeMenuItems.tsx";
import { useStableCallback } from "../useLatest.ts";
import type { useWorkstreams } from "../useWorkstreams.ts";
import { groupSnoozeRequest } from "./rows.ts";
import type { GroupSnooze, SnoozeRequest, ThreadNode } from "./types.ts";

/**
 * The thread list's snoozing: snooze a request, a workstream row's snooze
 * button, and the request the Custom… dialog is collecting a time for.
 */
export function useSidebarSnooze(ws: ReturnType<typeof useWorkstreams>) {
  const [customSnooze, setCustomSnooze] = useState<SnoozeRequest | null>(null);
  const snoozePrefs = ws.snoozePrefs;
  const applySnooze = useStableCallback(
    (request: SnoozeRequest, when: SnoozeWhen) =>
      snoozeThreads(ws.setSnoozes, request.threads, when, {
        previous: ws.snoozeOf,
        subject: request.subject,
      }),
  );
  /**
   * A workstream row's snooze button, while the row lists threads: it
   * snoozes every one of them (see `groupRoots`) with the default preset,
   * and its menu offers every preset and Custom…. The button itself works
   * out the wake time it names (see `SnoozeAction`).
   */
  const groupSnoozeOf = useCallback(
    (group: ThreadNode): GroupSnooze | undefined => {
      const request = groupSnoozeRequest(group);
      if (!request) return undefined;
      const snooze = (when: SnoozeWhen) => applySnooze(request, when);
      const custom = () => setCustomSnooze(request);
      return {
        label: request.label,
        subject: request.subject,
        prefs: snoozePrefs,
        menu: (
          <CurrentSnoozeMenuItems
            kit={plainMenuKit}
            heading={request.label}
            prefs={snoozePrefs}
            onSnooze={snooze}
            onCustom={custom}
          />
        ),
        snooze,
        custom,
      };
    },
    [applySnooze, snoozePrefs],
  );
  return {
    snoozePrefs,
    applySnooze,
    groupSnoozeOf,
    customSnooze,
    setCustomSnooze,
  };
}
