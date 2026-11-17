// @vitest-environment jsdom
/**
 * A model call whose cost was not reported never shows as $0.0000 in
 * Activity, a call's details, or the inspector.
 */
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { TraceSummary } from "../../src/domain/trace.ts";
import { ActivityView } from "./activity-mount.tsx";
import { entry, trace } from "./activity-fixtures.ts";
import { emptyState } from "./fixtures.ts";

afterEach(cleanup);

function page(traces: TraceSummary[]) {
  return renderSlot(
    { component: ActivityView },
    {},
    {
      settings: {},
      rpc: {
        prefs: () => ({
          prefs: {
            sidebar: { showUpNext: true, showRecent: true, recentLimit: 5 },
            threads: {
              autoTitle: true,
              analysisModel: { kind: "gateway", model: "m" },
              showParentLink: false,
            },
            newWork: {
              homeProjectId: "",
              suggestions: true,
              suggestionsModel: { kind: "gateway", model: "m" },
            },
            organize: { model: { kind: "gateway", model: "m" } },
            advanced: { hostId: "", debugUi: true },
          },
        }),
        state: () => emptyState(),
        journal: () => ({ entries: [entry] }),
        traces: () => ({ traces }),
        trace: ({ id }: { id: string }) => ({
          trace: {
            ...traces.find((t) => t.id === id),
            provider: "test",
            thinking: "off",
            system: "Classify",
            prompt: "Exact prompt",
            input: {},
            response: "{}",
            reasoning: null,
            stopReason: "stop",
            parsed: {},
            outcome: {},
            links: [],
            replays: [],
          },
        }),
      } as never,
    },
  );
}

const unreported = { input: 100, output: 20, cost: null };

it("says no cost was reported when no shown call reported one", async () => {
  const slot = await page([
    trace("gateway", { usage: unreported }),
    trace("worker", { usage: null }),
  ]);
  expect(
    await slot.findByText("2 model traces shown · no cost reported"),
  ).toBeTruthy();
  expect(slot.queryByText(/\$0\.0000/)).toBeNull();
});

it("sums the reported costs and leaves the unreported ones out", async () => {
  const slot = await page([
    trace("reported"),
    trace("free", { usage: { input: 1, output: 1, cost: 0 } }),
    trace("unreported", { usage: unreported }),
  ]);
  expect(await slot.findByText("3 model traces shown · $0.0100")).toBeTruthy();
});

it("shows a call's unreported cost as not reported, beside its tokens", async () => {
  const slot = await page([trace("unreported", { usage: unreported })]);
  const row = (await slot.findByText("unreported")).closest("li")!;
  fireEvent.click(within(row).getByText("Technical details"));
  const cost = within(row).getByText("Reported cost").nextElementSibling!;
  expect(cost.textContent).toBe("Not reported");
  const input = within(row).getByText("Input tokens").closest("dt")!;
  expect(input.nextElementSibling!.textContent).toBe("100");

  fireEvent.click(
    await within(row).findByRole("button", { name: "Inspect this model call" }),
  );
  const pane = await within(document.body).findByRole("dialog");
  expect(
    await within(pane).findByText(/100 in \/ 20 out · no cost reported/),
  ).toBeTruthy();
  expect(within(pane).queryByText(/\$0\.0000/)).toBeNull();
});

it("shows a reported zero as zero", async () => {
  const slot = await page([
    trace("free", { usage: { input: 1, output: 1, cost: 0 } }),
  ]);
  expect(await slot.findByText("1 model traces shown · $0.0000")).toBeTruthy();
  const row = slot.getByText("free").closest("li")!;
  fireEvent.click(within(row).getByText("Technical details"));
  expect(
    within(row).getByText("Reported cost").nextElementSibling!.textContent,
  ).toBe("$0.0000");
});
