/**
 * Full analysis queue. A turn's end schedules it after a short
 * debounce, a new turn cancels the pending run, and at most four runs are in
 * flight, each a Full analysis call and, for a root, a placement call. Results are keyed to the thread's revision, so a result from an
 * older turn renders as pending rather than current.
 *
 * What a run asks depends on what changed:
 *
 * - After a new request from you, Full analysis settles the title and goal and
 *   describes the turn when the agent didn't report, and placement settles a
 *   root's topic alongside it (see `Placement`). It keeps a title Workstreams
 *   wrote unless the goal changed, and never names over one you gave.
 * - After a turn with no new request (a waiting check, a bare "continue"),
 *   only the turn's status is new: with an agent report nothing is asked and
 *   the settled title carries forward; without one, only the status is asked.
 *
 * The title reaches BB only through `onResult` and the retitle policy; the
 * topic only through `topics.apply`.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createHash } from "node:crypto";
import type {
  AgentReport,
  FullAnalysisInput,
  StoredAnalysis,
  ThreadListing,
  TitledBy,
} from "../domain/analysis.ts";
import type { PlacementOutput } from "../domain/placement.ts";
import type { PlacementQuestion, PlacementThread } from "./placement.ts";
import type { Entity } from "../domain/classify.ts";
import type { TopicAssignment } from "../domain/topics.ts";
import type { ModelChoice } from "../domain/prefs.ts";
import type { Database } from "./db.ts";
import { displayTitle, type InventoryThread } from "./inventory.ts";
import { modelLabel, type Inference } from "./model.ts";
import {
  inputText,
  isSubstantiveRequest,
  openingOf,
  senderOfStart,
} from "./requests.ts";
import {
  continuationThreadId,
  withoutSubagentDeliveries,
} from "./requestProvenance.ts";
import { observeThreadTitle } from "./titles.ts";
import { assignmentEvidence, threadEvidence } from "./evidence.ts";

type Sdk = BbPluginApi["sdk"];

export const DEBOUNCE_MS = 5_000;
const CONCURRENCY = 4;
/** First retry after a failed call; doubles per failure at the same revision. */
const RETRY_AFTER_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

export type { StoredAnalysis } from "../domain/analysis.ts";

function readResult(json: string): StoredAnalysis | undefined {
  try {
    return JSON.parse(json) as StoredAnalysis;
  } catch {
    return undefined;
  }
}

export class Analyzer {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly waiting: string[] = [];
  /** In-flight runs per thread; a manual run can overlap a queued one. */
  private readonly running = new Map<string, number>();
  private inFlight = 0;
  /** A newer invocation supersedes a slower invocation at the same revision. */
  private readonly epochs = new Map<string, number>();
  /** Threads whose turn completed again while a run for them was in flight. */
  private readonly rerun = new Set<string>();
  private readonly failures = new Map<
    string,
    { revision: number; count: number; at: number }
  >();
  /** Deleted threads, so a run that was in flight doesn't write them back. */
  private readonly forgotten = new Set<string>();
  /** `lastAssistantText` from `thread.idle`, keyed by the turn it ended. */
  private readonly lastText = new Map<
    string,
    { revision: number; text: string | null }
  >();
  /** Roots with no topic yet, queued for a run despite a current result. */
  private readonly settleTopic = new Set<string>();
  private disposed = false;
  lastError: string | null = null;

