import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitializedTestPluginHost } from "./test-host.ts";
import { openDatabase } from "../../src/server/db.ts";
import { WorkstreamStore } from "../../src/server/workstreams.ts";
import { PullRequestStore } from "../../src/server/pullRequests/store.ts";
import {
  PullRequestError,
  PullRequestTracker,
  type MachineState,
} from "../../src/server/pullRequests/tracker.ts";
import {
  PULL_REQUEST_FAST_POLL_MS,
  PULL_REQUEST_OFFLINE_RECHECK_MS,
  PULL_REQUEST_QUIET_POLL_MS,
  PULL_REQUEST_TERMINAL_TTL_MS,
  parsePullRequestUrl,
  type PullRequestCheck,
  type PullRequestFailure,
  type PullRequestLookup,
  type PullRequestRead,
} from "../../src/domain/pullRequests.ts";

const T0 = Date.parse("2026-03-01T12:00:00Z");
const MINUTE = 60_000;

const check = (
  name: string,
  state: PullRequestCheck["state"],
): PullRequestCheck => ({
  id: name,
  name,
  state,
  url: null,
  startedAt: null,
  completedAt: null,
});
const pr = (overrides: Partial<PullRequestRead> = {}): PullRequestRead => ({
  number: 1,
  title: "Add shelf labels",
  body: "",
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: "labels",
  headRefOid: "aaa",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  mergedAt: null,
  closedAt: null,
  mergeStateStatus: "CLEAN",
  mergeable: "MERGEABLE",
  reviewDecision: null,
  checks: [check("test", "passed")],
  ...overrides,
});
const url = (n: number) => `https://github.com/acme/shelves/pull/${n}`;
const target = (n: number) => {
  const parsed = parsePullRequestUrl(url(n));
  if (!parsed.ok) throw new Error("bad fixture url");
  return parsed.target;
};

type Answer =
  | { read: PullRequestRead }
  | { fail: PullRequestFailure; message?: string; retryAfterMs?: number };

let host: Awaited<ReturnType<typeof createInitializedTestPluginHost>>;
beforeEach(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["setTimeout", "clearTimeout", "Date"] });
  host = await createInitializedTestPluginHost({ pluginId: "workstreams" });
});
afterEach(async () => {
  vi.useRealTimers();
  await host.harness.lifecycle.dispose();
});

/** A tracker over a real database, a fake GitHub, and fake machines. */
function world() {
  const db = openDatabase(host.bb);
  const workstreams = new WorkstreamStore(db);
  const store = new PullRequestStore(db);
  const shelves = workstreams.create("Shelves", "", null, []);
  const racks = workstreams.create("Racks", "", null, []);
  /** What GitHub says; a URL it has no answer for is not found. */
  const github = new Map<string, Answer>();
  const reads: { hostId: string; hostname: string; urls: string[] }[] = [];
  const machines = new Map<string, MachineState>();
  const signals: AbortSignal[] = [];
  let delay: Promise<void> | null = null;
  const events = { changed: 0 };
  const make = () =>
    new PullRequestTracker({
      store,
      now: Date.now,
      machine: async (hostId) =>
        machines.get(hostId) ?? { ok: true, name: `Machine ${hostId}` },
      read: async (hostId, request, signal) => {
        reads.push({ hostId, ...request, urls: [...request.urls] });
        signals.push(signal);
        await delay;
        return request.urls.map((u): PullRequestLookup => {
          const answer = github.get(u);
          if (answer && "read" in answer)
            return { outcome: "found", url: u, pullRequest: answer.read };
          return {
            outcome: "failed",
            url: u,
            failure: answer?.fail ?? "not_found",
            message: answer?.message ?? "No such pull request.",
            retryAfterMs:
              answer && "retryAfterMs" in answer
                ? (answer.retryAfterMs ?? null)
                : null,
          };
        });
      },
      canHold: (id) =>
        workstreams.getById(id) !== null && workstreams.workstreams(id) === 0,
      changed: () => void events.changed++,
      log: () => undefined,
    });
  return {
    db,
    workstreams,
    store,
    shelves,
    racks,
    github,
    reads,
    machines,
    signals,
    events,
    make,
    tracker: make(),
    /** Holds every read until `release` is called. */
    hold() {
      let release!: () => void;
      delay = new Promise<void>((resolve) => (release = resolve));
      return () => {
        delay = null;
        release();
      };
    },
  };
}

