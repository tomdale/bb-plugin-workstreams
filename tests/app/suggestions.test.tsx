// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  OrganizerState,
  SuggestionsStateWire,
} from "../../src/server/contract.ts";

afterEach(cleanup);

const organization: OrganizerState = {
  status: "idle",
  progress: null,
  error: null,
  lastUpdatedAt: 1,
  groups: [],
  unresolved: [],
  counts: {
    activeRoots: 0,
    completedRoots: 0,
    totalRoots: 0,
    unresolvedRoots: 0,
    activeWorkstreams: 0,
  },
};

const suggestion = (
  id: string,
  summary: string,
  extra: Partial<SuggestionsStateWire["suggestions"][number]> = {},
): SuggestionsStateWire["suggestions"][number] => ({
  id,
  kind: "edit",
  summary,
  reason: "",
  status: "pending",
  at: 1,
  decidedAt: null,
  problem: null,
  change: null,
  headline: summary,
  arrivals: [],
  traceId: null,
  ...extra,
});

async function mount(state: SuggestionsStateWire) {
  let current = state;
  const decide = vi.fn(async (input: unknown) => {
    const { ids, decision } = input as { ids: string[]; decision: string };
    {
      current = {
        ...current,
        suggestions: current.suggestions.map((s) =>
          ids.includes(s.id)
            ? {
                ...s,
                status: decision === "accept" ? "accepted" : "declined",
                decidedAt: 2,
              }
            : s,
        ),
      };
      return { applied: ids, failed: [], state: current };
    }
  });
  const app = await loadPluginApp(() => import("../../src/app/index.tsx"));
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "organization" },
    {
      sidebarThreads: {
        status: "ready",
        threads: [],
        sections: [],
        projects: [],
      },
      rpc: {
        state: () => ({ state: null }),
        organization: async () => ({ state: organization }),
        suggestions: async () => ({ state: current }),
        suggestionsDecide: decide,
      },
    },
  );
  return { slot, decide };
}

it("lists suggestions with their reasons, and accepts or declines each", async () => {
  const { decide } = await mount({
    suggestions: [
      suggestion("s1", "Split Automations into Planning, Triggers", {
        kind: "split",
        reason: "Planning apart from triggers",
      }),
      suggestion("s2", "Merge Alpha into Beta", {
        problem: "That topic is gone.",
      }),
      suggestion("s3", "Rename Gamma to Gamma Two"),
    ],
    running: false,
    lastRunAt: 1,
    error: null,
  });
  await screen.findByText("Split Automations into Planning, Triggers");
  expect(screen.getByText("Planning apart from triggers")).toBeTruthy();
  // One that can't apply waits under Out of date, with no Accept.
  expect(screen.getByText("That topic is gone.")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Accept: Merge Alpha into Beta" }),
  ).toBeNull();

  // Accept all takes only the ones that can apply.
  expect(screen.getByRole("button", { name: "Accept all 2" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Decline: Rename Gamma to Gamma Two",
    }),
  );
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith({ ids: ["s3"], decision: "decline" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /^Accept all/ })).toBeNull(),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Accept: Split Automations into Planning, Triggers",
    }),
  );
  await waitFor(() =>
    expect(decide).toHaveBeenLastCalledWith({
      ids: ["s1"],
      decision: "accept",
    }),
  );
  await screen.findByText("Recently decided (2)");
});

it("says when there is nothing to review", async () => {
  await mount({
    suggestions: [],
    running: false,
    lastRunAt: null,
    error: null,
  });
  await screen.findByText("No suggestions right now.");
  expect(screen.getByRole("button", { name: "Ask now" })).toBeTruthy();
});

const at = (...names: string[]) =>
  names.map((name) => ({ name, created: false }));

const thread = (id: string) => ({ id, title: `Thread ${id}` });

it("lists thread moves biggest first, then tidying, with out-of-date ones collapsed", async () => {
  await mount({
    suggestions: [
      suggestion("s1", "Refile", {
        headline: "Move “Thread p1” to PantryPal",
        reason: "Demo videos belong with the product.",
        change: {
          op: "refile",
          moves: [
            {
              from: at("Workstreams", "Recap Cards"),
              to: at("PantryPal"),
              threads: [thread("p1")],
              carried: 0,
            },
          ],
        },
      }),
      suggestion("s2", "Split", {
        kind: "split",
        headline: "Split Automations into PR Upkeep and Design",
        arrivals: [thread("n1"), thread("n2")],
        change: {
          op: "split",
          moves: [
            {
              from: at("Automations"),
              to: [...at("Automations"), { name: "PR Upkeep", created: true }],
              threads: [thread("a1"), thread("a2")],
              carried: 0,
            },
            {
              from: at("Color Settings"),
              to: [...at("Automations"), { name: "Design", created: true }],
              threads: [thread("a3")],
              carried: 0,
            },
          ],
        },
      }),
      suggestion("s3", "Move Workforest under bb", {
        headline: "Move Workforest under bb",
        change: {
          op: "reparent",
          moves: [
            {
              from: at("Workforest"),
              to: at("bb", "Workforest"),
              threads: [],
              carried: 0,
            },
          ],
        },
      }),
      suggestion("s4", "Old split", {
        kind: "split",
        headline: "Move “Thread e1” to Evals",
        problem: "Its threads changed since; ask for suggestions again.",
      }),
    ],
    running: false,
    lastRunAt: 1,
    error: null,
  });
  const moves = await screen.findByRole("region", { name: "Moves threads" });
  // The split moves more threads, so it leads.
  expect(
    within(moves)
      .getAllByRole("heading", { level: 4 })
      .map((h) => h.textContent),
  ).toEqual([
    "Split Automations into PR Upkeep and Design",
    "Move “Thread p1” to PantryPal",
  ]);
  // Each destination is listed once, with its threads; a thread from
  // elsewhere says where from.
  const split = within(moves)
    .getByRole("heading", { name: /^Split/ })
    .closest("li")!;
  expect(
    within(split)
      .getAllByRole("listitem")
      .map((row) => row.textContent),
  ).toEqual([
    "+PR Upkeep (new group)Thread a1 · Thread a2",
    "+Design (new group)Thread a3 (from Color Settings)",
  ]);
  expect(within(split).getByText(/^Also files/).textContent).toBe(
    "Also files Thread n1 and Thread n2, which joined since.",
  );
  // A single move is one from → to line.
  const refile = within(moves)
    .getByRole("heading", { name: /^Move “/ })
    .closest("li")!;
  expect(within(refile).getByText("From").parentElement!.textContent).toBe(
    "From Workstreams › Recap Cardsto PantryPal",
  );
  expect(
    within(refile).getByText("Demo videos belong with the product."),
  ).toBeTruthy();

  const tidying = screen.getByRole("region", { name: "Tidies groups" });
  expect(within(tidying).getByText("From").parentElement!.textContent).toBe(
    "From Workforestto bb › Workforest",
  );

  // Out-of-date suggestions wait collapsed at the end, and Accept all
  // counts only the ones that can apply.
  expect(screen.getByText("Out of date (1)")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Decline: Move “Thread e1” to Evals" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Accept: Move “Thread e1” to Evals" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Accept all 3" })).toBeTruthy();
});
