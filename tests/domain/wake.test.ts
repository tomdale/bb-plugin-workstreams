import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAKE_EVENTS,
  ERROR_GRACE_MS,
  STALL_GRACE_MS,
  failedAfter,
  isStalled,
  pullRequestEvent,
  turnOutcome,
  wakeEvent,
  wakesOnEvents,
  type WakeThread,
} from "../../src/domain/wake.ts";

const AT = 10_000;
const thread = (overrides: Partial<WakeThread> = {}): WakeThread => ({
  id: "t",
  status: "idle",
  hasPendingInteraction: false,
  latestAttentionAt: AT - 1,
  queued: false,
  busy: false,
  work: null,
  ...overrides,
});
const snooze = { until: null, attentionAt: AT - 1, at: AT };

describe("wakesOnEvents", () => {
  it("is always on for Until there's an update, and opt-in for a timed snooze", () => {
    expect(wakesOnEvents({ ...snooze, until: null })).toBe(true);
    expect(wakesOnEvents({ ...snooze, until: AT + 1 })).toBe(false);
    expect(wakesOnEvents({ ...snooze, until: AT + 1, events: true })).toBe(
      true,
    );
  });
});

describe("turnOutcome", () => {
  it("names a turn that ended after the snooze by how it ended", () => {
    const ended = { latestAttentionAt: AT + 5 };
    expect(turnOutcome(thread({ ...ended, work: "needs_decision" }), AT)).toBe(
      "needs-you",
    );
    expect(turnOutcome(thread({ ...ended, work: "review" }), AT)).toBe(
      "review",
    );
    expect(turnOutcome(thread({ ...ended, work: "done" }), AT)).toBe("done");
  });

  it("ignores turns still waiting, blocked, unknown, running, or from before", () => {
    const ended = { latestAttentionAt: AT + 5 };
    expect(turnOutcome(thread({ ...ended, work: "in_progress" }), AT)).toBe(
      null,
    );
    expect(turnOutcome(thread({ ...ended, work: "blocked" }), AT)).toBe(null);
    expect(turnOutcome(thread({ ...ended, work: null }), AT)).toBe(null);
    expect(
      turnOutcome(thread({ ...ended, status: "active", work: "done" }), AT),
    ).toBe(null);
    expect(turnOutcome(thread({ work: "done" }), AT)).toBe(null);
  });
});

describe("failedAfter", () => {
  const failed = thread({ status: "error", failedAt: AT + 1 });

  it("waits out the retry grace, then counts a failure after the snooze", () => {
    expect(failedAfter(failed, AT, AT + 1 + ERROR_GRACE_MS - 1)).toBe(false);
    expect(failedAfter(failed, AT, AT + 1 + ERROR_GRACE_MS)).toBe(true);
  });

  it("stays asleep while a retry is queued, or for an older failure", () => {
    const now = AT + 10 * ERROR_GRACE_MS;
    expect(failedAfter({ ...failed, queued: true }, AT, now)).toBe(false);
    expect(failedAfter({ ...failed, failedAt: AT - 1 }, AT, now)).toBe(false);
  });

  it("reads attention when the server didn't see the failure", () => {
    const unseen = thread({ status: "error", latestAttentionAt: AT + 1 });
    expect(failedAfter(unseen, AT, AT + 2)).toBe(true);
    expect(failedAfter({ ...unseen, latestAttentionAt: AT }, AT, AT + 2)).toBe(
      false,
    );
  });
});

