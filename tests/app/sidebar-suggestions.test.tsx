import { mount } from "./sidebar-fixture.tsx";
// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SuggestionsStateWire } from "../../src/server/contract.ts";
import { suggestionCountLabel } from "../../src/app/sidebar/SuggestionsFlyaway.tsx";

type Suggestion = SuggestionsStateWire["suggestions"][number];

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

const place = (name: string) => [{ name, created: false }];
const suggestion = (
  id: string,
  headline: string,
  change: Suggestion["change"],
  problem: string | null = null,
): Suggestion => ({
  id,
  kind: "edit",
  summary: headline,
  reason: "",
  status: "pending",
  at: 0,
  decidedAt: null,
  problem,
  change,
  headline,
  arrivals: [],
});

const merge = suggestion("merge", "Merge Payments into Billing", {
  op: "merge",
  moves: [
    {
      from: place("Payments"),
      to: place("Billing"),
      threads: [{ id: "t1", title: "Refund flow" }],
      carried: 0,
    },
  ],
});
const rename = suggestion("rename", "Rename Docs to Docs site", {
  op: "rename",
  moves: [
    { from: place("Docs"), to: place("Docs site"), threads: [], carried: 0 },
  ],
});
const outdated = suggestion(
  "old",
  "Move Infra under Platform",
  null,
  "Infra no longer exists.",
);

const stateOf = (suggestions: Suggestion[]): SuggestionsStateWire => ({
  suggestions,
  running: false,
  lastRunAt: null,
  error: null,
});

async function open(
  suggestions: Suggestion[],
  rpc: Record<string, (input: unknown) => unknown> = {},
) {
  const slot = await mount(undefined, {
    pendingSuggestions: suggestions.length,
    rpc: { suggestions: () => ({ state: stateOf(suggestions) }), ...rpc },
  });
  const count = await slot.findByRole("button", {
    name: suggestionCountLabel(suggestions.length),
  });
  fireEvent.click(count);
  const flyaway = await slot.findByRole("dialog", {
    name: "Organizing suggestions",
  });
  return { slot, count, flyaway: within(flyaway) };
}

it("shows the waiting count on the Workstreams heading", async () => {
  const slot = await mount(undefined, { pendingSuggestions: 1 });
  await slot.findByRole("button", { name: "1 suggestion" });
});

it("shows no count when nothing waits", async () => {
  const slot = await mount();
  await slot.findByRole("heading", { name: "Workstreams" });
  expect(slot.queryByRole("button", { name: /suggestion/ })).toBeNull();
});

it("lists each suggestion's change and the threads it moves", async () => {
  const { flyaway } = await open([merge, rename, outdated]);
  await flyaway.findByText("Merge Payments into Billing");
  expect(flyaway.getByText("Refund flow")).toBeTruthy();
  // A suggestion that moves no thread keeps an empty second line.
  const renameLines = flyaway
    .getByText("Rename Docs to Docs site")
    .closest("li")!
    .querySelectorAll("p");
  expect(renameLines).toHaveLength(1);
  expect(renameLines[0]!.textContent).toBe("");
  // Out-of-date suggestions are counted, not listed.
  expect(flyaway.queryByText("Move Infra under Platform")).toBeNull();
  expect(flyaway.getByText("1 out of date")).toBeTruthy();
  expect(
    flyaway.getByRole("button", {
      name: "Accept: Merge Payments into Billing",
    }),
  ).toBeTruthy();
  expect(
    flyaway.getByRole("button", { name: "Decline: Rename Docs to Docs site" }),
  ).toBeTruthy();
});

const reparent = suggestion("reparent", "Move Workforest under bb", {
  op: "reparent",
  moves: [
    {
      from: place("Workforest"),
      to: [...place("bb"), ...place("Workforest")],
      threads: [],
      carried: 2,
      carriedThreads: [
        { id: "w1", title: "Fix worktree cleanup" },
        { id: "w2", title: "Cache mirrors" },
      ],
    },
  ],
});

it("lists a group's threads when its count is clicked", async () => {
  const { flyaway } = await open([reparent]);
  const line = await flyaway.findByRole("button", { name: "2 threads" });
  expect(line.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(line);
  expect(line.getAttribute("aria-expanded")).toBe("true");
  expect(flyaway.getByText("Fix worktree cleanup")).toBeTruthy();
  expect(flyaway.getByText("Cache mirrors")).toBeTruthy();
  fireEvent.click(line);
  expect(flyaway.getByRole("button", { name: "2 threads" })).toBeTruthy();
  expect(flyaway.queryByText("Cache mirrors")).toBeNull();
});

it("lists every thread when the line is cut off", async () => {
  const widths = vi
    .spyOn(HTMLElement.prototype, "scrollWidth", "get")
    .mockReturnValue(400);
  try {
    const { flyaway } = await open([merge]);
    fireEvent.click(
      await flyaway.findByRole("button", { name: "Refund flow" }),
    );
    await flyaway.findByRole("button", { name: "Refund flow", expanded: true });
  } finally {
    widths.mockRestore();
  }
});

it("leaves suggestions waiting when closed", async () => {
  const decide = vi.fn();
  const { slot, count, flyaway } = await open([merge, rename], {
    suggestionsDecide: decide,
  });
  await flyaway.findByText("Merge Payments into Billing");
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
  await waitFor(() =>
    expect(
      slot.queryByRole("dialog", { name: "Organizing suggestions" }),
    ).toBeNull(),
  );
  fireEvent.click(count);
  const again = within(
    await slot.findByRole("dialog", { name: "Organizing suggestions" }),
  );
  await again.findByText("Merge Payments into Billing");
  fireEvent.click(again.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(
      slot.queryByRole("dialog", { name: "Organizing suggestions" }),
    ).toBeNull(),
  );
  expect(decide).not.toHaveBeenCalled();
});

it("accepts a suggestion, with Undo in its place", async () => {
  const decide = vi.fn((_input: unknown) => ({
    applied: ["merge"],
    failed: [],
    entries: { merge: "entry" },
    state: stateOf([{ ...merge, status: "accepted" }, rename]),
  }));
  const reopen = vi.fn((_input: unknown) => ({
    state: stateOf([merge, rename]),
  }));
  const { flyaway } = await open([merge, rename], {
    suggestionsDecide: decide,
    suggestionsReopen: reopen,
  });
  fireEvent.click(
    await flyaway.findByRole("button", {
      name: "Accept: Merge Payments into Billing",
    }),
  );
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith({ ids: ["merge"], decision: "accept" }),
  );
  await flyaway.findByText("✓ Merge Payments into Billing");
  fireEvent.click(flyaway.getByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(reopen).toHaveBeenCalledWith({ id: "merge", entryId: "entry" }),
  );
  await flyaway.findByRole("button", {
    name: "Accept: Merge Payments into Billing",
  });
});

it("says so when nothing is left to review", async () => {
  const slot = await mount(undefined, {
    pendingSuggestions: 1,
    rpc: { suggestions: () => ({ state: stateOf([]) }) },
  });
  fireEvent.click(await slot.findByRole("button", { name: "1 suggestion" }));
  const flyaway = within(
    await slot.findByRole("dialog", { name: "Organizing suggestions" }),
  );
  await flyaway.findByText("No suggestions waiting");
});

it("opens Topics from the flyaway", async () => {
  const { slot, flyaway } = await open([merge]);
  fireEvent.click(flyaway.getByRole("button", { name: "Open Topics" }));
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "toPluginPanel",
    path: "home",
    options: { subPath: "topics" },
  });
});
