/**
 * Opening titles: Quick analysis names a new thread from its first request
 * while its first turn is still running, so the thread is titled within
 * seconds instead of after a turn that may take an hour. Placement files it
 * meanwhile, and Full analysis of the first finished turn settles the title.
 *
 * Everything here is best effort and apart from the turn it describes:
 *
 * - Nothing waits on it. `onDispatch` runs inside BB's admission checkpoint,
 *   which fails the message if its handler throws or is slow, so it only
 *   decides whether to start the call, and never throws.
 * - A failed or slow call is logged and forgotten; Full analysis covers it.
 * - A thread is tried once per run, and titled only while it has no title of
 *   its own (the retitle policy re-checks at the write).
 * - When the New thread composer already named the text that was sent, that
 *   title is applied as is, with no second call.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { clip, type ThreadListing } from "../domain/analysis.ts";
import type { ModelChoice } from "../domain/prefs.ts";
import type { Database } from "./db.ts";
import type { InventoryThread } from "./inventory.ts";
import type { Inference } from "./model.ts";
import { isUserRequest, openingRequest } from "./requests.ts";
import { threadEvidence } from "./evidence.ts";

type Sdk = BbPluginApi["sdk"];

/** Gives up on a model that hasn't answered; Full analysis covers it. */
export const OPENING_TIMEOUT_MS = 15_000;
/**
 * Calls in flight at once. A thread that finds them busy isn't marked tried,
 * so its next `thread.active` or the next sweep can name it; otherwise its
 * analysis does.
 */
const MAX_IN_FLIGHT = 4;
/** A call's debug label is the request's opening words, as BB shows them. */
const LABEL_MAX = 60;

/** What decides whether a thread can be named from its opening request. */
export type OpeningThread = {
  readonly id: string;
  readonly title: string | null;
  readonly projectId?: string;
  readonly parentThreadId?: string | null;
  readonly visibility: string;
  readonly archivedAt: number | null;
  readonly latestAttentionAt?: number | null;
  readonly updatedAt: number;
};

/** The part of BB's `message.dispatch` context that tells a first message. */
export type OpeningDispatch = {
  readonly thread: OpeningThread;
  readonly attempt: string;
  /** Set on a thread's first message; follow-ups, steers, and retries have none. */
  readonly origin: unknown;
  readonly input: { readonly text: string };
};

export class QuickAnalysis {
  /** Threads tried in this run, however it went: at most one call each. */
  private readonly tried = new Set<string>();
  private inFlight = 0;
  private disposed = false;

  constructor(
    private readonly deps: {
      sdk: () => Sdk;
      db: Database;
      inference: Inference;
      model: () => Promise<ModelChoice>;
      /** Whether Workstreams may write titles (`threads.autoTitle`). */
      enabled: () => boolean;
      /** Whether a finished turn of the thread has been analyzed. */
      analyzed: (threadId: string) => boolean;
      /**
       * Applies the goal as the thread's title, under the retitle policy and
       * the `autoTitle` preference, and records the outcome on the trace.
       */
      apply: (
        threadId: string,
        goal: string,
        revision: number,
        traceId: string | null,
      ) => Promise<void>;
      /** Where the thread is listed, so its title needn't repeat it. */
      listing?: (thread: OpeningThread) => ThreadListing;
      log: (message: string) => void;
    },
  ) {}

  dispose(): void {
    this.disposed = true;
  }

  /** Lets a deleted thread's id go. */
  forget(threadId: string): void {
    this.tried.delete(threadId);
  }

  /**
   * A message is being admitted. A thread's first one is the earliest its
   * request is known: BB records the request only after admission. Queued
   * messages and retries come back through here, so a thread is tried once.
   */
  onDispatch(ctx: OpeningDispatch, preset?: string | null): void {
    try {
      if (ctx.attempt !== "start-turn" || ctx.origin === null) return;
      if (preset) this.applyPreset(ctx.thread, preset);
      else this.begin(ctx.thread, ctx.input.text.trim());
    } catch (error) {
      this.deps.log(`Quick analysis failed: ${String(error)}`);
    }
  }

