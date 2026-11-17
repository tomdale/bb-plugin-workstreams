/**
 * `bb workstreams pr …`: agents link a pull request to the workstream of the
 * thread they run in, list what is tracked, and stop tracking. Nothing here
 * writes to GitHub. Output is bounded: lists are capped, titles clipped, and
 * a pull request's checks are summarized rather than listed.
 */
import {
  PluginCliError,
  cliCommand,
  type PluginCliCommand,
} from "@get-bb/plugin-sdk";
import {
  parsePullRequestUrl,
  type TrackedPullRequest,
} from "../../domain/pullRequests.ts";
import { plainText } from "./plainText.ts";
import { PullRequestError, type PullRequestTracker } from "./tracker.ts";

const LIST_DEFAULT = 30;
const LIST_MAX = 100;
const FAILING_SHOWN = 10;
const TITLE_MAX = 80;

const line = (text: string, max = TITLE_MAX) => {
  const clean = plainText(text);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
};

export type PullRequestCommandDeps = {
  tracker: PullRequestTracker;
  /**
   * Where a thread's pull requests belong: its workstream and the machine its
   * environment runs on. Throws a `PullRequestError` that says what is missing.
   */
  link(threadId: string): Promise<{
    workstreamId: string;
    hostId: string;
  }>;
  /** A thread's workstream, or null. */
  workstreamOf(threadId: string): string | null;
  /** A workstream named by ID, name, or alias. */
  resolveWorkstream(arg: string): string;
  /** A workstream's path, for people. */
  label(workstreamId: string): string;
};

/** One tracked pull request for a script: no body, checks counted. */
function summary(item: TrackedPullRequest, label: string) {
  const count = (state: string) =>
    item.checks.filter((c) => c.state === state).length;
  return {
    id: item.id,
    url: item.url,
    repository: item.repository,
    number: item.number,
    title: line(item.title, 200),
    status: item.status,
    reason: plainText(item.reason),
    workstreamId: item.workstreamId,
    workstream: label,
    threadId: item.threadId,
    hostId: item.hostId,
    headRefName: item.headRefName,
    baseRefName: item.baseRefName,
    additions: item.additions,
    deletions: item.deletions,
    changedFiles: item.changedFiles,
    checks: {
      total: item.checks.length,
      passed: count("passed"),
      failed: count("failed"),
      running: count("running"),
      unknown: count("unknown"),
    },
    failingChecks: item.checks
      .filter((c) => c.state === "failed")
      .slice(0, FAILING_SHOWN)
      .map((c) => ({ name: line(c.name, 120), url: c.url })),
    lastSuccessAt: new Date(item.lastSuccessAt).toISOString(),
    error: item.error,
    expiresAt:
      item.expiresAt === null ? null : new Date(item.expiresAt).toISOString(),
    mergedAt: item.mergedAt,
    closedAt: item.closedAt,
  };
}

const describeRow = (item: TrackedPullRequest) =>
  `${item.repository}#${item.number} "${line(item.title)}" is ${item.status} (${plainText(item.reason)})`;

/** Turns a failure the tracker names into the CLI's own error. */
async function cliFailure<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof PullRequestError)
      throw new PluginCliError(plainText(error.message), {
        code: error.code,
        ...(error.hint ? { hint: plainText(error.hint) } : {}),
      });
    throw error;
  }
}

const threadArg = (arg: string | undefined, ctxThread: string | undefined) => {
  const id = (arg ?? ctxThread)?.replace(/^@thread:/, "").trim();
  if (!id)
    throw new PluginCliError("No thread to link the pull request to.", {
      code: "no_thread",
      hint: "Run this inside a BB thread, or pass --thread <thread id>.",
    });
  return id;
};

