/**
 * Placement: one closed-set call settles a root's topic from its
 * requests, when the thread starts and again when a turn ends after a new
 * request. The analyzer asks and applies it alongside Full analysis, with the
 * same freshness checks; the first request is placed here directly.
 *
 * Its evidence is the generated title, the first, second, and latest
 * substantive requests, the outcome Full analysis settled, the project,
 * and the checkout, plus hints:
 *
 * - the topic of the thread it continues or was started from, and of the
 *   workstream whose ＋ started it when that topic holds subtopics;
 * - the topic most threads in its checkout have, unless the checkout is a
 *   coordination workspace, one whose threads point at other repositories
 *   (at least two of them name a GitHub repository or a `~/Code` path
 *   outside it), where location says nothing about the work.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ModelChoice } from "../domain/prefs.ts";
import type { PlacementInput, PlacementOutput } from "../domain/placement.ts";
import {
  parsePlacementGate,
  placementGateQuestion,
} from "../domain/placementGate.ts";
import { topicPath } from "../domain/topic-path.ts";
import type { Database } from "./db.ts";
import type { Inference } from "./model.ts";
import { isSubstantiveRequest, placementRequests } from "./requests.ts";
import { continuationThreadId } from "./requestProvenance.ts";
import type { TopicStore } from "./topics.ts";

type Sdk = BbPluginApi["sdk"];

/** What placement reads from a BB thread. */
export type PlacementThread = {
  readonly id: string;
  readonly title: string | null;
  readonly projectId: string;
  readonly environmentId?: string | null;
  readonly sourceThreadId?: string | null;
  readonly parentThreadId?: string | null;
};

export type PlacementQuestion = {
  input: PlacementInput;
  basis: string;
  /** The answer when no call is needed: a root with nothing to place by. */
  settled?: PlacementOutput;
};

/** Each first-send attempt is bounded; the turn's end places it otherwise. */
const FIRST_REQUEST_TIMEOUT_MS = 15_000;
const FIRST_REQUEST_RETRY_DELAYS_MS = [1_000, 2_000];
/** A gate answer either arrives while the thread starts or stops mattering. */
const GATE_TIMEOUT_MS = 8_000;

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

export class Placement {
  /** Hints recorded before a thread's first request is placed. */
  private readonly startHints = new Map<string, string>();
  private readonly checkouts = new Map<string, string | null>();
  private readonly firstRequests = new Map<string, AbortController>();
  private disposed = false;

  constructor(
    private readonly deps: {
      sdk: () => Sdk;
      db: Database;
      inference: Inference;
      model: () => Promise<ModelChoice>;
      /**
       * Placement's gate: the decision model that answers its closed choice,
       * or null when the gate is off. A confident answer replaces the call;
       * everything else falls back to it.
       */
      gate: () => ModelChoice | null;
      topics: TopicStore;
      project: (projectId: string) => Promise<string | null>;
      /** The basis an automatic topic is settled from. */
      basisOf: (requests: readonly string[], project: string | null) => string;
      /** Applies an answer under the source priority. */
      apply: (
        threadId: string,
        answer: PlacementOutput,
        basis: string,
        traceId: string | null,
      ) => void;
      log: (message: string) => void;
    },
  ) {}

