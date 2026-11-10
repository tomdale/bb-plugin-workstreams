import { expect, it } from "vitest";
import { projectWorkstreams } from "../../src/domain/project.ts";
import { selectRecent } from "../../src/domain/upNext.ts";
import {
  initialUpNextState,
  planSidebarUpNext,
  type UpNextState,
} from "../../src/app/sidebar/upNextState.ts";
import { thread, type TestThread } from "../domain/fixtures.ts";

const now = 1_000;
const others = () =>
  [1, 2, 3, 4, 5].map((n) => thread(`o${n}`, { latestAttentionAt: 100 - n }));
const ids = (rows: readonly { thread: { id: string } }[]) =>
  rows.map((row) => row.thread.id);
function view(
  threads: TestThread[],
  active: string | null = null,
  previous: UpNextState = initialUpNextState,
  { expanded = false, snoozed = "", prioritized = new Set<string>() } = {},
) {
  const projection = projectWorkstreams(
    threads,
    [{ id: "focused", name: "Focused" }],
    {
      now,
      snoozedUntil: (t) => (t.id === snoozed ? null : undefined),
    },
  );
  const plan = planSidebarUpNext(
    previous,
    projection,
    {
      now,
      kindOf: (t) => (t.hasPendingInteraction ? "question" : "other"),
      prioritized,
    },
    active,
    expanded,
  );
  return { ...plan, recent: selectRecent(projection, plan.rows, 5) };
}

it.each([
  { next: "o1", readOnSelect: false },
  { next: null, readOnSelect: false },
  { next: "o1", readOnSelect: true },
])(
  "holds a read result until selecting $next (readOnSelect: $readOnSelect)",
  ({ next, readOnSelect }) => {
    const threads = [
      thread("result", { isUnread: true, latestAttentionAt: 10 }),
      ...others(),
    ];
    let current = view(threads, "o5");
    expect(ids(current.rows)).toEqual(["result", "o1", "o2", "o3", "o4"]);
    if (!readOnSelect) current = view(threads, "result", current.state);
    threads[0] = { ...threads[0]!, isUnread: false, title: "Updated result" };
    current = view(threads, "result", current.state);
    expect(ids(current.rows)).toEqual(["result", "o1", "o2", "o3", "o4", "o5"]);
    // The held row is shown, so it isn't trimmed even past the limit.
    expect([...current.trimmed]).toEqual([]);
    expect(current.rows[0]!.thread.title).toBe("Updated result");
    expect(ids(current.recent)).not.toContain("result");
    current = view(threads, next, current.state);
    expect(ids(current.rows)).not.toContain("result");
    expect(ids(current.recent)).toContain("result");
    current = view(threads, "result", current.state);
    expect(ids(current.rows)).not.toContain("result");
  },
);

it("leaves running threads out unless they ask for input and admits completed turns", () => {
  const threads = [
    thread("running", { status: "active", latestAttentionAt: 30 }),
    thread("asking", {
      status: "active",
      hasPendingInteraction: true,
      latestAttentionAt: 20,
    }),
    thread("done", { latestAttentionAt: 10 }),
  ];
  const before = view(threads);
  expect(ids(before.rows)).toEqual(["asking", "done"]);
  threads[0] = {
    ...threads[0]!,
    status: "idle",
    isUnread: true,
    latestAttentionAt: now,
  };
  // Unread ranks above the read question, however long it has waited.
  expect(ids(view(threads, null, before.state).rows)).toEqual([
    "running",
    "asking",
    "done",
  ]);
});

it("holds an answered question while running, then releases it on navigation", () => {
  const threads = [
    thread("question", { hasPendingInteraction: true, latestAttentionAt: 10 }),
    ...others(),
  ];
  const before = view(threads, "question");
  threads[0] = {
    ...threads[0]!,
    hasPendingInteraction: false,
    status: "active",
  };
  const answered = view(threads, "question", before.state);
  expect(ids(answered.rows)).toEqual([
    "question",
    "o1",
    "o2",
    "o3",
    "o4",
    "o5",
  ]);
  expect(ids(view(threads, "o1", answered.state).rows)).not.toContain(
    "question",
  );
});

