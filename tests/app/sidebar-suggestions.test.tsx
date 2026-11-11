import { mount } from "./sidebar-fixture.tsx";
// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SuggestionsStateWire } from "../../src/server/contract.ts";
import { suggestionCountLabel } from "../../src/app/sidebar/SuggestionsChip.tsx";

type Suggestion = SuggestionsStateWire["suggestions"][number];

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const place = (name: string) => [{ name, created: false }];
const suggestion = (
  id: string,
  headline: string,
  change: Suggestion["change"],
  delta: Suggestion["delta"] = null,
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
  delta,
  headline,
  arrivals: [],
  traceId: null,
});

const merge = suggestion(
  "merge",
  "Merge Alpha into Beta",
  {
    op: "merge",
    moves: [
      {
        from: place("Alpha"),
        to: place("Beta"),
        threads: [{ id: "root", title: "Root task" }],
        carried: 0,
      },
    ],
  },
  {
    topics: [],
    removed: ["alpha"],
    assignments: [{ threadId: "root", topicId: "beta" }],
  },
);
const rename = suggestion(
  "rename",
  "Rename Beta to Beta site",
  {
    op: "rename",
    moves: [
      {
        from: place("Beta"),
        to: place("Beta site"),
        threads: [],
        carried: 1,
      },
    ],
  },
  {
    topics: [{ id: "beta", name: "Beta site", parentId: null }],
    removed: [],
    assignments: [],
  },
);
const third = suggestion(
  "third",
  "Move “Loose task” to Beta",
  {
    op: "refile",
    moves: [
      {
        from: null,
        to: place("Beta"),
        threads: [{ id: "loose", title: "Loose task" }],
        carried: 0,
      },
    ],
  },
  {
    topics: [],
    removed: [],
    assignments: [{ threadId: "loose", topicId: "beta" }],
  },
);
const outdated = suggestion(
  "old",
  "Move Infra under Platform",
  null,
  null,
  "Infra no longer exists.",
);

const stateOf = (suggestions: Suggestion[]): SuggestionsStateWire => ({
  suggestions,
  running: false,
  lastRunAt: null,
  error: null,
});

/** Alpha and Beta, with the sidebar's roots filed in them; "loose" is Unfiled. */
const catalog = {
  entities: [
    {
      id: "alpha",
      name: "Alpha",
      description: "",
      parentId: null,
      aliases: [],
    },
    { id: "beta", name: "Beta", description: "", parentId: null, aliases: [] },
  ],
  groups: { sec_a: "alpha", sec_b: "beta" },
};
const assignments = { root: "alpha", beta: "beta" };

async function open(
  suggestions: Suggestion[],
  rpc: Record<string, (input: unknown) => unknown> = {},
  options: { realtime?: boolean } = {},
) {
  const slot = await mount(undefined, {
    pendingSuggestions: suggestions.length,
    catalog,
    assignments,
    rpc: { suggestions: () => ({ state: stateOf(suggestions) }), ...rpc },
    ...options,
  });
  const count = await slot.findByRole("button", {
    name: suggestionCountLabel(suggestions.length),
  });
  fireEvent.click(count);
  const dialog = await slot.findByRole("dialog", {
    name: "Organizing suggestions",
  });
  return { slot, count, dialog, review: within(dialog) };
}

/** The sentences of the list, top to bottom. */
const rows = (review: ReturnType<typeof within>) =>
  review
    .getAllByRole("listitem")
    .map((item: HTMLElement) => item.textContent?.replace(/\s+/g, " ").trim());

const decideResult = (
  state: Suggestion[],
  applied: string[],
  entries: Record<string, string> = {},
) => ({ applied, failed: [], entries, state: stateOf(state) });

it("shows the waiting count on the Workstreams heading", async () => {
  const slot = await mount(undefined, { pendingSuggestions: 1 });
  await slot.findByRole("button", { name: "1 suggestion" });
});

it("shows no count when nothing waits", async () => {
  const slot = await mount();
  await slot.findByRole("heading", { name: "Workstreams" });
  expect(slot.queryByRole("button", { name: /suggestion/ })).toBeNull();
});

