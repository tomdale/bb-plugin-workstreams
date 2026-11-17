/**
 * Keeps tracked pull requests current. Tracking is an explicit, durable
 * intent: a tracked row is read on its own schedule whether or not anyone has
 * the sidebar open, and survives restarts.
 *
 * Each row names one machine, the one whose thread linked it, and is read only
 * through that machine's `gh` login. A machine that is not connected and
 * active is never asked, and never woken: the row keeps its last snapshot
 * with the reason it is stale. A failed read changes only `error`; a pull
 * request counts as ended only when GitHub says it is merged or closed.
 */
import {
  PULL_REQUEST_BATCH_SIZE,
  PULL_REQUEST_FAST_POLL_MS,
  PULL_REQUEST_OFFLINE_RECHECK_MS,
  isTerminalStatus,
  pullRequestPollDelayMs,
  pullRequestRetryDelayMs,
  sameTrackedContent,
  sortTrackedPullRequests,
  trackedFromRead,
  type PullRequestLookup,
  type PullRequestTarget,
  type TrackedPullRequest,
} from "../../domain/pullRequests.ts";
import type { PullRequestStore, StoredPullRequest } from "./store.ts";

/** A failure the caller can show as written; `code` is stable for scripts. */
export class PullRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export type MachineState =
  { ok: true; name: string } | { ok: false; message: string };

export type TrackerDeps = {
  store: PullRequestStore;
  now(): number;
  /** Whether a machine is connected and active. It must not start one. */
  machine(hostId: string): Promise<MachineState>;
  /** Reads pull requests on one hostname through one machine's `gh`. */
  read(
    hostId: string,
    request: { hostname: string; urls: string[] },
    signal: AbortSignal,
  ): Promise<PullRequestLookup[]>;
  /**
   * Whether a workstream still exists and can hold a pull request (it is not
   * a group). Asked again when a read finishes, since either can change while
   * GitHub is being read.
   */
  canHold(workstreamId: string): boolean;
  /** The set of tracked pull requests changed. */
  changed(): void;
  log(message: string): void;
};

export type TrackOutcome =
  | { outcome: "tracked" | "updated" | "unchanged"; item: TrackedPullRequest }
  | { outcome: "expired"; repository: string; number: number; endedAt: string };

/** Waits before the first poll after a restart, so machines can reconnect. */
const STARTUP_GRACE_MS = 3_000;
/** The longest a timer is set for; setTimeout cannot hold much more. */
const MAX_TIMER_MS = 24 * 60 * 60_000;

const FAILURE_CODE = {
  gh_missing: "gh_missing",
  auth: "auth_failed",
  not_found: "not_found",
  rate_limit: "rate_limited",
  unavailable: "unavailable",
} as const;

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
};

