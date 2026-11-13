import { describe, expect, it } from "vitest";
import type { StoredAnalysis } from "../../src/domain/analysis.ts";
import {
  FAILED_SUMMARY,
  overviewCounts,
  overviewRow,
  overviewStatus,
  sortOverviewRows,
  type OverviewThread,
} from "../../src/domain/overview.ts";
import { recapInputSchema, toRecap } from "../../src/domain/recap.ts";
import { workView } from "../../src/domain/status.ts";

const thread = (overrides: Partial<OverviewThread> = {}): OverviewThread => ({
  id: "t1",
  status: "idle",
  indicator: "none",
  hasPendingInteraction: false,
  isUnread: false,
  latestAttentionAt: 100,
  ...overrides,
});

const analysis = (state: StoredAnalysis["state"]): StoredAnalysis => ({
  recap: "Analysis recap",
  state,
  needsYou: state === "needs_decision" ? "Pick one" : null,
  goal: "Analysis goal",
  revision: 100,
  at: 100,
  model: "test",
});

const recap = (
  state: "complete" | "review" | "waiting",
  next: { title: string; message: string }[] = [],
) =>
  toRecap(
    recapInputSchema.parse({
      state,
      goal: "Shipped `abc1234`",
      latest: state === "waiting" ? [] : ["Reported result"],
      ...(state === "review"
        ? { review: ["Open the page", "Click Save"] }
        : {}),
      ...(state === "waiting"
        ? {
            timeout: 60,
            waitingAgents: [{ threadId: "w1", task: "Run evals" }],
          }
        : { next }),
    }),
    { id: "r1", turnId: "turn-1", at: 100 },
  );

const row = (
  t: OverviewThread,
  stored?: StoredAnalysis,
  reported?: ReturnType<typeof recap>,
  sent?: string,
) => overviewRow(t, workView(t, stored, reported), reported, sent);

describe("overviewStatus", () => {
  it("reads a finished thread as Complete whether or not it is read", () => {
    const read = thread();
    expect(overviewStatus(read, workView(read, analysis("done")))).toBe(
      "complete",
    );
  });

  it("puts a failed turn ahead of its stored result", () => {
    const failed = thread({ status: "error" });
    expect(overviewStatus(failed, workView(failed, analysis("review")))).toBe(
      "failed",
    );
  });

  it("reads a running thread as Working and a pending question as Needs you", () => {
    const running = thread({ status: "active", indicator: "runtime" });
    expect(overviewStatus(running, workView(running, undefined))).toBe(
      "working",
    );
    const asking = thread({ status: "active", hasPendingInteraction: true });
    expect(overviewStatus(asking, workView(asking, undefined))).toBe(
      "needs-you",
    );
  });

  it("reads an agent's waiting recap as Waiting, and unreported progress as other", () => {
    const idle = thread();
    expect(
      overviewStatus(idle, workView(idle, undefined, recap("waiting"))),
    ).toBe("waiting");
    expect(overviewStatus(idle, workView(idle, analysis("in_progress")))).toBe(
      "other",
    );
  });
});

describe("overviewRow", () => {
  it("shows a review recap's headline, steps, and follow-ups", () => {
    const result = row(
      thread(),
      undefined,
      recap("review", [{ title: "Ship it", message: "Ship it to main" }]),
    );
    expect(result).toMatchObject({
      status: "review",
      label: "Ready for review",
      summary: "Shipped `abc1234`",
      recapId: "r1",
    });
    expect(result.next.steps.map((step) => step.text)).toEqual([
      "Open the page",
      "Click Save",
    ]);
    expect(result.next.actions).toEqual([
      { title: "Ship it", message: "Ship it to main" },
    ]);
    expect(result.next.archive).toBe(false);
  });

  it("offers Archive for a complete recap with no follow-up and no work left", () => {
    expect(row(thread(), undefined, recap("complete")).next.archive).toBe(true);
    expect(
      row(
        thread(),
        undefined,
        recap("complete", [{ title: "Next", message: "Do the next thing" }]),
      ).next.archive,
    ).toBe(false);
    expect(
      row(
        thread({ activity: { backgroundAgents: 1 } }),
        undefined,
        recap("complete"),
      ).next.archive,
    ).toBe(false);
  });

  it("shows what a thread asks of the user", () => {
    const result = row(thread(), analysis("needs_decision"));
    expect(result.status).toBe("needs-you");
    expect(result.summary).toBe("Analysis recap");
    expect(result.next.prompt).toBe("Pick one");
  });

  it("shows a waiting recap's status check and no follow-ups", () => {
    const result = row(thread(), undefined, recap("waiting"));
    expect(result.status).toBe("waiting");
    expect(result.next.waiting?.waitingAgents).toEqual([
      { threadId: "w1", task: "Run evals" },
    ]);
    expect(result.next.actions).toEqual([]);
  });

  it("leaves a working thread's cells empty and explains a failed one", () => {
    const working = row(
      thread({ status: "active", indicator: "runtime" }),
      analysis("done"),
    );
    expect(working).toMatchObject({ status: "working", summary: null });
    expect(working.next.actions).toEqual([]);
    expect(row(thread({ status: "error" }), analysis("done")).summary).toBe(
      FAILED_SUMMARY,
    );
  });

  it("shows a message sent from the Overview as Working", () => {
    const result = row(thread(), undefined, recap("complete"), "Ship it");
    expect(result).toMatchObject({
      status: "working",
      summary: "You sent: Ship it",
    });
    expect(result.next.archive).toBe(false);
  });
});

describe("sortOverviewRows", () => {
  it("lists rows by what they need, newest turn first within a status", () => {
    const rows = sortOverviewRows([
      row(thread({ id: "done-old", latestAttentionAt: 1 }), analysis("done")),
      row(thread({ id: "working", status: "active", indicator: "runtime" })),
      row(thread({ id: "done-new", latestAttentionAt: 9 }), analysis("done")),
      row(thread({ id: "failed", status: "error" })),
      row(thread({ id: "review" }), analysis("review")),
      row(thread({ id: "needs" }), analysis("needs_decision")),
      row(thread({ id: "waiting" }), undefined, recap("waiting")),
    ]);
    expect(rows.map((r) => r.thread.id)).toEqual([
      "needs",
      "review",
      "failed",
      "working",
      "waiting",
      "done-new",
      "done-old",
    ]);
  });
});

describe("overviewCounts", () => {
  const rows = (
    ...statuses: Parameters<typeof overviewCounts>[0][number]["status"][]
  ) => statuses.map((status) => ({ status }));

  it("counts the threads and the ones waiting on the user", () => {
    expect(
      overviewCounts(rows("needs-you", "review", "review", "complete")),
    ).toBe("4 threads. 1 needs you and 2 are ready for review.");
    expect(overviewCounts(rows("needs-you", "needs-you"))).toBe(
      "2 threads. 2 need you.",
    );
    expect(overviewCounts(rows("review"))).toBe(
      "1 thread. 1 is ready for review.",
    );
    expect(overviewCounts(rows("complete", "working"))).toBe("2 threads.");
  });
});
