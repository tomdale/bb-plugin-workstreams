/**
 * Tracked pull requests: the wire shapes the server and app share, URL
 * validation, and the rules that turn GitHub's facts into one status, a poll
 * cadence, and an expiry. Everything here is pure.
 *
 * A pull request is tracked once per workstream. Its row keeps the workstream
 * it was linked in, whatever happens to the thread that linked it.
 */
import { z } from "zod";

export const PULL_REQUEST_STATUSES = [
  "ready",
  "failing",
  "running",
  "waiting",
  "draft",
  "merged",
  "closed",
] as const;
export const pullRequestStatusSchema = z.enum(PULL_REQUEST_STATUSES);
export type PullRequestStatus = z.infer<typeof pullRequestStatusSchema>;

export const pullRequestCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(["passed", "failed", "running", "unknown"]),
  url: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type PullRequestCheck = z.infer<typeof pullRequestCheckSchema>;

export const trackedPullRequestSchema = z.object({
  id: z.string(),
  url: z.string(),
  hostname: z.string(),
  /** `owner/repo`. */
  repository: z.string(),
  number: z.number(),
  title: z.string(),
  body: z.string(),
  workstreamId: z.string(),
  /** The thread that linked it, most recently. */
  threadId: z.string(),
  /** The machine whose `gh` login reads it. */
  hostId: z.string(),
  status: pullRequestStatusSchema,
  /** Why the status is what it is, in a few words. */
  reason: z.string(),
  checks: z.array(pullRequestCheckSchema),
  headRefName: z.string(),
  baseRefName: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  /** When GitHub last answered for this pull request, in epoch ms. */
  lastSuccessAt: z.number(),
  /** Why the latest read failed; the rest of the row is from `lastSuccessAt`. */
  error: z.string().nullable(),
  /** Epoch ms after which a merged or closed row is dropped. */
  expiresAt: z.number().nullable(),
  closedAt: z.string().nullable(),
  mergedAt: z.string().nullable(),
});
export type TrackedPullRequest = z.infer<typeof trackedPullRequestSchema>;

/** What the machine reads from GitHub for one pull request, before it is a row. */
export const PULL_REQUEST_MAX_CHECKS = 5000;
export const pullRequestReadSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  baseRefName: z.string(),
  headRefName: z.string(),
  headRefOid: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  mergedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  mergeStateStatus: z.string().nullable(),
  mergeable: z.string().nullable(),
  reviewDecision: z.string().nullable(),
  checks: z.array(pullRequestCheckSchema).max(PULL_REQUEST_MAX_CHECKS),
});
export type PullRequestRead = z.infer<typeof pullRequestReadSchema>;

/** Why a machine could not read a pull request; none of these means it closed. */
export const PULL_REQUEST_FAILURES = [
  "gh_missing",
  "auth",
  "not_found",
  "rate_limit",
  "unavailable",
] as const;
export type PullRequestFailure = (typeof PULL_REQUEST_FAILURES)[number];

export const pullRequestLookupSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("found"),
    url: z.string(),
    pullRequest: pullRequestReadSchema,
  }),
  z.object({
    outcome: z.literal("failed"),
    url: z.string(),
    failure: z.enum(PULL_REQUEST_FAILURES),
    message: z.string().max(500),
    /** How long GitHub asked a caller to wait, when it said. */
    retryAfterMs: z.number().nullable(),
  }),
]);
export type PullRequestLookup = z.infer<typeof pullRequestLookupSchema>;

/** Most pull requests one GraphQL document reads. */
export const PULL_REQUEST_BATCH_SIZE = 25;
export const PULL_REQUEST_FAST_POLL_MS = 30_000;
export const PULL_REQUEST_QUIET_POLL_MS = 5 * 60_000;
export const PULL_REQUEST_RETRY_MAX_MS = 10 * 60_000;
/** How long a merged or closed pull request stays after GitHub says it ended. */
export const PULL_REQUEST_TERMINAL_TTL_MS = 60 * 60_000;
/** A machine that is not connected is asked about again this often. */
export const PULL_REQUEST_OFFLINE_RECHECK_MS = 60_000;

// --- URLs -------------------------------------------------------------------

export type PullRequestTarget = {
  /** The canonical form: `https://<host>/<owner>/<repo>/pull/<number>`. */
  url: string;
  hostname: string;
  repository: string;
  number: number;
};

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PR_TAB = new Set(["files", "commits", "checks", "conflicts"]);

