import { useCallback, useState } from "react";
import {
  describeWake,
  defaultPreset,
  presetWhen,
} from "../../domain/snooze.ts";
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
 * The thread list's snoozing: snooze a request, the default wake, a
 * workstream row's snooze button, and the request the Custom… dialog is
 * collecting a time for.
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
  const preset = defaultPreset(snoozePrefs);
  /** When the default preset wakes, from the moment of the click. */
  const wakeByDefault = useStableCallback(() => presetWhen(preset, Date.now()));
  /**
   * A workstream row's snooze button, while the row lists threads: it
   * snoozes every one of them (see `groupRoots`) with the default preset,
   * and its menu offers every preset and Custom….
   */
  const groupSnoozeOf = useCallback(
    (group: ThreadNode): GroupSnooze | undefined => {
      const request = groupSnoozeRequest(group);
      if (!request) return undefined;
      const snooze = (when: SnoozeWhen) => applySnooze(request, when);
      const custom = () => setCustomSnooze(request);
      const wake = wakeByDefault();
      return {
        label: request.label,
        title: `Snooze ${request.subject} ${describeWake(wake.until, Date.now(), wake.events)}`,
        run: () => snooze(wakeByDefault()),
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
    [applySnooze, wakeByDefault, snoozePrefs],
  );
  return {
    snoozePrefs,
    applySnooze,
    wakeByDefault,
    groupSnoozeOf,
    customSnooze,
    setCustomSnooze,
  };
}
