// @vitest-environment jsdom
// Activity's derived list: a page render hands it a new workstream lookup
// each time, which must not regroup the journal it already drew.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Activity } from "../../src/app/page/Activity.tsx";
import type { RpcContract } from "../../src/server/contract.ts";
import { entry } from "./activity-fixtures.ts";
import { emptyState } from "./fixtures.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps its day groups when only the page's workstream lookup changes", async () => {
  const day = 86_400_000;
  const entries = Array.from({ length: 50 }, (_, index) => ({
    ...entry,
    id: `e${index}`,
    at: Date.now() - index * (day / 4),
    rationale: `Moved thread ${index}`,
  }));
  let rerender!: () => void;
  function Page() {
    const rpc = useRpc<RpcContract>();
    const [, setCount] = useState(0);
    rerender = () => setCount((count) => count + 1);
    return (
      <Activity
        rpc={rpc}
        sections={[]}
        // A new lookup on every render, as the page passes a projection's.
        workstreamOf={() => null}
      />
    );
  }
  const slot = renderSlot({ component: Page }, {}, {
    rpc: {
      prefs: () => ({ prefs: {} }),
      state: () => emptyState(),
      journal: () => ({ entries }),
      traces: () => ({ traces: [] }),
    },
  } as never);
  await slot.findByText("Moved thread 49");
  expect(slot.getByText("Today")).toBeTruthy();
  const grouping = vi.spyOn(Date.prototype, "toDateString");
  for (let index = 0; index < 3; index++) act(() => rerender());
  expect(grouping).not.toHaveBeenCalled();
  slot.lifecycle.unmount();
});