const track = (
  w: ReturnType<typeof world>,
  n: number,
  extra: Partial<{
    workstreamId: string;
    threadId: string;
    hostId: string;
  }> = {},
) =>
  w.tracker.track({
    target: target(n),
    workstreamId: w.shelves.id,
    threadId: "t_a",
    hostId: "host_a",
    ...extra,
  });

describe("tracking", () => {
  it("reads the pull request on the thread's machine and stores a row in its workstream", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    const result = await track(w, 1);
    expect(result.outcome).toBe("tracked");
    expect(w.reads).toEqual([
      { hostId: "host_a", hostname: "github.com", urls: [url(1)] },
    ]);
    expect(w.tracker.list()).toMatchObject([
      {
        url: url(1),
        repository: "acme/shelves",
        number: 1,
        workstreamId: w.shelves.id,
        threadId: "t_a",
        hostId: "host_a",
        status: "ready",
        error: null,
        lastSuccessAt: T0,
      },
    ]);
    expect(w.events.changed).toBe(1);
  });

  it("is idempotent for the same URL in the same workstream", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    const first = await track(w, 1);
    const again = await track(w, 1);
    expect(again.outcome).toBe("unchanged");
    expect(w.tracker.list()).toHaveLength(1);
    expect(
      again.outcome === "unchanged" &&
        first.outcome === "tracked" &&
        again.item.id,
    ).toBe(first.outcome === "tracked" ? first.item.id : "");
    // Nothing a reader sees changed, so nothing was published again.
    expect(w.events.changed).toBe(1);
  });

  it("records a new thread and machine when it is tracked again", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    const first = await track(w, 1);
    const again = await track(w, 1, { threadId: "t_b", hostId: "host_b" });
    expect(again.outcome).toBe("updated");
    expect(w.tracker.list()).toMatchObject([
      {
        id: first.outcome === "tracked" ? first.item.id : "",
        threadId: "t_b",
        hostId: "host_b",
      },
    ]);
    expect(w.reads.at(-1)?.hostId).toBe("host_b");
    // Later polls go to the new machine only.
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.reads.map((r) => r.hostId)).toEqual(["host_b"]);
  });

  it("links the same URL independently in two workstreams", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    await track(w, 1);
    await track(w, 1, { workstreamId: w.racks.id, threadId: "t_c" });
    const rows = w.tracker.list();
    expect(rows.map((r) => r.workstreamId).sort()).toEqual(
      [w.shelves.id, w.racks.id].sort(),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(w.tracker.untrack(rows[0]!.id)).toBe(true);
    expect(w.tracker.list()).toHaveLength(1);
  });

  it("makes one read for two identical operations in flight", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    const release = w.hold();
    const both = Promise.all([track(w, 1), track(w, 1)]);
    await vi.advanceTimersByTimeAsync(0);
    release();
    const [a, b] = await both;
    expect(w.reads).toHaveLength(1);
    expect([a.outcome, b.outcome].sort()).toEqual(["tracked", "unchanged"]);
    expect(w.tracker.list()).toHaveLength(1);
  });

  it.each([
    ["gh_missing", "gh_missing"],
    ["auth", "auth_failed"],
    ["not_found", "not_found"],
    ["rate_limit", "rate_limited"],
    ["unavailable", "unavailable"],
  ] as const)(
    "fails clearly when GitHub says %s, and stores no row",
    async (fail, code) => {
      const w = world();
      w.github.set(url(1), { fail, message: "It failed." });
      await expect(track(w, 1)).rejects.toMatchObject({
        name: "Error",
        code,
        message: "It failed.",
      });
      expect(w.tracker.list()).toEqual([]);
      expect(w.events.changed).toBe(0);
    },
  );

  it("fails when the machine is not connected, without reading", async () => {
    const w = world();
    w.machines.set("host_a", {
      ok: false,
      message: "Studio is not connected.",
    });
    const error = await track(w, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PullRequestError);
    expect(error).toMatchObject({ code: "machine_unavailable" });
    expect(w.reads).toEqual([]);
  });

  it("leaves no row for a pull request that ended over an hour ago", async () => {
    const w = world();
    const mergedAt = new Date(
      T0 - PULL_REQUEST_TERMINAL_TTL_MS - MINUTE,
    ).toISOString();
    w.github.set(url(1), {
      read: pr({ state: "MERGED", mergedAt, closedAt: mergedAt }),
    });
    const result = await track(w, 1);
    expect(result).toMatchObject({
      outcome: "expired",
      number: 1,
      endedAt: mergedAt,
    });
    expect(w.tracker.list()).toEqual([]);
  });

  it("drops an existing row when it is tracked again after it expired", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    await track(w, 1);
    const mergedAt = new Date(
      T0 - 2 * PULL_REQUEST_TERMINAL_TTL_MS,
    ).toISOString();
    w.github.set(url(1), {
      read: pr({ state: "MERGED", mergedAt, closedAt: mergedAt }),
    });
    expect((await track(w, 1)).outcome).toBe("expired");
    expect(w.tracker.list()).toEqual([]);
  });
});

