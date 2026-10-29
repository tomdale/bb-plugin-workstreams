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
  expect(screen.getByText("Can't apply now: That topic is gone.")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Accept: Merge Alpha into Beta",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);

  // Accept all takes only the ones that can apply.
  expect(screen.getByRole("button", { name: "Accept all" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Decline: Rename Gamma to Gamma Two",
    }),
  );
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith({ ids: ["s3"], decision: "decline" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Accept all" })).toBeNull(),
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
  await screen.findByText("Recently decided");
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

it("leads with the operation and each item's move, from where to where", async () => {
  await mount({
    suggestions: [
      suggestion("s1", "Refile “Record demo” into PantryPal", {
        reason: "A demo belongs under PantryPal.",
        change: {
          op: "refile",
          rows: [
            {
              kind: "thread",
              id: "t1",
              title: "Record demo",
              from: at("Workstreams", "Recap Cards"),
              to: at("PantryPal"),
            },
          ],
        },
      }),
      suggestion("s2", "Move Workforest under bb", {
        change: {
          op: "reparent",
          rows: [
            {
              kind: "topic",
              name: "Workforest",
              created: false,
              from: [],
              to: at("bb"),
              threads: 2,
            },
          ],
        },
      }),
      suggestion("s3", "Split Automations into PR Upkeep, Design", {
        kind: "split",
        change: {
          op: "split",
          rows: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
            kind: "thread" as const,
            id: `a${n}`,
            title: `Automation task ${n}`,
            from: at("Automations"),
            to: [
              ...at("Automations"),
              { name: n <= 3 ? "PR Upkeep" : "Design", created: true },
            ],
          })),
        },
      }),
    ],
    running: false,
    lastRunAt: 1,
    error: null,
  });
  const refile = (await screen.findByRole("heading", { name: "Refile thread" }))
    .parentElement!.parentElement!;
  const [row] = within(refile).getAllByRole("listitem");
  expect(row!.textContent).toBe(
    "Record demonow in Workstreams › Recap Cardsmoves to PantryPal",
  );
  expect(
    within(refile).getByText("A demo belongs under PantryPal."),
  ).toBeTruthy();

  const move = screen.getByRole("heading", { name: "Move topic" })
    .parentElement!.parentElement!;
  expect(within(move).getByRole("listitem").textContent).toBe(
    "Topic Workforest2 threadsnow in Top levelmoves to bb",
  );

  // A big split shows its first rows, each target marked New, and the rest
  // on request.
  const split = screen.getByRole("heading", { name: "Split topic" })
    .parentElement!.parentElement!;
  expect(within(split).getAllByRole("listitem")).toHaveLength(5);
  expect(within(split).getAllByText("New")).toHaveLength(5);
  fireEvent.click(within(split).getByRole("button", { name: "Show 2 more" }));
  expect(within(split).getAllByRole("listitem")).toHaveLength(7);
});