  /**
   * Remembers where a new thread was started from when that topic couldn't
   * be inherited (it holds subtopics), so placement weighs it.
   */
  hintStart(
    threadId: string,
    topicId: string,
    from: "thread" | "workstream" | "picked",
  ) {
    const label = this.label(topicId);
    if (!label) return;
    this.startHints.set(
      threadId,
      from === "workstream"
        ? `It was started from the ${label} workstream.`
        : from === "picked"
          ? `It was started with the topic ${label}, which now has subtopics.`
          : `It was started from a thread filed under ${label}.`,
    );
    if (this.startHints.size > 200)
      this.startHints.delete(this.startHints.keys().next().value!);
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.firstRequests.values()) controller.abort();
    this.firstRequests.clear();
  }

  cancelFirstRequest(threadId: string): void {
    this.firstRequests.get(threadId)?.abort();
    this.firstRequests.delete(threadId);
  }

  forget(threadId: string): void {
    this.cancelFirstRequest(threadId);
    this.startHints.delete(threadId);
    this.deps.db
      .prepare("DELETE FROM ws_thread_checkout WHERE thread_id = ?")
      .run(threadId);
  }

  /**
   * What placing a root from these requests would ask, or null when there is
   * nothing to settle: you set its topic, or it was settled from these
   * requests.
   */
  async question(
    thread: PlacementThread,
    rawRequests: readonly string[],
    options: { force?: boolean; within?: string; goal?: string | null } = {},
  ): Promise<PlacementQuestion | null> {
    const topics = this.deps.topics;
    const assignment = topics.assignment(thread.id);
    if (assignment.provenance === "manual" && !options.within) return null;
    const requests = placementRequests(rawRequests);
    // With neither a substantive request nor a title there is nothing to
    // place by; settling "no topic" keeps the root from being asked again
    // until a request arrives.
    const blank = requests.length === 0 && !thread.title;
    if (blank && options.within)
      throw new Error(
        "The thread has no request or title to choose a topic from.",
      );
    if (blank && assignment.provenance !== null) return null;
    const project = await this.deps.project(thread.projectId);
    const basis = this.deps.basisOf(rawRequests, project);
    if (
      !options.force &&
      assignment.provenance !== null &&
      assignment.provenance !== "quick" &&
      topics.basis(thread.id) === basis
    )
      return null;
    const checkout = await this.checkout(thread.environmentId ?? null);
    if (checkout) this.observe(thread.id, checkout, rawRequests);
    const entities = topics.list();
    return {
      basis,
      ...(blank
        ? { settled: { subjectId: null, proposed: null, scopeShift: false } }
        : {}),
      input: {
        title: thread.title,
        ...(options.within ? { within: options.within } : {}),
        requests,
        project,
        checkout,
        entities,
        counts: this.counts(),
        hints: this.hints(thread, rawRequests, checkout),
        current: assignment.label
          ? {
              label: assignment.label,
              inherited: assignment.provenance === "inherited",
            }
          : null,
        goal: options.goal ?? null,
      },
    };
  }

  /** Asks the model; throws when the call fails or its answer is invalid. */
  async ask(
    threadId: string,
    question: PlacementQuestion,
    options: { label: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{ answer: PlacementOutput; traceId: string | null }> {
    if (question.settled) return { answer: question.settled, traceId: null };
    const gated = await this.askGate(threadId, question, options);
    if (gated) return gated;
    const { value, traceId } = await this.deps.inference.run(
      "placement",
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

  /**
   * The confident pick, before the generative call: the same closed choice as
   * a typed question. Null means ask the model — the gate is off or couldn't
   * answer this tree, its answer was not confident enough, or asking it
   * failed. A failure never fails the placement.
   */
  private async askGate(
    threadId: string,
    question: PlacementQuestion,
    options: { label: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{ answer: PlacementOutput; traceId: string | null } | null> {
    const model = this.deps.gate();
    if (!model) return null;
    const asked = placementGateQuestion(question.input);
    if (!asked) return null;
    try {
      const decided = await this.deps.inference.gate({
        kind: "placement",
        input: question.input,
        question: asked,
        model,
        callLabel: "Placement gate",
        label: options.label,
        threadId,
        links: [{ kind: "thread", ref: threadId }],
        timeoutMs: Math.min(
          options.timeoutMs ?? GATE_TIMEOUT_MS,
          GATE_TIMEOUT_MS,
        ),
        signal: options.signal,
        decide: (answers) => {
          const picked = parsePlacementGate(answers, question.input);
          if (!picked) return null;
          const label = this.label(picked.answer.subjectId ?? "");
          return {
            value: picked.answer,
            summary: `${label ?? "no topic"} · ${picked.confidence.toFixed(2)} confidence`,
          };
        },
      });
      if (!decided) return null;
      return { answer: decided.value, traceId: decided.traceId };
    } catch (error) {
      // An abort means placement stopped mattering; anything else is the
      // gate's own failure, which the generative call absorbs.
      if (options.signal?.aborted) throw error;
      this.deps.log(`Placement gate fell back: ${String(error)}`);
      return null;
    }
  }

  /**
   * Places a root from its first request, right after it was filed from
   * where it started. Never rejects; the turn's end places it otherwise.
   */
  async onFirstRequest(thread: PlacementThread, text: string): Promise<void> {
    if (this.disposed || thread.parentThreadId) return;
    this.firstRequests.get(thread.id)?.abort();
    const controller = new AbortController();
    this.firstRequests.set(thread.id, controller);
    const unsettled = () =>
      !controller.signal.aborted &&
      this.deps.topics.assignment(thread.id).provenance !== "manual" &&
      !this.deps.topics.basis(thread.id);
    try {
      for (let attempt = 0; unsettled(); attempt++) {
        try {
          const question = await this.question(thread, [text]);
          if (!question || !unsettled()) return;
          const { answer, traceId } = await this.ask(thread.id, question, {
            label: thread.title ?? text.slice(0, 60),
            timeoutMs: FIRST_REQUEST_TIMEOUT_MS,
            signal: controller.signal,
          });
          // The thread may have been settled or corrected while the call ran.
          if (!unsettled()) return;
          this.deps.apply(thread.id, answer, question.basis, traceId);
          this.startHints.delete(thread.id);
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          this.deps.log(`Placing ${thread.id} failed: ${String(error)}`);
          const wait = FIRST_REQUEST_RETRY_DELAYS_MS[attempt];
          if (wait === undefined) return;
          await delay(wait, controller.signal);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted)
        this.deps.log(`Placing ${thread.id} failed: ${String(error)}`);
    } finally {
      if (this.firstRequests.get(thread.id) === controller)
        this.firstRequests.delete(thread.id);
    }
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

  private label(topicId: string): string | null {
    try {
      return topicPath(topicId, this.deps.topics.list());
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

  /** Visible roots assigned to each topic. */
  private counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of this.deps.db
      .prepare(
        `SELECT s.entity_id AS id, COUNT(*) AS n FROM ws_corpus_subject s
         JOIN ws_seen_thread t ON t.thread_id = s.thread_id
         WHERE s.entity_id IS NOT NULL GROUP BY s.entity_id`,
      )
      .all() as { id: string; n: number }[])
      out[row.id] = row.n;
    return out;
  }

  private hints(
    thread: PlacementThread,
    requests: readonly string[],
    checkout: string | null,
  ): string[] {
    const hints: string[] = [];
    const started = this.startHints.get(thread.id);
    if (started) hints.push(started);
    const referenced = continuationThreadId(thread.sourceThreadId, requests);
    if (referenced && referenced !== thread.id) {
      const source = this.deps.topics.assignment(referenced);
      if (source.label)
        hints.push(`It continues a thread filed under ${source.label}.`);
    }
    if (checkout && !this.coordinates(checkout)) {
      const usual = this.usualTopic(checkout, thread.id);
      if (usual)
        hints.push(`Threads in its checkout are usually filed under ${usual}.`);
    }
    return hints;
  }

  /** The topic most of a checkout's other threads have, when one clearly leads. */
  private usualTopic(checkout: string, threadId: string): string | null {
    const rows = this.deps.db
      .prepare(
        `SELECT s.entity_id AS id, COUNT(*) AS n FROM ws_thread_checkout c
         JOIN ws_corpus_subject s ON s.thread_id = c.thread_id
         WHERE c.path = ? AND c.thread_id != ? AND s.entity_id IS NOT NULL
         GROUP BY s.entity_id ORDER BY n DESC`,
      )
      .all(checkout, threadId) as { id: string; n: number }[];
    const total = rows.reduce((sum, row) => sum + row.n, 0);
    const lead = rows[0];
    if (!lead || lead.n < 2 || lead.n * 2 <= total) return null;
    return this.label(lead.id);
  }
}
