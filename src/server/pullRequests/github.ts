/**
 * Reads pull requests from GitHub with the machine's own `gh` login. This
 * runs in the `bb.host` entry: it starts `gh` with fixed arguments (no shell,
 * the query on stdin), keeps no token, and never writes to GitHub.
 *
 * One document reads up to `PULL_REQUEST_BATCH_SIZE` pull requests, each as an
 * aliased `resource(url:)` selection so one failure stays that pull request's
 * own. A pull request's checks are every context of its latest commit: pages
 * of 100 are followed until GitHub says there are no more, and a read that
 * cannot finish that is a failure rather than a short list.
 */
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { experimental_sanitizeInheritedChildProcessEnv as sanitizeEnv } from "@get-bb/plugin-sdk/host";
import {
  PULL_REQUEST_BATCH_SIZE,
  PULL_REQUEST_MAX_CHECKS,
  pullRequestReadSchema,
  type PullRequestCheck,
  type PullRequestFailure,
  type PullRequestLookup,
  type PullRequestRead,
} from "../../domain/pullRequests.ts";
import { plainText } from "./plainText.ts";

const CONTEXTS_PAGE = 100;
/** Pages of checks read per pull request; the schema's check ceiling binds first. */
const MAX_CONTEXT_PAGES = Math.ceil(PULL_REQUEST_MAX_CHECKS / CONTEXTS_PAGE);
const BODY_MAX = 20_000;
const TITLE_MAX = 500;
const GH_TIMEOUT_MS = 60_000;
const GH_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MESSAGE_MAX = 300;

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
const str = (object: Json | null, key: string): string | null => {
  const value = object?.[key];
  return typeof value === "string" ? value : null;
};
const num = (object: Json | null, key: string): number | null => {
  const value = object?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const dateTime = (object: Json | null, key: string): string | null => {
  const value = str(object, key);
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
};

/** How a `gh` run ended; it throws only when `gh` could not run at all. */
export type GhResult = { code: number; stdout: string; stderr: string };
export type GhRunner = (
  args: readonly string[],
  stdin: string,
  signal?: AbortSignal,
) => Promise<GhResult>;

/** `gh` is not installed or not on the machine's PATH. */
export class GhMissingError extends Error {
  constructor() {
    super("gh is not installed on this machine, or is not on its PATH.");
  }
}

/**
 * Runs `gh` without a shell. Its output is read in full, up to a ceiling. The
 * child inherits this process's environment (that is how it finds the user's
 * login) minus BB's own variables. A signal that is already aborted never
 * starts it.
 */
export const runGh: GhRunner = (args, stdin, signal) =>
  new Promise((resolve, reject) => {
    const stop = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(GH_TIMEOUT_MS),
    ]);
    const stopped = () =>
      new Error(signal?.aborted ? "The read was canceled." : "gh timed out.");
    if (stop.aborted) return reject(stopped());
    const path = process.env.PATH ?? "";
    const extra = ["/opt/homebrew/bin", "/usr/local/bin"].filter(
      (dir) => !path.split(":").includes(dir),
    );
    const child = spawn("gh", [...args], {
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...sanitizeEnv({
          env: process.env,
          shellPath: [path, ...extra].filter(Boolean).join(":"),
        }),
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
        NO_COLOR: "1",
      },
    });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let size = 0;
    let overflow = false;
    const kill = () => child.kill("SIGKILL");
    stop.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > GH_MAX_OUTPUT_BYTES) {
        overflow = true;
        kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errors.reduce((n, c) => n + c.length, 0) < 64_000) errors.push(chunk);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      stop.removeEventListener("abort", kill);
      reject(
        error.code === "ENOENT"
          ? new GhMissingError()
          : new Error(error.message),
      );
    });
    child.once("close", (code) => {
      stop.removeEventListener("abort", kill);
      if (overflow) return reject(new Error("GitHub's answer was too large."));
      if (stop.aborted) return reject(stopped());
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: Buffer.concat(errors).toString("utf8"),
      });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin);
  });

// --- Query ------------------------------------------------------------------

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const CONTEXT_NODES = oneLine(`nodes {
  __typename
  ... on CheckRun { id name status conclusion detailsUrl startedAt completedAt
    checkSuite { workflowRun { runNumber event workflow { databaseId } } } }
  ... on StatusContext { id context state targetUrl createdAt }
}
pageInfo { hasNextPage endCursor }`);

