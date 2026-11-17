import { describe, expect, it } from "vitest";
import {
  GhMissingError,
  buildQuery,
  readPullRequests,
  type GhResult,
  type GhRunner,
} from "../../src/server/pullRequests/github.ts";
import { readPullRequestsOnHost } from "../../src/server/pullRequests/host.ts";
import type { PullRequestLookup } from "../../src/domain/pullRequests.ts";

type Node = Record<string, unknown>;
type FakePr = {
  oid?: string;
  state?: string;
  mergeStateStatus?: string;
  nodes: Node[];
  /** Changes the head commit after this many reads of its checks. */
  headChangesAfter?: number;
};

const url = (n: number) => `https://github.com/acme/shelves/pull/${n}`;
const run = (
  name: string,
  conclusion: string | null,
  extra: Record<string, unknown> = {},
): Node => ({
  __typename: "CheckRun",
  id: `run-${name}`,
  name,
  status: conclusion === null ? "IN_PROGRESS" : "COMPLETED",
  conclusion,
  detailsUrl: `https://ci.example.test/${name}`,
  startedAt: "2026-03-01T10:00:00Z",
  completedAt: conclusion === null ? null : "2026-03-01T10:05:00Z",
  checkSuite: { workflowRun: null },
  ...extra,
});
const workflowRun = (
  name: string,
  runNumber: number,
  conclusion: string | null,
  workflow = 1,
): Node =>
  run(name, conclusion, {
    id: `run-${name}-${runNumber}`,
    checkSuite: {
      workflowRun: {
        runNumber,
        event: "push",
        workflow: { databaseId: workflow },
      },
    },
  });
const status = (context: string, state: string): Node => ({
  __typename: "StatusContext",
  id: `status-${context}`,
  context,
  state,
  targetUrl: null,
  createdAt: "2026-03-01T10:00:00Z",
});

/**
 * A GitHub that serves the fake pull requests keyed by URL, a hundred checks a
 * page, and records every document it was sent.
 */
function github(prs: Record<string, FakePr | "missing" | "forbidden">) {
  const documents: string[] = [];
  const reads = new Map<string, number>();
  const runner: GhRunner = async (_args, stdin) => {
    const query = (JSON.parse(stdin) as { query: string }).query;
    documents.push(query);
    const data: Record<string, unknown> = {};
    const errors: Node[] = [];
    for (const [, alias, target, rest] of query.matchAll(
      /(\w+): resource\(url: "([^"]+)"\) \{ \.\.\. on PullRequest \{ (.*)\} \}/g,
    )) {
      const pr = prs[target!];
      if (pr === "missing" || pr === undefined) {
        data[alias!] = null;
        errors.push({
          type: "NOT_FOUND",
          path: [alias],
          message: "Could not resolve",
        });
        continue;
      }
      if (pr === "forbidden") {
        data[alias!] = null;
        errors.push({
          type: "FORBIDDEN",
          path: [alias],
          message: "Resource not accessible",
        });
        continue;
      }
      const cursor = /after: "(\d+)"/.exec(rest!)?.[1];
      const start = cursor ? Number(cursor) : 0;
      const seen = reads.get(target!) ?? 0;
      reads.set(target!, seen + 1);
      const oid =
        pr.headChangesAfter !== undefined && seen >= pr.headChangesAfter
          ? "ffff"
          : (pr.oid ?? "head1");
      const end = Math.min(start + 100, pr.nodes.length);
      data[alias!] = {
        ...(cursor
          ? { headRefOid: oid }
          : {
              number: Number(target!.split("/").pop()),
              title: "Shelf labels",
              body: "Body",
              state: pr.state ?? "OPEN",
              isDraft: false,
              baseRefName: "main",
              headRefName: "labels",
              headRefOid: oid,
              additions: 3,
              deletions: 1,
              changedFiles: 2,
              mergedAt: null,
              closedAt: null,
              mergeStateStatus: pr.mergeStateStatus ?? "CLEAN",
              mergeable: "MERGEABLE",
              reviewDecision: null,
            }),
        commits: {
          nodes: [
            {
              commit: {
                oid,
                statusCheckRollup: {
                  contexts: {
                    nodes: pr.nodes.slice(start, end),
                    pageInfo: {
                      hasNextPage: end < pr.nodes.length,
                      endCursor: String(end),
                    },
                  },
                },
              },
            },
          ],
        },
      };
    }
    const body = JSON.stringify({ data, ...(errors.length ? { errors } : {}) });
    // gh exits non-zero when GraphQL returned errors, with the data on stdout.
    return { code: errors.length ? 1 : 0, stdout: body, stderr: "" };
  };
  return { runner, documents };
}

