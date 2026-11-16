/**
 * Puts Snooze in the Quick Actions ring when that plugin is installed. Quick
 * Actions shows the BB thread actions other plugins name in a
 * `bb-quick-actions:offer` event, and sends `bb-quick-actions:request` when its
 * menu mounts, so this offers once on mount and again on every request. The
 * ring then draws the Snooze thread action (`threadAction.ts`) with its presets
 * as a band. Without Quick Actions nothing listens, and Snooze is unchanged.
 */
import { useEffect } from "react";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { SNOOZE_ACTION_ID } from "./threadAction.ts";

export const QUICK_ACTIONS_OFFER_EVENT = "bb-quick-actions:offer";
export const QUICK_ACTIONS_REQUEST_EVENT = "bb-quick-actions:request";
/** Right after Archive, which Quick Actions orders at 100. */
const RING_ORDER = 200;

export function QuickActionsOffer(): null {
  const pluginId = experimental_usePluginId();
  useEffect(() => {
    const offer = () =>
      window.dispatchEvent(
        new CustomEvent(QUICK_ACTIONS_OFFER_EVENT, {
          detail: { key: `${pluginId}/${SNOOZE_ACTION_ID}`, order: RING_ORDER },
        }),
      );
    window.addEventListener(QUICK_ACTIONS_REQUEST_EVENT, offer);
    offer();
    return () => window.removeEventListener(QUICK_ACTIONS_REQUEST_EVENT, offer);
  }, [pluginId]);
  return null;
}
