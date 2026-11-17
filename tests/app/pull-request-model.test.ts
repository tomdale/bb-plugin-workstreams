import { describe, expect, it } from "vitest";
import {
  checkDuration,
  checkSummary,
  formatDuration,
  pullRequestShape,
  pullRequestSubPath,
  pullRequestsOf,
  removalNote,
  repositoryName,
  rowLabel,
  safeExternalUrl,
  sortChecks,
  sortPullRequests,
  statusDetail,
  statusHeading,
  statusWord,
  workstreamIdsWithPullRequests,
} from "../../src/app/pullRequests/model.ts";
import {
  NOW,
  check,
  minutesAgo,
  trackedPullRequest as pr,
} from "./pull-request-fixtures.ts";

describe("pull request order", () => {
  it("lists ready, failing, running, waiting, draft, then merged and closed", () => {
    const sorted = sortPullRequests([
      pr({ number: 1, status: "closed", closedAt: minutesAgo(5) }),
      pr({ number: 2, status: "draft" }),
      pr({ number: 3, status: "merged", mergedAt: minutesAgo(30) }),
      pr({ number: 4, status: "waiting" }),
      pr({ number: 5, status: "running" }),
      pr({ number: 6, status: "failing" }),
      pr({ number: 7, status: "ready" }),
    ]);
    expect(sorted.map((p) => p.status)).toEqual([
      "ready",
      "failing",
      "running",
      "waiting",
      "draft",
      "closed",
      "merged",
    ]);
  });

  it("puts the higher number first within a status, and the latest settled first", () => {
    const sorted = sortPullRequests([
      pr({ number: 10, status: "waiting" }),
      pr({ number: 12, status: "waiting" }),
      pr({ number: 3, status: "merged", mergedAt: minutesAgo(50) }),
      pr({ number: 4, status: "closed", closedAt: minutesAgo(10) }),
    ]);
    expect(sorted.map((p) => p.number)).toEqual([12, 10, 4, 3]);
  });

  it("does not reorder its input", () => {
    const input = [pr({ status: "draft" }), pr({ status: "ready" })];
    sortPullRequests(input);
    expect(input.map((p) => p.status)).toEqual(["draft", "ready"]);
  });
});

describe("status words", () => {
  it("names what each open pull request needs", () => {
    const word = (p: ReturnType<typeof pr>) => statusWord(p, NOW);
    expect(word(pr({ status: "ready" }))).toBe("Ready");
    expect(word(pr({ status: "running" }))).toBe("Running");
    expect(word(pr({ status: "waiting" }))).toBe("Waiting");
    expect(word(pr({ status: "draft" }))).toBe("Draft");
  });

  it("counts failing checks, and still says Failing without a failed check", () => {
    const failing = pr({
      status: "failing",
      checks: [
        check("test", "failed"),
        check("lint", "failed"),
        check("build", "passed"),
      ],
    });
    expect(statusWord(failing, NOW)).toBe("2 failing");
    expect(statusWord(pr({ status: "failing", checks: [] }), NOW)).toBe(
      "Failing",
    );
  });

  it("says when a settled pull request merged or closed", () => {
    expect(
      statusWord(pr({ status: "merged", mergedAt: minutesAgo(14) }), NOW),
    ).toBe("Merged 14m ago");
    expect(
      statusWord(pr({ status: "closed", closedAt: minutesAgo(41) }), NOW),
    ).toBe("Closed 41m ago");
    expect(
      statusWord(pr({ status: "merged", mergedAt: minutesAgo(0) }), NOW),
    ).toBe("Merged just now");
    expect(statusWord(pr({ status: "merged", mergedAt: null }), NOW)).toBe(
      "Merged",
    );
  });

  it("gives a row an accessible name with number, title, repository, and status", () => {
    const row = pr({
      number: 46,
      title: "Serve the dial",
      repository: "tidewater/harbor",
      status: "ready",
    });
    expect(rowLabel(row, NOW)).toBe(
      "Pull request 46, Serve the dial, harbor, Ready",
    );
    expect(rowLabel({ ...row, error: "gh is not signed in" }, NOW)).toBe(
      "Pull request 46, Serve the dial, harbor, Ready, can’t refresh",
    );
  });

  it("reads the view heading and detail as sentences", () => {
    const merged = pr({
      status: "merged",
      mergedAt: minutesAgo(14),
      reason: "Merged by a maintainer",
      checks: [check("build", "passed")],
      expiresAt: NOW + 46 * 60_000,
    });
    expect(statusHeading(merged, NOW)).toBe("Merged 14 minutes ago");
    expect(statusDetail(merged, NOW)).toBe(
      "Merged by a maintainer. 1 of 1 check passed. Leaves the sidebar in 46 minutes.",
    );
    expect(statusHeading(pr({ status: "failing" }), NOW)).toBe(
      "Checks failing",
    );
  });

  it("maps statuses to GitHub's four shapes", () => {
    expect(
      (["ready", "failing", "running", "waiting"] as const).map(
        pullRequestShape,
      ),
    ).toEqual(["open", "open", "open", "open"]);
    expect(pullRequestShape("draft")).toBe("draft");
    expect(pullRequestShape("merged")).toBe("merged");
    expect(pullRequestShape("closed")).toBe("closed");
  });
});

