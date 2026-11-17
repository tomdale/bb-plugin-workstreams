import { describe, expect, it } from "vitest";
import {
  PULL_REQUEST_FAST_POLL_MS,
  PULL_REQUEST_QUIET_POLL_MS,
  PULL_REQUEST_RETRY_MAX_MS,
  PULL_REQUEST_TERMINAL_TTL_MS,
  derivePullRequestStatus,
  parsePullRequestUrl,
  pullRequestPollDelayMs,
  pullRequestReadSchema,
  pullRequestRetryDelayMs,
  sameTrackedContent,
  sortTrackedPullRequests,
  terminalExpiry,
  trackedFromRead,
  trackedPullRequestSchema,
  type PullRequestCheck,
  type PullRequestRead,
  type PullRequestStatus,
} from "../../src/domain/pullRequests.ts";

const check = (
  name: string,
  state: PullRequestCheck["state"],
): PullRequestCheck => ({
  id: `id-${name}`,
  name,
  state,
  url: null,
  startedAt: null,
  completedAt: null,
});

const read = (overrides: Partial<PullRequestRead> = {}): PullRequestRead => ({
  number: 7,
  title: "Add shelf labels",
  body: "Adds labels.",
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: "labels",
  headRefOid: "abc123",
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  mergedAt: null,
  closedAt: null,
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  reviewDecision: null,
  checks: [],
  ...overrides,
});

describe("parsePullRequestUrl", () => {
  it("canonicalizes a pull request URL, dropping tabs, queries, and fragments", () => {
    for (const input of [
      "https://github.com/acme/shelves/pull/12",
      "https://GitHub.com/acme/shelves/pull/12/",
      "https://github.com/acme/shelves/pull/12/files?w=1#diff-abc",
      " https://github.com/acme/shelves/pull/12#issuecomment-5 ",
    ]) {
      expect(parsePullRequestUrl(input)).toEqual({
        ok: true,
        target: {
          url: "https://github.com/acme/shelves/pull/12",
          hostname: "github.com",
          repository: "acme/shelves",
          number: 12,
        },
      });
    }
  });

  it("accepts an enterprise hostname", () => {
    const parsed = parsePullRequestUrl(
      "https://git.example.test/acme/shelves/pull/3",
    );
    expect(parsed).toMatchObject({
      ok: true,
      target: { hostname: "git.example.test" },
    });
  });

  it.each([
    ["http scheme", "http://github.com/acme/shelves/pull/1"],
    ["credentials", "https://user:pw@github.com/acme/shelves/pull/1"],
    ["a port", "https://github.com:8443/acme/shelves/pull/1"],
    ["an issue", "https://github.com/acme/shelves/issues/1"],
    ["a missing number", "https://github.com/acme/shelves/pull/"],
    ["a zero number", "https://github.com/acme/shelves/pull/0"],
    ["a leading zero", "https://github.com/acme/shelves/pull/01"],
    ["a huge number", "https://github.com/acme/shelves/pull/99999999999"],
    ["a non-numeric number", "https://github.com/acme/shelves/pull/1a"],
    ["an unknown tab", "https://github.com/acme/shelves/pull/1/rm"],
    ["extra path", "https://github.com/acme/shelves/pull/1/files/more"],
    ["a dot-dot owner", "https://github.com/../shelves/pull/1"],
    ["a doubled slash", "https://github.com/acme//pull/1"],
    ["shell text", "https://github.com/acme/shelves/pull/1;rm -rf"],
    ["a space", "https://github.com/acme/she lves/pull/1"],
    ["an IP address", "https://127.0.0.1/acme/shelves/pull/1"],
    ["a single-label host", "https://localhost/acme/shelves/pull/1"],
    ["not a URL", "acme/shelves#1"],
    ["empty", ""],
  ])("refuses %s", (_name, input) => {
    expect(parsePullRequestUrl(input).ok).toBe(false);
  });
});