  /** Applies the title the composer previewed for the text that was sent. */
  private applyPreset(thread: OpeningThread, title: string) {
    if (!this.eligible(thread)) return;
    this.tried.add(thread.id);
    const revision = thread.latestAttentionAt ?? thread.updatedAt;
    void this.deps
      .apply(thread.id, title, revision, null)
      .catch((error: unknown) =>
        this.deps.log(`Quick title for ${thread.id} failed: ${String(error)}`),
      );
  }

  /**
   * A thread is running without a title. Reads its opening request, which
   * covers a thread whose dispatch this run never saw (the plugin loaded
   * mid-turn, or the hook missed it). Never rejects.
   */
  async onRunning(thread: OpeningThread): Promise<void> {
    try {
      if (!this.eligible(thread)) return;
      const request = await openingRequest(this.deps.sdk(), thread.id);
      if (request) this.begin(thread, request);
    } catch (error) {
      this.deps.log(`Quick analysis for ${thread.id} failed: ${String(error)}`);
    }
  }

  /**
   * Names the running threads that have no title, which the reconciler finds
   * after a reload or a missed event.
   */
  sweep(threads: readonly InventoryThread[]): void {
    for (const candidate of threads) {
      if (
        candidate.ownTitle !== null ||
        candidate.status === "idle" ||
        candidate.status === "error" ||
        !this.available(candidate.id)
      )
        continue;
      void this.deps
        .sdk()
        .threads.get({ threadId: candidate.id })
        .then((thread) => this.onRunning(thread))
        .catch((error: unknown) =>
          this.deps.log(
            `Opening title for ${candidate.id} failed: ${String(error)}`,
          ),
        );
    }
  }

  /** Whether the thread may be titled now. Cheap checks first: this runs often. */
  private eligible(thread: OpeningThread): boolean {
    return (
      thread.title === null &&
      thread.visibility !== "hidden" &&
      thread.archivedAt === null &&
      this.available(thread.id)
    );
  }

  /** What Workstreams alone knows about whether a thread may be named now. */
  private available(threadId: string): boolean {
    return (
      !this.disposed &&
      !this.tried.has(threadId) &&
      this.inFlight < MAX_IN_FLIGHT &&
      this.deps.enabled() &&
      // A thread whose turn was analyzed is named by its analysis.
      !this.deps.analyzed(threadId)
    );
  }

  private begin(thread: OpeningThread, request: string): void {
    if (!isUserRequest(request) || !this.eligible(thread)) return;
    this.tried.add(thread.id);
    this.inFlight++;
    void this.run(thread, request)
      .catch((error: unknown) =>
        this.deps.log(
          `Quick analysis for ${thread.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => {
        this.inFlight--;
      });
  }

  private async run(thread: OpeningThread, request: string): Promise<void> {
    // Anything that has happened to the thread since is the retitle policy's
    // to weigh against this revision.
    const revision = thread.latestAttentionAt ?? thread.updatedAt;
    const evidence = threadEvidence({ ...thread, status: undefined });
    const { value, traceId } = await this.deps.inference.run(
      "quick-analysis",
      {
        request,
        entities: null,
        listing: this.deps.listing?.(thread) ?? null,
      },
      {
        model: await this.deps.model(),
        threadId: thread.id,
        label: clip(request, LABEL_MAX),
        links: [{ kind: "thread", ref: thread.id }],
        timeoutMs: OPENING_TIMEOUT_MS,
      },
    );
    if (this.disposed) return;
    const live = await this.deps
      .sdk()
      .threads.get({ threadId: thread.id })
      .catch(() => null);
    if (
      !live ||
      live.status === "idle" ||
      live.status === "error" ||
      this.deps.analyzed(thread.id) ||
      threadEvidence({ ...live, status: undefined }) !== evidence
    ) {
      this.deps.inference.annotate(traceId, {
        application: "discarded: opening evidence changed",
        evidenceRevision: revision,
      });
      return;
    }
    if (!value.goal) {
      this.deps.inference.annotate(traceId, {
        title: "not applied: the request doesn't say what the work is",
      });
      return;
    }
    await this.deps.apply(thread.id, value.goal, revision, traceId);
  }
}