const contexts = (cursor: string | null) =>
  `commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: ${CONTEXTS_PAGE}${cursor === null ? "" : `, after: ${JSON.stringify(cursor)}`}) { ${CONTEXT_NODES} } } } } }`;

const FIELDS =
  oneLine(`number title body state isDraft baseRefName headRefName headRefOid
  additions deletions changedFiles mergedAt closedAt mergeStateStatus mergeable
  reviewDecision`);

type Target = { alias: string; url: string; cursor: string | null };

/** One document; a target with a cursor asks only for the next page of checks. */
export function buildQuery(targets: readonly Target[]): string {
  const selections = targets.map(
    ({ alias, url, cursor }) =>
      `${alias}: resource(url: ${JSON.stringify(url)}) { ... on PullRequest { ${cursor === null ? `${FIELDS} ` : "headRefOid "}${contexts(cursor)} } }`,
  );
  return `query { ${selections.join("\n")} }`;
}

// --- Checks -----------------------------------------------------------------

type WorkflowRun = { workflow: string; runNumber: number };
type Context = { check: PullRequestCheck; run: WorkflowRun | null };

function checkState(node: Json): PullRequestCheck["state"] {
  if (node.__typename === "StatusContext") {
    switch (str(node, "state")) {
      case "SUCCESS":
        return "passed";
      case "FAILURE":
      case "ERROR":
        return "failed";
      case "PENDING":
      case "EXPECTED":
        return "running";
      default:
        return "unknown";
    }
  }
  if (str(node, "status") !== "COMPLETED") {
    return [
      "QUEUED",
      "IN_PROGRESS",
      "WAITING",
      "PENDING",
      "REQUESTED",
    ].includes(str(node, "status") ?? "")
      ? "running"
      : "unknown";
  }
  switch (str(node, "conclusion")) {
    case "SUCCESS":
    case "NEUTRAL":
    case "SKIPPED":
      return "passed";
    case "FAILURE":
    case "TIMED_OUT":
    case "CANCELLED":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failed";
    default:
      return "unknown";
  }
}

function decodeContext(node: Json): Context | null {
  const typename = str(node, "__typename");
  if (typename !== "CheckRun" && typename !== "StatusContext") return null;
  const name = plainText(str(node, "name") ?? str(node, "context") ?? "");
  const id = str(node, "id");
  const run = asObject(asObject(node.checkSuite)?.workflowRun);
  const workflowId = num(asObject(run?.workflow) ?? null, "databaseId");
  const event = str(run, "event");
  const runNumber = num(run, "runNumber");
  return {
    check: {
      id: id ?? name,
      name: name || "Unnamed check",
      state: checkState(node),
      url: str(node, "detailsUrl") ?? str(node, "targetUrl"),
      startedAt: dateTime(node, "startedAt") ?? dateTime(node, "createdAt"),
      completedAt: dateTime(node, "completedAt"),
    },
    run:
      workflowId !== null && event !== null && runNumber !== null
        ? { workflow: `${workflowId}:${event}`, runNumber }
        : null,
  };
}

/**
 * Checks of runs a newer run of the same workflow replaced are not the pull
 * request's checks any more. Otherwise a name seen twice keeps its newest.
 */
export function currentChecks(all: readonly Context[]): PullRequestCheck[] {
  const latest = new Map<string, number>();
  for (const { run } of all)
    if (run)
      latest.set(
        run.workflow,
        Math.max(latest.get(run.workflow) ?? 0, run.runNumber),
      );
  const kept = all.filter(
    ({ run }) => run === null || run.runNumber === latest.get(run.workflow),
  );
  const byName = new Map<string, Context>();
  const out: Context[] = [];
  for (const context of kept) {
    if (context.run) {
      out.push(context);
      continue;
    }
    const seen = byName.get(context.check.name);
    if (!seen) {
      byName.set(context.check.name, context);
      out.push(context);
    } else if (
      Date.parse(context.check.startedAt ?? "") >
      Date.parse(seen.check.startedAt ?? "")
    ) {
      out[out.indexOf(seen)] = context;
      byName.set(context.check.name, context);
    }
  }
  return out.map((context) => context.check);
}