const found = (lookup: PullRequestLookup | undefined) => {
  if (lookup?.outcome !== "found")
    throw new Error(`not found: ${JSON.stringify(lookup)}`);
  return lookup.pullRequest;
};

describe("reading pull requests", () => {
  it("follows every page of checks instead of stopping at a hundred", async () => {
    const nodes = Array.from({ length: 250 }, (_, i) =>
      run(`job-${i}`, "SUCCESS"),
    );
    const { runner, documents } = github({ [url(1)]: { nodes } });
    const [lookup] = await readPullRequests(runner, {
      hostname: "github.com",
      urls: [url(1)],
    });
    const pr = found(lookup);
    expect(pr.checks).toHaveLength(250);
    expect(new Set(pr.checks.map((c) => c.name)).size).toBe(250);
    expect(documents).toHaveLength(3);
    expect(documents[1]).toContain('after: "100"');
    expect(documents[2]).toContain('after: "200"');
    // Later pages ask only for checks.
    expect(documents[1]).not.toContain("body");
  });

  it("reads a pull request with no checks", async () => {
    const { runner } = github({ [url(1)]: { nodes: [] } });
    const [lookup] = await readPullRequests(runner, {
      hostname: "github.com",
      urls: [url(1)],
    });
    expect(found(lookup).checks).toEqual([]);
  });

  it("fails rather than report a short list when the head moves mid-read", async () => {
    const nodes = Array.from({ length: 150 }, (_, i) =>
      run(`job-${i}`, "SUCCESS"),
    );
    const { runner } = github({ [url(1)]: { nodes, headChangesAfter: 1 } });
    const [lookup] = await readPullRequests(runner, {
      hostname: "github.com",
      urls: [url(1)],
    });
    expect(lookup).toMatchObject({ outcome: "failed", failure: "unavailable" });
    expect((lookup as { message: string }).message).toMatch(/head changed/);
  });

  it("fails on a checks cursor that does not advance", async () => {
    const runner: GhRunner = async () => ({
      code: 0,
      stderr: "",
      stdout: JSON.stringify({
        data: {
          p0: {
            number: 1,
            title: "t",
            body: "",
            state: "OPEN",
            isDraft: false,
            baseRefName: "main",
            headRefName: "x",
            headRefOid: "a",
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            mergedAt: null,
            closedAt: null,
            mergeStateStatus: "CLEAN",
            mergeable: "MERGEABLE",
            reviewDecision: null,
            commits: {
              nodes: [
                {
                  commit: {
                    oid: "a",
                    statusCheckRollup: {
                      contexts: {
                        nodes: [],
                        pageInfo: { hasNextPage: true, endCursor: null },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    });
    const [lookup] = await readPullRequests(runner, {
      hostname: "github.com",
      urls: [url(1)],
    });
    expect(lookup).toMatchObject({ outcome: "failed", failure: "unavailable" });
  });

  it("strips terminal control sequences and bidi marks from check names", async () => {
    const { runner } = github({
      [url(1)]: {
        nodes: [
          run("\u001b]0;pwned\u0007\u001b[31mlint\u202e\n\tfix", "FAILURE"),
          status("ci\u200b/\u0007deploy", "FAILURE"),
        ],
      },
    });
    const [lookup] = await readPullRequests(runner, {
      hostname: "github.com",
      urls: [url(1)],
    });
    const names = found(lookup).checks.map((c) => c.name);
    expect(names).toEqual(["lint fix", "ci / deploy"]);
  });

  it("classifies a document-wide error on a later page as the cause it names", async () => {
    const nodes = Array.from({ length: 150 }, (_, i) =>
      run(`job-${i}`, "SUCCESS"),
    );
    const { runner } = github({ [url(1)]: { nodes } });
    const limited: GhRunner = async (args, stdin) =>
      stdin.includes("after:")
        ? {
            code: 1,
            stderr: "",
            stdout: JSON.stringify({
              data: null,
              errors: [
                { type: "RATE_LIMITED", message: "API rate limit exceeded" },
              ],
            }),
          }
        : runner(args, stdin);
    const [lookup] = await readPullRequests(limited, {
      hostname: "github.com",
      urls: [url(1)],
    });
    expect(lookup).toMatchObject({
      outcome: "failed",
      failure: "rate_limit",
      retryAfterMs: 60_000,
    });
  });

  it("reads check runs and status contexts, and keeps only the newest workflow run", async () => {
    const nodes = [
      workflowRun("build", 1, "FAILURE"),
      workflowRun("build", 2, "SUCCESS"),
      workflowRun("test", 2, null),
      workflowRun("other", 5, "SUCCESS", 2),
      status("deploy/preview", "PENDING"),
      status("legacy/ci", "ERROR"),
      run("lint", "NEUTRAL"),
      run("flaky", "CANCELLED"),
      run("odd", "STALE"),
    ];
    const { runner } = github({ [url(1)]: { nodes } });
    const [lookup] = await readPullRequests(runner, {
      hostname: "github.com",
      urls: [url(1)],
    });
    const states = Object.fromEntries(
      found(lookup).checks.map((c) => [c.name, c.state]),
    );
    expect(states).toEqual({
      build: "passed",
      test: "running",
      other: "passed",
      "deploy/preview": "running",
      "legacy/ci": "failed",
      lint: "passed",
      flaky: "failed",
      odd: "unknown",
    });
    expect(found(lookup).checks.filter((c) => c.name === "build")).toHaveLength(
      1,
    );
  });

  it("keeps the newest of a repeated check that belongs to no workflow", async () => {
    const older = run("scan", "FAILURE", {
      id: "a",
      startedAt: "2026-03-01T09:00:00Z",
    });
    const newer = run("scan", "SUCCESS", {
      id: "b",
      startedAt: "2026-03-01T10:00:00Z",
    });
    const { runner } = github({ [url(1)]: { nodes: [newer, older] } });
    const [lookup] = await readPullRequests(runner, {
      hostname: "github.com",
      urls: [url(1)],
    });
    expect(found(lookup).checks).toMatchObject([{ id: "b", state: "passed" }]);
  });

  it("keeps one pull request's failure from touching the others in its document", async () => {
    const { runner, documents } = github({
      [url(1)]: { nodes: [run("a", "SUCCESS")] },
      [url(2)]: "missing",
      [url(3)]: "forbidden",
      [url(4)]: { nodes: [run("b", "FAILURE")], state: "MERGED" },
    });
    const lookups = await readPullRequests(runner, {
      hostname: "github.com",
      urls: [url(1), url(2), url(3), url(4)],
    });
    expect(documents).toHaveLength(1);
    expect(lookups.map((l) => l.outcome)).toEqual([
      "found",
      "failed",
      "failed",
      "found",
    ]);
    expect(lookups[1]).toMatchObject({ failure: "not_found" });
    expect(lookups[2]).toMatchObject({ failure: "auth" });
    expect(found(lookups[3]).state).toBe("MERGED");
    expect(lookups.map((l) => l.url)).toEqual([url(1), url(2), url(3), url(4)]);
  });

  it("treats a URL that is not a pull request as not found, not as closed", async () => {
    const runner: GhRunner = async () => ({
      code: 0,
      stderr: "",
      stdout: JSON.stringify({ data: { p0: {} } }),
    });
    const [lookup] = await readPullRequests(runner, {
      hostname: "github.com",
      urls: [url(1)],
    });
    expect(lookup).toMatchObject({ outcome: "failed", failure: "not_found" });
  });

  it("puts a whole batch in one read-only document", () => {
    const urls = Array.from({ length: 25 }, (_, i) => url(i + 1));
    const query = buildQuery(
      urls.map((u, i) => ({ alias: `p${i}`, url: u, cursor: null })),
    );
    expect(query.match(/resource\(url:/g)).toHaveLength(25);
    expect(query).not.toMatch(/mutation/i);
  });

  it("sends fixed arguments, with the query on stdin and the hostname as its own argument", async () => {
    const seen: { args: readonly string[]; stdin: string }[] = [];
    const runner: GhRunner = async (args, stdin) => {
      seen.push({ args, stdin });
      return {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({ data: { p0: null } }),
      };
    };
    await readPullRequests(runner, { hostname: "github.com", urls: [url(1)] });
    expect(seen[0]!.args).toEqual([
      "api",
      "graphql",
      "--hostname",
      "github.com",
      "--method",
      "POST",
      "--input",
      "-",
    ]);
    expect(seen[0]!.stdin).toContain(url(1));
  });
});

describe("failures", () => {
  const read = (runner: GhRunner, hostname = "github.com") =>
    readPullRequests(runner, { hostname, urls: [url(1)] });
  const result =
    (code: number, stderr: string, stdout = ""): GhRunner =>
    async () =>
      ({ code, stderr, stdout }) satisfies GhResult;

  it("names a missing gh", async () => {
    const [lookup] = await read(async () => {
      throw new GhMissingError();
    });
    expect(lookup).toMatchObject({ outcome: "failed", failure: "gh_missing" });
  });

  it("names a missing login, with the command that fixes it", async () => {
    const [lookup] = await read(
      result(4, "To get started with GitHub CLI, please run:  gh auth login"),
    );
    expect(lookup).toMatchObject({ outcome: "failed", failure: "auth" });
    expect((lookup as { message: string }).message).toContain("gh auth login");
  });

  it("waits out a rate limit", async () => {
    const [lookup] = await read(result(1, "API rate limit exceeded for user"));
    expect(lookup).toMatchObject({
      failure: "rate_limit",
      retryAfterMs: 60_000,
    });
  });

  it("calls anything else unavailable, never a closed pull request", async () => {
    for (const runner of [
      result(1, "dial tcp: lookup api.github.com: no such host"),
      async () => {
        throw new Error("gh timed out.");
      },
      result(0, "", "<html>bad gateway</html>"),
    ]) {
      const [lookup] = await read(runner);
      expect(lookup).toMatchObject({
        outcome: "failed",
        failure: "unavailable",
      });
    }
  });

  it("prints a failure's text without terminal control sequences", async () => {
    const [lookup] = await read(
      result(1, "dial tcp: \u001b[2Jno\u001b]0;x\u0007 such\u202e host"),
    );
    expect((lookup as { message: string }).message).toBe(
      "dial tcp: no such host",
    );
  });

  it("trims a long message", async () => {
    const [lookup] = await read(result(1, "x".repeat(5000)));
    expect((lookup as { message: string }).message.length).toBeLessThanOrEqual(
      300,
    );
  });

  it("checks gh's login for an enterprise host before reading it, and for no other", async () => {
    const calls: string[][] = [];
    const runner: GhRunner = async (args) => {
      calls.push([...args]);
      return args[0] === "auth"
        ? { code: 1, stderr: "not logged in", stdout: "" }
        : { code: 0, stderr: "", stdout: "{}" };
    };
    const [lookup] = await read(runner, "git.example.test");
    expect(lookup).toMatchObject({ failure: "auth" });
    expect(calls).toEqual([
      ["auth", "status", "--hostname", "git.example.test"],
    ]);

    const plain: string[][] = [];
    await read(async (args) => {
      plain.push([...args]);
      return {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({ data: { p0: null } }),
      };
    });
    expect(plain.every((args) => args[0] === "api")).toBe(true);
  });
});

describe("the machine's entry", () => {
  it("refuses a URL that is not a pull request on the hostname, without running gh", async () => {
    const calls: unknown[] = [];
    const runner: GhRunner = async (...args) => {
      calls.push(args);
      return {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({ data: { p0: null } }),
      };
    };
    const bad = [
      "https://github.com/acme/shelves/pull/1/files",
      'https://github.com/acme/shelves/pull/1"){x}',
      "https://elsewhere.example.test/acme/shelves/pull/1",
      "file:///etc/passwd",
    ];
    const lookups = await readPullRequestsOnHost(
      { hostname: "github.com", urls: [...bad, url(1)] },
      undefined,
      runner,
    );
    expect(lookups.map((l) => l.url)).toEqual([...bad, url(1)]);
    expect(lookups.slice(0, 4).every((l) => l.outcome === "failed")).toBe(true);
    // Only the one valid URL reached gh.
    expect(calls).toHaveLength(1);
    expect((calls[0] as [string[], string])[1]).not.toContain("passwd");
  });
});

describe("running gh", () => {
  /** Puts a fake `gh` first on PATH for one test; nothing here touches the network. */
  async function withFakeGh(
    script: string,
    body: (dir: string) => Promise<void>,
  ) {
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } =
      await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "fake-gh-"));
    const before = process.env.PATH;
    try {
      writeFileSync(join(dir, "gh"), `#!/bin/sh\n${script}`);
      chmodSync(join(dir, "gh"), 0o755);
      process.env.PATH = `${dir}:${before ?? ""}`;
      await body(dir);
    } finally {
      process.env.PATH = before;
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const slowGh = `touch "$(dirname "$0")/started"\nexec sleep 30\n`;

  it("starts gh with the arguments as given, no shell, and the query on stdin", async () => {
    const { runGh } = await import("../../src/server/pullRequests/github.ts");
    await withFakeGh(
      `printf '%s\\n' "$@"\nprintf 'stdin:'\ncat\n`,
      async () => {
        const result = await runGh(
          ["api", "$(touch pwned)", "a b; c"],
          "query body",
        );
        expect(result.code).toBe(0);
        expect(result.stdout).toBe(
          "api\n$(touch pwned)\na b; c\nstdin:query body",
        );
      },
    );
  });

  it("keeps BB's own variables from gh and passes the rest, including the login", async () => {
    const { runGh } = await import("../../src/server/pullRequests/github.ts");
    const saved = { ...process.env };
    process.env.BB_THREAD_ID = "thr_secret";
    process.env.BB_SERVER_TOKEN = "bb-secret-value";
    process.env.GH_TOKEN = "gh-login-value";
    try {
      await withFakeGh(`env\n`, async () => {
        const { stdout } = await runGh(["api"], "");
        // Asserted on names and booleans so a failure never prints the environment.
        const lines = stdout.split("\n");
        const names = lines.map((l) => l.split("=")[0]!);
        expect(names.filter((n) => n.startsWith("BB_"))).toEqual([]);
        expect(stdout.includes("bb-secret-value")).toBe(false);
        expect(lines.includes("GH_TOKEN=gh-login-value")).toBe(true);
        expect(lines.includes("GH_PROMPT_DISABLED=1")).toBe(true);
        expect(lines.some((l) => /^PATH=.*fake-gh-/.test(l))).toBe(true);
      });
    } finally {
      for (const key of Object.keys(process.env))
        if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  it("does not start gh when the signal is already aborted", async () => {
    const { runGh } = await import("../../src/server/pullRequests/github.ts");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    await withFakeGh(slowGh, async (dir) => {
      const began = Date.now();
      await expect(
        runGh(["api"], "", AbortSignal.abort(new Error("stop"))),
      ).rejects.toThrow("The read was canceled.");
      expect(Date.now() - began).toBeLessThan(2000);
      expect(existsSync(join(dir, "started"))).toBe(false);
    });
  });

  it("kills a running gh when the signal aborts", async () => {
    const { runGh } = await import("../../src/server/pullRequests/github.ts");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    await withFakeGh(slowGh, async (dir) => {
      const controller = new AbortController();
      const running = runGh(["api"], "", controller.signal);
      const began = Date.now();
      while (!existsSync(join(dir, "started")) && Date.now() - began < 5000)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(existsSync(join(dir, "started"))).toBe(true);
      const aborted = Date.now();
      controller.abort();
      await expect(running).rejects.toThrow("The read was canceled.");
      expect(Date.now() - aborted).toBeLessThan(2000);
    });
  });
});
