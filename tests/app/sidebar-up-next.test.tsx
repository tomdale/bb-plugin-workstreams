import { mountWithBands } from "./sidebar-fixture.tsx";
// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sidebarThread } from "./fixtures.ts";
import { groupRows } from "./sidebar-fixture.tsx";
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("lists Threads shown threads blocked on you, newest first, with the rest behind Show more", async () => {
  const at = Date.now();
  const base = at - 60_000;
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
  const slot = await mountWithBands(
    ids.map((id, index) =>
      sidebarThread(id, {
        title: `Ask ${id}`,
        latestAttentionAt: base + index,
      }),
    ),
    {
      analysis: Object.fromEntries(
        ids.map((id, index) => [
          id,
          {
            recap: "Asked.",
            state: "needs_decision",
            needsYou: "Decide?",
            subject: null,
            drift: null,
            driftSectionId: null,
            revision: base + index,
            at,
            model: "m",
          },
        ]),
      ),
    },
  );
  const band = await slot.findByRole("region", { name: "Up Next" });
  // Blocked on you or not, the count is the whole list; the newest lead.
  const top = ["l", "k", "j", "i", "h"].map((id) => `Ask ${id}, Needs you`);
  expect(groupRows(slot, "Up Next")).toEqual(top);
  // Show more lists the rest below, which stay where they were.
  const more = within(band).getByRole("button", { name: "Show 7 more" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(groupRows(slot, "Up Next")).toEqual([
    ...top,
    "Ask g, Needs you",
    "Ask f, Needs you",
    "Ask e, Needs you",
    "Ask d, Needs you",
    "Ask c, Needs you",
    "Ask b, Needs you",
    "Ask a, Needs you",
  ]);
  fireEvent.click(within(band).getByRole("button", { name: "Show less" }));
  expect(groupRows(slot, "Up Next")).toEqual(top);
  slot.lifecycle.unmount();
});

it("ranks a current needs-decision result as a question, but not a stale one", async () => {
  const at = Date.now();
  const result = (revision: number) => ({
    recap: "Asked whether to ship.",
    state: "needs_decision",
    needsYou: "Ship it?",
    subject: null,
    drift: null,
    driftSectionId: null,
    revision,
    at,
    model: "m",
  });
  const base = at - 60_000;
  const slot = await mountWithBands(
    [
      sidebarThread("fresh", {
        title: "Fresh ask",
        latestAttentionAt: base + 100,
      }),
      sidebarThread("stale", {
        title: "Stale ask",
        latestAttentionAt: base + 200,
      }),
    ],
    { analysis: { fresh: result(base + 100), stale: result(base + 150) } },
  );
  const band = await slot.findByRole("region", { name: "Up Next" });
  // The stale ask is newer but no longer a question, so it ranks after and
  // draws no needs-you mark.
  expect(
    within(band)
      .getAllByRole("link")
      .map((a) => a.getAttribute("aria-label")),
  ).toEqual(["Fresh ask, Needs you", "Stale ask"]);
  // Each row carries what it asks, under the title.
  expect(band.textContent).toContain("Ship it?");
  expect(within(band).getAllByRole("img", { name: "Needs you" })).toHaveLength(
    1,
  );
  expect(
    within(slot.getByRole("region", { name: "Unfiled" })).getAllByRole("img", {
      name: "Needs you",
    }),
  ).toHaveLength(1);
  slot.lifecycle.unmount();
});

/** Five read threads newer than anything else, which fill Up Next. */
const newer = () =>
  [1, 2, 3, 4, 5].map((n) =>
    sidebarThread(`o${n}`, {
      title: `Other ${n}`,
      latestAttentionAt: 100 - n,
    }),
  );

it("holds a result marked read on selection until another thread opens", async () => {
  const threads = [
    sidebarThread("result", {
      title: "Result",
      isUnread: true,
      latestAttentionAt: 10,
    }),
    ...newer(),
  ];
  const slot = await mountWithBands(threads, {
    activeThreadId: "o5",
    recaps: {
      result: {
        id: "result-recap",
        turnId: "turn",
        at: 10,
        state: "complete",
        goal: "Shipping",
        latest: ["Finished"],
        review: [],
        links: [],
      },
    },
  });
  // Unread, the oldest thread outranks the read ones.
  await waitFor(() =>
    expect(groupRows(slot, "Up Next")).toEqual([
      "Result",
      "Other 1",
      "Other 2",
      "Other 3",
      "Other 4",
    ]),
  );
  threads[0] = {
    ...threads[0]!,
    isUnread: false,
    displayTitle: "Updated result",
  };
  slot.selectThread("result");
  // Read, it would rank last and leave; it holds its row while open.
  await waitFor(() => {
    expect(groupRows(slot, "Up Next")).toEqual([
      "Updated result",
      "Other 1",
      "Other 2",
      "Other 3",
      "Other 4",
      "Other 5",
    ]);
  });
  expect(slot.queryByRole("region", { name: "Recent" })).toBeNull();

  slot.selectThread("o1");
  expect(groupRows(slot, "Up Next")).not.toContain("Updated result");
  expect(groupRows(slot, "Recent")).toEqual(["Updated result"]);
  // Opening it again doesn't bring it back.
  slot.selectThread("result");
  expect(groupRows(slot, "Up Next")).not.toContain("Updated result");
  slot.lifecycle.unmount();
});

it("removes a selected Up Next thread through its Snooze button", async () => {
  const threads = [
    sidebarThread("question", {
      title: "Question",
      hasPendingInteraction: true,
      latestAttentionAt: 100,
    }),
  ];
  const slot = await mountWithBands(threads, { activeThreadId: "question" });
  const band = await slot.findByRole("region", { name: "Up Next" });
  fireEvent.click(within(band).getByRole("button", { name: /^Snooze until/ }));
  await waitFor(() =>
    expect(slot.queryByRole("region", { name: "Up Next" })).toBeNull(),
  );
  slot.lifecycle.unmount();
});

it("marks the agent's reported state, which outranks analysis", async () => {
  const at = Date.now();
  const recap = (state: string) => ({
    id: `r-${state}`,
    turnId: "turn",
    at,
    state,
    goal: "Shipping",
    latest: [`Reported ${state}`],
    review: state === "review" ? ["Try it"] : [],
    links: [],
  });
  const slot = await mountWithBands(
    [
      sidebarThread("asked", { title: "Asked", latestAttentionAt: 100 }),
      sidebarThread("finished", {
        title: "Finished",
        latestAttentionAt: 100,
      }),
    ],
    {
      // Analysis read both turns as questions; the agent reported one ready
      // for review and the other complete.
      analysis: Object.fromEntries(
        ["asked", "finished"].map((id) => [
          id,
          {
            recap: "Asked whether to ship.",
            state: "needs_decision",
            needsYou: "Ship it?",
            subject: null,
            drift: null,
            driftSectionId: null,
            revision: 100,
            at,
            model: "m",
          },
        ]),
      ),
      recaps: { asked: recap("review"), finished: recap("complete") },
    },
  );
  const group = await slot.findByRole("region", { name: "Unfiled" });
  const band = await slot.findByRole("region", { name: "Up Next" });
  expect(
    within(band).getByRole("link", { name: "Asked, Ready for review" }),
  ).toBeTruthy();
  // Complete draws no mark, even over analysis that read a question.
  expect(within(band).getByRole("link", { name: "Finished" })).toBeTruthy();
  expect(
    within(group).getAllByRole("img", { name: "Ready for review" }),
  ).toHaveLength(1);
  const finishedLink = within(group).getByRole("link", { name: "Finished" });
  expect(finishedLink.getAttribute("title")).toBeNull();
  expect(
    finishedLink.parentElement?.querySelector(
      `[id="${finishedLink.getAttribute("aria-describedby")}"]`,
    )?.textContent,
  ).toContain("Reported complete");
  slot.lifecycle.unmount();
});

it("keeps Up Next open and names each row's workstream", async () => {
  const at = Date.now();
  const asks = (revision: number) => ({
    recap: "Asked whether to ship.",
    state: "needs_decision",
    needsYou: "Ship it?",
    subject: null,
    drift: null,
    driftSectionId: null,
    revision,
    at,
    model: "m",
  });
  // The delegate's older question folds into its manager's newer one.
  const slot = await mountWithBands(
    [
      sidebarThread("manager", {
        sectionId: "sec_a",
        title: "Manager",
        latestAttentionAt: 200,
      }),
      sidebarThread("delegate", {
        parentThreadId: "manager",
        sectionId: "sec_a",
        title: "Delegate",
        latestAttentionAt: 100,
      }),
    ],
    {
      settings: { showRecent: false },
      analysis: { manager: asks(200), delegate: asks(100) },
    },
  );
  const band = await slot.findByRole("region", { name: "Up Next" });
  expect(within(band).getByText("Alpha")).toBeTruthy();
  // The section is always open: its header is a heading, not a toggle.
  expect(within(band).getByRole("heading", { name: /Up Next/ })).toBeTruthy();
  expect(within(band).queryByRole("button", { name: /Up Next/ })).toBeNull();
  expect(within(band).queryByText(/via/)).toBeNull();
  slot.lifecycle.unmount();
});