/**
 * Reads a full `https` pull request URL. Any DNS hostname passes (GitHub
 * Enterprise included); the machine's `gh` decides whether it has a login for
 * it. A tab (`/files`), query, or fragment is dropped. Anything else is
 * refused with a reason an agent can act on.
 */
export function parsePullRequestUrl(
  input: string,
): { ok: true; target: PullRequestTarget } | { ok: false; message: string } {
  const text = input.trim();
  const refuse = (message: string) => ({ ok: false as const, message });
  if (!text || text.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(text))
    return refuse("Give one full pull request URL.");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return refuse(
      `"${text.slice(0, 80)}" is not a URL. Use https://github.com/<owner>/<repo>/pull/<number>.`,
    );
  }
  if (url.protocol !== "https:")
    return refuse("The pull request URL must use https.");
  if (url.username || url.password)
    return refuse("The pull request URL must not contain credentials.");
  if (url.port) return refuse("The pull request URL must not name a port.");
  const hostname = url.hostname.toLowerCase();
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    !labels.every((label) => HOST_LABEL.test(label)) ||
    /^[0-9.]+$/.test(hostname)
  )
    return refuse(`"${hostname}" is not a GitHub hostname.`);
  const path = url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;
  const parts = path.split("/").slice(1);
  const [owner, repo, kind, rawNumber, tab, ...rest] = parts;
  if (
    !owner ||
    !repo ||
    kind !== "pull" ||
    !rawNumber ||
    rest.length > 0 ||
    (tab !== undefined && !PR_TAB.has(tab)) ||
    !NAME.test(owner) ||
    !NAME.test(repo) ||
    owner === "." ||
    owner === ".." ||
    repo === "." ||
    repo === ".." ||
    !/^[1-9][0-9]{0,8}$/.test(rawNumber)
  )
    return refuse(
      "Use a pull request URL like https://github.com/<owner>/<repo>/pull/<number>.",
    );
  const number = Number(rawNumber);
  return {
    ok: true,
    target: {
      url: `https://${hostname}/${owner}/${repo}/pull/${number}`,
      hostname,
      repository: `${owner}/${repo}`,
      number,
    },
  };
}

// --- Status -----------------------------------------------------------------

type StatusFacts = Pick<
  PullRequestRead,
  | "state"
  | "isDraft"
  | "checks"
  | "mergeStateStatus"
  | "reviewDecision"
  | "mergedAt"
  | "closedAt"
>;

const clip = (text: string) =>
  text.length <= 60 ? text : `${text.slice(0, 59)}…`;
const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Why an open pull request that is not ready is waiting. */
function waitingReason(facts: StatusFacts): string {
  if (facts.reviewDecision === "CHANGES_REQUESTED") return "Changes requested";
  switch (facts.mergeStateStatus) {
    case "DIRTY":
      return "Merge conflicts";
    case "BEHIND":
      return "Behind the base branch";
    case "HAS_HOOKS":
      return "Waiting on merge hooks";
    case "UNSTABLE":
      return "Checks unstable";
    case "BLOCKED":
      return facts.reviewDecision === "REVIEW_REQUIRED"
        ? "Review required"
        : "Blocked by required reviews or checks";
    default:
      return facts.reviewDecision === "REVIEW_REQUIRED"
        ? "Review required"
        : "Mergeability unavailable";
  }
}

/**
 * One status for a pull request. Merged or closed comes first, then draft
 * whatever its checks say, then failing checks, then running checks, then
 * GitHub's own verdict: `CLEAN` is ready, even for a repository with no
 * checks, and anything else is waiting on something the reason names.
 */
export function derivePullRequestStatus(facts: StatusFacts): {
  status: PullRequestStatus;
  reason: string;
} {
  if (facts.state === "MERGED") return { status: "merged", reason: "Merged" };
  if (facts.state === "CLOSED")
    return { status: "closed", reason: "Closed without merging" };
  if (facts.isDraft) return { status: "draft", reason: "Draft" };
  const failed = facts.checks.filter((c) => c.state === "failed");
  if (failed.length > 0)
    return {
      status: "failing",
      reason:
        failed.length === 1
          ? `${clip(failed[0]!.name)} failing`
          : `${plural(failed.length, "check")} failing`,
    };
  const running = facts.checks.filter((c) => c.state === "running");
  if (running.length > 0)
    return {
      status: "running",
      reason: `${plural(running.length, "check")} running`,
    };
  if (facts.mergeStateStatus === "CLEAN")
    return { status: "ready", reason: "Ready to merge" };
  return { status: "waiting", reason: waitingReason(facts) };
}

