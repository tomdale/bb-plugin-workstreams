import { afterEach, describe, expect, it } from "vitest";
import { fakeWorld } from "./fake-bb.ts";
import { openDatabase } from "../../src/server/db.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import type {
  PullRequestFailure,
  PullRequestRead,
} from "../../src/domain/pullRequests.ts";

type World = Awaited<ReturnType<typeof fakeWorld>>;
let world: World | null = null;
afterEach(async () => {
  await world?.harness.lifecycle.dispose();
  world = null;
});

const url = (n: number) => `https://github.com/acme/shelves/pull/${n}`;
const read = (overrides: Partial<PullRequestRead> = {}): PullRequestRead => ({
  number: 1,
  title: "Add shelf labels",
  body: "A long body that scripts do not need.",
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: "labels",
  headRefOid: "aaa",
  additions: 4,
  deletions: 1,
  changedFiles: 2,
  mergedAt: null,
  closedAt: null,
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  reviewDecision: null,
  checks: [
    {
      id: "c1",
      name: "test",
      state: "passed",
      url: null,
      startedAt: null,
      completedAt: null,
    },
  ],
  ...overrides,
});

type Answer = PullRequestRead | { fail: PullRequestFailure; message: string };

async function setup() {
  const answers = new Map<string, Answer>();
  world = await fakeWorld({
    readPullRequests: ({ urls }) =>
      urls.map((u) => {
        const answer = answers.get(u);
        return answer && "fail" in answer
          ? {
              outcome: "failed",
              url: u,
              failure: answer.fail,
              message: answer.message,
              retryAfterMs: null,
            }
          : answer
            ? { outcome: "found", url: u, pullRequest: answer }
            : {
                outcome: "failed",
                url: u,
                failure: "not_found",
                message: "GitHub reports no such pull request.",
                retryAfterMs: null,
              };
      }),
  });
  const w = world;
  const store = new WorkstreamStore(openDatabase(w.bb));
  const shelves = store.create("Shelves", "", null, []);
  const racks = store.create("Racks", "", null, []);
  const mine = w.addThread("t_mine", { title: "Shelf labels" });
  const other = w.addThread("t_other", { title: "Rack labels" });
  const homeless = w.addThread("t_homeless", { title: "Unfiled" });
  store.assign(mine.id, shelves.id, { provenance: "manual", evidence: null });
  store.assign(other.id, racks.id, { provenance: "manual", evidence: null });
  const run = (argv: string[], threadId?: string) =>
    w.harness.behavior.runCli(["pr", ...argv], threadId ? { threadId } : {});
  const rows = async () =>
    (
      (await w.harness.behavior.callRpc("trackedPullRequests", {})) as {
        items: {
          id: string;
          workstreamId: string;
          threadId: string;
          hostId: string;
          status: string;
        }[];
      }
    ).items;
  return {
    w,
    store,
    shelves,
    racks,
    answers,
    run,
    rows,
    mine,
    other,
    homeless,
  };
}