// --- Failures ---------------------------------------------------------------

const failure = (
  url: string,
  kind: PullRequestFailure,
  message: string,
  retryAfterMs: number | null = null,
): PullRequestLookup => ({
  outcome: "failed",
  url,
  failure: kind,
  message: plainText(message).slice(0, MESSAGE_MAX),
  retryAfterMs,
});

const RATE_LIMIT = /rate limit|secondary rate|abuse detection/i;
const AUTH =
  /gh auth login|not logged in|authentication|HTTP 401|Bad credentials|requires authentication|GH_TOKEN/i;

/** Sorts a failure's text into the cause a person can act on. */
function classify(text: string): {
  kind: PullRequestFailure;
  retryAfterMs: number | null;
} {
  if (RATE_LIMIT.test(text))
    return { kind: "rate_limit", retryAfterMs: 60_000 };
  if (AUTH.test(text)) return { kind: "auth", retryAfterMs: null };
  return { kind: "unavailable", retryAfterMs: null };
}

function describe(kind: PullRequestFailure, hostname: string, text: string) {
  switch (kind) {
    case "auth":
      return `gh is not signed in to ${hostname} on this machine. Run gh auth login --hostname ${hostname}.`;
    case "rate_limit":
      return "GitHub's rate limit was reached; reading resumes after the wait.";
    default:
      return text || "GitHub could not be reached.";
  }
}

type Graph = { data: Json | null; errors: Json[] };

async function query(
  run: GhRunner,
  hostname: string,
  targets: readonly Target[],
  signal?: AbortSignal,
): Promise<
  | Graph
  | {
      failed: {
        kind: PullRequestFailure;
        message: string;
        retryAfterMs: number | null;
      };
    }
> {
  let result: GhResult;
  try {
    result = await run(
      [
        "api",
        "graphql",
        "--hostname",
        hostname,
        "--method",
        "POST",
        "--input",
        "-",
      ],
      JSON.stringify({ query: buildQuery(targets) }),
      signal,
    );
  } catch (error) {
    if (error instanceof GhMissingError)
      return {
        failed: {
          kind: "gh_missing",
          message: error.message,
          retryAfterMs: null,
        },
      };
    const message = error instanceof Error ? error.message : String(error);
    return {
      failed: {
        kind: "unavailable",
        message: message.slice(0, MESSAGE_MAX),
        retryAfterMs: null,
      },
    };
  }
  let parsed: Json | null = null;
  if (result.stdout.trim().startsWith("{")) {
    try {
      parsed = asObject(JSON.parse(result.stdout));
    } catch {
      parsed = null;
    }
  }
  // `gh` exits non-zero on GraphQL errors but still prints the partial data.
  if (parsed && (result.code === 0 || "data" in parsed || "errors" in parsed)) {
    return {
      data: asObject(parsed.data),
      errors: Array.isArray(parsed.errors)
        ? parsed.errors.flatMap((e): Json[] => {
            const error = asObject(e);
            return error ? [error] : [];
          })
        : [],
    };
  }
  const text = `${result.stderr}\n${result.stdout}`;
  const { kind, retryAfterMs } = classify(text);
  return {
    failed: {
      kind,
      message: describe(kind, hostname, result.stderr.trim() || text.trim()),
      retryAfterMs,
    },
  };
}

/**
 * What went wrong for one aliased selection: errors on its own path, or, when
 * it came back empty, errors that name no path (a rate limit, say, which
 * GitHub reports for the whole document).
 */
function errorsOf(
  errors: readonly Json[],
  alias: string,
  answered: boolean,
): Json[] {
  const own = errors.filter(
    (e) => Array.isArray(e.path) && e.path[0] === alias,
  );
  if (own.length > 0 || answered) return own;
  return errors.filter((e) => !Array.isArray(e.path));
}

