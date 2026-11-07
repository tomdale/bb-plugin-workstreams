// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sidebarThread } from "./fixtures.ts";
import { groupRows, mount } from "./sidebar-fixture.tsx";
beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("lists up to ten threads blocked on you, newest first, with the rest behind Show more", async () => {
  const at = Date.now();
  const base = at - 60_000;
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
  const slot = await mount(
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
  // Unread or not, past ten the least recently active leave.
  const top = ["l", "k", "j", "i", "h", "g", "f", "e", "d", "c"].map(
    (id) => `Ask ${id}`,
  );
  expect(groupRows(slot, "Up Next")).toEqual(top);
  // Show more lists them below the rest, which stay where they were.
  const more = within(band).getByRole("button", { name: "Show 2 more" });
  expect(more.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(more);
  expect(groupRows(slot, "Up Next")).toEqual([...top, "Ask b", "Ask a"]);
  fireEvent.click(within(band).getByRole("button", { name: "Show less" }));
  expect(groupRows(slot, "Up Next")).toEqual(top);
  slot.lifecycle.unmount();
});

it("leaves running threads out of Up Next until their turn ends", async () => {
  const threads = [
    sidebarThread("running", {
      title: "Running",
      status: "active",
      indicator: "runtime",
      latestAttentionAt: Date.now() - 1_000,
    }),
    sidebarThread("asking", {
      title: "Asking",
      status: "active",
      hasPendingInteraction: true,
      latestAttentionAt: Date.now() - 2_000,
    }),
    sidebarThread("done", {
      title: "Done",
      latestAttentionAt: Date.now() - 3_000,
    }),
  ];
  const slot = await mount(threads, {
    activeThreadId: null,
    settings: { showRecent: false },
  });
  await waitFor(() =>
    expect(groupRows(slot, "Up Next")).toEqual(["Asking", "Done"]),
  );
  // When the turn ends, BB marks the thread unread and it comes back.
  threads[0] = {
    ...threads[0]!,
    status: "idle",
    indicator: "none",
    isUnread: true,
    latestAttentionAt: Date.now(),
  };
  slot.selectThread(null);
  await waitFor(() =>
    expect(groupRows(slot, "Up Next")).toEqual(["Asking", "Running", "Done"]),
  );
  slot.lifecycle.unmount();
});

it("offers no Show more for trimmed read threads not blocked on you", async () => {
  const slot = await mount(
    [1, 2, 3, 4, 5, 6, 7].map((n) =>
      sidebarThread(`t${n}`, {
        title: `Thread ${n}`,
        latestAttentionAt: Date.now() - n * 1_000,
      }),
    ),
    { activeThreadId: null, settings: { showRecent: false } },
  );
  const band = await slot.findByRole("region", { name: "Up Next" });
  await waitFor(() => expect(groupRows(slot, "Up Next")).toHaveLength(5));
  expect(within(band).queryByRole("button", { name: /^Show/ })).toBeNull();
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
  const slot = await mount(
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
  // The section implies the decision, so its rows leave the mark out. The
  // stale ask is newer but no longer a question, so it ranks after.
  expect(
    within(band)
      .getAllByRole("link")
      .map((a) => a.getAttribute("aria-label")),
  ).toEqual(["Fresh ask", "Stale ask"]);
  // Each row carries what it asks, under the title.
  expect(band.textContent).toContain("Ship it?");
  expect(
    within(band).queryAllByRole("img", { name: "Needs your decision" }),
  ).toHaveLength(0);
  expect(
    within(slot.getByRole("region", { name: "Unfiled" })).getAllByRole("img", {
      name: "Needs your decision",
    }),
  ).toHaveLength(1);
  slot.lifecycle.unmount();
});

it("ranks an unread review above a read question, and finished work after both", async () => {
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
  const slot = await mount(
    [
      sidebarThread("complete", {
        title: "Complete",
        isUnread: true,
        latestAttentionAt: at - 3_000,
      }),
      sidebarThread("review", {
        title: "Review",
        isUnread: true,
        latestAttentionAt: at - 2_000,
      }),
      sidebarThread("question", {
        title: "Question",
        hasPendingInteraction: true,
        isUnread: false,
        latestAttentionAt: at - 1_000,
      }),
    ],
    { recaps: { complete: recap("complete"), review: recap("review") } },
  );
  const band = await slot.findByRole("region", { name: "Up Next" });
  expect(
    within(band)
      .getAllByRole("link")
      .map((a) => a.getAttribute("aria-label")),
  ).toEqual([
    "Review, Ready for your review",
    "Question",
    "Complete, Complete",
  ]);
  slot.lifecycle.unmount();
});

it("ranks a review left for over a week with the threads not blocked on you", async () => {
  const slot = await mount(
    [
      sidebarThread("stale", {
        title: "Stale review",
        latestAttentionAt: Date.now() - 8 * 24 * 3_600_000,
      }),
      sidebarThread("fresh", {
        title: "Fresh",
        latestAttentionAt: Date.now() - 1_000,
      }),
    ],
    {
      activeThreadId: null,
      recaps: {
        stale: {
          id: "r-stale",
          turnId: "turn",
          at: Date.now(),
          state: "review",
          goal: "Shipping",
          latest: ["Reported review"],
          review: ["Try it"],
          links: [],
        },
      },
    },
  );
  await waitFor(() =>
    expect(groupRows(slot, "Up Next")).toEqual([
      "Fresh",
      "Stale review, Ready for your review",
    ]),
  );
  slot.lifecycle.unmount();
});

it("puts read threads not blocked on you after the ones that are, and Waiting ones last", async () => {
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
  const slot = await mount(
    [
      sidebarThread("ask", {
        title: "Unread ask",
        isUnread: true,
        latestAttentionAt: 300,
      }),
      sidebarThread("complete", {
        title: "Read complete",
        latestAttentionAt: 200,
      }),
      sidebarThread("waiting", {
        title: "Read waiting",
        latestAttentionAt: 100,
      }),
      sidebarThread("without-recap", {
        title: "Read without recap",
        latestAttentionAt: 50,
      }),
    ],
    {
      analysis: {
        ask: {
          recap: "Asked.",
          state: "needs_decision",
          needsYou: "Decide?",
          subject: null,
          drift: null,
          driftSectionId: null,
          revision: 300,
          at,
          model: "m",
        },
      },
      recaps: {
        complete: recap("complete"),
        waiting: recap("waiting"),
      },
    },
  );
  const band = await slot.findByRole("region", { name: "Up Next" });
  expect(
    within(band)
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label")),
  ).toEqual([
    "Unread ask",
    "Read complete, Complete",
    "Read without recap",
    "Read waiting, Waiting",
  ]);
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

it.each([
  { nextThreadId: "o1", readOnSelect: false },
  { nextThreadId: null, readOnSelect: false },
  { nextThreadId: "o1", readOnSelect: true },
])(
  "holds a read result in place until $nextThreadId is selected (readOnSelect: $readOnSelect)",
  async ({ nextThreadId, readOnSelect }) => {
    const threads = [
      sidebarThread("result", {
        title: "Result",
        isUnread: true,
        latestAttentionAt: 10,
      }),
      ...newer(),
    ];
    const slot = await mount(threads, {
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
        "Result, Complete",
        "Other 1",
        "Other 2",
        "Other 3",
        "Other 4",
      ]),
    );
    if (!readOnSelect) slot.selectThread("result");
    threads[0] = {
      ...threads[0]!,
      isUnread: false,
      displayTitle: "Updated result",
    };
    slot.selectThread("result");
    // Read, it would rank last and leave; it holds its row while open.
    await waitFor(() => {
      expect(groupRows(slot, "Up Next")).toEqual([
        "Updated result, Complete",
        "Other 1",
        "Other 2",
        "Other 3",
        "Other 4",
        "Other 5",
      ]);
    });
    expect(slot.queryByRole("region", { name: "Recent" })).toBeNull();

    slot.selectThread(nextThreadId);
    expect(groupRows(slot, "Up Next")).not.toContain(
      "Updated result, Complete",
    );
    expect(groupRows(slot, "Recent")).toEqual(["Updated result, Complete"]);
    // Opening it again doesn't bring it back.
    slot.selectThread("result");
    expect(groupRows(slot, "Up Next")).not.toContain(
      "Updated result, Complete",
    );
    slot.lifecycle.unmount();
  },
);

it("releases a resolved question only after selecting another thread", async () => {
  const threads = [
    sidebarThread("question", {
      title: "Question",
      hasPendingInteraction: true,
      latestAttentionAt: 10,
    }),
    ...newer(),
  ];
  const slot = await mount(threads, { activeThreadId: "question" });
  await waitFor(() => expect(groupRows(slot, "Up Next")[0]).toBe("Question"));
  threads[0] = {
    ...threads[0]!,
    hasPendingInteraction: false,
    status: "active",
  };
  slot.selectThread("question");
  await waitFor(() =>
    expect(groupRows(slot, "Up Next")).toEqual([
      "Question",
      "Other 1",
      "Other 2",
      "Other 3",
      "Other 4",
      "Other 5",
    ]),
  );
  slot.selectThread("o1");
  expect(groupRows(slot, "Up Next")).not.toContain("Question");
  slot.lifecycle.unmount();
});

it.each(["hidden", "archived", "snoozed"])(
  "still removes a selected Up Next thread when explicitly %s",
  async (action) => {
    const threads = [
      sidebarThread("question", {
        title: "Question",
        hasPendingInteraction: true,
        latestAttentionAt: 100,
      }),
    ];
    const slot = await mount(threads, { activeThreadId: "question" });
    const band = await slot.findByRole("region", { name: "Up Next" });
    if (action === "snoozed") {
      fireEvent.click(
        within(band).getByRole("button", { name: /^Snooze until/ }),
      );
    } else {
      threads[0] = {
        ...threads[0]!,
        isHidden: action === "hidden",
        isArchived: action === "archived",
      };
      slot.selectThread("question");
    }
    await waitFor(() =>
      expect(slot.queryByRole("region", { name: "Up Next" })).toBeNull(),
    );
    slot.lifecycle.unmount();
  },
);

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
  const slot = await mount(
    [
      sidebarThread("asked", { title: "Asked", latestAttentionAt: 100 }),
      sidebarThread("finished", {
        title: "Finished",
        latestAttentionAt: 100,
      }),
    ],
    {
      // Analysis read the turn as a question; the agent reported it done.
      analysis: {
        asked: {
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
      },
      recaps: { asked: recap("review"), finished: recap("complete") },
    },
  );
  const group = await slot.findByRole("region", { name: "Unfiled" });
  const band = await slot.findByRole("region", { name: "Up Next" });
  expect(
    within(band).getByRole("link", { name: "Asked, Ready for your review" }),
  ).toBeTruthy();
  expect(
    within(band).getByRole("link", { name: "Finished, Complete" }),
  ).toBeTruthy();
  expect(
    within(group).getByRole("img", { name: "Ready for your review" }),
  ).toBeTruthy();
  expect(within(group).getByRole("img", { name: "Complete" })).toBeTruthy();
  const finishedLink = within(group).getByRole("link", {
    name: "Finished, Complete",
  });
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
  const slot = await mount(
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