describe("removal time", () => {
  const closed = (expiresAt: number | null) =>
    pr({ status: "closed", closedAt: minutesAgo(5), expiresAt });

  it("says when a terminal pull request leaves the sidebar", () => {
    expect(removalNote(closed(NOW + 46 * 60_000), NOW)).toBe(
      "Leaves the sidebar in 46 minutes.",
    );
    expect(removalNote(closed(NOW + 60_000), NOW)).toBe(
      "Leaves the sidebar in 1 minute.",
    );
    expect(removalNote(closed(NOW + 90 * 60_000), NOW)).toBe(
      "Leaves the sidebar in 2 hours.",
    );
    expect(removalNote(closed(NOW - 1000), NOW)).toBe(
      "Leaves the sidebar shortly.",
    );
  });

  it("says nothing for an open pull request or an unset time", () => {
    expect(removalNote(pr({ expiresAt: NOW + 60_000 }), NOW)).toBeNull();
    expect(removalNote(closed(null), NOW)).toBeNull();
  });
});

describe("external addresses", () => {
  it("accepts http and https addresses", () => {
    expect(
      safeExternalUrl("https://github.example/tidewater/harbor/pull/4"),
    ).toBe("https://github.example/tidewater/harbor/pull/4");
    expect(safeExternalUrl("http://ci.example/run/1")).toBe(
      "http://ci.example/run/1",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "file:///etc/passwd",
    "vscode://open",
    "//ci.example/run",
    "/relative/path",
    "https://user:secret@ci.example/run",
    "not a url",
    "",
  ])("refuses %j", (value) => {
    expect(safeExternalUrl(value)).toBeNull();
  });

  it("refuses a missing address", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});

describe("routes", () => {
  it("encodes a pull request's id into the page's sub-path", () => {
    expect(pullRequestSubPath("github.example/tidewater/harbor#7")).toBe(
      "pull-request/github.example%2Ftidewater%2Fharbor%237",
    );
  });
});

describe("checks", () => {
  it("formats durations in seconds, minutes, and hours", () => {
    expect(formatDuration(43_000)).toBe("43s");
    expect(formatDuration(68_000)).toBe("1m 08s");
    expect(formatDuration(3_780_000)).toBe("1h 03m");
    expect(formatDuration(-5)).toBe("0s");
  });

  it("times a finished check, counts up a running one, and leaves others blank", () => {
    expect(
      checkDuration(
        check("test", "passed", {
          startedAt: minutesAgo(10),
          completedAt: new Date(NOW - 10 * 60_000 + 68_000).toISOString(),
        }),
        NOW,
      ),
    ).toBe("1m 08s");
    expect(
      checkDuration(
        check("test", "running", { startedAt: minutesAgo(2) }),
        NOW,
      ),
    ).toBe("2m 00s");
    expect(checkDuration(check("test", "unknown"), NOW)).toBeNull();
    expect(
      checkDuration(check("test", "passed", { startedAt: "soon" }), NOW),
    ).toBeNull();
  });

  it("lists failed checks first, then running, no result, and passed", () => {
    const sorted = sortChecks([
      check("a", "passed"),
      check("b", "unknown"),
      check("c", "running"),
      check("d", "failed"),
      check("e", "failed"),
    ]);
    expect(sorted.map((c) => c.name)).toEqual(["d", "e", "c", "b", "a"]);
  });

  it("summarizes how many passed", () => {
    expect(checkSummary([])).toBe("No checks");
    expect(checkSummary([check("a", "passed"), check("b", "running")])).toBe(
      "1 of 2 checks passed",
    );
  });
});

describe("grouping", () => {
  it("names each workstream holding a pull request once, sorted", () => {
    expect(
      workstreamIdsWithPullRequests([
        pr({ workstreamId: "b" }),
        pr({ workstreamId: "a" }),
        pr({ workstreamId: "b" }),
      ]),
    ).toEqual(["a", "b"]);
  });

  it("selects and sorts the pull requests of some workstreams", () => {
    const items = [
      pr({ number: 1, workstreamId: "a", status: "draft" }),
      pr({ number: 2, workstreamId: "b", status: "ready" }),
      pr({ number: 3, workstreamId: "a", status: "ready" }),
    ];
    expect(pullRequestsOf(items, new Set(["a"])).map((p) => p.number)).toEqual([
      3, 1,
    ]);
  });

  it("names a repository without its owner", () => {
    expect(repositoryName("tidewater/harbor")).toBe("harbor");
    expect(repositoryName("solo")).toBe("solo");
  });
});
