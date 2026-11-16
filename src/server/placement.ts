/**
 * Placement: what choosing a root's workstream reads, and the closed-set call that
 * asks only that. A thread's start and a turn's end ask the workstream together
 * with their other fields (`question` builds the evidence they share); this
 * call alone serves a move into a multi-workstream group, a workstream preview or
 * repair, and a root that only lacks a workstream.
 *
 * Its evidence is the generated title, the first, second, and latest
 * substantive requests, the project, and the checkout, plus hints:
 *
 * - the workstream of the thread it continues or was started from, and of the
 *   workstream whose ＋ started it when that workstream holds workstreams in a group;
 * - the workstream most threads in its checkout have, unless the checkout is a
 *   coordination workspace, one whose threads point at other repositories
 *   (at least two of them name a GitHub repository or a `~/Code` path
 *   outside it), where location says nothing about the work.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ModelChoice } from "../domain/prefs.ts";
import type {
  WorkstreamChoiceInput,
  WorkstreamChoiceOutput,
} from "../domain/placement.ts";
import { workstreamPath } from "../domain/topic-path.ts";
import type { Database } from "./db.ts";
import type { Inference } from "./model.ts";
import { isSubstantiveRequest, placementRequests } from "./requests.ts";
import { continuationThreadId } from "./requestProvenance.ts";
import type { WorkstreamStore } from "./topics.ts";

type Sdk = BbPluginApi["sdk"];

/** What placement reads from a BB thread. */
export type ChoiceThread = {
  readonly id: string;
  readonly title: string | null;
  readonly projectId: string;
  readonly environmentId?: string | null;
  readonly sourceThreadId?: string | null;
  readonly parentThreadId?: string | null;
};

export type ChoiceQuestion = {
  input: WorkstreamChoiceInput;
  basis: string;
  /** The answer when no call is needed: a root with nothing to place by. */
  settled?: WorkstreamChoiceOutput;
};

/** Roots that point at other repositories before a checkout coordinates. */
const COORDINATION_AT = 2;

const GITHUB_REPO = /github\.com\/([\w.-]+)\/([\w.-]+)/gi;
const CODE_PATH = /(?:~|\/Users\/[\w.-]+)\/Code\/[\w./+-]+/g;

/** Whether a request names a repository other than the checkout's own. */
export function pointsElsewhere(text: string, checkout: string): boolean {
  const segments = new Set(checkout.toLowerCase().split("/").filter(Boolean));
  for (const match of text.matchAll(GITHUB_REPO)) {
    const repo = match[2]!.replace(/\.git$/, "").toLowerCase();
    if (!segments.has(repo)) return true;
  }
  const home = checkout.match(/^\/Users\/[\w.-]+/)?.[0];
  for (const match of text.matchAll(CODE_PATH)) {
    const path = home ? match[0].replace(/^~/, home) : match[0];
    if (!path.startsWith(checkout)) return true;
  }
  return false;
}

export class WorkstreamChoice {
  /** Hints recorded before a thread's first request is placed. */
  private readonly startHints = new Map<string, string>();
  private readonly checkouts = new Map<string, string | null>();

  constructor(
    private readonly deps: {
      sdk: () => Sdk;
      db: Database;
      inference: Inference;
      model: () => Promise<ModelChoice>;
      workstreamStore: WorkstreamStore;
      project: (projectId: string) => Promise<string | null>;
      /** The basis an automatic workstream is settled from. */
      basisOf: (requests: readonly string[], project: string | null) => string;
      log: (message: string) => void;
    },
  ) {}

  /**
   * Remembers where a new thread was started from when that workstream couldn't
   * be inherited (it holds workstreams in a group), so placement weighs it.
   */
  hintStart(
    threadId: string,
    workstreamId: string,
    from: "thread" | "workstream" | "picked",
  ) {
    const label = this.label(workstreamId);
    if (!label) return;
    this.startHints.set(
      threadId,
      from === "workstream"
        ? `It was started from the ${label} workstream.`
        : from === "picked"
          ? `It was started in ${label}, which is now a group.`
          : `It was started from a thread in ${label}.`,
    );
    if (this.startHints.size > 200)
      this.startHints.delete(this.startHints.keys().next().value!);
  }

  forget(threadId: string): void {
    this.startHints.delete(threadId);
    this.deps.db
      .prepare("DELETE FROM ws_thread_checkout WHERE thread_id = ?")
      .run(threadId);
  }

  /**
   * What placing a root from these requests would ask, or null when there is
   * nothing to settle: you set its workstream, or it was settled from these
   * requests.
   */
  async question(
    thread: ChoiceThread,
    rawRequests: readonly string[],
    options: { force?: boolean; within?: string; digest?: string | null } = {},
  ): Promise<ChoiceQuestion | null> {
    const workstreamStore = this.deps.workstreamStore;
    const assignment = workstreamStore.assignment(thread.id);
    if (assignment.provenance === "manual" && !options.within) return null;
    const requests = placementRequests(rawRequests);
    // With neither a substantive request nor a title there is nothing to
    // place by; settling "no workstream" keeps the root from being asked again
    // until a request arrives.
    const blank = requests.length === 0 && !thread.title;
    if (blank && options.within)
      throw new Error(
        "The thread has no request or title to choose a workstream from.",
      );
    if (blank && assignment.provenance !== null) return null;
    const project = await this.deps.project(thread.projectId);
    const basis = this.deps.basisOf(rawRequests, project);
    if (
      !options.force &&
      assignment.provenance !== null &&
      assignment.provenance !== "composer" &&
      workstreamStore.basis(thread.id) === basis
    )
      return null;
    const checkout = await this.checkout(thread.environmentId ?? null);
    if (checkout) this.observe(thread.id, checkout, rawRequests);
    const workstreams = workstreamStore.list();
    return {
      basis,
      ...(blank
        ? { settled: { workstreamId: null, proposed: null, scopeShift: false } }
        : {}),
      input: {
        title: thread.title,
        ...(options.within ? { within: options.within } : {}),
        requests,
        project,
        checkout,
        workstreams,
        counts: this.counts(),
        hints: this.hints(thread, rawRequests, checkout),
        current: assignment.label
          ? {
              label: assignment.label,
              inherited: assignment.provenance === "inherited",
            }
          : null,
        digest: options.digest ?? null,
      },
    };
  }