describe("isStalled", () => {
  const root = thread({ id: "root", work: "in_progress" });
  const failedDelegate = thread({
    id: "d",
    status: "error",
    failedAt: AT + 1,
  });

  it("holds when a delegate failed after the snooze and nothing moves", () => {
    expect(isStalled(root, [failedDelegate], AT)).toBe(true);
  });

  it("doesn't hold while anything runs, queues, or asks the user", () => {
    for (const change of [
      { status: "active" },
      { busy: true },
      { queued: true },
      { hasPendingInteraction: true },
    ] as const) {
      expect(isStalled({ ...root, ...change }, [failedDelegate], AT)).toBe(
        false,
      );
      expect(
        isStalled(root, [failedDelegate, thread({ id: "e", ...change })], AT),
      ).toBe(false);
    }
  });

  it("doesn't hold when the root's turn already wakes it, or the failure is old", () => {
    expect(isStalled({ ...root, work: "done" }, [failedDelegate], AT)).toBe(
      false,
    );
    expect(isStalled(root, [{ ...failedDelegate, failedAt: AT - 1 }], AT)).toBe(
      false,
    );
    expect(isStalled(root, [thread({ id: "d" })], AT)).toBe(false);
  });
});

describe("pullRequestEvent", () => {
  it("wakes only on a change into feedback or a merge-ready state", () => {
    expect(pullRequestEvent("checks_pending", "checks_failed")).toBe(
      "checks-failed",
    );
    expect(pullRequestEvent("none", "changes_requested")).toBe(
      "changes-requested",
    );
    expect(pullRequestEvent(null, "ready_to_merge")).toBe("ready-to-merge");
    expect(pullRequestEvent("checks_failed", "checks_failed")).toBe(null);
    expect(pullRequestEvent("checks_failed", "checks_pending")).toBe(null);
    expect(pullRequestEvent("ready_to_merge", "merged")).toBe(null);
    expect(pullRequestEvent("none", "conflicts")).toBe(null);
    expect(pullRequestEvent("none", null)).toBe(null);
  });
});

describe("wakeEvent", () => {
  const facts = { snooze, root: thread(), delegates: [], now: AT + 1 };

  it("names the first enabled event, in settings order", () => {
    const root = thread({ latestAttentionAt: AT + 1, work: "review" });
    expect(wakeEvent({ ...facts, root }, DEFAULT_WAKE_EVENTS)).toBe("review");
    expect(
      wakeEvent({ ...facts, root }, { ...DEFAULT_WAKE_EVENTS, review: false }),
    ).toBe(null);
  });

  it("wakes for a delegate that needs the user, but not one that's done", () => {
    const delegate = (work: WakeThread["work"]) =>
      thread({ id: "d", latestAttentionAt: AT + 1, work });
    expect(
      wakeEvent(
        { ...facts, delegates: [delegate("needs_decision")] },
        DEFAULT_WAKE_EVENTS,
      ),
    ).toBe("delegate-needs-you");
    expect(
      wakeEvent(
        { ...facts, delegates: [delegate("review")] },
        DEFAULT_WAKE_EVENTS,
      ),
    ).toBe("delegate-needs-you");
    expect(
      wakeEvent(
        { ...facts, delegates: [delegate("done")] },
        DEFAULT_WAKE_EVENTS,
      ),
    ).toBe(null);
  });

  it("wakes on lasting conditions only once they began after the snooze and outlast the grace", () => {
    const later = AT + STALL_GRACE_MS;
    expect(
      wakeEvent({ ...facts, sendFailedSince: AT + 1 }, DEFAULT_WAKE_EVENTS),
    ).toBe("send-failed");
    expect(
      wakeEvent({ ...facts, sendFailedSince: -Infinity }, DEFAULT_WAKE_EVENTS),
    ).toBe(null);
    expect(
      wakeEvent(
        { ...facts, hostWaitingSince: AT, now: later - 1 },
        DEFAULT_WAKE_EVENTS,
      ),
    ).toBe(null);
    expect(
      wakeEvent(
        { ...facts, hostWaitingSince: AT, now: later },
        DEFAULT_WAKE_EVENTS,
      ),
    ).toBe("host-stalled");
    expect(
      wakeEvent(
        { ...facts, hostWaitingSince: AT - 1, now: later },
        DEFAULT_WAKE_EVENTS,
      ),
    ).toBe(null);
    expect(
      wakeEvent(
        { ...facts, stalledSince: AT + 1, now: AT + 1 + STALL_GRACE_MS },
        DEFAULT_WAKE_EVENTS,
      ),
    ).toBe("delegate-stalled");
  });
});
