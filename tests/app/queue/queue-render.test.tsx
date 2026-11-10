// @vitest-environment jsdom
// The queue renders for things that leave its cards alone (⇧ held, server
// state for other threads): those renders must not re-measure the pile or
// redraw the cards.
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkstreamsPage } from "../../../src/app/page/Page.tsx";
import { ThreadCard } from "../../../src/app/page/queue/QueueItem.tsx";
import { emptyState, section, sidebarThread } from "../fixtures.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("leaves the pile unmeasured and its cards undrawn on a render that changes neither", async () => {
  const now = Date.now();
  const threads = Array.from({ length: 4 }, (_, index) =>
    sidebarThread(`t${index}`, {
      sectionId: "sec_a",
      title: `Task ${index}`,
      isUnread: true,
      latestAttentionAt: now - index * 60_000,
    }),
  );
  const slot = renderSlot({ component: WorkstreamsPage }, { subPath: "" }, {
    context: { projectId: null, threadId: null },
    sidebarThreads: {
      status: "ready",
      threads,
      sections: [section("sec_a", "Alpha")],
      projects: [],
    },
    rpc: {
      state: () => emptyState(),
      recapPrefs: () => ({ prefs: {} }),
      suggestions: () => ({
        state: { suggestions: [], running: false, error: null },
      }),
    },
  } as never);
  await waitFor(() =>
    expect(
      slot.container.querySelectorAll("[data-queue-card]").length,
    ).toBeGreaterThan(1),
  );
  const cardRenders = vi.spyOn(
    ThreadCard as unknown as { type: (props: unknown) => unknown },
    "type",
  );
  const measures = vi.spyOn(window, "getComputedStyle");
  // Holding ⇧ renders the queue to brighten the replies' keys.
  act(() => {
    fireEvent.keyDown(window, { key: "Shift" });
  });
  act(() => {
    fireEvent.keyUp(window, { key: "Shift" });
  });
  expect(measures).not.toHaveBeenCalled();
  expect(cardRenders).not.toHaveBeenCalled();
  slot.lifecycle.unmount();
});