describe("tracking while its workstream changes", () => {
  it("writes no row when the workstream was merged away while GitHub was read", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    const release = w.hold();
    const pending = track(w, 1);
    await vi.advanceTimersByTimeAsync(0);
    w.workstreams.merge(w.shelves.id, w.racks.id);
    release();
    await expect(pending).rejects.toMatchObject({ code: "no_workstream" });
    expect(w.store.all()).toEqual([]);
  });

  it("writes no row when the workstream became a group while GitHub was read", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    const release = w.hold();
    const pending = track(w, 1);
    await vi.advanceTimersByTimeAsync(0);
    w.workstreams.create("Labels", "", w.shelves.id);
    release();
    await expect(pending).rejects.toBeInstanceOf(PullRequestError);
    expect(w.store.all()).toEqual([]);
  });

  it("writes nothing once stopped", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    const release = w.hold();
    const pending = track(w, 1);
    await vi.advanceTimersByTimeAsync(0);
    w.tracker.dispose();
    release();
    await expect(pending).rejects.toBeInstanceOf(PullRequestError);
    expect(w.store.all()).toEqual([]);
  });
});

describe("polling", () => {
  it("reads every 30 seconds while checks run, then every 5 minutes", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS * 3);
    expect(w.reads).toHaveLength(3);

    w.github.set(url(1), { read: pr() });
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.reads).toHaveLength(4);
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_QUIET_POLL_MS - 1000);
    expect(w.reads).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.reads).toHaveLength(1);
  });

  it("polls fast while mergeability is unknown", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ mergeStateStatus: "UNKNOWN" }) });
    await track(w, 1);
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.reads).toHaveLength(1);
  });

  it("publishes only when what a reader sees changes", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    expect(w.events.changed).toBe(1);
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS * 2);
    expect(w.reads.length).toBeGreaterThan(1);
    expect(w.events.changed).toBe(1);
    // The success time moved, quietly.
    expect(w.tracker.list()[0]!.lastSuccessAt).toBe(
      T0 + PULL_REQUEST_FAST_POLL_MS * 2,
    );

    w.github.set(url(1), { read: pr({ checks: [check("test", "failed")] }) });
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.events.changed).toBe(2);
    expect(w.tracker.list()[0]!.status).toBe("failing");
  });

  it("reads many pull requests in documents of at most 25, one read per URL and machine", async () => {
    const w = world();
    for (let n = 1; n <= 30; n++) {
      w.github.set(url(n), {
        read: pr({ number: n, checks: [check("t", "running")] }),
      });
      await track(w, n);
    }
    // The same URL in another workstream shares the read.
    await track(w, 1, { workstreamId: w.racks.id });
    // Another machine reads on its own.
    await track(w, 2, { workstreamId: w.racks.id, hostId: "host_b" });
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    const a = w.reads.filter((r) => r.hostId === "host_a");
    const b = w.reads.filter((r) => r.hostId === "host_b");
    expect(a.map((r) => r.urls.length)).toEqual([25, 5]);
    expect(new Set(a.flatMap((r) => r.urls)).size).toBe(30);
    expect(a.flatMap((r) => r.urls)).toHaveLength(30);
    expect(b).toEqual([
      { hostId: "host_b", hostname: "github.com", urls: [url(2)] },
    ]);
  });

  it("reads rows of different hostnames in separate documents", async () => {
    const w = world();
    const enterprise = "https://git.example.test/acme/shelves/pull/9";
    const parsed = parsePullRequestUrl(enterprise);
    if (!parsed.ok) throw new Error("fixture");
    w.github.set(url(1), { read: pr({ checks: [check("t", "running")] }) });
    w.github.set(enterprise, {
      read: pr({ number: 9, checks: [check("t", "running")] }),
    });
    await track(w, 1);
    await w.tracker.track({
      target: parsed.target,
      workstreamId: w.shelves.id,
      threadId: "t_a",
      hostId: "host_a",
    });
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.reads.map((r) => r.hostname).sort()).toEqual([
      "git.example.test",
      "github.com",
    ]);
  });

  it("joins a read already under way", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("t", "running")] }) });
    await track(w, 1);
    w.reads.length = 0;
    const release = w.hold();
    const id = w.tracker.list()[0]!.id;
    const first = w.tracker.refresh(id);
    const second = w.tracker.refresh(id);
    await vi.advanceTimersByTimeAsync(0);
    release();
    await Promise.all([first, second]);
    expect(w.reads).toHaveLength(1);
  });

  it("stops polling an ended pull request and removes it an hour after it ended", async () => {
    const w = world();
    const mergedAt = new Date(T0 - 10 * MINUTE).toISOString();
    w.github.set(url(1), { read: pr({ checks: [check("t", "running")] }) });
    await track(w, 1);
    w.github.set(url(1), {
      read: pr({ state: "MERGED", mergedAt, closedAt: mergedAt }),
    });
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.tracker.list()).toMatchObject([
      {
        status: "merged",
        expiresAt: Date.parse(mergedAt) + PULL_REQUEST_TERMINAL_TTL_MS,
      },
    ]);
    const readsAfterMerge = w.reads.length;
    const changed = w.events.changed;

    // Nothing reads it again, but the timer still removes it at expiry.
    await vi.advanceTimersByTimeAsync(49 * MINUTE);
    expect(w.reads).toHaveLength(readsAfterMerge);
    expect(w.store.all()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(w.store.all()).toHaveLength(0);
    expect(w.events.changed).toBe(changed + 1);
  });

  it("does not start polling an ended pull request again when a refresh fails", async () => {
    const w = world();
    const mergedAt = new Date(T0 - MINUTE).toISOString();
    w.github.set(url(1), {
      read: pr({ state: "MERGED", mergedAt, closedAt: mergedAt }),
    });
    await track(w, 1);
    const id = w.tracker.list()[0]!.id;
    w.github.set(url(1), { fail: "unavailable", message: "Down." });
    expect(await w.tracker.refresh(id)).toMatchObject({
      status: "merged",
      error: "Down.",
    });
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(w.reads).toEqual([]);
  });

  it("uses closedAt for a closed pull request", async () => {
    const w = world();
    const closedAt = new Date(T0 - MINUTE).toISOString();
    w.github.set(url(1), { read: pr({ state: "CLOSED", closedAt }) });
    await track(w, 1);
    expect(w.tracker.list()[0]).toMatchObject({
      status: "closed",
      expiresAt: Date.parse(closedAt) + PULL_REQUEST_TERMINAL_TTL_MS,
    });
  });
});