export class PullRequestTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<void> | null = null;
  private disposed = false;
  private notBefore = 0;
  private readonly controller = new AbortController();
  /** Reads under way, so a second asker joins the first. */
  private readonly inFlight = new Map<string, Promise<PullRequestLookup>>();

  constructor(private readonly deps: TrackerDeps) {}

  /** Drops what ended while the plugin was off, then starts the schedule. */
  start(): void {
    const now = this.deps.now();
    this.notBefore = now + STARTUP_GRACE_MS;
    const pruned =
      this.deps.store.pruneOrphans() + this.deps.store.pruneExpired(now);
    if (pruned > 0) this.deps.changed();
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller.abort(new Error("Pull request tracking stopped."));
  }

  /**
   * Rows moved or removed outside the tracker (a workstream merge): tells
   * readers and re-arms the timer, since an expiry may have gone with them.
   */
  rowsChanged(): void {
    this.deps.changed();
    this.schedule();
  }

  list(): TrackedPullRequest[] {
    if (this.deps.store.pruneExpired(this.deps.now()) > 0) {
      this.deps.changed();
      this.schedule();
    }
    return sortTrackedPullRequests(this.deps.store.all().map((s) => s.item));
  }

  get(id: string): TrackedPullRequest | null {
    return this.deps.store.get(id)?.item ?? null;
  }

  /** The rows tracking this URL, in any workstream. */
  forUrl(url: string): TrackedPullRequest[] {
    return this.list().filter((item) => item.url === url);
  }

  // --- Commands --------------------------------------------------------------

  /**
   * Links a pull request to a workstream and reads it now. The same URL in the
   * same workstream is one row: tracking it again keeps the row and records
   * the new thread and machine. A pull request that ended more than an hour
   * ago leaves no row.
   */
  async track(input: {
    target: PullRequestTarget;
    workstreamId: string;
    threadId: string;
    hostId: string;
  }): Promise<TrackOutcome> {
    const { target, workstreamId, threadId, hostId } = input;
    await this.requireMachine(hostId);
    const [lookup] = await this.fetchMany(hostId, target.hostname, [
      target.url,
    ]);
    if (lookup?.outcome !== "found")
      throw this.failureError(lookup, target, hostId);
    // Nothing awaits between here and the write, so a second tracker of the
    // same pull request finds this row rather than adding another, and the
    // workstream checked here is the one written to.
    if (this.disposed)
      throw new PullRequestError(
        "Pull request tracking has stopped.",
        "unavailable",
      );
    if (!this.deps.canHold(workstreamId))
      throw new PullRequestError(
        "That workstream no longer exists or has become a group, so the pull request has nowhere to go.",
        "no_workstream",
        "Track it again from a thread in a workstream.",
      );
    const now = this.deps.now();
    const existing = this.deps.store.find(workstreamId, target.url);
    const identity = {
      id: existing?.item.id ?? this.deps.store.newId(),
      url: target.url,
      hostname: target.hostname,
      repository: target.repository,
      number: target.number,
      workstreamId,
      threadId,
      hostId,
    };
    const item = trackedFromRead(identity, lookup.pullRequest, now);
    if (item.expiresAt !== null && item.expiresAt <= now) {
      if (existing && this.deps.store.remove(existing.item.id)) {
        this.deps.changed();
        this.schedule();
      }
      return {
        outcome: "expired",
        repository: target.repository,
        number: target.number,
        endedAt:
          (item.status === "merged" ? item.mergedAt : null) ??
          item.closedAt ??
          new Date(item.expiresAt).toISOString(),
      };
    }
    this.deps.store.put(
      {
        item,
        nextPollAt: this.nextPoll(lookup.pullRequest, now),
        failures: 0,
      },
      now,
    );
    const outcome = !existing
      ? "tracked"
      : existing.item.threadId !== threadId || existing.item.hostId !== hostId
        ? "updated"
        : "unchanged";
    if (!existing || !sameTrackedContent(existing.item, item))
      this.deps.changed();
    this.schedule();
    return { outcome, item };
  }

  /** Stops tracking one row. */
  untrack(id: string): boolean {
    const removed = this.deps.store.remove(id);
    if (removed) {
      this.deps.changed();
      this.schedule();
    }
    return removed;
  }

  /** Reads one row now, for a person who asked. */
  async refresh(id: string): Promise<TrackedPullRequest | null> {
    if (this.deps.store.pruneExpired(this.deps.now()) > 0) this.deps.changed();
    const stored = this.deps.store.get(id);
    if (!stored) return null;
    if (await this.readRows([stored])) this.deps.changed();
    this.schedule();
    return this.deps.store.get(id)?.item ?? null;
  }

  // --- Schedule ---------------------------------------------------------------

  /** Arms one timer for the soonest read or expiry. */
  private schedule(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    let at: number | null = this.deps.store.nextExpiry();
    for (const { nextPollAt } of this.deps.store.all())
      if (nextPollAt !== null && (at === null || nextPollAt < at))
        at = nextPollAt;
    if (at === null) return;
    const delay = Math.min(
      Math.max(at, this.notBefore) - this.deps.now(),
      MAX_TIMER_MS,
    );
    this.timer = setTimeout(() => void this.tick(), Math.max(0, delay));
    this.timer.unref?.();
  }

  /** One pass: drop what expired, read what is due. */
  tick(): Promise<void> {
    this.ticking ??= this.pass().finally(() => {
      this.ticking = null;
      this.schedule();
    });
    return this.ticking;
  }

  private async pass(): Promise<void> {
    if (this.disposed) return;
    const now = this.deps.now();
    const pruned =
      this.deps.store.pruneExpired(now) + this.deps.store.pruneOrphans();
    const due = this.deps.store
      .all()
      .filter((s) => s.nextPollAt !== null && s.nextPollAt <= now);
    let changed = false;
    try {
      changed = await this.readRows(due);
    } catch (error) {
      this.deps.log(`Reading tracked pull requests failed: ${String(error)}`);
      // Without a later time these rows stay due and the timer spins. The
      // rows are read again: some may have been rewritten, or untracked, while
      // the reads were out, and none may be written once stopped.
      if (this.disposed) return;
      for (const row of due) {
        const current = this.deps.store.get(row.item.id);
        if (current)
          this.deps.store.put(
            { ...current, nextPollAt: now + PULL_REQUEST_FAST_POLL_MS },
            now,
          );
      }
    }
    if (pruned > 0 || changed) this.deps.changed();
  }

  // --- Reading ----------------------------------------------------------------

  /** Reads the rows through their machines; returns whether any row changed. */
  private async readRows(rows: readonly StoredPullRequest[]): Promise<boolean> {
    const byMachine = new Map<string, StoredPullRequest[]>();
    for (const row of rows) {
      const group = byMachine.get(row.item.hostId) ?? [];
      group.push(row);
      byMachine.set(row.item.hostId, group);
    }
    const changes = await Promise.all(
      [...byMachine].map(async ([hostId, group]) => {
        const machine = await this.deps
          .machine(hostId)
          .catch((error: unknown): MachineState => ({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }));
        if (!machine.ok)
          return this.apply(group, hostId, () => ({
            outcome: "failed",
            url: "",
            failure: "unavailable",
            message: machine.message,
            retryAfterMs: null,
            offline: true,
          }));
        const byHostname = new Map<string, StoredPullRequest[]>();
        for (const row of group) {
          const same = byHostname.get(row.item.hostname) ?? [];
          same.push(row);
          byHostname.set(row.item.hostname, same);
        }
        let any = false;
        for (const [hostname, same] of byHostname) {
          const urls = [...new Set(same.map((s) => s.item.url))];
          const lookups = new Map(
            (await this.fetchMany(hostId, hostname, urls)).map((l) => [
              l.url,
              l,
            ]),
          );
          any =
            this.apply(same, hostId, (url) => lookups.get(url) ?? null) || any;
        }
        return any;
      }),
    );
    return changes.some(Boolean);
  }

  /**
   * Writes what a read found into each row still there and still read through
   * that machine. A row whose machine was unavailable (`offline`) is retried
   * soon and quietly.
   */
  private apply(
    rows: readonly StoredPullRequest[],
    hostId: string,
    lookupOf: (
      url: string,
    ) => (PullRequestLookup & { offline?: boolean }) | null,
  ): boolean {
    if (this.disposed) return false;
    const now = this.deps.now();
    let changed = false;
    for (const row of rows) {
      const current = this.deps.store.get(row.item.id);
      // Untracked, or moved to another machine, while the read was out.
      if (!current || current.item.hostId !== hostId) continue;
      const lookup = lookupOf(current.item.url) ?? {
        outcome: "failed" as const,
        url: current.item.url,
        failure: "unavailable" as const,
        message: "GitHub returned no answer for this pull request.",
        retryAfterMs: null,
      };
      if (lookup.outcome === "found") {
        const item = trackedFromRead(current.item, lookup.pullRequest, now);
        if (item.expiresAt !== null && item.expiresAt <= now) {
          this.deps.store.remove(item.id);
          changed = true;
          continue;
        }
        this.deps.store.put(
          {
            item,
            nextPollAt: this.nextPoll(lookup.pullRequest, now),
            failures: 0,
          },
          now,
        );
        changed ||= !sameTrackedContent(current.item, item);
        continue;
      }
      const offline = "offline" in lookup && lookup.offline === true;
      const failures = offline ? current.failures : current.failures + 1;
      const item = { ...current.item, error: lookup.message };
      this.deps.store.put(
        {
          item,
          // An ended pull request is read again only when someone asks.
          nextPollAt: isTerminalStatus(item.status)
            ? null
            : now +
              (offline
                ? PULL_REQUEST_OFFLINE_RECHECK_MS
                : pullRequestRetryDelayMs(failures, lookup.retryAfterMs)),
          failures,
        },
        now,
      );
      changed ||= current.item.error !== item.error;
    }
    return changed;
  }

  /** One read per URL on a machine and hostname, shared by everyone asking. */
  private fetchMany(
    hostId: string,
    hostname: string,
    urls: readonly string[],
  ): Promise<PullRequestLookup[]> {
    const key = (url: string) => `${hostId}\n${hostname}\n${url}`;
    const waits = new Map<string, Promise<PullRequestLookup>>();
    const fresh: string[] = [];
    for (const url of new Set(urls)) {
      const running = this.inFlight.get(key(url));
      if (running) waits.set(url, running);
      else fresh.push(url);
    }
    for (const batch of chunk(fresh, PULL_REQUEST_BATCH_SIZE)) {
      const call = this.deps
        .read(hostId, { hostname, urls: batch }, this.controller.signal)
        .catch((error: unknown): PullRequestLookup[] =>
          batch.map((url) => ({
            outcome: "failed",
            url,
            failure: "unavailable",
            message: (error instanceof Error ? error.message : String(error))
              .replace(/\s+/g, " ")
              .slice(0, 300),
            retryAfterMs: null,
          })),
        );
      const settled = call.finally(() => {
        for (const url of batch) this.inFlight.delete(key(url));
      });
      for (const url of batch) {
        const own = settled.then(
          (lookups) =>
            lookups.find((l) => l.url === url) ??
            ({
              outcome: "failed",
              url,
              failure: "unavailable",
              message: "The machine returned no answer for this pull request.",
              retryAfterMs: null,
            } satisfies PullRequestLookup),
        );
        this.inFlight.set(key(url), own);
        waits.set(url, own);
      }
    }
    return Promise.all(urls.map((url) => waits.get(url)!));
  }

  private nextPoll(
    read: Parameters<typeof pullRequestPollDelayMs>[0],
    now: number,
  ): number | null {
    const delay = pullRequestPollDelayMs(read);
    return delay === null ? null : now + delay;
  }

  private async requireMachine(hostId: string): Promise<void> {
    const machine = await this.deps.machine(hostId);
    if (!machine.ok)
      throw new PullRequestError(machine.message, "machine_unavailable");
  }

  private failureError(
    lookup: PullRequestLookup | undefined,
    target: PullRequestTarget,
    hostId: string,
  ): PullRequestError {
    if (!lookup || lookup.outcome !== "failed")
      return new PullRequestError(
        "The machine returned no answer for this pull request.",
        "unavailable",
      );
    const hint =
      lookup.failure === "auth"
        ? `Run gh auth login --hostname ${target.hostname} on the thread's machine (${hostId}).`
        : lookup.failure === "gh_missing"
          ? "Install the GitHub CLI (gh) on the thread's machine."
          : undefined;
    return new PullRequestError(
      lookup.message,
      FAILURE_CODE[lookup.failure],
      hint,
    );
  }
}