describe("bb workstreams pr track", () => {
  it("tracks in the running thread's workstream and captures its machine", async () => {
    const { w, answers, run, rows, shelves } = await setup();
    answers.set(url(1), read());
    w.environmentHosts.set("env_1", "host_7");
    const result = await run(["track", url(1)], "t_mine");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      'Tracking acme/shelves#1 "Add shelf labels" is ready (Ready to merge) in Shelves.',
    );
    expect(await rows()).toMatchObject([
      { workstreamId: shelves.id, threadId: "t_mine", hostId: "host_7" },
    ]);
    expect(w.pullRequestReads).toEqual([
      { hostId: "host_7", hostname: "github.com", urls: [url(1)] },
    ]);
    expect(
      w.harness.inspection.realtimeSignals.some(
        (s) => s.channel === "pull-requests-changed",
      ),
    ).toBe(true);
  });

  it("takes --thread over the running thread, with or without @thread:", async () => {
    const { answers, run, rows, racks } = await setup();
    answers.set(url(1), read());
    expect(
      (await run(["track", url(1), "--thread", "@thread:t_other"], "t_mine"))
        .exitCode,
    ).toBe(0);
    expect(await rows()).toMatchObject([
      { workstreamId: racks.id, threadId: "t_other" },
    ]);
  });

  it("prints JSON without the body and with checks counted", async () => {
    const { answers, run } = await setup();
    answers.set(url(1), read());
    const result = await run(["track", url(1), "--json"], "t_mine");
    const parsed = JSON.parse(result.stdout);
    expect(parsed.outcome).toBe("tracked");
    expect(parsed.pullRequest).toMatchObject({
      repository: "acme/shelves",
      number: 1,
      status: "ready",
      workstream: "Shelves",
      checks: { total: 1, passed: 1, failed: 0, running: 0, unknown: 0 },
    });
    expect(parsed.pullRequest.body).toBeUndefined();
    expect(result.stdout).not.toContain("scripts do not need");
  });

  it("is idempotent for the same workstream and updates the thread and machine on a re-track", async () => {
    const { w, answers, run, rows, store, shelves } = await setup();
    answers.set(url(1), read());
    await run(["track", url(1)], "t_mine");
    const again = await run(["track", url(1)], "t_mine");
    expect(again.stdout).toMatch(/^Already tracked:/);
    expect(await rows()).toHaveLength(1);

    const second = w.addThread("t_second", {
      title: "More labels",
      environmentId: "env_2",
    });
    store.assign(second.id, shelves.id, {
      provenance: "manual",
      evidence: null,
    });
    w.environmentHosts.set("env_2", "host_9");
    const moved = await run(["track", url(1)], "t_second");
    expect(moved.stdout).toMatch(
      /^Already tracked; updated its thread and machine/,
    );
    expect(await rows()).toMatchObject([
      { threadId: "t_second", hostId: "host_9" },
    ]);
  });

  it("links the same URL separately in another workstream", async () => {
    const { answers, run, rows } = await setup();
    answers.set(url(1), read());
    await run(["track", url(1)], "t_mine");
    await run(["track", url(1)], "t_other");
    expect(await rows()).toHaveLength(2);
  });

  it("accepts a tab, query, and fragment on the URL", async () => {
    const { answers, run, rows } = await setup();
    answers.set(url(1), read());
    expect(
      (await run(["track", `${url(1)}/files?w=1#diff`], "t_mine")).exitCode,
    ).toBe(0);
    expect(await rows()).toHaveLength(1);
  });

  it("says a pull request that ended over an hour ago is not tracked", async () => {
    const { answers, run, rows } = await setup();
    const mergedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    answers.set(
      url(1),
      read({ state: "MERGED", mergedAt, closedAt: mergedAt }),
    );
    const result = await run(["track", url(1)], "t_mine");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("over an hour ago, so it is not tracked");
    expect(await rows()).toEqual([]);
  });

  describe("fails clearly", () => {
    const fails = async (argv: string[], threadId?: string) => {
      const s = await setup();
      return { ...s, result: await s.run(argv, threadId) };
    };

    it("without a thread", async () => {
      const { result } = await fails(["track", url(1)]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("No thread to link");
      expect(result.stderr).toContain("--thread");
    });

    it("for a URL that is not a pull request", async () => {
      const { result, rows } = await fails(
        ["track", "https://github.com/acme/shelves/issues/1"],
        "t_mine",
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("pull request URL");
      expect(await rows()).toEqual([]);
    });

    it("for a thread Workstreams does not know", async () => {
      const { result } = await fails(["track", url(1)], "t_missing");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Unknown thread");
    });

    it("for a thread in no workstream", async () => {
      const { result, w } = await fails(["track", url(1)], "t_homeless");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("no workstream yet");
      expect(w.pullRequestReads).toEqual([]);
    });

    it("for a thread with no machine", async () => {
      const s = await setup();
      const bare = s.w.addThread("t_bare", { environmentId: null });
      s.store.assign(bare.id, s.shelves.id, {
        provenance: "manual",
        evidence: null,
      });
      const result = await s.run(["track", url(1)], "t_bare");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("no machine");
    });

    it("for a machine that is not connected, without asking it", async () => {
      const s = await setup();
      s.w.hostStatuses.set("host_1", "disconnected");
      const result = await s.run(["track", url(1)], "t_mine");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("is not connected");
      expect(s.w.pullRequestReads).toEqual([]);
    });

    it.each([
      ["gh_missing", "gh is not installed on this machine."],
      ["auth", "gh is not signed in to github.com on this machine."],
      ["not_found", "GitHub reports no such pull request."],
    ] as const)("when GitHub says %s", async (fail, message) => {
      const s = await setup();
      s.answers.set(url(1), { fail, message });
      const result = await s.run(["track", url(1)], "t_mine");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(message);
      expect(await s.rows()).toEqual([]);
    });
  });
});

describe("terminal safety", () => {
  const hostile = "\u001b]0;pwned\u0007\u001b[31mdeploy\u202e\u0007";
  const clean = (text: string) => {
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(text).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
  };

  it("prints no control characters from a check name, a stale error, or a workstream name", async () => {
    const { answers, run, store, shelves } = await setup();
    store.rename(shelves.id, "Shelves\u001b[2J\u202e");
    answers.set(
      url(1),
      read({
        checks: [
          {
            id: "c",
            name: hostile,
            state: "failed",
            url: null,
            startedAt: null,
            completedAt: null,
          },
        ],
      }),
    );
    const tracked = await run(["track", url(1)], "t_mine");
    expect(tracked.exitCode).toBe(0);
    expect(tracked.stdout).toContain("deploy");
    clean(tracked.stdout);
    clean((await run(["list"])).stdout);
    clean((await run(["untrack", url(1)], "t_mine")).stdout);

    answers.set(url(2), { fail: "unavailable", message: hostile });
    const failed = await run(["track", url(2)], "t_mine");
    expect(failed.exitCode).not.toBe(0);
    clean(failed.stderr);
  });
});

describe("bb workstreams pr list", () => {
  it("lists ready first and bounds what it prints", async () => {
    const { answers, run } = await setup();
    for (let n = 1; n <= 5; n++)
      answers.set(
        url(n),
        read({
          number: n,
          title: `Pull request ${n} ${"x".repeat(200)}`,
          mergeStateStatus: n === 3 ? "CLEAN" : "BLOCKED",
          reviewDecision: n === 3 ? null : "REVIEW_REQUIRED",
        }),
      );
    for (let n = 1; n <= 5; n++) await run(["track", url(n)], "t_mine");

    const all = await run(["list"]);
    expect(all.exitCode).toBe(0);
    const lines = all.stdout.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^ready\s+acme\/shelves#3/);
    expect(lines[0]!.length).toBeLessThan(200);

    const limited = await run(["list", "--limit", "2"]);
    expect(limited.stdout.split("\n")).toHaveLength(3);
    expect(limited.stdout).toContain("…and 3 more");

    const json = JSON.parse(
      (await run(["list", "--limit", "2", "--json"])).stdout,
    );
    expect(json).toMatchObject({ total: 5, shown: 2, truncated: true });
    expect(json.pullRequests).toHaveLength(2);
    expect(json.pullRequests[0].number).toBe(3);
    expect(json.pullRequests[0].title.length).toBeLessThanOrEqual(200);
  });

  it("filters by workstream or thread, and says when nothing is tracked", async () => {
    const { answers, run } = await setup();
    expect((await run(["list"])).stdout).toBe("No tracked pull requests.");
    answers.set(url(1), read());
    answers.set(url(2), read({ number: 2 }));
    await run(["track", url(1)], "t_mine");
    await run(["track", url(2)], "t_other");
    expect(
      (await run(["list", "--workstream", "Racks", "--json"])).stdout,
    ).toContain("/pull/2");
    const byThread = JSON.parse(
      (await run(["list", "--thread", "t_mine", "--json"])).stdout,
    );
    expect(
      byThread.pullRequests.map((p: { number: number }) => p.number),
    ).toEqual([1]);
    expect((await run(["list", "--workstream", "Nope"])).exitCode).not.toBe(0);
  });
});

describe("bb workstreams pr untrack", () => {
  it("stops tracking by URL or by row id, and is quiet about one it never tracked", async () => {
    const { answers, run, rows } = await setup();
    answers.set(url(1), read());
    answers.set(url(2), read({ number: 2 }));
    await run(["track", url(1)], "t_mine");
    await run(["track", url(2)], "t_mine");
    const removed = await run(["untrack", url(1)], "t_mine");
    expect(removed.stdout).toBe("Stopped tracking acme/shelves#1 in Shelves.");
    const [rest] = await rows();
    expect((await run(["untrack", rest!.id, "--json"])).stdout).toContain(
      '"removed": true',
    );
    expect(await rows()).toEqual([]);
    const none = await run(["untrack", url(1)], "t_mine");
    expect(none).toMatchObject({
      exitCode: 0,
      stdout: "That pull request is not tracked.",
    });
  });

  it("asks which workstream when several track the URL, and takes the thread's own", async () => {
    const { answers, run, rows, racks } = await setup();
    answers.set(url(1), read());
    await run(["track", url(1)], "t_mine");
    await run(["track", url(1)], "t_other");

    const ambiguous = await run(["untrack", url(1)]);
    expect(ambiguous.exitCode).not.toBe(0);
    expect(ambiguous.stderr).toContain("2 workstreams track this pull request");
    expect(ambiguous.stderr).toContain("--workstream");
    expect(await rows()).toHaveLength(2);

    // From a thread, its workstream's row goes.
    await run(["untrack", url(1)], "t_other");
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]!.workstreamId).not.toBe(racks.id);

    await run(["track", url(1)], "t_other");
    await run(["untrack", url(1), "--workstream", "Racks"]);
    expect(await rows()).toHaveLength(1);
  });
});