describe("failures", () => {
  it("keeps the last snapshot, says why it is stale, and backs off", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    const before = w.tracker.list()[0]!;
    w.github.set(url(1), { fail: "auth", message: "gh is not signed in." });
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.reads).toHaveLength(1);
    const stale = w.tracker.list()[0]!;
    expect(stale).toMatchObject({
      title: before.title,
      status: "running",
      checks: before.checks,
      lastSuccessAt: before.lastSuccessAt,
      error: "gh is not signed in.",
    });
    expect(w.events.changed).toBe(2);

    // The wait doubles from 30s: reads follow 30s, 60s, then 120s later.
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS - 1000);
    expect(w.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.reads).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS * 2 - 1000);
    expect(w.reads).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.reads).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS * 4 - 1000);
    expect(w.reads).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.reads).toHaveLength(4);
    // Repeating the same failure is not a new thing to show.
    expect(w.events.changed).toBe(2);

    w.github.set(url(1), { read: pr({ checks: [check("test", "passed")] }) });
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS * 8);
    expect(w.tracker.list()[0]).toMatchObject({ status: "ready", error: null });
    expect(w.store.all()[0]!.failures).toBe(0);
  });

  it.each(["not_found", "auth", "unavailable", "gh_missing"] as const)(
    "does not take %s for a closed pull request",
    async (fail) => {
      const w = world();
      w.github.set(url(1), {
        read: pr({ checks: [check("test", "running")] }),
      });
      await track(w, 1);
      w.github.set(url(1), { fail });
      await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
      expect(w.tracker.list()).toMatchObject([
        { status: "running", expiresAt: null, closedAt: null, mergedAt: null },
      ]);
      expect(w.tracker.list()[0]!.error).not.toBeNull();
      w.tracker.dispose();
    },
  );

  it("waits as long as a rate limit asks", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    w.github.set(url(1), { fail: "rate_limit", retryAfterMs: 10 * MINUTE });
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9 * MINUTE);
    expect(w.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(w.reads).toHaveLength(2);
  });

  it("keeps the snapshot when the machine's read itself throws", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    const broken = new PullRequestTracker({
      store: w.store,
      now: Date.now,
      machine: async () => ({ ok: true, name: "m" }),
      read: async () => {
        throw new Error("Plugin host call timed out");
      },
      canHold: () => true,
      changed: () => undefined,
      log: () => undefined,
    });
    w.tracker.dispose();
    await vi.advanceTimersByTimeAsync(0);
    const id = w.tracker.list()[0]!.id;
    expect(await broken.refresh(id)).toMatchObject({
      status: "running",
      error: "Plugin host call timed out",
    });
    broken.dispose();
  });

  it("never asks a machine that is not connected, and keeps the snapshot", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    w.machines.set("host_a", {
      ok: false,
      message: "Studio is not connected.",
    });
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.reads).toEqual([]);
    expect(w.tracker.list()[0]).toMatchObject({
      status: "running",
      error: "Studio is not connected.",
    });
    await vi.advanceTimersByTimeAsync(5 * PULL_REQUEST_OFFLINE_RECHECK_MS);
    expect(w.reads).toEqual([]);

    w.machines.delete("host_a");
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_OFFLINE_RECHECK_MS);
    expect(w.reads).toHaveLength(1);
    expect(w.tracker.list()[0]!.error).toBeNull();
  });

  it("answers a refresh with the stale row when the machine is offline", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    await track(w, 1);
    const id = w.tracker.list()[0]!.id;
    w.machines.set("host_a", {
      ok: false,
      message: "Studio is not connected.",
    });
    w.reads.length = 0;
    expect(await w.tracker.refresh(id)).toMatchObject({
      error: "Studio is not connected.",
    });
    expect(w.reads).toEqual([]);
  });
});