it("lists each suggestion as a sentence, the first selected and titling the pane", async () => {
  const { review } = await open([merge, rename, outdated]);
  expect(rows(review)).toEqual([
    "Merge Alpha into Beta",
    "Rename Beta to Beta site",
  ]);
  const first = review.getByRole("button", { name: "Merge Alpha into Beta" });
  expect(first.getAttribute("aria-current")).toBe("true");
  expect(
    review
      .getByRole("button", { name: "Rename Beta to Beta site" })
      .getAttribute("aria-current"),
  ).toBe("false");
  expect(
    review.getByRole("heading", { name: "Merge Alpha into Beta" }),
  ).toBeTruthy();
  expect(
    review.getByRole("button", { name: "Accept: Merge Alpha into Beta" }),
  ).toBeTruthy();
  expect(
    review.getByRole("button", { name: "Decline: Merge Alpha into Beta" }),
  ).toBeTruthy();
  // Out-of-date suggestions are counted, not listed.
  expect(review.queryByText("Move Infra under Platform")).toBeNull();
  expect(review.getByText("1 out of date")).toBeTruthy();
});

it("gives the keys on the buttons", async () => {
  const { review } = await open([merge, rename]);
  const accept = review.getByRole("button", {
    name: "Accept: Merge Alpha into Beta",
  });
  expect(accept.getAttribute("aria-keyshortcuts")).toBe("A");
  expect(accept.textContent).toContain("A");
  expect(
    review.getByRole("button", { name: "Decline: Merge Alpha into Beta" })
      .textContent,
  ).toContain("D");
});

it("reads the suggestions when the pointer reaches the count, so the modal opens complete", async () => {
  const read = vi.fn(() => ({ state: stateOf([merge, rename]) }));
  const slot = await mount(undefined, {
    pendingSuggestions: 2,
    rpc: { suggestions: read },
  });
  const count = await slot.findByRole("button", { name: "2 suggestions" });
  expect(read).not.toHaveBeenCalled();
  fireEvent.pointerEnter(count);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  // Let the read land before the click, as it does in the moment before one.
  await new Promise((resolve) => setTimeout(resolve, 20));
  fireEvent.click(count);
  const review = within(
    await slot.findByRole("dialog", { name: "Organizing suggestions" }),
  );
  // The first frame already has the suggestions, not a loading line.
  expect(review.queryByText("Loading…")).toBeNull();
  expect(
    review.getByRole("button", { name: "Merge Alpha into Beta" }),
  ).toBeTruthy();
  // Opening right after the read does not read again.
  expect(read).toHaveBeenCalledTimes(1);
});

it("draws the sidebar now and after accepting the selected change", async () => {
  const { review, dialog } = await open([merge, rename]);
  // The drawing in words; its ribbons carry the threads that move.
  expect(
    dialog.textContent?.includes("Merge Alpha into Beta. 1 thread to Beta."),
  ).toBe(true);
  expect(review.getByText("Now")).toBeTruthy();
  expect(review.getByText("After accepting")).toBeTruthy();
  const ribbon = review.getByRole("button", {
    name: "1 thread to Beta: Root task",
  });
  // A ribbon names its threads on hover, with their count.
  fireEvent.mouseEnter(ribbon);
  const card = review.getByRole("tooltip");
  expect(within(card).getByText("Root task")).toBeTruthy();
  expect(within(card).getByText("1 thread")).toBeTruthy();
  fireEvent.mouseLeave(ribbon);
  expect(review.queryByRole("tooltip")).toBeNull();
});