  constructor(
    private readonly deps: {
      sdk: () => Sdk;
      db: Database;
      inference: Inference;
      model: () => Promise<ModelChoice>;
      /**
       * How the thread's agent reported its latest turn and the status that
       * reads as, or null when it didn't report.
       */
      report?: (threadId: string) => {
        report: AgentReport;
        status: Pick<StoredAnalysis, "recap" | "state" | "needsYou">;
      } | null;
      /** Topics, for settling a root's topic with its goal. */
      topics?: {
        entities(): Entity[];
        assignment(threadId: string): TopicAssignment;
        project(projectId: string): Promise<string | null>;
        apply(
          threadId: string,
          answer: PlacementOutput,
          basis: string,
          traceId: string | null,
        ): void;
      };
      /** Where the thread is listed, so its title needn't repeat it. */
      listing?: (thread: {
        id: string;
        parentThreadId?: string | null;
      }) => ThreadListing;
      /** Asks where a root belongs (see `Placement`). */
      placement?: {
        question(
          thread: PlacementThread,
          requests: readonly string[],
          options?: { force?: boolean; goal?: string | null },
        ): Promise<PlacementQuestion | null>;
        ask(
          threadId: string,
          question: PlacementQuestion,
          options: { label: string },
        ): Promise<{ answer: PlacementOutput; traceId: string | null }>;
      };
      /** Incremental evidence is optional; failure leaves triage available. */
      onChange: () => void;
      /** A new result was stored for the thread's current turn. */
      onResult?: (threadId: string, result: StoredAnalysis) => void;
      log: (message: string) => void;
      info?: (message: string) => void;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.waiting.length = 0;
  }

  /**
   * Stored results for visible, non-archived threads. Archived threads keep
   * theirs available for subject lookup but aren't sent to clients.
   */
  all(): Record<string, StoredAnalysis> {
    const out: Record<string, StoredAnalysis> = {};
    for (const row of this.deps.db
      .prepare(
        `SELECT a.thread_id, a.result FROM ws_analysis a
         JOIN ws_seen_thread t ON t.thread_id = a.thread_id`,
      )
      .all() as { thread_id: string; result: string }[]) {
      const parsed = readResult(row.result);
      if (parsed) out[row.thread_id] = parsed;
    }
    return out;
  }

  /**
   * How many visible threads' latest analyzed turns the agent reported
   * itself, of those analyzed since reports were recorded. Measures whether
   * agents report without being asked, which decides whether recap
   * corrections are still worth their extra turns.
   */
  coverage(): { reported: number; analyzed: number } {
    let reported = 0;
    let analyzed = 0;
    for (const result of Object.values(this.all())) {
      if (result.reported === undefined) continue;
      analyzed++;
      if (result.reported) reported++;
    }
    return { reported, analyzed };
  }

  get(threadId: string): StoredAnalysis | undefined {
    const row = this.deps.db
      .prepare("SELECT result FROM ws_analysis WHERE thread_id = ?")
      .get(threadId) as { result: string } | undefined;
    return row ? readResult(row.result) : undefined;
  }

  /** Schedules analysis after a turn completes. */
  onIdle(
    thread: { id: string; latestAttentionAt: number },
    lastAssistantText: string | null,
  ): void {
    const threadId = thread.id;
    this.lastText.set(threadId, {
      revision: thread.latestAttentionAt,
      text: lastAssistantText,
    });
    this.schedule(threadId, DEBOUNCE_MS);
  }

  /** A new turn started: whatever was scheduled would describe the old one. */
  onActive(threadId: string): void {
    this.epochs.set(threadId, (this.epochs.get(threadId) ?? 0) + 1);
    const timer = this.timers.get(threadId);
    if (timer) clearTimeout(timer);
    this.timers.delete(threadId);
    this.lastText.delete(threadId);
  }

  forget(threadId: string): void {
    this.onActive(threadId);
    this.forgotten.add(threadId);
    this.rerun.delete(threadId);
    this.failures.delete(threadId);
    this.deps.db
      .prepare("DELETE FROM ws_analysis WHERE thread_id = ?")
      .run(threadId);
  }

  /**
   * Queues every idle thread whose revision is newer than its stored result,
   * which covers turns that finished while the plugin was offline.
   */
  catchUp(threads: readonly InventoryThread[]): number {
    const stored = new Map(
      (
        this.deps.db
          .prepare("SELECT thread_id, revision, result FROM ws_analysis")
          .all() as { thread_id: string; revision: number; result: string }[]
      ).map((row) => {
        const result = readResult(row.result);
        return [
          row.thread_id,
          {
            revision: row.revision,
            needsTopicRetry: Boolean(result?.topicError),
            needsGoal: result?.threadGoal === undefined,
          },
        ] as const;
      }),
    );
    const now = this.now();
    let queued = 0;
    for (const thread of threads) {
      if (thread.status !== "idle") continue;
      const previous = stored.get(thread.id);
      // A root that never had a topic is settled even when its latest turn
      // was analyzed, for example after the plugin first loads.
      const untopiced =
        this.deps.topics !== undefined &&
        thread.parentThreadId === null &&
        this.deps.topics.assignment(thread.id).provenance === null;
      if (
        previous &&
        previous.revision >= thread.latestAttentionAt &&
        !previous.needsTopicRetry &&
        !previous.needsGoal &&
        !untopiced
      )
        continue;
      const failed = this.failures.get(thread.id);
      if (
        failed &&
        failed.revision === thread.latestAttentionAt &&
        (failed.count >= MAX_ATTEMPTS ||
          now - failed.at < RETRY_AFTER_MS * 2 ** (failed.count - 1))
      )
        continue;
      if (this.timers.has(thread.id) || this.running.has(thread.id)) continue;
      if (this.waiting.includes(thread.id)) continue;
      if (untopiced) this.settleTopic.add(thread.id);
      this.waiting.push(thread.id);
      queued++;
    }
    this.pump();
    return queued;
  }

  /**
   * Settles one thread now with a full run, regardless of its stored
   * revision: `bb workstreams analyze`, and handing a topic back to
   * Workstreams ("Automatic").
   */
  async analyzeNow(threadId: string): Promise<StoredAnalysis | null> {
    return this.run(threadId, true);
  }

  /** A placement preview shares production evidence and parsing but writes no facts. */
  async previewTopic(threadId: string, options: { within?: string } = {}) {
    const sdk = this.deps.sdk();
    const thread = await sdk.threads.get({ threadId });
    const topics = this.deps.topics;
    const placement = this.deps.placement;
    if (
      !topics ||
      !placement ||
      thread.archivedAt !== null ||
      thread.visibility === "hidden"
    )
      throw new Error("That thread is unavailable for classification.");
    const evidence = threadEvidence(thread);
    const assignment = topics.assignment(threadId);
    if (assignment.provenance === "manual" && !options.within)
      throw new Error("Manual topics are preserved.");
    const assignmentKey = assignmentEvidence(assignment);
    const context = await this.context(thread);
    const question = await placement.question(
      { ...thread, sourceThreadId: context.sourceThreadId },
      context.requests.map((r) => r.text),
      { goal: this.get(threadId)?.threadGoal ?? null, force: true, ...options },
    );
    if (!question) throw new Error("The thread has no request to place.");
    const title = displayTitle(thread);
    const { answer, traceId } = await placement.ask(threadId, question, {
      label: `Topic preview: ${title}`,
    });
    this.deps.inference.annotate(traceId, {
      application: "preview only: no facts changed",
    });
    return {
      threadId,
      title,
      from: assignment.label,
      evidence,
      assignmentKey,
      traceId,
      projectHint: question.input.project,
      basis: question.basis,
      answer,
    };
  }

  private schedule(threadId: string, delay: number): void {
    if (this.disposed) return;
    const existing = this.timers.get(threadId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      threadId,
      setTimeout(() => {
        this.timers.delete(threadId);
        if (!this.waiting.includes(threadId)) this.waiting.unshift(threadId);
        this.pump();
      }, delay),
    );
  }

  private pump(): void {
    while (
      !this.disposed &&
      this.inFlight < CONCURRENCY &&
      this.waiting.length > 0
    ) {
      const threadId = this.waiting.shift()!;
      // Run again once the in-flight run finishes; it read the older turn.
      if (this.running.has(threadId)) {
        this.rerun.add(threadId);
        continue;
      }
      void this.run(threadId, false).finally(() => {
        if (this.rerun.delete(threadId) && !this.waiting.includes(threadId))
          this.waiting.unshift(threadId);
        this.pump();
      });
    }
  }

  private async run(
    threadId: string,
    force: boolean,
  ): Promise<StoredAnalysis | null> {
    this.running.set(threadId, (this.running.get(threadId) ?? 0) + 1);
    this.inFlight++;
    let revision = -1;
    const epoch = (this.epochs.get(threadId) ?? 0) + 1;
    this.epochs.set(threadId, epoch);
    try {
      const sdk = this.deps.sdk();
      const thread = await sdk.threads.get({ threadId });
      if (
        thread.archivedAt !== null ||
        thread.visibility === "hidden" ||
        (!force && thread.status !== "idle")
      )
        return null;
      revision = thread.latestAttentionAt ?? thread.updatedAt;
      const evidence = threadEvidence(thread);
      const assignment = this.deps.topics
        ? assignmentEvidence(this.deps.topics.assignment(threadId))
        : null;
      const catalog = this.deps.topics
        ? JSON.stringify(this.deps.topics.entities())
        : null;
      const previous = this.get(threadId);
      if (
        !force &&
        previous &&
        previous.revision >= revision &&
        !previous.topicError &&
        previous.threadGoal !== undefined &&
        !this.settleTopic.has(threadId)
      )
        return previous;
      // A run only to give an already-analyzed root its first topic leaves
      // the turn's goal and status as they were.
      const topicOnly =
        this.settleTopic.delete(threadId) &&
        !force &&
        previous !== undefined &&
        previous.threadGoal !== undefined &&
        previous.revision >= revision;

      const started = this.now();
      if (this.disposed || this.forgotten.has(threadId)) return null;
      const context = await this.context(thread);
      const reported = this.deps.report?.(threadId) ?? null;
      // Requests already titled from need no second look at the title.
      const settled = previous?.requestsKey === context.requestsKey;
      const placing =
        this.deps.placement && this.placement(thread.id).isTask
          ? await this.deps.placement.question(
              { ...thread, sourceThreadId: context.sourceThreadId },
              context.requests.map((r) => r.text),
              { goal: previous?.threadGoal ?? null },
            )
          : null;
      // Placement runs beside Full analysis; it fails on its own.
      const placed = placing
        ? this.deps
            .placement!.ask(threadId, placing, {
              label: displayTitle(thread),
            })
            .then(
              (value) => ({ ok: true as const, ...value }),
              (error: unknown) => ({
                ok: false as const,
                error: error instanceof Error ? error.message : String(error),
              }),
            )
        : null;
      const full = force || !settled || previous?.threadGoal === undefined;
      let result: StoredAnalysis;
      let topicAnswer: PlacementOutput | null = null;
      let topicTraceId: string | null = null;
      if (topicOnly && previous) {
        // Only the topic was missing; the turn's goal and status stand.
        result = { ...previous };
      } else if (!full && reported && previous) {
        // Nothing new to settle, and the agent said how the turn ended.
        result = {
          ...previous,
          ...reported.status,
          reported: true,
          revision,
          at: this.now(),
          traceId: null,
        };
      } else {
        const titledBy = this.titledBy(thread);
        const input: FullAnalysisInput = {
          title: displayTitle(thread),
          titledBy,
          preserveTitle:
            !force &&
            (settled ||
              (previous !== undefined && previous.revision >= revision)),
          threadGoal: previous?.threadGoal ?? null,
          continuation: full
            ? await this.continuation(
                thread.id,
                context.sourceThreadId,
                context.requests,
              )
            : null,
          listing: full ? (this.deps.listing?.(thread) ?? null) : null,
          requests: context.requests,
          lastAssistantText: context.lastAssistantText,
          report: reported?.report ?? null,
          mode: full ? "full" : "status",
        };
        const model = await this.deps.model();
        const asked = this.now();
        const { value: output, traceId } = await this.deps.inference.run(
          "full-analysis",
          input,
          {
            model,
            threadId,
            label: input.title,
            links: [{ kind: "thread", ref: threadId }],
          },
        );
        this.deps.info?.(
          `Analyzed ${threadId}: context ${asked - started} ms, model ${this.now() - asked} ms`,
        );
        const status = reported?.status ?? output.status!;
        // Without a new title the thread keeps its own: one Workstreams wrote
        // or you gave it, or else the title last settled for it, which a turn
        // that started meanwhile kept from being applied.
        const kept =
          input.preserveTitle ||
          titledBy === "workstreams" ||
          titledBy === "you"
            ? input.title
            : (previous?.goal ?? null);
        result = {
          ...status,
          goal: full ? (output.goal ?? kept) : (previous?.goal ?? null),
          threadGoal: full
            ? (output.threadGoal ?? previous?.threadGoal ?? null)
            : (previous?.threadGoal ?? null),
          reported: reported !== null,
          requestsKey: full
            ? context.requestsKey
            : (previous?.requestsKey ?? null),
          revision,
          at: this.now(),
          model: modelLabel(model),
          traceId,
        };
      }
      const placement = await placed;
      // A failed placement is retried with backoff; a result carried over
      // keeps no older failure.
      const { topicError: _carried, ...current } = result;
      void _carried;
      result =
        placement && !placement.ok
          ? { ...current, topicError: placement.error }
          : current;
      if (placement?.ok) {
        topicAnswer = placement.answer;
        topicTraceId = placement.traceId;
      }
      if (this.disposed || this.forgotten.has(threadId)) return null;
      const projectIsCurrent =
        !placing ||
        !this.deps.topics ||
        (await this.deps.topics.project(thread.projectId)) ===
          placing.input.project;
      const live = await sdk.threads.get({ threadId }).catch(() => null);
      if (
        !live ||
        !projectIsCurrent ||
        this.disposed ||
        this.forgotten.has(threadId) ||
        this.epochs.get(threadId) !== epoch ||
        threadEvidence(live) !== evidence ||
        (this.deps.topics &&
          (assignmentEvidence(this.deps.topics.assignment(threadId)) !==
            assignment ||
            JSON.stringify(this.deps.topics.entities()) !== catalog))
      ) {
        for (const id of [result.traceId, topicTraceId])
          this.deps.inference.annotate(id, {
            application:
              "discarded: thread, assignment, or catalog evidence changed",
            evidenceRevision: revision,
          });
        if (
          live?.status === "idle" &&
          !this.disposed &&
          !this.forgotten.has(threadId)
        )
          this.schedule(threadId, DEBOUNCE_MS);
        return null;
      }
      // Application is synchronous after the live check: no newer correction
      // can interleave with these writes on the event loop.
      // Never let a slower run for an older turn replace a newer result.
      const stored = this.deps.db
        .prepare(
          `INSERT INTO ws_analysis (thread_id, revision, at, result) VALUES (?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET revision = excluded.revision, at = excluded.at, result = excluded.result
           WHERE excluded.revision >= ws_analysis.revision`,
        )
        .run(threadId, revision, result.at, JSON.stringify(result));
      this.deps.inference.annotate(
        result.traceId,
        stored.changes > 0
          ? { storedForRevision: revision, evidenceRevision: revision }
          : { stored: "no: a newer turn's analysis was already stored" },
      );
      if (stored.changes > 0 && topicAnswer && placing)
        this.deps.topics?.apply(
          threadId,
          // A forced run is the user asking to settle the topic afresh, so
          // its answer replaces a settled topic the way a scope shift does.
          force ? { ...topicAnswer, scopeShift: true } : topicAnswer,
          placing.basis,
          topicTraceId,
        );
      if (result.topicError) {
        const failed = this.failures.get(threadId);
        const count = failed?.revision === revision ? failed.count + 1 : 1;
        this.failures.set(threadId, { revision, count, at: this.now() });
        this.deps.inference.annotate(result.traceId, {
          topic: "not settled: placement failed; bounded backoff retry",
        });
        if (count < MAX_ATTEMPTS)
          this.schedule(threadId, RETRY_AFTER_MS * 2 ** (count - 1));
      } else this.failures.delete(threadId);
      if ((this.lastText.get(threadId)?.revision ?? Infinity) <= revision)
        this.lastText.delete(threadId);
      this.lastError = null;
      this.deps.onChange();
      if (stored.changes > 0 && !topicOnly)
        this.deps.onResult?.(threadId, result);
      return result;
    } catch (error) {
      const previous = this.failures.get(threadId);
      this.failures.set(threadId, {
        revision,
        count: previous?.revision === revision ? previous.count + 1 : 1,
        at: this.now(),
      });
      this.lastError = error instanceof Error ? error.message : String(error);
      this.deps.log(`Analysis failed for ${threadId}: ${this.lastError}`);
      if (force) throw error;
      return null;
    } finally {
      this.inFlight--;
      const left = (this.running.get(threadId) ?? 1) - 1;
      if (left > 0) this.running.set(threadId, left);
      else this.running.delete(threadId);
    }
  }

  /** The requests and the agent's last reply, bounded for the prompt. */
  private async context(
    thread: Awaited<ReturnType<Sdk["threads"]["get"]>>,
  ): Promise<{
    requests: FullAnalysisInput["requests"];
    requestsKey: string;
    sourceThreadId: string | null;
    lastAssistantText: string | null;
  }> {
    const sdk = this.deps.sdk();
    const [history, first] = await Promise.all([
      sdk.threads.promptHistory({ threadId: thread.id, limit: "50" }),
      sdk.threads.events.list({
        threadId: thread.id,
        types: ["client/turn/requested"],
        order: "asc",
        limit: "4",
      }),
    ]);
    const firstRequest = openingOf(first) ?? "";
    const [clean, cleanFirst] = await Promise.all([
      withoutSubagentDeliveries(
        sdk,
        thread.id,
        history.map((prompt) => inputText(prompt.input)),
      ),
      withoutSubagentDeliveries(sdk, thread.id, [firstRequest]),
    ]);
    const opening = cleanFirst[0] ?? "";
    const recent = clean.filter(isSubstantiveRequest).slice(0, 6).reverse();
    const substantiveOpening = isSubstantiveRequest(opening) ? opening : "";
    const requests = [
      ...(substantiveOpening && !recent.includes(substantiveOpening)
        ? [{ text: substantiveOpening, initial: true }]
        : []),
      ...recent.map((text) => ({ text, initial: text === substantiveOpening })),
    ];
    // The idle event's text describes its own turn only; otherwise read the
    // latest output.
    const cached = this.lastText.get(thread.id);
    let lastAssistantText =
      cached && cached.revision === thread.latestAttentionAt
        ? cached.text
        : null;
    if (lastAssistantText === null)
      lastAssistantText = (await sdk.threads.output({ threadId: thread.id }))
        .output;
    return {
      requests,
      requestsKey: createHash("sha256")
        .update(JSON.stringify(requests.map((r) => r.text)))
        .digest("hex"),
      sourceThreadId: thread.sourceThreadId ?? senderOfStart(first),
      lastAssistantText,
    };
  }

  /** Continuations retain bounded intent, not an entire foreign transcript. */
  private async continuation(
    threadId: string,
    sourceThreadId: string | null,
    requests: FullAnalysisInput["requests"],
  ): Promise<string | null> {
    const referenced = continuationThreadId(
      sourceThreadId,
      requests.map((request) => request.text),
    );
    if (!referenced || referenced === threadId) return null;
    const stored = this.get(referenced);
    try {
      const sdk = this.deps.sdk();
      const first = await sdk.threads.events.list({
        threadId: referenced,
        types: ["client/turn/requested"],
        order: "asc",
        limit: "4",
      });
      return openingOf(first)?.slice(0, 1800) ?? stored?.goal ?? null;
    } catch {
      return stored?.goal ?? null;
    }
  }

  /** Who gave the thread its current title (see `TitledBy`). */
  private titledBy(thread: { id: string; title: string | null }): TitledBy {
    if (thread.title === null) return "none";
    const record = observeThreadTitle(this.deps.db, thread.id, thread.title);
    if (record.locked) return "you";
    return record.written === thread.title ? "workstreams" : "other";
  }

  /**
   * The thread's workstream is its root's section, walked through
   * the reconciler's snapshot of parent links.
   */
  private placement(threadId: string): {
    sectionId: string | null;
    isTask: boolean;
  } {
    const lookup = this.deps.db.prepare(
      "SELECT section_id, parent_thread_id FROM ws_seen_thread WHERE thread_id = ?",
    );
    let current = lookup.get(threadId) as
      | { section_id: string | null; parent_thread_id: string | null }
      | undefined;
    if (!current) return { sectionId: null, isTask: true };
    const isTask =
      current.parent_thread_id === null ||
      lookup.get(current.parent_thread_id) === undefined;
    const seen = new Set([threadId]);
    while (current.parent_thread_id && !seen.has(current.parent_thread_id)) {
      seen.add(current.parent_thread_id);
      const parent = lookup.get(current.parent_thread_id) as
        typeof current | undefined;
      if (!parent) break;
      current = parent;
    }
    return { sectionId: current.section_id, isTask };
  }
}
