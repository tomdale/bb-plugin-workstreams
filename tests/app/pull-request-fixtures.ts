import type {
  PullRequestCheck,
  TrackedPullRequest,
} from "../../src/domain/pullRequests.ts";

/** A fixed moment the fixtures' times count back from, so ages never drift. */
export const NOW = Date.parse("2031-04-12T15:00:00Z");
export const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

let counter = 0;

/** A fictional open pull request; every field is overridable. */
export function trackedPullRequest(
  overrides: Partial<TrackedPullRequest> = {},
): TrackedPullRequest {
  const number = overrides.number ?? ++counter + 100;
  const repository = overrides.repository ?? "tidewater/harbor";
  return {
    id: `github.example/${repository}#${number}`,
    url: `https://github.example/${repository}/pull/${number}`,
    hostname: "github.example",
    repository,
    number,
    title: `Change number ${number}`,
    body: "",
    workstreamId: "ws_harbor",
    threadId: "thread_author",
    hostId: "host_one",
    status: "waiting",
    reason: "Waiting for a review",
    checks: [],
    headRefName: `feature/change-${number}`,
    baseRefName: "main",
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    lastSuccessAt: NOW - 20_000,
    error: null,
    expiresAt: null,
    closedAt: null,
    mergedAt: null,
    ...overrides,
  };
}

export const check = (
  name: string,
  state: PullRequestCheck["state"],
  overrides: Partial<PullRequestCheck> = {},
): PullRequestCheck => ({
  id: `check-${name}`,
  name,
  state,
  url: null,
  startedAt: null,
  completedAt: null,
  ...overrides,
});

export const workstream = (
  id: string,
  name: string,
  parentId: string | null,
) => ({
  id,
  name,
  description: "",
  parentId,
  aliases: [],
});