/** Whether a status ends the pull request's tracking. */
export const isTerminalStatus = (status: PullRequestStatus): boolean =>
  status === "merged" || status === "closed";

/** When a merged or closed pull request leaves the list; null while open. */
export function terminalExpiry(
  read: Pick<PullRequestRead, "state" | "mergedAt" | "closedAt">,
  now: number,
): number | null {
  if (read.state === "OPEN") return null;
  const ended = Date.parse(
    (read.state === "MERGED" ? read.mergedAt : null) ?? read.closedAt ?? "",
  );
  return (Number.isFinite(ended) ? ended : now) + PULL_REQUEST_TERMINAL_TTL_MS;
}

/** How long to wait before reading an open pull request again; null if it ended. */
export function pullRequestPollDelayMs(
  read: Pick<
    PullRequestRead,
    "state" | "checks" | "mergeStateStatus" | "mergeable"
  >,
): number | null {
  if (read.state !== "OPEN") return null;
  const pending = read.checks.some((check) => check.state === "running");
  const unknownMergeability =
    read.mergeStateStatus === null ||
    read.mergeStateStatus === "UNKNOWN" ||
    read.mergeable === null ||
    read.mergeable === "UNKNOWN";
  return pending || unknownMergeability
    ? PULL_REQUEST_FAST_POLL_MS
    : PULL_REQUEST_QUIET_POLL_MS;
}

/**
 * How long to wait after the `failures`th read in a row failed: doubling from
 * the fast cadence to a ceiling, or the wait GitHub asked for when longer.
 */
export function pullRequestRetryDelayMs(
  failures: number,
  retryAfterMs: number | null,
): number {
  const backoff = Math.min(
    PULL_REQUEST_FAST_POLL_MS * 2 ** Math.max(0, failures - 1),
    PULL_REQUEST_RETRY_MAX_MS,
  );
  return Math.max(backoff, Math.min(retryAfterMs ?? 0, 60 * 60_000));
}

/** The row a read makes, for the pull request tracked as `identity`. */
export function trackedFromRead(
  identity: Pick<
    TrackedPullRequest,
    | "id"
    | "url"
    | "hostname"
    | "repository"
    | "number"
    | "workstreamId"
    | "threadId"
    | "hostId"
  >,
  read: PullRequestRead,
  now: number,
): TrackedPullRequest {
  const { status, reason } = derivePullRequestStatus(read);
  return {
    ...identity,
    title: read.title,
    body: read.body,
    status,
    reason,
    checks: read.checks,
    headRefName: read.headRefName,
    baseRefName: read.baseRefName,
    additions: read.additions,
    deletions: read.deletions,
    changedFiles: read.changedFiles,
    lastSuccessAt: now,
    error: null,
    expiresAt: terminalExpiry(read, now),
    closedAt: read.closedAt,
    mergedAt: read.mergedAt,
  };
}

// --- Order ------------------------------------------------------------------

const STATUS_ORDER: Record<PullRequestStatus, number> = {
  ready: 0,
  failing: 1,
  running: 2,
  waiting: 3,
  draft: 4,
  merged: 5,
  closed: 5,
};

/** Ready, failing, running, waiting, draft, then merged and closed. */
export function compareTrackedPullRequests(
  a: Pick<TrackedPullRequest, "status" | "repository" | "number" | "id">,
  b: Pick<TrackedPullRequest, "status" | "repository" | "number" | "id">,
): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    a.repository.localeCompare(b.repository) ||
    a.number - b.number ||
    a.id.localeCompare(b.id)
  );
}

export function sortTrackedPullRequests<
  T extends Pick<TrackedPullRequest, "status" | "repository" | "number" | "id">,
>(items: readonly T[]): T[] {
  return [...items].sort(compareTrackedPullRequests);
}

/** Whether two rows say the same thing to a reader; `lastSuccessAt` is ignored. */
export function sameTrackedContent(
  a: TrackedPullRequest,
  b: TrackedPullRequest,
): boolean {
  // Parsing puts both in the schema's key order, whoever built them.
  const canonical = (row: TrackedPullRequest) =>
    JSON.stringify(
      trackedPullRequestSchema.parse({ ...row, lastSuccessAt: 0 }),
    );
  return canonical(a) === canonical(b);
}