function errorFailure(
  url: string,
  hostname: string,
  errors: readonly Json[],
): PullRequestLookup {
  const text = errors.map((e) => str(e, "message") ?? "").join("; ");
  const type = errors.map((e) => str(e, "type")).find(Boolean) ?? "";
  if (type === "NOT_FOUND")
    return failure(
      url,
      "not_found",
      "GitHub reports no such pull request, or this login cannot see it.",
    );
  if (
    type === "FORBIDDEN" ||
    type === "INSUFFICIENT_SCOPES" ||
    /SAML|SSO/i.test(text)
  )
    return failure(
      url,
      "auth",
      `This gh login cannot read the pull request (${text.slice(0, 120) || type}).`,
    );
  if (type === "RATE_LIMITED" || RATE_LIMIT.test(text))
    return failure(
      url,
      "rate_limit",
      describe("rate_limit", hostname, text),
      60_000,
    );
  return failure(url, "unavailable", text || "GitHub returned an error.");
}

// --- Reading ----------------------------------------------------------------

type Pending = {
  url: string;
  alias: string;
  read: Omit<PullRequestRead, "checks">;
  oid: string;
  contexts: Context[];
  cursor: string | null;
};

function commitOf(pr: Json): { oid: string | null; rollup: Json | null } {
  const nodes = asObject(pr.commits)?.nodes;
  const commit = asObject(
    asObject(Array.isArray(nodes) ? nodes[0] : null)?.commit,
  );
  return {
    oid: str(commit, "oid"),
    rollup: asObject(asObject(commit?.statusCheckRollup)?.contexts),
  };
}

/** Takes one page of contexts; the cursor of the next page, or null at the end. */
function takePage(
  into: Context[],
  rollup: Json | null,
): { cursor: string | null; bad: boolean } {
  const nodes = rollup?.nodes;
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const object = asObject(node);
    const context = object ? decodeContext(object) : null;
    if (context) into.push(context);
  }
  const info = asObject(rollup?.pageInfo);
  if (info?.hasNextPage !== true) return { cursor: null, bad: false };
  const cursor = str(info, "endCursor");
  return { cursor, bad: cursor === null };
}

function decodeFirstPage(url: string, pr: Json): Pending | PullRequestLookup {
  const { oid, rollup } = commitOf(pr);
  const contexts: Context[] = [];
  const page = takePage(contexts, rollup);
  if (page.bad)
    return failure(
      url,
      "unavailable",
      "GitHub returned an invalid checks cursor.",
    );
  const read = {
    number: num(pr, "number") ?? 0,
    title: (str(pr, "title") ?? "").slice(0, TITLE_MAX),
    body: (str(pr, "body") ?? "").slice(0, BODY_MAX),
    state: str(pr, "state") as PullRequestRead["state"],
    isDraft: pr.isDraft === true,
    baseRefName: str(pr, "baseRefName") ?? "",
    headRefName: str(pr, "headRefName") ?? "",
    headRefOid: str(pr, "headRefOid") ?? "",
    additions: num(pr, "additions") ?? 0,
    deletions: num(pr, "deletions") ?? 0,
    changedFiles: num(pr, "changedFiles") ?? 0,
    mergedAt: dateTime(pr, "mergedAt"),
    closedAt: dateTime(pr, "closedAt"),
    mergeStateStatus: str(pr, "mergeStateStatus"),
    mergeable: str(pr, "mergeable"),
    reviewDecision: str(pr, "reviewDecision"),
  };
  return {
    url,
    alias: "",
    read,
    oid: oid ?? read.headRefOid,
    contexts,
    cursor: page.cursor,
  };
}

/**
 * Reads up to a batch of pull requests on one hostname, one lookup per URL in
 * the order given. `run` is the only way out of the process.
 */