it("says so when a change moves no thread, and when it can't be drawn", async () => {
  const quiet = suggestion("quiet", "Create Ops", merge.change, {
    topics: [{ id: "new:/ops", name: "Ops", parentId: null }],
    removed: [],
    assignments: [],
  });
  const undrawn = suggestion("undrawn", "Move Docs to Ops", merge.change);
  const { review, dialog } = await open([quiet, undrawn]);
  expect(dialog.textContent).toContain("No thread in the sidebar moves.");
  fireEvent.click(review.getByRole("button", { name: "Move Docs to Ops" }));
  await review.findByText("The sidebar can't be drawn for this suggestion.");
  // It can still be decided.
  expect(
    (
      review.getByRole("button", {
        name: "Accept: Move Docs to Ops",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

it("steps between changes with J and K and the arrow keys", async () => {
  const { review } = await open([merge, rename, third]);
  const selected = () =>
    review
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-current") === "true")?.textContent;
  // Focus follows the selection, so the arrow keys continue from the row.
  const settle = () =>
    waitFor(() => expect(document.activeElement?.textContent).toBe(selected()));
  await settle();
  expect(selected()).toBe("Merge Alpha into Beta");
  await userEvent.keyboard("j");
  expect(selected()).toBe("Rename Beta to Beta site");
  expect(
    review.getByRole("heading", { name: "Rename Beta to Beta site" }),
  ).toBeTruthy();
  await settle();
  await userEvent.keyboard("k");
  expect(selected()).toBe("Merge Alpha into Beta");
  await settle();
  await userEvent.keyboard("k");
  expect(selected()).toBe("Move “Loose task” to Beta");
  await settle();
  await userEvent.keyboard("{ArrowDown}");
  expect(selected()).toBe("Merge Alpha into Beta");
  await settle();
  await userEvent.keyboard("{ArrowUp}");
  expect(selected()).toBe("Move “Loose task” to Beta");
});

it("selects a change when its row is clicked", async () => {
  const { review } = await open([merge, rename]);
  fireEvent.click(
    review.getByRole("button", { name: "Rename Beta to Beta site" }),
  );
  expect(
    review.getByRole("heading", { name: "Rename Beta to Beta site" }),
  ).toBeTruthy();
});

it("leaves suggestions waiting when closed", async () => {
  const decide = vi.fn();
  const { slot, count, review } = await open([merge, rename], {
    suggestionsDecide: decide,
  });
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      slot.queryByRole("dialog", { name: "Organizing suggestions" }),
    ).toBeNull(),
  );
  fireEvent.click(count);
  const again = within(
    await slot.findByRole("dialog", { name: "Organizing suggestions" }),
  );
  await again.findByRole("button", { name: "Merge Alpha into Beta" });
  fireEvent.click(again.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(
      slot.queryByRole("dialog", { name: "Organizing suggestions" }),
    ).toBeNull(),
  );
  expect(decide).not.toHaveBeenCalled();
  void review;
});

it("accepts the selected change with A: its row keeps its place, with Undo, and the next is selected", async () => {
  const decide = vi.fn((_input: unknown) =>
    decideResult([{ ...merge, status: "accepted" }, rename, third], ["merge"], {
      merge: "entry",
    }),
  );
  const { review } = await open([merge, rename, third], {
    suggestionsDecide: decide,
  });
  await userEvent.keyboard("a");
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith({ ids: ["merge"], decision: "accept" }),
  );
  const undo = await review.findByRole("button", { name: /Undo/ });
  // The latest decision shows the key that undoes it.
  expect(undo.textContent).toContain("U");
  // Nothing below the decided row moved.
  expect(rows(review)).toEqual([
    "Accepted: Merge Alpha into BetaUndoU",
    "Rename Beta to Beta site",
    "Move “Loose task” to Beta",
  ]);
  expect(
    review
      .getByRole("button", { name: "Rename Beta to Beta site" })
      .getAttribute("aria-current"),
  ).toBe("true");
  expect(
    review.getByRole("heading", { name: "Rename Beta to Beta site" }),
  ).toBeTruthy();
});

it("declines the selected change with D", async () => {
  const decide = vi.fn((_input: unknown) =>
    decideResult([{ ...merge, status: "declined" }, rename], ["merge"]),
  );
  const { review } = await open([merge, rename], { suggestionsDecide: decide });
  await userEvent.keyboard("d");
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith({
      ids: ["merge"],
      decision: "decline",
    }),
  );
  await review.findByText("Merge Alpha into Beta", { selector: "span" });
  expect(rows(review)[0]).toContain("Declined: Merge Alpha into Beta");
});

it("decides with the buttons too", async () => {
  const decide = vi.fn((_input: unknown) =>
    decideResult([merge, { ...rename, status: "accepted" }], ["rename"], {
      rename: "entry",
    }),
  );
  const { review } = await open([merge, rename], { suggestionsDecide: decide });
  fireEvent.click(
    review.getByRole("button", { name: "Rename Beta to Beta site" }),
  );
  fireEvent.click(
    review.getByRole("button", { name: "Accept: Rename Beta to Beta site" }),
  );
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith({
      ids: ["rename"],
      decision: "accept",
    }),
  );
});

it("undoes the latest decision with U, putting the change back up for review", async () => {
  const decide = vi.fn((_input: unknown) =>
    decideResult([{ ...merge, status: "accepted" }, rename], ["merge"], {
      merge: "entry",
    }),
  );
  const reopen = vi.fn((_input: unknown) => ({
    state: stateOf([merge, rename]),
  }));
  const { review } = await open([merge, rename], {
    suggestionsDecide: decide,
    suggestionsReopen: reopen,
  });
  await userEvent.keyboard("a");
  await review.findByRole("button", { name: /Undo/ });
  await userEvent.keyboard("u");
  await waitFor(() =>
    expect(reopen).toHaveBeenCalledWith({ id: "merge", entryId: "entry" }),
  );
  await review.findByRole("button", { name: "Accept: Merge Alpha into Beta" });
  expect(
    review
      .getByRole("button", { name: "Merge Alpha into Beta" })
      .getAttribute("aria-current"),
  ).toBe("true");
});

it("undoes a decision with its Undo button", async () => {
  const decide = vi.fn((_input: unknown) =>
    decideResult([{ ...merge, status: "accepted" }, rename], ["merge"], {
      merge: "entry",
    }),
  );
  const reopen = vi.fn((_input: unknown) => ({
    state: stateOf([merge, rename]),
  }));
  const { review } = await open([merge, rename], {
    suggestionsDecide: decide,
    suggestionsReopen: reopen,
  });
  fireEvent.click(
    await review.findByRole("button", {
      name: "Accept: Merge Alpha into Beta",
    }),
  );
  fireEvent.click(await review.findByRole("button", { name: /Undo/ }));
  await waitFor(() =>
    expect(reopen).toHaveBeenCalledWith({ id: "merge", entryId: "entry" }),
  );
});

it("dims a decided row once its Undo has gone, and closes after the last one", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const decide = vi.fn((_input: unknown) =>
    decideResult([{ ...merge, status: "accepted" }, rename], ["merge"], {
      merge: "entry",
    }),
  );
  const decideRest = vi.fn((_input: unknown) =>
    decideResult(
      [
        { ...merge, status: "accepted" },
        { ...rename, status: "declined" },
      ],
      ["rename"],
    ),
  );
  let calls = 0;
  const { slot, review } = await open([merge, rename], {
    suggestionsDecide: (input: unknown) =>
      ++calls === 1 ? decide(input) : decideRest(input),
  });
  await userEvent.keyboard("a");
  await review.findByRole("button", { name: /Undo/ });
  await userEvent.keyboard("d");
  await waitFor(() => expect(decideRest).toHaveBeenCalled());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_900);
  });
  // Still within six seconds of the first decision.
  expect(slot.queryByRole("dialog")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  // The first Undo has gone, and the row stays.
  expect(rows(review)[0]).toBe("Accepted: Merge Alpha into Beta");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6_000);
  });
  // The last decision's Undo has gone too: nothing is left to review.
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
});