describe("restart and dispose", () => {
  it("resumes polling from the stored schedule and drops what expired while away", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    w.github.set(url(2), {
      read: pr({ number: 2, checks: [check("test", "running")] }),
    });
    await track(w, 1);
    await track(w, 2);
    const mergedAt = new Date(T0).toISOString();
    w.github.set(url(2), {
      read: pr({ number: 2, state: "MERGED", mergedAt, closedAt: mergedAt }),
    });
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(
      w.tracker
        .list()
        .map((r) => r.number)
        .sort(),
    ).toEqual([1, 2]);

    w.tracker.dispose();
    // Two hours pass with the plugin off.
    vi.setSystemTime(Date.now() + 2 * 60 * MINUTE);
    const restarted = w.make();
    w.reads.length = 0;
    const before = w.events.changed;
    restarted.start();
    expect(restarted.list().map((r) => r.number)).toEqual([1]);
    expect(w.events.changed).toBe(before + 1);
    // The overdue row is read soon after start, not at once.
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.reads).toEqual([]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(w.reads).toHaveLength(1);
    restarted.dispose();
  });

  it("polls without anything asking for the list", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    w.tracker.dispose();
    const restarted = w.make();
    restarted.start();
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(w.reads.length).toBeGreaterThan(0);
    restarted.dispose();
  });

  it("cancels its timer and aborts a read under way when disposed", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    w.reads.length = 0;
    w.tracker.dispose();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(w.reads).toEqual([]);
    expect(w.signals.at(-1)?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("writes nothing from a read that finishes after dispose", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    const id = w.tracker.list()[0]!.id;
    const release = w.hold();
    const pending = w.tracker.refresh(id);
    await vi.advanceTimersByTimeAsync(0);
    w.github.set(url(1), { read: pr({ title: "Renamed" }) });
    w.tracker.dispose();
    release();
    await pending;
    expect(w.store.get(id)!.item.title).toBe("Add shelf labels");
  });

  it("untracking stops its reads", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    w.tracker.untrack(w.tracker.list()[0]!.id);
    w.reads.length = 0;
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(w.reads).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not publish a merge that moved no pull requests", async () => {
    const w = world();
    w.workstreams.onPullRequestsMoved = () => w.tracker.rowsChanged();
    const before = w.events.changed;
    w.workstreams.merge(w.shelves.id, w.racks.id);
    expect(w.events.changed).toBe(before);
  });

  it("after a failed pass, reschedules the rows still there and does not bring back an untracked one", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("t", "running")] }) });
    w.github.set(url(2), {
      read: pr({ number: 2, checks: [check("t", "running")] }),
    });
    await track(w, 1);
    await track(w, 2);
    const [a, b] = w.tracker.list();
    const release = w.hold();
    const before = w.reads.length;
    // The timer starts the pass when the rows fall due; its reads are held.
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.reads.length).toBeGreaterThan(before);
    const pass = w.tracker.tick();
    // The pass holds both rows as they were; one is untracked while it reads.
    w.tracker.untrack(b!.id);
    const put = w.store.put.bind(w.store);
    let first = true;
    vi.spyOn(w.store, "put").mockImplementation((stored, now) => {
      if (first) {
        first = false;
        throw new Error("database is locked");
      }
      put(stored, now);
    });
    release();
    await pass;
    vi.restoreAllMocks();
    expect(w.store.get(b!.id)).toBeNull();
    expect(w.store.get(a!.id)).toMatchObject({
      nextPollAt: expect.any(Number),
    });
  });

  it("writes nothing from a failed pass once stopped", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("t", "running")] }) });
    await track(w, 1);
    const release = w.hold();
    const before = w.reads.length;
    // The timer starts the pass when the rows fall due; its reads are held.
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_FAST_POLL_MS);
    expect(w.reads.length).toBeGreaterThan(before);
    const pass = w.tracker.tick();
    const put = vi.spyOn(w.store, "put").mockImplementation(() => {
      w.tracker.dispose();
      throw new Error("database is locked");
    });
    release();
    await pass;
    expect(put).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("does not write a row that was untracked while its read was out", async () => {
    const w = world();
    w.github.set(url(1), { read: pr({ checks: [check("test", "running")] }) });
    await track(w, 1);
    const id = w.tracker.list()[0]!.id;
    const release = w.hold();
    const pending = w.tracker.refresh(id);
    await vi.advanceTimersByTimeAsync(0);
    w.tracker.untrack(id);
    release();
    expect(await pending).toBeNull();
    expect(w.store.all()).toEqual([]);
  });
});