it.each(["hidden", "archived", "snoozed"])(
  "removes an explicitly %s selected row",
  (action) => {
    const threads = [thread("question", { hasPendingInteraction: true })];
    const before = view(threads, "question");
    threads[0] = {
      ...threads[0]!,
      isHidden: action === "hidden",
      isArchived: action === "archived",
    };
    const after = view(threads, "question", before.state, {
      snoozed: action === "snoozed" ? "question" : "",
    });
    expect(after.rows).toEqual([]);
  },
);

it("anchors a selected thread when it first appears after its turn ends", () => {
  const threads = [
    thread("running", { status: "active", latestAttentionAt: 10 }),
    ...others(),
  ];
  const before = view(threads, "running");
  expect(ids(before.rows)).not.toContain("running");
  threads[0] = { ...threads[0]!, status: "idle", isUnread: true };
  const finished = view(threads, "running", before.state);
  expect(ids(finished.rows)[0]).toBe("running");
  threads[0] = { ...threads[0]!, isUnread: false };
  expect(ids(view(threads, "running", finished.state).rows)[0]).toBe("running");
});

it("holds the open row when focus arrives and releases it when focus is selected", () => {
  const threads = [
    thread("open", { hasPendingInteraction: true, latestAttentionAt: 100 }),
    thread("focus", { sectionId: "focused", latestAttentionAt: 50 }),
  ];
  const options = { prioritized: new Set(["focused"]) };
  const before = view(threads, "open", initialUpNextState, options);
  expect(before.focused).toBe(false);
  threads[1] = {
    ...threads[1]!,
    hasPendingInteraction: true,
    latestAttentionAt: 200,
  };
  const focused = view(threads, "open", before.state, options);
  expect(focused.focused).toBe(true);
  expect(ids(focused.rows)).toEqual(["open", "focus"]);
  expect(ids(view(threads, "focus", focused.state, options).rows)).toEqual([
    "focus",
  ]);
});

it("does not carry an abandoned render's selection into the committed view", () => {
  const threads = [
    thread("open", { isUnread: true, latestAttentionAt: 10 }),
    ...others(),
  ];
  const committed = view(threads, "open");
  const saved = structuredClone(committed.state);
  view(threads, "o1", committed.state);
  expect(committed.state).toEqual(saved);
  threads[0] = { ...threads[0]!, isUnread: false };
  expect(ids(view(threads, "open", committed.state).rows)[0]).toBe("open");
});

it("resets Show more after the extra rows disappear", () => {
  const threads = Array.from({ length: 12 }, (_, i) =>
    thread(`q${i}`, { hasPendingInteraction: true, latestAttentionAt: i }),
  );
  // The count is the whole list, so every blocked thread past it waits behind
  // Show more.
  const closed = view(threads);
  expect(closed.rows).toHaveLength(5);
  expect(closed.moreCount).toBe(7);
  const open = view(threads, null, closed.state, { expanded: true });
  expect(open.rows).toHaveLength(12);
  expect(open.moreCount).toBe(0);
  const fewer = view(threads.slice(0, 2), null, open.state, { expanded: true });
  expect(fewer.expanded).toBe(false);
  expect(
    view(threads, null, fewer.state, { expanded: fewer.expanded }).rows,
  ).toHaveLength(5);
});

it("does not count an anchored overflow row twice in Show more", () => {
  const threads = Array.from({ length: 7 }, (_, i) =>
    thread(`u${i}`, { isUnread: true, latestAttentionAt: i }),
  );
  const expanded = view(threads, null, initialUpNextState, { expanded: true });
  const held = view(threads, "u0", expanded.state);
  expect(ids(held.rows)).toEqual(["u6", "u5", "u4", "u3", "u2", "u0"]);
  expect(held.moreCount).toBe(1);
});

it("offers no Show more for trimmed read threads", () => {
  const current = view([...others(), thread("old", { latestAttentionAt: 1 })]);
  expect(current.rows).toHaveLength(5);
  expect(current.moreCount).toBe(0);
});
