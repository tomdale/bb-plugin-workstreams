/**
 * A thread's start: one call names a new thread from its first request and,
 * for a root, chooses its topic (see `domain/start.ts`), while its first turn
 * is still running. The thread is titled and filed within seconds instead of
 * after a turn that may take an hour; the turn-end call settles both later.
 *
 * Everything here is best effort and apart from the turn it describes:
 *
 * - Nothing waits on it. `onDispatch` runs inside BB's admission checkpoint,
 *   which fails the message if its handler throws or is slow, so it only
 *   decides whether to start the call, and never throws.
 * - A failed call is retried twice, then left to the turn's end. A newer
 *   request (`cancel`), deletion, or disposal stops it.
 * - A thread is tried once per run. The title is applied only while the
 *   thread has no title of its own and its first turn is the evidence (the
 *   retitle policy re-checks at the write); the topic only while nothing else
 *   has settled it (`unsettled`).
 * - Hidden threads, which the workflows and subagents plugins start, are
 *   never listed, so they get neither.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { clip, type ThreadListing } from "../domain/analysis.ts";
import type { PlacementOutput } from "../domain/placement.ts";
import type { ModelChoice } from "../domain/prefs.ts";
import type { InventoryThread } from "./inventory.ts";
import type { Inference } from "./model.ts";
import type { PlacementQuestion, PlacementThread } from "./placement.ts";
import { isUserRequest, openingRequest } from "./requests.ts";
import { threadEvidence } from "./evidence.ts";

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

/** What decides whether a thread can be named and filed from its request. */
export type OpeningThread = PlacementThread & {
  readonly visibility: string;
  readonly archivedAt: number | null;
  readonly latestAttentionAt?: number | null;
  readonly updatedAt: number;
};

/**
 * What the composer's preview already answered for the text sent: its title
 * (null when the request says nothing), and its topic unless the topic must
 * still be asked. An omitted title is asked too.
 */
export type StartPreset = {
  readonly title?: string | null;
  readonly topic?: PlacementOutput;
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
      /** What filing a root from its first request asks (see `Placement`). */
      question: (
        thread: OpeningThread,
        request: string,
      ) => Promise<PlacementQuestion | null>;
      /** Whether nothing else has settled the root's topic. */
      unsettled: (threadId: string) => boolean;
      /** Applies a topic answer under the source priority. */
      file: (
        threadId: string,
        answer: PlacementOutput,
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
  }

  /**
   * A thread's first message was admitted and the thread is filed from where
   * it started, so the call reads its inherited topic and hints. What the
   * composer's preview answered for this text (`preset`) is applied as is,
   * and only the rest is asked. Never rejects.
   */
  async onFirstRequest(
    ctx: OpeningDispatch,
    preset: StartPreset = {},
  ): Promise<void> {
    try {
      if (ctx.attempt !== "start-turn" || ctx.origin === null) return;
      const thread = ctx.thread;
      if (!this.available(thread) || this.tried.has(thread.id)) return;
      this.tried.add(thread.id);
      const request = ctx.input.text.trim();
      if (preset.title && this.deps.titles())
        void this.deps
          .title(thread.id, preset.title, revisionOf(thread), null)
          .catch((error: unknown) =>
            this.deps.log(`Titling ${thread.id} failed: ${String(error)}`),
          );
      if (
        preset.topic &&
        !thread.parentThreadId &&
        this.deps.unsettled(thread.id)
      ) {
        // The basis records which requests settled the topic.
        const question = await this.deps.question(thread, request);
        if (question && this.deps.unsettled(thread.id))
          this.deps.file(thread.id, preset.topic, question.basis, null);
      }
      await this.start(thread, request, {
        title: preset.title === undefined,
        topic: preset.topic === undefined,
      });
    } catch (error) {
      this.deps.log(`Starting ${ctx.thread.id} failed: ${String(error)}`);
    }
  }

  /**
   * A thread is running without a title. Reads its opening request, which
   * covers a thread whose dispatch this run never saw (the plugin loaded
   * mid-turn, or the hook missed it); its topic waits for the turn's end.
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
    want: { title: boolean; topic?: boolean },
  ): Promise<void> {
    if (!isUserRequest(request)) return;
    let title = want.title && this.titleWanted(thread);
    const root = want.topic === true && !thread.parentThreadId;
    if (!title && !(root && this.deps.unsettled(thread.id))) return;

    this.running.get(thread.id)?.abort();
    const controller = new AbortController();
    this.running.set(thread.id, controller);
    const revision = revisionOf(thread);
    const evidence = threadEvidence({ ...thread, status: undefined });
    const topicWanted = () =>
      root && !controller.signal.aborted && this.deps.unsettled(thread.id);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          // Asked again on each attempt, so a retry reads the current tree.
          const question = topicWanted()
            ? await this.deps.question(thread, request)
            : null;
          // A root with nothing to place by settles "no topic" without a call.
          if (question?.settled)
            this.deps.file(thread.id, question.settled, question.basis, null);
          const placing = question && !question.settled ? question : null;
          if (!title && !placing) return;
          const { value, traceId } = await this.deps.inference.run(
            "start",
            {
              request,
              project: placing?.input.project ?? null,
              placement: placing
                ? (({ requests: _r, title: _t, ...rest }) => rest)(
                    placing.input,
                  )
                : null,
              listing: placing ? null : this.deps.listing(thread),
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
          // An invalid topic is asked again; the title already stands.
          if (placing && value.topicError) throw new Error(value.topicError);
          // The thread may have been filed or corrected while the call ran.
          if (placing && value.topic && topicWanted())
            this.deps.file(thread.id, value.topic, placing.basis, traceId);
          else if (placing)
            this.deps.inference.annotate(traceId, {
              topic: "not applied: the thread's topic was settled meanwhile",
            });
          return;
        } catch (error) {
          if (controller.signal.aborted || this.disposed) return;
          this.deps.log(`Starting ${thread.id} failed: ${String(error)}`);
          const wait = RETRY_DELAYS_MS[attempt];
          if (wait === undefined) return;
          await delay(wait, controller.signal);
          if (!topicWanted() && !(title && this.titleWanted(thread))) return;
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
