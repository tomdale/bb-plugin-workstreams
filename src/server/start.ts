/**
 * A thread's start: one call names a new thread from its first request and, for
 * a thread with no parent, chooses its workstream (see `domain/start.ts`),
 * while its first turn is still running. The thread is titled and moved to its
 * workstream within seconds instead of after a turn that may take an hour; the
 * turn-end call settles both later.
 *
 * Everything here is best effort and apart from the turn it describes:
 *
 * - Nothing waits on it. `onDispatch` runs inside BB's admission checkpoint,
 *   which fails the message if its handler throws or is slow, so it only
 *   decides whether to start the call, and never throws.
 * - A failed call is retried twice, then left to the turn's end. A newer
 *   request (`cancel`), deletion, or disposal stops it.
 * - A call a spend cap refused (`SpendCapError`) is not retried. Its thread
 *   may be tried once more when the pause lifts (`runDeferred`).
 * - A thread is tried once per run. The title is applied only while the
 *   thread has no title of its own and its first turn is the evidence (the
 *   retitle policy re-checks at the write); the workstream only while nothing else
 *   has settled it (`unsettled`).
 * - Hidden threads, which the workflows and subagents plugins start, are
 *   never listed, so they get neither.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { clip, type ThreadListing } from "../domain/analysis.ts";
import type { WorkstreamChoiceOutput } from "../domain/workstreamChoice.ts";
import type { ModelChoice } from "../domain/prefs.ts";
import type { InventoryThread } from "./inventory.ts";
import type { Inference } from "./model.ts";
import type { ChoiceQuestion, ChoiceThread } from "./workstreamChoice.ts";
import { isUserRequest, openingRequest } from "./requests.ts";
import { threadEvidence } from "./evidence.ts";
import { SpendCapError } from "./spendGuard.ts";

type Sdk = BbPluginApi["sdk"];

/** Each attempt is bounded; the turn's end covers a thread otherwise. */
const ATTEMPT_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [1_000, 2_000];
/**
 * Title-only calls in flight at once, for threads found running without a
 * title (a reload, a missed event). A thread that finds them busy isn't
 * marked tried, so the next sweep can name it.
 */
const MAX_SWEEP_IN_FLIGHT = 4;
/** A call's debug label is the request's opening words, as BB shows them. */
const LABEL_MAX = 60;

/**
 * What decides whether a thread can be named and given a workstream from its
 * request.
 */
export type OpeningThread = ChoiceThread & {
  readonly visibility: string;
  readonly archivedAt: number | null;
  readonly latestAttentionAt?: number | null;
  readonly updatedAt: number;
};