describe("tracked pull request RPC", () => {
  it("refreshes one row, and answers null for one that is not tracked", async () => {
    const { answers, run, rows, w } = await setup();
    answers.set(url(1), read({ checks: [] }));
    await run(["track", url(1)], "t_mine");
    const [row] = await rows();
    answers.set(url(1), read({ title: "Retitled", checks: [] }));
    const refreshed = (await w.harness.behavior.callRpc(
      "refreshTrackedPullRequest",
      {
        id: row!.id,
      },
    )) as { item: { title: string } | null };
    expect(refreshed.item?.title).toBe("Retitled");
    expect(
      await w.harness.behavior.callRpc("refreshTrackedPullRequest", {
        id: "pr_missing",
      }),
    ).toEqual({ item: null });
  });

  it("keeps a pull request in the workstream it was linked in when the thread moves", async () => {
    const { answers, run, rows, store, mine, racks, shelves } = await setup();
    answers.set(url(1), read());
    await run(["track", url(1)], "t_mine");
    store.assign(mine.id, racks.id, { provenance: "manual", evidence: null });
    await run(["track", url(1)], "t_other");
    const all = await rows();
    expect(all.map((r) => r.workstreamId).sort()).toEqual(
      [racks.id, shelves.id].sort(),
    );
    expect(all.find((r) => r.threadId === "t_mine")!.workstreamId).toBe(
      shelves.id,
    );
  });
});