export function pullRequestCommands(
  deps: PullRequestCommandDeps,
): Record<string, PluginCliCommand> {
  const { tracker } = deps;
  // A workstream's name is text a person or a model wrote; print it as plain text.
  const labelOf = (workstreamId: string) => plainText(deps.label(workstreamId));
  return {
    "pr track": cliCommand({
      summary:
        "Track a GitHub pull request in this thread's workstream. Read-only: nothing is written to GitHub",
      description:
        "Reads the pull request with the gh login on this thread's machine, shows it in the workstream's list with live checks and status, and keeps it current until it merges or closes. Tracking a pull request the workstream already tracks keeps one row and records this thread and machine.",
      positionals: [
        {
          name: "url",
          description:
            "Full pull request URL, https://<host>/<owner>/<repo>/pull/<number>",
          required: true,
        },
      ],
      options: {
        thread: {
          type: "string",
          description:
            "Thread whose workstream and machine to use; defaults to the thread running this command",
        },
        json: { type: "boolean", description: "Print JSON" },
      },
      async run({ positionals, options }, ctx) {
        const parsed = parsePullRequestUrl(positionals.url);
        if (!parsed.ok)
          throw new PluginCliError(parsed.message, { code: "invalid_url" });
        const threadId = threadArg(options.thread, ctx.threadId);
        const result = await cliFailure(
          (async () => {
            const link = await deps.link(threadId);
            return tracker.track({
              target: parsed.target,
              threadId,
              ...link,
            });
          })(),
        );
        if (result.outcome === "expired") {
          const text = `${result.repository}#${result.number} ended at ${result.endedAt}, over an hour ago, so it is not tracked.`;
          return {
            exitCode: 0,
            stdout: options.json
              ? JSON.stringify(
                  {
                    outcome: "expired",
                    repository: result.repository,
                    number: result.number,
                    endedAt: result.endedAt,
                    message: text,
                  },
                  null,
                  2,
                )
              : text,
          };
        }
        const label = labelOf(result.item.workstreamId);
        if (options.json)
          return {
            exitCode: 0,
            stdout: JSON.stringify(
              {
                outcome: result.outcome,
                pullRequest: summary(result.item, label),
              },
              null,
              2,
            ),
          };
        const verb = {
          tracked: "Tracking",
          updated: "Already tracked; updated its thread and machine for",
          unchanged: "Already tracked:",
        }[result.outcome];
        return {
          exitCode: 0,
          stdout: `${verb} ${describeRow(result.item)} in ${label}.`,
        };
      },
    }),
    "pr list": cliCommand({
      summary: "List tracked pull requests, ready first",
      options: {
        workstream: {
          type: "string",
          description: "Only this workstream (ID, name, or alias)",
        },
        thread: {
          type: "string",
          description: "Only the workstream this thread is in",
        },
        limit: {
          type: "integer",
          min: 1,
          max: LIST_MAX,
          default: LIST_DEFAULT,
          description: `Most to show (1-${LIST_MAX}, default ${LIST_DEFAULT})`,
        },
        json: { type: "boolean", description: "Print JSON" },
      },
      async run({ options }) {
        let workstreamId: string | null = null;
        if (options.workstream)
          workstreamId = deps.resolveWorkstream(options.workstream);
        else if (options.thread) {
          const id = threadArg(options.thread, undefined);
          workstreamId = deps.workstreamOf(id);
          if (!workstreamId)
            throw new PluginCliError(
              `@thread:${id} is not in a workstream yet.`,
              { code: "no_workstream" },
            );
        }
        const all = tracker
          .list()
          .filter(
            (i) => workstreamId === null || i.workstreamId === workstreamId,
          );
        const shown = all.slice(0, options.limit);
        const rows = shown.map((i) => summary(i, labelOf(i.workstreamId)));
        if (options.json)
          return {
            exitCode: 0,
            stdout: JSON.stringify(
              {
                total: all.length,
                shown: rows.length,
                truncated: all.length > rows.length,
                pullRequests: rows,
              },
              null,
              2,
            ),
          };
        if (all.length === 0)
          return { exitCode: 0, stdout: "No tracked pull requests." };
        const lines = rows.map(
          (r) =>
            `${r.status.padEnd(8)} ${r.repository}#${r.number}  ${line(r.title)}  [${r.workstream}]  ${r.reason}${r.error ? `  (stale: ${line(r.error, 100)})` : ""}`,
        );
        if (all.length > rows.length)
          lines.push(
            `…and ${all.length - rows.length} more. Raise --limit (up to ${LIST_MAX}) or filter with --workstream.`,
          );
        return { exitCode: 0, stdout: lines.join("\n") };
      },
    }),
    "pr untrack": cliCommand({
      summary:
        "Stop tracking a pull request. Read-only: nothing is changed on GitHub",
      positionals: [
        {
          name: "target",
          description: "The pull request URL, or a tracked row's ID",
          required: true,
        },
      ],
      options: {
        workstream: {
          type: "string",
          description:
            "The workstream to stop tracking it in (ID, name, or alias)",
        },
        thread: {
          type: "string",
          description:
            "Use this thread's workstream when several track the URL; defaults to the thread running this command",
        },
        json: { type: "boolean", description: "Print JSON" },
      },
      run({ positionals, options }, ctx) {
        let rows: TrackedPullRequest[];
        if (positionals.target.startsWith("pr_")) {
          const row = tracker.get(positionals.target);
          rows = row ? [row] : [];
        } else {
          const parsed = parsePullRequestUrl(positionals.target);
          if (!parsed.ok)
            throw new PluginCliError(parsed.message, { code: "invalid_url" });
          rows = tracker.forUrl(parsed.target.url);
        }
        if (options.workstream) {
          const id = deps.resolveWorkstream(options.workstream);
          rows = rows.filter((r) => r.workstreamId === id);
        }
        if (rows.length > 1) {
          const threadId = (options.thread ?? ctx.threadId)?.replace(
            /^@thread:/,
            "",
          );
          const home = threadId ? deps.workstreamOf(threadId) : null;
          const own = rows.filter((r) => r.workstreamId === home);
          if (own.length === 1) rows = own;
        }
        if (rows.length > 1)
          throw new PluginCliError(
            `${rows.length} workstreams track this pull request: ${rows
              .map((r) => labelOf(r.workstreamId))
              .join("; ")}.`,
            {
              code: "ambiguous",
              hint: "Pass --workstream <name> to choose one.",
            },
          );
        const row = rows[0];
        if (!row)
          return {
            exitCode: 0,
            stdout: options.json
              ? JSON.stringify({ removed: false }, null, 2)
              : "That pull request is not tracked.",
          };
        tracker.untrack(row.id);
        const label = labelOf(row.workstreamId);
        return {
          exitCode: 0,
          stdout: options.json
            ? JSON.stringify(
                { removed: true, pullRequest: summary(row, label) },
                null,
                2,
              )
            : `Stopped tracking ${row.repository}#${row.number} in ${label}.`,
        };
      },
    }),
  };
}