/** The part of BB's `message.dispatch` context that tells a first message. */
type OpeningDispatch = {
  readonly thread: OpeningThread;
  readonly attempt: string;
  /** Set on a thread's first message; follow-ups, steers, and retries have none. */
  readonly origin: unknown;
  readonly input: { readonly text: string };
};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class ThreadStart {
  /** Threads tried in this run, however it went: at most one start each. */
  private readonly tried = new Set<string>();
  /** Tried threads whose call a spend cap refused; see `runDeferred`. */
  private readonly deferred = new Set<string>();
  private readonly running = new Map<string, AbortController>();
  private sweeping = 0;
  private disposed = false;

  constructor(
    private readonly deps: {
      sdk: () => Sdk;
      inference: Inference;
      model: () => Promise<ModelChoice>;
      /** Whether Workstreams may write titles (`threads.autoTitle`). */
      titles: () => boolean;
      /** Whether a finished turn of the thread has been analyzed. */
      analyzed: (threadId: string) => boolean;
      /**
       * Applies the title under the retitle policy and the `autoTitle`
       * preference, and records the outcome on the trace.
       */
      title: (
        threadId: string,
        title: string,
        revision: number,
        traceId: string | null,
      ) => Promise<void>;
      /** Where a child thread is listed, so its title needn't repeat it. */
      listing: (thread: OpeningThread) => ThreadListing;
      /**
       * What choosing a thread's workstream from its first request asks (see
       * `WorkstreamChoice`).
       */
      question: (
        thread: OpeningThread,
        request: string,
      ) => Promise<ChoiceQuestion | null>;
      /** Whether nothing else has settled the thread's workstream. */
      unsettled: (threadId: string) => boolean;
      /** Applies a workstream answer under the source priority. */
      applyWorkstream: (
        threadId: string,
        answer: WorkstreamChoiceOutput,
        basis: string,
        traceId: string | null,
      ) => void;
      log: (message: string) => void;
    },
  ) {}

  dispose(): void {
    this.disposed = true;
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
  }

  /** A newer request supersedes the first one: the turn's end decides. */
  cancel(threadId: string): void {
    this.running.get(threadId)?.abort();
    this.running.delete(threadId);
  }

  /** Lets a deleted thread's id go. */
  forget(threadId: string): void {
    this.cancel(threadId);
    this.tried.delete(threadId);
    this.deferred.delete(threadId);
  }

  /**
   * A thread's first message was admitted and the thread's workstream is chosen
   * from where it started, so the call reads its inherited workstream and
   * hints. The start call titles the thread and chooses its workstream; a
   * workstream the composer showed holds the thread until it answers. Never
   * rejects.
   */
  async onFirstRequest(ctx: OpeningDispatch): Promise<void> {
    try {
      if (ctx.attempt !== "start-turn" || ctx.origin === null) return;
      const thread = ctx.thread;
      if (!this.available(thread) || this.tried.has(thread.id)) return;
      this.tried.add(thread.id);
      await this.start(thread, ctx.input.text.trim(), {
        title: true,
        workstream: true,
      });
    } catch (error) {
      this.deps.log(`Starting ${ctx.thread.id} failed: ${String(error)}`);
    }
  }

  /**
   * A thread is running without a title. Reads its opening request, which
   * covers a thread whose dispatch this run never saw (the plugin loaded
   * mid-turn, or the hook missed it); its workstream waits for the turn's end.
   * Never rejects.
   */
  async onRunning(thread: OpeningThread): Promise<void> {
    try {
      if (
        !this.available(thread) ||
        this.tried.has(thread.id) ||
        !this.titleWanted(thread) ||
        this.sweeping >= MAX_SWEEP_IN_FLIGHT
      )
        return;
      this.tried.add(thread.id);
      this.sweeping++;
      try {
        const request = await openingRequest(this.deps.sdk(), thread.id);
        if (request) await this.start(thread, request, { title: true });
      } finally {
        this.sweeping--;
      }
    } catch (error) {
      this.deps.log(`Titling ${thread.id} failed: ${String(error)}`);
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
        this.tried.has(candidate.id) ||
        this.disposed ||
        !this.deps.titles() ||
        this.deps.analyzed(candidate.id)
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

  /**
   * A spend pause lifted: the threads it refused count as untried again, and
   * those still running without a title are named. A workstream it left
   * unchosen is settled by the turn's end.
   */
  runDeferred(threads: readonly InventoryThread[]): void {
    for (const threadId of this.deferred) this.tried.delete(threadId);
    this.deferred.clear();
    this.sweep(threads);
  }

  /** Whether the thread may be started at all. Cheap: this runs often. */
  private available(thread: OpeningThread): boolean {
    return (
      !this.disposed &&
      thread.visibility !== "hidden" &&
      thread.archivedAt === null
    );
  }

  /** Whether the thread still wants an opening title. */
  private titleWanted(thread: OpeningThread): boolean {
    return (
      thread.title === null &&
      this.deps.titles() &&
      // A thread whose turn was analyzed is named by its analysis.
      !this.deps.analyzed(thread.id)
    );
  }

  private async start(
    thread: OpeningThread,
    request: string,
    want: { title: boolean; workstream?: boolean },
  ): Promise<void> {
    if (!isUserRequest(request)) return;
    let title = want.title && this.titleWanted(thread);
    const choosing = want.workstream === true && !thread.parentThreadId;
    if (!title && !(choosing && this.deps.unsettled(thread.id))) return;

    this.running.get(thread.id)?.abort();
    const controller = new AbortController();
    this.running.set(thread.id, controller);
    const revision = revisionOf(thread);
    const evidence = threadEvidence({ ...thread, status: undefined });
    const workstreamWanted = () =>
      choosing && !controller.signal.aborted && this.deps.unsettled(thread.id);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          // Asked again on each attempt, so a retry reads the current tree.
          const question = workstreamWanted()
            ? await this.deps.question(thread, request)
            : null;
          // A thread with nothing to choose by settles "no workstream" without
          // a call.
          if (question?.settled)
            this.deps.applyWorkstream(
              thread.id,
              question.settled,
              question.basis,
              null,
            );
          const asking = question && !question.settled ? question : null;
          if (!title && !asking) return;
          const { value, traceId } = await this.deps.inference.run(
            "start",
            {
              request,
              project: asking?.input.project ?? null,
              choice: asking
                ? (({ requests: _r, title: _t, ...rest }) => rest)(asking.input)
                : null,
              listing: asking ? null : this.deps.listing(thread),
            },
            {
              model: await this.deps.model(),
              threadId: thread.id,
              label: clip(request, LABEL_MAX),
              links: [{ kind: "thread", ref: thread.id }],
              timeoutMs: ATTEMPT_TIMEOUT_MS,
              signal: controller.signal,
            },
          );
          if (this.disposed || controller.signal.aborted) return;
          if (title) {
            await this.applyTitle(
              thread,
              value.title,
              revision,
              evidence,
              traceId,
            );
            title = false;
          }
          // An invalid workstream is asked again; the title already stands.
          if (asking && value.workstreamError)
            throw new Error(value.workstreamError);
          // The thread may have been moved or corrected while the call ran.
          if (asking && value.workstream && workstreamWanted())
            this.deps.applyWorkstream(
              thread.id,
              value.workstream,
              asking.basis,
              traceId,
            );
          else if (asking)
            this.deps.inference.annotate(traceId, {
              workstream:
                "not applied: the thread's workstream was chosen meanwhile",
            });
          return;
        } catch (error) {
          if (controller.signal.aborted || this.disposed) return;
          if (error instanceof SpendCapError) {
            this.deferred.add(thread.id);
            return;
          }
          this.deps.log(`Starting ${thread.id} failed: ${String(error)}`);
          const wait = RETRY_DELAYS_MS[attempt];
          if (wait === undefined) return;
          await delay(wait, controller.signal);
          if (!workstreamWanted() && !(title && this.titleWanted(thread)))
            return;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted)
        this.deps.log(`Starting ${thread.id} failed: ${String(error)}`);
    } finally {
      if (this.running.get(thread.id) === controller)
        this.running.delete(thread.id);
    }
  }

  /** Applies the opening title while the first turn is still its evidence. */
  private async applyTitle(
    thread: OpeningThread,
    title: string | null,
    revision: number,
    evidence: string,
    traceId: string | null,
  ): Promise<void> {
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
        application: "title discarded: opening evidence changed",
        evidenceRevision: revision,
      });
      return;
    }
    if (!title) {
      this.deps.inference.annotate(traceId, {
        title: "not applied: the request doesn't say what the work is",
      });
      return;
    }
    await this.deps.title(thread.id, title, revision, traceId);
  }
}

/** Anything that happens to the thread later is weighed against this. */
const revisionOf = (thread: OpeningThread) =>
  thread.latestAttentionAt ?? thread.updatedAt;