  /**
   * What filing a composer draft reads before it is a thread: the tree with
   * its thread counts and the project the draft would start in.
   */
  draft(
    project: string | null,
  ): Omit<WorkstreamChoiceInput, "requests" | "title"> {
    return {
      project,
      checkout: null,
      workstreams: this.deps.workstreamStore.list(),
      counts: this.counts(),
      hints: [],
      current: null,
    };
  }

  /** Asks the model; throws when the call fails or its answer is invalid. */
  async ask(
    threadId: string,
    question: ChoiceQuestion,
    options: { label: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{ answer: WorkstreamChoiceOutput; traceId: string | null }> {
    if (question.settled) return { answer: question.settled, traceId: null };
    const { value, traceId } = await this.deps.inference.run(
      "workstream-choice",
      question.input,
      {
        model: await this.deps.model(),
        threadId,
        label: options.label,
        links: [{ kind: "thread", ref: threadId }],
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      },
    );
    return { answer: value, traceId };
  }

  /** The checkout a root ran in when it was last placed. */
  checkoutOf(threadId: string): string | null {
    return (
      (
        this.deps.db
          .prepare("SELECT path FROM ws_thread_checkout WHERE thread_id = ?")
          .get(threadId) as { path: string } | undefined
      )?.path ?? null
    );
  }

  /** Whether threads in a checkout point at other repositories. */
  coordinates(checkout: string): boolean {
    return (
      (
        this.deps.db
          .prepare(
            "SELECT COUNT(*) AS n FROM ws_thread_checkout WHERE path = ? AND elsewhere = 1",
          )
          .get(checkout) as { n: number }
      ).n >= COORDINATION_AT
    );
  }

  /** Checkouts that coordinate work in other repositories. */
  coordinationWorkspaces(): string[] {
    return (
      this.deps.db
        .prepare(
          "SELECT path FROM ws_thread_checkout WHERE elsewhere = 1 GROUP BY path HAVING COUNT(*) >= ?",
        )
        .all(COORDINATION_AT) as { path: string }[]
    ).map((row) => row.path);
  }

  private label(workstreamId: string): string | null {
    try {
      return workstreamPath(workstreamId, this.deps.workstreamStore.list());
    } catch {
      return null;
    }
  }

  private async checkout(environmentId: string | null): Promise<string | null> {
    if (!environmentId) return null;
    if (this.checkouts.has(environmentId))
      return this.checkouts.get(environmentId)!;
    const path = await this.deps
      .sdk()
      .environments.get({ environmentId })
      .then((environment) => environment?.path ?? null)
      .catch(() => null);
    this.checkouts.set(environmentId, path);
    return path;
  }

  private observe(
    threadId: string,
    checkout: string,
    requests: readonly string[],
  ): void {
    const elsewhere = requests.some((text) => pointsElsewhere(text, checkout));
    this.deps.db
      .prepare(
        `INSERT INTO ws_thread_checkout(thread_id, path, elsewhere) VALUES (?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET path = excluded.path,
           elsewhere = MAX(ws_thread_checkout.elsewhere, excluded.elsewhere)`,
      )
      .run(threadId, checkout, elsewhere ? 1 : 0);
  }

  /** Visible roots assigned to each workstream. */
  private counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of this.deps.db
      .prepare(
        `SELECT s.workstream_id AS id, COUNT(*) AS n FROM ws_thread_workstream s
         JOIN ws_seen_thread t ON t.thread_id = s.thread_id
         WHERE s.workstream_id IS NOT NULL GROUP BY s.workstream_id`,
      )
      .all() as { id: string; n: number }[])
      out[row.id] = row.n;
    return out;
  }

  private hints(
    thread: ChoiceThread,
    requests: readonly string[],
    checkout: string | null,
  ): string[] {
    const hints: string[] = [];
    const started = this.startHints.get(thread.id);
    if (started) hints.push(started);
    const referenced = continuationThreadId(thread.sourceThreadId, requests);
    if (referenced && referenced !== thread.id) {
      const source = this.deps.workstreamStore.assignment(referenced);
      if (source.label) hints.push(`It continues a thread in ${source.label}.`);
    }
    if (checkout && !this.coordinates(checkout)) {
      const usual = this.usualWorkstream(checkout, thread.id);
      if (usual) hints.push(`Threads in its checkout are usually in ${usual}.`);
    }
    return hints;
  }

  /** The workstream most of a checkout's other threads have, when one clearly leads. */
  private usualWorkstream(checkout: string, threadId: string): string | null {
    const rows = this.deps.db
      .prepare(
        `SELECT s.workstream_id AS id, COUNT(*) AS n FROM ws_thread_checkout c
         JOIN ws_thread_workstream s ON s.thread_id = c.thread_id
         WHERE c.path = ? AND c.thread_id != ? AND s.workstream_id IS NOT NULL
         GROUP BY s.workstream_id ORDER BY n DESC`,
      )
      .all(checkout, threadId) as { id: string; n: number }[];
    const total = rows.reduce((sum, row) => sum + row.n, 0);
    const lead = rows[0];
    if (!lead || lead.n < 2 || lead.n * 2 <= total) return null;
    return this.label(lead.id);
  }
}
