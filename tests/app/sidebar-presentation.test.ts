import { expect, it } from "vitest";
import {
  headerCounts,
  hasStatusMark,
  presentRow,
} from "../../src/app/sidebar/presentation.ts";
import { workView } from "../../src/domain/status.ts";
import type { StoredAnalysis } from "../../src/domain/analysis.ts";
import { sidebarThread } from "./fixtures.ts";

const thread = sidebarThread("t", { title: "Task", latestAttentionAt: 100 });
const options = { showPin: true, timestamps: "show" as const, age: "1m" };
const analysis = (state: StoredAnalysis["state"]): StoredAnalysis => ({
  state,
  recap: "Shipped it",
  ask: null,
  title: "Ship",
  revision: 100,
  at: 100,
  model: "test",
});

it.each(["always", "collapsed", "never"] as const)(
  "shows header counts according to %s",
  (when) => {
    for (const collapsed of [false, true]) {
      expect(
        headerCounts({ total: 3, needsYou: 1 }, collapsed, {
          threadCount: when,
          needsYouCount: when,
        }),
      ).toEqual({
        needsYou: when === "always" || (when === "collapsed" && collapsed),
        total: when === "always" || (when === "collapsed" && collapsed),
      });
      expect(
        headerCounts({ total: 0, needsYou: 0 }, collapsed, {
          threadCount: when,
          needsYouCount: when,
        }),
      ).toEqual({ needsYou: false, total: false });
    }
  },
);

it.each([
  [
    { needsYouCount: "collapsed", threadCount: "collapsed" },
    { needsYou: true, total: true },
  ],
  [
    { needsYouCount: "never", threadCount: "always" },
    { needsYou: false, total: true },
  ],
  [
    { needsYouCount: "always", threadCount: "never" },
    { needsYou: true, total: false },
  ],
  [
    { needsYouCount: "never", threadCount: "never" },
    { needsYou: false, total: false },
  ],
] as const)(
  "uses independent count preferences for a collapsed lower-workstream toggle: %j",
  (prefs, expected) => {
    expect(headerCounts({ needsYou: 1, total: 2 }, true, prefs)).toEqual(
      expected,
    );
  },
);

it("defaults to showing counts on collapsed headers", () => {
  expect(headerCounts({ total: 3, needsYou: 1 }, false)).toEqual({
    needsYou: false,
    total: false,
  });
  expect(headerCounts({ total: 3, needsYou: 1 }, true)).toEqual({
    needsYou: true,
    total: true,
  });
});

it.each(["show", "hover", "hide"] as const)(
  "presents the %s timestamp preference independently of pin and state",
  (timestamps) => {
    const row = presentRow(thread, undefined, { ...options, timestamps });
    expect(row.timestamp).toEqual(
      timestamps === "hide" ? null : { mode: timestamps, text: "1m" },
    );
    expect(row.accessibleName).toBe("Task");
  },
);

it.each([true, false])(
  "shows a pin only when its placement permits it (%s)",
  (showPin) => {
    const pinned = { ...thread, isPinned: true, isUnread: true };
    const row = presentRow(pinned, undefined, { ...options, showPin });
    expect(row.pinned).toBe(showPin);
    // Unread alone is no slot mark.
    expect(row.slotMark).toBeNull();
    expect(presentRow(thread, undefined, { ...options, showPin }).pinned).toBe(
      false,
    );
  },
);

it("shows no mark or completion suffix for inferred completion", () => {
  const work = workView(thread, analysis("complete"));
  expect(hasStatusMark(thread, work)).toBe(false);
  expect(presentRow(thread, work, options)).toMatchObject({
    accessibleName: "Task",
    recap: "Shipped it",
  });
});

it("marks a completed turn only until the row is read", () => {
  const work = workView(thread, analysis("complete"));
  const unread = sidebarThread("u", { title: "Task", isUnread: true });
  expect(presentRow(unread, work, options).slotMark).toEqual({
    kind: "complete",
    label: "Complete",
  });
  expect(presentRow(unread, work, options).accessibleName).toBe(
    "Task, Complete",
  );
  expect(presentRow(thread, work, options).slotMark).toBeNull();
});

it("marks a decision as needs you everywhere, Up Next included", () => {
  const work = workView(thread, analysis("needs-input"));
  expect(hasStatusMark(thread, work)).toBe(true);
  expect(presentRow(thread, work, options).accessibleName).toContain(
    "Needs input",
  );
});

it("marks a review verdict as ready for review", () => {
  const work = workView(thread, analysis("review"));
  expect(hasStatusMark(thread, work)).toBe(true);
  expect(presentRow(thread, work, options).slotMark).toEqual({
    kind: "review",
    label: "Ready for review",
  });
});

it("marks a waiting turn as Waiting and a blocked one as Blocked", () => {
  const work = {
    kind: "current" as const,
    analysis: analysis("waiting"),
    reported: true,
  };
  expect(presentRow(thread, work, options).slotMark).toEqual({
    kind: "waiting",
    label: "Waiting",
  });
  const blocked = workView(thread, analysis("blocked"));
  expect(presentRow(thread, blocked, options).slotMark).toEqual({
    kind: "blocked",
    label: "Blocked",
  });
});

it("marks a failed turn over a verdict, and working over everything", () => {
  const work = workView(thread, analysis("review"));
  const failed = sidebarThread("f", {
    title: "Task",
    indicator: "unread-error",
  });
  expect(presentRow(failed, work, options).slotMark?.kind).toBe("failed");
  const running = sidebarThread("r", { title: "Task", indicator: "runtime" });
  expect(presentRow(running, work, options).slotMark?.kind).toBe("working");
});

it("keeps the failure mark after the failed turn is read", () => {
  // BB drops the indicator to "none" on read; the thread's status holds.
  const read = sidebarThread("e", { title: "Task", status: "error" });
  expect(read.indicator).toBe("none");
  expect(hasStatusMark(read, undefined)).toBe(true);
  expect(presentRow(read, undefined, options)).toMatchObject({
    accessibleName: "Task, Failed",
    slotMark: { kind: "failed", label: "Failed" },
  });
  // An unread failed thread adds the inline unread dot beside that mark.
  const unread = sidebarThread("u", {
    title: "Task",
    status: "error",
    isUnread: true,
  });
  expect(presentRow(unread, undefined, options).slotMark?.kind).toBe("failed");
});

it("reserves a shared status slot when any row has a slot mark", () => {
  const quiet = [thread, sidebarThread("other")];
  const marked = [{ ...thread, hasPendingInteraction: true }, quiet[1]!];
  expect(quiet.some((t) => hasStatusMark(t, undefined))).toBe(false);
  expect(marked.some((t) => hasStatusMark(t, undefined))).toBe(true);
});
