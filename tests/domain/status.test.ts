import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredAnalysis } from "../../src/domain/analysis.ts";
import * as recapModule from "../../src/domain/recap.ts";
import { recapInputSchema, toRecap } from "../../src/domain/recap.ts";
import {
  isComplete,
  needsYou,
  needsAttention,
  upNextKind,
  workView,
} from "../../src/domain/status.ts";

const analysis = (
  state: StoredAnalysis["state"],
  revision = 100,
): StoredAnalysis => ({
  recap: "Analysis recap",
  state,
  ask: state === "needs-input" ? "Pick one" : null,
  title: "Analysis goal",
  revision,
  at: revision,
  model: "test",
});

const recap = (state: "complete" | "review" | "waiting") =>
  toRecap(
    recapInputSchema.parse({
      state,
      headline: "Reported goal",
      latest: state === "waiting" ? [] : ["Reported result"],
      ...(state === "review" ? { review: "Check it" } : {}),
      ...(state === "waiting" ? { timeout: 60 } : {}),
    }),
    { id: "r1", turnId: "turn-1", at: 100 },
  );

const idle = { status: "idle", latestAttentionAt: 100 };

afterEach(() => vi.restoreAllMocks());

describe("workView", () => {
  it("prefers the agent's recap over analysis for an idle thread", () => {
    const view = workView(idle, analysis("needs-input"), recap("complete"));
    expect(view).toMatchObject({ kind: "current", reported: true });
    expect(isComplete(view)).toBe(true);
    // Analysis still supplies the title.
    expect(view.kind === "current" && view.analysis.title).toBe(
      "Analysis goal",
    );
  });

  it("falls back to analysis when the agent didn't report", () => {
    const view = workView(idle, analysis("complete"));
    expect(view).toMatchObject({ kind: "current", reported: false });
    expect(isComplete(view)).toBe(true);
  });

  it("treats a waiting recap as not done", () => {
    expect(
      isComplete(workView(idle, analysis("complete"), recap("waiting"))),
    ).toBe(false);
  });

  it("ignores the recap while a turn runs, and stale analysis is pending", () => {
    const running = { status: "active", latestAttentionAt: 200 };
    const view = workView(running, analysis("complete"), recap("complete"));
    expect(view.kind).toBe("pending");
    expect(isComplete(view)).toBe(false);
  });

  it("shows nothing for a failed turn", () => {
    const failed = { status: "error", latestAttentionAt: 100 };
    expect(workView(failed, analysis("complete"), recap("complete"))).toEqual({
      kind: "none",
    });
  });

  it("reuses reported analysis for identical thread, analysis, and recap identities", () => {
    const reported = vi.spyOn(recapModule, "reportedAnalysis");
    const thread = { ...idle };
    const stored = analysis("needs-input");
    const agent = recap("complete");
    const first = workView(thread, stored, agent);

    expect(workView(thread, stored, agent)).toBe(first);
    workView({ ...idle }, analysis("complete"));
    expect(workView(thread, stored, agent)).toBe(first);
    expect(reported).toHaveBeenCalledTimes(1);

    expect(workView(thread, stored, recap("review"))).not.toBe(first);
    expect(workView(thread, analysis("needs-input"), agent)).not.toBe(first);
    expect(reported).toHaveBeenCalledTimes(3);
  });
});

describe("needsAttention", () => {
  it.each(["complete", "review"] as const)(
    "surfaces unread %s turns without treating them as decisions",
    (state) => {
      const thread = { ...idle, hasPendingInteraction: false, isUnread: true };
      const work = workView(thread, analysis(state));
      expect(needsAttention(thread, work)).toBe(true);
      expect(needsYou(thread, work)).toBe(false);
      expect(needsAttention({ ...thread, isUnread: false }, work)).toBe(false);
      expect(
        needsAttention(
          thread,
          workView({ ...thread, status: "active" }, analysis(state)),
        ),
      ).toBe(false);
    },
  );
});

describe("needsYou", () => {
  it("is a pending interaction or a current needs-input or blocked result", () => {
    const quiet = { hasPendingInteraction: false };
    expect(needsYou(quiet, workView(idle, analysis("needs-input")))).toBe(true);
    expect(needsYou(quiet, workView(idle, analysis("blocked")))).toBe(true);
    expect(needsYou(quiet, workView(idle, analysis("review")))).toBe(false);
    expect(needsYou(quiet, workView(idle, analysis("complete")))).toBe(false);
    expect(
      needsYou(
        { hasPendingInteraction: true },
        workView(idle, analysis("needs-input")),
      ),
    ).toBe(true);
  });

  it("clears an inferred ask once the agent reports the turn", () => {
    const view = workView(idle, analysis("needs-input"), recap("review"));
    expect(needsYou({ hasPendingInteraction: false }, view)).toBe(false);
  });
});

describe("upNextKind", () => {
  const quiet = { hasPendingInteraction: false };
  const asking = { hasPendingInteraction: true };

  it("is a question for a pending interaction or a needed decision", () => {
    expect(upNextKind(asking, workView(idle, analysis("review")))).toBe(
      "question",
    );
    expect(upNextKind(quiet, workView(idle, analysis("needs-input")))).toBe(
      "question",
    );
  });

  it("is a review for a reported or inferred review", () => {
    expect(upNextKind(quiet, workView(idle, undefined, recap("review")))).toBe(
      "review",
    );
    expect(upNextKind(quiet, workView(idle, analysis("review")))).toBe(
      "review",
    );
  });

  it("is waiting for a reported Waiting turn", () => {
    expect(upNextKind(quiet, workView(idle, undefined, recap("waiting")))).toBe(
      "waiting",
    );
  });

  it("ranks a blocked turn with questions", () => {
    expect(upNextKind(quiet, workView(idle, analysis("blocked")))).toBe(
      "question",
    );
    expect(upNextKind(quiet, workView(idle, analysis("needs-input")))).toBe(
      "question",
    );
  });

  it("is other for complete, stale, and failed turns", () => {
    expect(
      upNextKind(quiet, workView(idle, undefined, recap("complete"))),
    ).toBe("other");
    expect(
      upNextKind(
        quiet,
        workView(
          { status: "active", latestAttentionAt: 200 },
          analysis("review"),
        ),
      ),
    ).toBe("other");
    expect(
      upNextKind(
        quiet,
        workView(
          { status: "error", latestAttentionAt: 100 },
          analysis("review"),
        ),
      ),
    ).toBe("other");
  });
});

describe("a cancelled Waiting recap", () => {
  it("leaves the thread's status to analysis", () => {
    const cancelled = { ...recap("waiting"), cancelled: true as const };
    const view = workView(idle, analysis("needs-input"), cancelled);
    expect(view).toMatchObject({ kind: "current", reported: false });
    expect(upNextKind({ hasPendingInteraction: false }, view)).toBe("question");
  });
});