export async function readPullRequests(
  run: GhRunner,
  request: { hostname: string; urls: readonly string[] },
  signal?: AbortSignal,
): Promise<PullRequestLookup[]> {
  const { hostname } = request;
  const urls = [...new Set(request.urls)].slice(0, PULL_REQUEST_BATCH_SIZE);
  const results = new Map<string, PullRequestLookup>();
  const failAll = (
    kind: PullRequestFailure,
    message: string,
    retry: number | null,
  ) => {
    for (const url of urls)
      if (!results.has(url))
        results.set(url, failure(url, kind, message, retry));
  };

  if (hostname !== "github.com") {
    // gh sends no credentials to a host it has no login for, but asking
    // first gives a clear answer and never contacts a host it cannot sign in to.
    try {
      const status = await run(
        ["auth", "status", "--hostname", hostname],
        "",
        signal,
      );
      if (status.code !== 0) {
        failAll("auth", describe("auth", hostname, ""), null);
        return urls.map((url) => results.get(url)!);
      }
    } catch (error) {
      if (error instanceof GhMissingError)
        failAll("gh_missing", error.message, null);
      else
        failAll(
          "unavailable",
          error instanceof Error ? error.message : "gh failed.",
          null,
        );
      return urls.map((url) => results.get(url)!);
    }
  }

  const first = await query(
    run,
    hostname,
    urls.map((url, index) => ({ alias: `p${index}`, url, cursor: null })),
    signal,
  );
  if ("failed" in first) {
    failAll(first.failed.kind, first.failed.message, first.failed.retryAfterMs);
    return urls.map((url) => results.get(url)!);
  }

  const pending: Pending[] = [];
  urls.forEach((url, index) => {
    const alias = `p${index}`;
    const pr = asObject(first.data?.[alias]);
    const own = errorsOf(first.errors, alias, pr !== null);
    if (own.length > 0)
      return void results.set(url, errorFailure(url, hostname, own));
    if (!pr || pr.number === undefined)
      return void results.set(
        url,
        failure(url, "not_found", "GitHub has no pull request at this URL."),
      );
    if (!["OPEN", "CLOSED", "MERGED"].includes(str(pr, "state") ?? ""))
      return void results.set(
        url,
        failure(
          url,
          "unavailable",
          "GitHub returned an unrecognized pull request.",
        ),
      );
    const decoded = decodeFirstPage(url, pr);
    if ("outcome" in decoded) return void results.set(url, decoded);
    pending.push({ ...decoded, alias });
  });

  // Follow every cursor: a short list would read as passing.
  for (let pageNo = 1; ; pageNo += 1) {
    const more = pending.filter(
      (p) => p.cursor !== null && !results.has(p.url),
    );
    if (more.length === 0) break;
    if (pageNo >= MAX_CONTEXT_PAGES) {
      for (const p of more)
        results.set(
          p.url,
          failure(
            p.url,
            "unavailable",
            `More than ${PULL_REQUEST_MAX_CHECKS} checks; not read.`,
          ),
        );
      break;
    }
    const page = await query(
      run,
      hostname,
      more.map((p, index) => ({
        alias: `n${index}`,
        url: p.url,
        cursor: p.cursor,
      })),
      signal,
    );
    if ("failed" in page) {
      for (const p of more)
        results.set(
          p.url,
          failure(
            p.url,
            page.failed.kind,
            page.failed.message,
            page.failed.retryAfterMs,
          ),
        );
      break;
    }
    more.forEach((p, index) => {
      const alias = `n${index}`;
      const pr = asObject(page.data?.[alias]);
      const own = errorsOf(page.errors, alias, pr !== null);
      if (own.length > 0 || pr === null)
        return void results.set(p.url, errorFailure(p.url, hostname, own));
      const { oid, rollup } = commitOf(pr);
      if (oid !== p.oid)
        return void results.set(
          p.url,
          failure(
            p.url,
            "unavailable",
            "The pull request's head changed while its checks were read.",
          ),
        );
      const next = takePage(p.contexts, rollup);
      if (next.bad || (next.cursor !== null && next.cursor === p.cursor))
        return void results.set(
          p.url,
          failure(
            p.url,
            "unavailable",
            "GitHub returned an invalid checks cursor.",
          ),
        );
      p.cursor = next.cursor;
      if (p.contexts.length > PULL_REQUEST_MAX_CHECKS)
        results.set(
          p.url,
          failure(
            p.url,
            "unavailable",
            `More than ${PULL_REQUEST_MAX_CHECKS} checks; not read.`,
          ),
        );
    });
  }

  for (const p of pending) {
    if (results.has(p.url)) continue;
    const parsed = pullRequestReadSchema.safeParse({
      ...p.read,
      checks: currentChecks(p.contexts),
    });
    results.set(
      p.url,
      parsed.success
        ? { outcome: "found", url: p.url, pullRequest: parsed.data }
        : failure(
            p.url,
            "unavailable",
            "GitHub returned an invalid pull request.",
          ),
    );
  }
  return urls.map((url) => results.get(url)!);
}
