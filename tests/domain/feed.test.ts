import { describe, expect, it } from "vitest";
import { DAY_MS, projectWorkstreams } from "../../src/domain/project.ts";
import { keepOrder, planFeed } from "../../src/domain/feed.ts";
import type { UpNextKind } from "../../src/domain/status.ts";
import { thread, type TestThread } from "./fixtures.ts";

const now = 100 * DAY_MS;
const sections = [
  { id: "sec_a", name: "Alpha" },
  { id: "sec_b", name: "Beta" },
];
const ids = (rows: readonly { thread: { id: string } }[]) =>
  rows.map((row) => row.thread.id);
const kindOf = (t: { id: string }): UpNextKind =>
  t.id.startsWith("q") ? "question" : t.id.startsWith("r") ? "review" : "other";

function plan(threads: TestThread[], snoozed: string[] = []) {
  const projection = projectWorkstreams(threads, sections, {
    now,
    snoozedUntil: (t) => (snoozed.includes(t.id) ? now + DAY_MS : undefined),
  });
  return planFeed(projection, {
    kindOf,
    now,
    prioritized: new Set(),
    groupSort: "alphabetical",
  });
}

describe("planFeed", () => {
  it("lists Up Next with the trimmed threads, then every other open root newest first", () => {
    // Seven read threads not blocked on the user: Up Next keeps five, and
    // the rest are read and not blocked, so they fall to Earlier.
    const threads = Array.from({ length: 7 }, (_, i) =>
      thread(`o${i}`, {
        sectionId: "sec_a",
        latestAttentionAt: now - (i + 1) * 60_000,
      }),
    );
    const feed = plan(threads);
    expect(ids(feed.upNext)).toEqual(["o0", "o1", "o2", "o3", "o4"]);
    expect(ids(feed.earlier)).toEqual(["o5", "o6"]);
  });

  it("appends the threads behind Show more to Up Next in rank order", () => {
    const threads = Array.from({ length: 12 }, (_, i) =>
      thread(`q${String(i).padStart(2, "0")}`, {
        sectionId: "sec_a",
        isUnread: true,
        latestAttentionAt: now - (i + 1) * 60_000,
      }),
    );
    const feed = plan(threads);
    expect(feed.upNext).toHaveLength(12);
    expect(feed.earlier).toHaveLength(0);
  });

  it("leaves running and snoozed roots out of the queue", () => {
    const feed = plan(
      [
        thread("run", { sectionId: "sec_a", status: "active" }),
        thread("nap", { sectionId: "sec_b" }),
        thread("idle", { sectionId: "sec_b" }),
      ],
      ["nap"],
    );
    expect([...ids(feed.upNext), ...ids(feed.earlier)]).toEqual(["idle"]);
  });

  it("never queues a delegate on its own", () => {
    const feed = plan([
      thread("root", { sectionId: "sec_a" }),
      thread("kid1", { parentThreadId: "root" }),
      thread("kid2", { parentThreadId: "root" }),
    ]);
    expect(ids(feed.upNext)).toEqual(["root"]);
    expect(ids(feed.earlier)).toEqual([]);
  });

  it("files each root under its workstream", () => {
    const threads = [
      thread("qa", { sectionId: "sec_a", isUnread: true }),
      thread("qb1", { sectionId: "sec_b", isUnread: true }),
      thread("qb2", { sectionId: "sec_b", isUnread: true }),
      thread("loose"),
    ];
    const feed = plan(threads);
    expect(feed.place.get("qa")).toEqual({ topId: "sec_a", path: ["Alpha"] });
    expect(feed.place.get("loose")).toEqual({
      topId: "unsorted",
      path: ["Unfiled"],
    });
    expect(feed.place.get("qb1")).toEqual({ topId: "sec_b", path: ["Beta"] });
  });
});

describe("keepOrder", () => {
  it("keeps shown ids in place, drops gone ones, and appends new ones", () => {
    expect(keepOrder(["a", "b", "c"], ["c", "d", "a"])).toEqual([
      "a",
      "c",
      "d",
    ]);
  });
});
