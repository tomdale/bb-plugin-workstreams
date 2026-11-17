/**
 * What the sidebar rows and the read-only view say about a tracked pull
 * request: the sort order, the status words, durations, and which links are
 * safe to open. Pure, so a test reads every word without mounting anything.
 */
import type {
  PullRequestCheck,
  PullRequestStatus,
  TrackedPullRequest,
} from "../../domain/pullRequests.ts";
import { relativeAge, relativeAgeLabel } from "../../domain/presentation.ts";

/**
 * Where a status sorts in a workstream's list: what can merge first, then what
 * needs a fix, then what is still moving, and the settled ones last.
 */
export const PULL_REQUEST_RANK: Readonly<Record<PullRequestStatus, number>> = {
  ready: 0,
  failing: 1,
  running: 2,
  waiting: 3,
  draft: 4,
  merged: 5,
  closed: 5,
};

/** The octicon shape a status draws: GitHub's open, draft, merged, closed. */
export type PullRequestShape = "open" | "draft" | "merged" | "closed";

export const pullRequestShape = (
  status: PullRequestStatus,
): PullRequestShape =>
  status === "draft" || status === "merged" || status === "closed"
    ? status
    : "open";

/** The status as the view's heading says it. */
export const STATUS_HEADING: Readonly<Record<PullRequestStatus, string>> = {
  ready: "Ready to merge",
  failing: "Checks failing",
  running: "Checks running",
  waiting: "Waiting",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

/** A settled pull request: it merged or closed and will leave the sidebar. */
export const isSettled = (pr: Pick<TrackedPullRequest, "status">) =>
  pr.status === "merged" || pr.status === "closed";

/** When a settled pull request merged or closed, in milliseconds; null if unknown. */
export function settledAt(pr: TrackedPullRequest): number | null {
  const iso = pr.status === "merged" ? pr.mergedAt : pr.closedAt;
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
}

/**
 * Ready, failing, running, waiting, draft, then merged and closed together;
 * within a status the one that settled last, then the higher number.
 */
export function comparePullRequests(
  a: TrackedPullRequest,
  b: TrackedPullRequest,
): number {
  return (
    PULL_REQUEST_RANK[a.status] - PULL_REQUEST_RANK[b.status] ||
    (settledAt(b) ?? 0) - (settledAt(a) ?? 0) ||
    b.number - a.number ||
    a.id.localeCompare(b.id)
  );
}

export const sortPullRequests = (items: readonly TrackedPullRequest[]) =>
  [...items].sort(comparePullRequests);

export const failingChecks = (pr: Pick<TrackedPullRequest, "checks">) =>
  pr.checks.filter((check) => check.state === "failed").length;

/** `owner/repo` without its owner: the repository name a row's second line shows. */
export const repositoryName = (repository: string) =>
  repository.split("/").at(-1) ?? repository;

/**
 * The status word on a row's second line: what the pull request needs, or
 * when a settled one merged or closed.
 */
export function statusWord(pr: TrackedPullRequest, now: number): string {
  switch (pr.status) {
    case "ready":
      return "Ready";
    case "failing": {
      const failing = failingChecks(pr);
      return failing > 0 ? `${failing} failing` : "Failing";
    }
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "draft":
      return "Draft";
    case "merged":
    case "closed": {
      const verb = pr.status === "merged" ? "Merged" : "Closed";
      const at = settledAt(pr);
      if (at === null) return verb;
      const age = relativeAge(at, now);
      return age === "now" ? `${verb} just now` : `${verb} ${age} ago`;
    }
  }
}

/** The view's heading: the status, or for a settled one when it settled. */
export function statusHeading(pr: TrackedPullRequest, now: number): string {
  const at = isSettled(pr) ? settledAt(pr) : null;
  return at === null
    ? STATUS_HEADING[pr.status]
    : `${STATUS_HEADING[pr.status]} ${relativeAgeLabel(at, now)}`;
}

const sentence = (text: string) => {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/**
 * The line under the heading: why the status is what it is, how many checks
 * passed, and for a settled pull request when it leaves the sidebar.
 */
export function statusDetail(pr: TrackedPullRequest, now: number): string {
  return [pr.reason, checkSummary(pr.checks), removalNote(pr, now)]
    .filter((part): part is string => Boolean(part?.trim()))
    .map(sentence)
    .join(" ");
}

/** Whether the last read failed, so the status shown is the last one known. */
export const isStale = (pr: Pick<TrackedPullRequest, "error">) =>
  pr.error !== null;

/** A row's accessible name: the number, title, repository, and status in words. */
export function rowLabel(pr: TrackedPullRequest, now: number): string {
  const parts = [
    `Pull request ${pr.number}`,
    pr.title,
    repositoryName(pr.repository),
    statusWord(pr, now),
  ];
  if (isStale(pr)) parts.push("can’t refresh");
  return parts.join(", ");
}

/**
 * An `http` or `https` address without embedded credentials, or null. The
 * view opens nothing else: a pull request's own fields and a check's link come
 * from GitHub and the checks' providers.
 */
export function safeExternalUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.href;
}

/** The Workstreams page's sub-path for a pull request's view. */
export const pullRequestSubPath = (id: string) =>
  `pull-request/${encodeURIComponent(id)}`;

/** `1m 08s`, `43s`, `2h 03m`: a duration in whole seconds, as a check list shows it. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * How long a check took, or has been running; null when its times are
 * unknown. A running check counts up to `now`.
 */
export function checkDuration(
  check: PullRequestCheck,
  now: number,
): string | null {
  if (!check.startedAt) return null;
  const started = Date.parse(check.startedAt);
  if (Number.isNaN(started)) return null;
  const ended = check.completedAt ? Date.parse(check.completedAt) : NaN;
  if (!Number.isNaN(ended)) return formatDuration(ended - started);
  return check.state === "running" ? formatDuration(now - started) : null;
}

const CHECK_ORDER: Readonly<Record<PullRequestCheck["state"], number>> = {
  failed: 0,
  running: 1,
  unknown: 2,
  passed: 3,
};

/** Failed checks first, then running, unknown, and passed; each in the order given. */
export const sortChecks = (checks: readonly PullRequestCheck[]) =>
  [...checks]
    .map((check, index) => ({ check, index }))
    .sort(
      (a, b) =>
        CHECK_ORDER[a.check.state] - CHECK_ORDER[b.check.state] ||
        a.index - b.index,
    )
    .map(({ check }) => check);

export const CHECK_STATE_LABEL: Readonly<
  Record<PullRequestCheck["state"], string>
> = {
  passed: "Passed",
  failed: "Failed",
  running: "Running",
  unknown: "No result",
};

/** `3 of 5 checks passed`, or `No checks` for a pull request without any. */
export function checkSummary(checks: readonly PullRequestCheck[]): string {
  if (checks.length === 0) return "No checks";
  const passed = checks.filter((check) => check.state === "passed").length;
  return `${passed} of ${checks.length} ${checks.length === 1 ? "check" : "checks"} passed`;
}

/** When a settled pull request leaves the sidebar: "Leaves the sidebar in 46 minutes." */
export function removalNote(
  pr: TrackedPullRequest,
  now: number,
): string | null {
  if (!isSettled(pr) || pr.expiresAt === null) return null;
  const minutes = Math.ceil((pr.expiresAt - now) / 60_000);
  if (minutes <= 0) return "Leaves the sidebar shortly.";
  if (minutes < 60)
    return `Leaves the sidebar in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  const hours = Math.round(minutes / 60);
  return `Leaves the sidebar in ${hours} ${hours === 1 ? "hour" : "hours"}.`;
}

/** The workstream ids that hold at least one pull request, sorted. */
export const workstreamIdsWithPullRequests = (
  items: readonly Pick<TrackedPullRequest, "workstreamId">[],
): string[] => [...new Set(items.map((pr) => pr.workstreamId))].sort();

/** The pull requests of these workstreams, sorted for a list. */
export const pullRequestsOf = (
  items: readonly TrackedPullRequest[],
  workstreamIds: ReadonlySet<string>,
) => sortPullRequests(items.filter((pr) => workstreamIds.has(pr.workstreamId)));
