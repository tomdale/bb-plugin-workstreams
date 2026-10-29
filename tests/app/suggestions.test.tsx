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
import type { PreviewGroup } from "../../src/domain/suggestion-preview.ts";

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
  preview: null,
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

const group = (
  name: string,
  extra: Partial<PreviewGroup> = {},
): PreviewGroup => ({
  name,
  context: false,
  unfiled: false,
  created: false,
  removed: false,
  moved: false,
  renamedFrom: null,
  threads: [],
  more: 0,
  groups: [],
  others: 0,
  collapsed: null,
  ...extra,
});

it("previews sidebar changes, and lists tree tidying that moves no thread apart", async () => {
  await mount({
    suggestions: [
      suggestion("s1", "File Automations' own threads in PR Upkeep", {
        kind: "split",
        headline: "Move 1 thread in Automations into subgroups",
        reason: "Upkeep apart from design.",
        preview: {
          before: [
            group("Vercel Agent", {
              context: true,
              groups: [
                group("Automations", {
                  threads: [{ id: "t1", title: "Fix PR checks", moved: true }],
                  groups: [group("Alert Investigations", { collapsed: 2 })],
                }),
              ],
            }),
          ],
          after: [
            group("Vercel Agent", {
              context: true,
              groups: [
                group("Automations", {
                  groups: [
                    group("Alert Investigations", { collapsed: 2 }),
                    group("PR Upkeep", {
                      created: true,
                      threads: [
                        { id: "t1", title: "Fix PR checks", moved: true },
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        },
      }),
      suggestion("s2", "Move Workforest under bb", {
        headline: "Move Workforest under bb",
        reason: "Workforest is a bb tool.",
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
    ],
    running: false,
    lastRunAt: 1,
    error: null,
  });
  const sidebar = await screen.findByRole("region", {
    name: "Sidebar changes",
  });
  const tree = screen.getByRole("region", { name: "Group tree tidying" });
  expect(
    within(sidebar).getByRole("heading", {
      name: "Move 1 thread in Automations into subgroups",
    }),
  ).toBeTruthy();
  const now = within(sidebar).getByRole("region", { name: "Now" });
  const after = within(sidebar).getByRole("region", {
    name: "After accepting",
  });
  // A lone context group folds into its child's dimmed prefix.
  expect(within(now).getByText("Automations").textContent).toBe(
    "Vercel Agent › Automations",
  );
  expect(within(now).getByText("Fix PR checks").textContent).toBe(
    "Moves: Fix PR checks",
  );
  expect(within(after).getByText("PR Upkeep").nextSibling?.textContent).toBe(
    "New",
  );
  expect(within(after).getByText("· 2 threads")).toBeTruthy();
  expect(within(sidebar).getByText("Upkeep apart from design.")).toBeTruthy();

  expect(
    within(tree).getByRole("heading", { name: "Move Workforest under bb" }),
  ).toBeTruthy();
  expect(within(tree).getByText("From").parentElement!.textContent).toBe(
    "From Workforestto bb › Workforest",
  );
  expect(within(tree).queryByRole("region", { name: "Now" })).toBeNull();
});