it("accepts all from the list's foot in one call", async () => {
  const decide = vi.fn((_input: unknown) =>
    decideResult(
      [
        { ...merge, status: "accepted" },
        { ...rename, status: "accepted" },
      ],
      ["merge", "rename"],
      { merge: "a", rename: "b" },
    ),
  );
  const { review } = await open([merge, rename], { suggestionsDecide: decide });
  fireEvent.click(review.getByRole("button", { name: "Accept all" }));
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith({
      ids: ["merge", "rename"],
      decision: "accept",
    }),
  );
  await review.findAllByRole("button", { name: /Undo/ });
});

it("holds Accept all, Reject all and Open Topics in the header menu", async () => {
  const decide = vi.fn((_input: unknown) =>
    decideResult(
      [
        { ...merge, status: "declined" },
        { ...rename, status: "declined" },
      ],
      ["merge", "rename"],
    ),
  );
  const { slot, review } = await open([merge, rename], {
    suggestionsDecide: decide,
  });
  const menu = () =>
    userEvent.click(review.getByRole("button", { name: "More actions" }));
  await menu();
  const items = (await slot.findAllByRole("menuitem")).map(
    (item) => item.textContent,
  );
  expect(items).toEqual(["Accept all", "Reject all", "Open Topics"]);
  await userEvent.click(
    await slot.findByRole("menuitem", { name: "Reject all" }),
  );
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith({
      ids: ["merge", "rename"],
      decision: "decline",
    }),
  );
});