describe("derivePullRequestStatus", () => {
  it("puts merged and closed before everything", () => {
    for (const [state, status] of [
      ["MERGED", "merged"],
      ["CLOSED", "closed"],
    ] as const)
      expect(
        derivePullRequestStatus(
          read({
            state,
            isDraft: true,
            checks: [check("lint", "failed"), check("test", "running")],
          }),
        ).status,
      ).toBe(status);
  });

  it("calls a draft a draft whatever its checks say", () => {
    expect(
      derivePullRequestStatus(
        read({ isDraft: true, checks: [check("lint", "failed")] }),
      ),
    ).toEqual({ status: "draft", reason: "Draft" });
  });

  it("ranks failing above running above CLEAN", () => {
    const checks = [check("lint", "failed"), check("test", "running")];
    expect(derivePullRequestStatus(read({ checks })).status).toBe("failing");
    expect(
      derivePullRequestStatus(
        read({ checks: [check("test", "running"), check("lint", "passed")] }),
      ).status,
    ).toBe("running");
    expect(
      derivePullRequestStatus(read({ checks: [check("lint", "passed")] }))
        .status,
    ).toBe("ready");
  });

  it("names the failing check, or counts several", () => {
    expect(
      derivePullRequestStatus(read({ checks: [check("lint", "failed")] }))
        .reason,
    ).toBe("lint failing");
    expect(
      derivePullRequestStatus(
        read({ checks: [check("a", "failed"), check("b", "failed")] }),
      ).reason,
    ).toBe("2 checks failing");
  });

  it("is ready when CLEAN even with no checks at all", () => {
    expect(derivePullRequestStatus(read({ checks: [] }))).toEqual({
      status: "ready",
      reason: "Ready to merge",
    });
  });

  it.each([
    [
      { mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" },
      "Review required",
    ],
    [
      { mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED" },
      "Changes requested",
    ],
    [
      { mergeStateStatus: "BLOCKED", reviewDecision: null },
      "Blocked by required reviews or checks",
    ],
    [{ mergeStateStatus: "DIRTY" }, "Merge conflicts"],
    [{ mergeStateStatus: "BEHIND" }, "Behind the base branch"],
    [{ mergeStateStatus: "UNKNOWN" }, "Mergeability unavailable"],
    [{ mergeStateStatus: null }, "Mergeability unavailable"],
  ])("waits with a reason for %j", (facts, reason) => {
    expect(derivePullRequestStatus(read(facts))).toEqual({
      status: "waiting",
      reason,
    });
  });

  it("does not make an unrecognized check state block a CLEAN pull request", () => {
    expect(
      derivePullRequestStatus(read({ checks: [check("odd", "unknown")] }))
        .status,
    ).toBe("ready");
  });
});

describe("sortTrackedPullRequests", () => {
  it("orders ready, failing, running, waiting, draft, then ended", () => {
    const row = (status: PullRequestStatus, number: number) => ({
      id: `${status}${number}`,
      status,
      repository: "acme/shelves",
      number,
    });
    const sorted = sortTrackedPullRequests([
      row("closed", 1),
      row("draft", 2),
      row("merged", 3),
      row("waiting", 4),
      row("running", 5),
      row("failing", 6),
      row("ready", 7),
      row("ready", 2),
    ]);
    expect(sorted.map((r) => r.id)).toEqual([
      "ready2",
      "ready7",
      "failing6",
      "running5",
      "waiting4",
      "draft2",
      "closed1",
      "merged3",
    ]);
  });
});

describe("polling and expiry", () => {
  it("polls fast while checks run or mergeability is unknown, slowly when quiet", () => {
    expect(pullRequestPollDelayMs(read())).toBe(PULL_REQUEST_QUIET_POLL_MS);
    expect(
      pullRequestPollDelayMs(read({ checks: [check("t", "running")] })),
    ).toBe(PULL_REQUEST_FAST_POLL_MS);
    expect(pullRequestPollDelayMs(read({ mergeStateStatus: "UNKNOWN" }))).toBe(
      PULL_REQUEST_FAST_POLL_MS,
    );
    expect(pullRequestPollDelayMs(read({ mergeable: "UNKNOWN" }))).toBe(
      PULL_REQUEST_FAST_POLL_MS,
    );
    expect(pullRequestPollDelayMs(read({ isDraft: true }))).toBe(
      PULL_REQUEST_QUIET_POLL_MS,
    );
  });

  it("stops polling an ended pull request", () => {
    expect(pullRequestPollDelayMs(read({ state: "MERGED" }))).toBeNull();
    expect(pullRequestPollDelayMs(read({ state: "CLOSED" }))).toBeNull();
  });

  it("expires an hour after GitHub's own end time", () => {
    const mergedAt = "2026-03-01T10:00:00Z";
    expect(terminalExpiry(read({ state: "MERGED", mergedAt }), 0)).toBe(
      Date.parse(mergedAt) + PULL_REQUEST_TERMINAL_TTL_MS,
    );
    const closedAt = "2026-03-01T11:00:00Z";
    expect(terminalExpiry(read({ state: "CLOSED", closedAt }), 0)).toBe(
      Date.parse(closedAt) + PULL_REQUEST_TERMINAL_TTL_MS,
    );
    expect(terminalExpiry(read(), 0)).toBeNull();
  });

  it("backs off in doubling steps to a ceiling, or waits as long as GitHub asked", () => {
    expect(pullRequestRetryDelayMs(1, null)).toBe(PULL_REQUEST_FAST_POLL_MS);
    expect(pullRequestRetryDelayMs(2, null)).toBe(
      2 * PULL_REQUEST_FAST_POLL_MS,
    );
    expect(pullRequestRetryDelayMs(50, null)).toBe(PULL_REQUEST_RETRY_MAX_MS);
    expect(pullRequestRetryDelayMs(1, 5 * 60_000)).toBe(5 * 60_000);
  });
});

describe("rows", () => {
  const identity = {
    id: "pr_1",
    url: "https://github.com/acme/shelves/pull/7",
    hostname: "github.com",
    repository: "acme/shelves",
    number: 7,
    workstreamId: "ws_1",
    threadId: "t_1",
    hostId: "host_1",
  };

  it("builds a row that matches the shared schema", () => {
    const row = trackedFromRead(
      identity,
      read({ checks: [check("a", "passed")] }),
      1000,
    );
    expect(trackedPullRequestSchema.parse(row)).toEqual(row);
    expect(row).toMatchObject({
      status: "ready",
      lastSuccessAt: 1000,
      error: null,
      expiresAt: null,
    });
  });

  it("limits a read's check list in its schema", () => {
    expect(
      pullRequestReadSchema.safeParse(
        read({
          checks: Array.from({ length: 5001 }, (_, i) =>
            check(`c${i}`, "passed"),
          ),
        }),
      ).success,
    ).toBe(false);
  });

  it("ignores the success time when comparing content", () => {
    const a = trackedFromRead(identity, read(), 1000);
    const b = trackedFromRead(identity, read(), 9000);
    expect(sameTrackedContent(a, b)).toBe(true);
    expect(sameTrackedContent(a, { ...b, error: "offline" })).toBe(false);
  });
});
