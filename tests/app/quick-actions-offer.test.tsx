// @vitest-environment jsdom
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  QUICK_ACTIONS_OFFER_EVENT,
  QUICK_ACTIONS_REQUEST_EVENT,
  QuickActionsOffer,
} from "../../src/app/snooze/QuickActionsOffer.tsx";

afterEach(cleanup);

/** Records offers the way Quick Actions receives them. */
function listen() {
  const offers: unknown[] = [];
  const receive = (event: Event) =>
    offers.push((event as CustomEvent<unknown>).detail);
  window.addEventListener(QUICK_ACTIONS_OFFER_EVENT, receive);
  return {
    offers,
    stop: () => window.removeEventListener(QUICK_ACTIONS_OFFER_EVENT, receive),
  };
}

const request = () =>
  window.dispatchEvent(new CustomEvent(QUICK_ACTIONS_REQUEST_EVENT));
const SNOOZE_OFFER = { key: "workstreams/snooze", order: 200 };

describe("QuickActionsOffer", () => {
  it("offers Snooze, keyed by this plugin's id, on mount and on every request", () => {
    const quickActions = listen();
    const slot = renderSlot(
      { component: QuickActionsOffer },
      {},
      { pluginId: "workstreams" },
    );
    expect(quickActions.offers).toEqual([SNOOZE_OFFER]);
    request();
    request();
    expect(quickActions.offers).toEqual([
      SNOOZE_OFFER,
      SNOOZE_OFFER,
      SNOOZE_OFFER,
    ]);
    expect(slot.container.innerHTML).toBe("");
    slot.lifecycle.unmount();
    quickActions.stop();
  });

  it("stops answering requests once unmounted", () => {
    const slot = renderSlot(
      { component: QuickActionsOffer },
      {},
      { pluginId: "workstreams" },
    );
    slot.lifecycle.unmount();
    const quickActions = listen();
    request();
    expect(quickActions.offers).toEqual([]);
    quickActions.stop();
  });
});