it("offers no bulk actions for a single suggestion", async () => {
  const { slot, review } = await open([merge]);
  expect(review.queryByRole("button", { name: "Accept all" })).toBeNull();
  await userEvent.click(review.getByRole("button", { name: "More actions" }));
  expect(
    (await slot.findAllByRole("menuitem")).map((item) => item.textContent),
  ).toEqual(["Open Topics"]);
});

it("opens Topics from the menu", async () => {
  const { slot, review } = await open([merge]);
  await userEvent.click(review.getByRole("button", { name: "More actions" }));
  await userEvent.click(
    await slot.findByRole("menuitem", { name: "Open Topics" }),
  );
  expect(slot.inspection.navigateCalls).toContainEqual({
    method: "toPluginPanel",
    path: "home",
    options: { subPath: "topics" },
  });
});

it("marks a change the tree outgrew in place, with its buttons off", async () => {
  let current = [merge, rename];
  const { slot, review } = await open(
    [merge, rename],
    { suggestions: () => ({ state: stateOf(current) }) },
    { realtime: true },
  );
  await review.findByRole("button", { name: "Merge Alpha into Beta" });
  current = [
    { ...merge, problem: "Alpha no longer exists.", delta: null },
    rename,
  ];
  await act(async () => {
    await slot.emitRealtime("changed", {});
  });
  const row = await review.findByRole("button", {
    name: /Merge Alpha into Beta.*out of date/,
  });
  // It stays where it was.
  expect(rows(review)[0]).toContain("Merge Alpha into Beta");
  fireEvent.click(row);
  await review.findByText("This suggestion is out of date");
  expect(
    (
      review.getByRole("button", {
        name: "Accept: Merge Alpha into Beta",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(review.getByText("1 out of date")).toBeTruthy();
});

it("says so when nothing is left to review", async () => {
  const slot = await mount(undefined, {
    pendingSuggestions: 1,
    rpc: { suggestions: () => ({ state: stateOf([]) }) },
  });
  fireEvent.click(await slot.findByRole("button", { name: "1 suggestion" }));
  const review = within(
    await slot.findByRole("dialog", { name: "Organizing suggestions" }),
  );
  await review.findByText("No suggestions waiting");
});

it("is a drawer on a compact viewport, with the list as a drop-down and the buttons above the drawing", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 767px"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  }));
  const { slot, review } = await open([merge, rename]);
  const trigger = await review.findByRole("button", {
    name: /^Merge Alpha into Beta.*1 of 2/,
  });
  expect(trigger.textContent).toContain("1 of 2");
  // The list is closed; both buttons are there.
  expect(slot.queryByRole("menuitem")).toBeNull();
  expect(
    review.getByRole("button", { name: "Accept: Merge Alpha into Beta" }),
  ).toBeTruthy();
  await userEvent.click(trigger);
  await userEvent.click(
    await slot.findByRole("menuitem", { name: "Rename Beta to Beta site" }),
  );
  expect(
    await review.findByRole("button", {
      name: "Accept: Rename Beta to Beta site",
    }),
  ).toBeTruthy();
});