describe("workstream changes", () => {
  it("stays in the workstream it was linked in when its thread is filed elsewhere", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    await track(w, 1);
    // Nothing about a thread's filing reaches the row; polling keeps it where it was.
    w.github.set(url(1), { read: pr({ title: "New title" }) });
    await vi.advanceTimersByTimeAsync(PULL_REQUEST_QUIET_POLL_MS);
    expect(w.tracker.list()[0]).toMatchObject({
      workstreamId: w.shelves.id,
      threadId: "t_a",
      title: "New title",
    });
  });

  it("follows a merge of its workstream, keeping the target's own row for the same URL", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    w.github.set(url(2), { read: pr({ number: 2 }) });
    await track(w, 1);
    await track(w, 2);
    await track(w, 1, { workstreamId: w.racks.id });
    w.workstreams.onPullRequestsMoved = () => w.tracker.rowsChanged();
    const before = w.events.changed;
    w.workstreams.merge(w.shelves.id, w.racks.id);
    expect(w.events.changed).toBe(before + 1);
    const rows = w.tracker.list();
    expect(rows.map((r) => [r.number, r.workstreamId])).toEqual([
      [1, w.racks.id],
      [2, w.racks.id],
    ]);
  });

  it("keeps a workstream that only a tracked pull request holds", async () => {
    const w = world();
    const mine = w.workstreams.create("Mine", "", null, []);
    w.github.set(url(1), { read: pr() });
    await track(w, 1, { workstreamId: mine.id });
    w.workstreams.prune();
    expect(w.workstreams.getById(mine.id)).not.toBeNull();
  });

  it("drops rows of a workstream that no longer exists", async () => {
    const w = world();
    w.github.set(url(1), { read: pr() });
    await track(w, 1);
    w.db.prepare("DELETE FROM ws_workstream WHERE id = ?").run(w.shelves.id);
    w.tracker.dispose();
    const restarted = w.make();
    restarted.start();
    expect(restarted.list()).toEqual([]);
    restarted.dispose();
  });
});
