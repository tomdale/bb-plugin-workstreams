/**
 * Enhanced responses: after a turn in a visible root thread ends, find the
 * assistant message it ended with, compose an enhanced document for it, and
 * store the document under that message's id for the app to draw below it.
 *
 * The working agent is never involved: composition starts after its turn has
 * ended, nothing is sent to its thread, and a failure leaves only a log line.
 * A message gets at most one composition, so a repeated idle event, a reload,
 * or a second window never composes twice. A document composed after a newer
 * turn started still belongs to the message it was composed for.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  summarizeIssues,
  validateDocument,
} from "../../domain/postTurn/document.ts";
import { isReplyBlock } from "../../domain/postTurn/instructions.ts";
import { PRESENTATION_LIMITS } from "../../domain/postTurn/limits.ts";
import type {
  DocumentTopic,
  StoredPresentation,
} from "../../domain/postTurn/message.ts";
import type { PresentationPrefs } from "../../domain/postTurn/prefs.ts";
import { findFinalMessage, type FinalMessage } from "./anchor.ts";
import type { PresentationStore } from "./store.ts";

type Sdk = BbPluginApi["sdk"];

export type ComposeRequest = {
  response: string;
  title: string;
  topic: DocumentTopic | null;
  prefs: PresentationPrefs;
  signal: AbortSignal;
};

/** What a composition returned; the document is still untrusted. */
export type ComposeResult =
  | { kind: "document"; document: unknown }
  | { kind: "none" | "failed"; reason: string };

export type Compose = (request: ComposeRequest) => Promise<ComposeResult>;

export type PresentOutcome =
  { kind: "stored"; messageId: string } | { kind: "skipped"; reason: string };

/** Compositions running at once, across threads. */
const CONCURRENT = 2;

type ThreadFacts = {
  id: string;
  visibility: string;
  parentThreadId?: string | null;
  archivedAt: number | null;
};

export class PostTurnPresenter {
  private readonly controller = new AbortController();
  /** Messages being composed, so a repeated event joins the running one. */
  private readonly running = new Map<string, Promise<PresentOutcome>>();
  /**
   * Each thread's work in progress, from the message lookup to the save, so
   * a deletion at any point stops it before anything is stored.
   */
  private readonly cancels = new Map<string, Set<AbortController>>();

  constructor(
    private readonly deps: {
      sdk: () => Sdk;
      store: PresentationStore;
      prefs: () => PresentationPrefs;
      compose: Compose;
      title: (threadId: string) => string;
      topic: (threadId: string) => DocumentTopic | null;
      /** A thread's documents changed. */
      changed: (threadId: string) => void;
      log: BbPluginApi["log"];
    },
  ) {}

  enabled(): boolean {
    return this.deps.prefs().enabled;
  }

  /** Whether the experiment's response contract applies to a thread's agent. */
  appliesTo(thread: { parentThreadId: string | null }): boolean {
    return this.enabled() && thread.parentThreadId === null;
  }

  /** A turn ended. Composes in the background; never throws. */
  onIdle(thread: ThreadFacts, lastAssistantText: string | null): void {
    if (!this.deps.prefs().enabled) return;
    if (
      thread.visibility !== "visible" ||
      thread.parentThreadId ||
      thread.archivedAt !== null
    )
      return;
    void this.present(thread.id, lastAssistantText).then(
      (outcome) => {
        if (outcome.kind === "skipped")
          this.deps.log.info(
            `Enhanced response skipped for ${thread.id}: ${outcome.reason}`,
          );
      },
      (error: unknown) =>
        this.deps.log.warn(
          `Enhanced response failed for ${thread.id}: ${String(error)}`,
        ),
    );
  }

  /**
   * Finds the thread's final message and composes for it, or stores
   * `document` instead of composing (`bb workstreams present --document`).
   * `turnId` names the turn instead of matching the latest finished one.
   */
  async present(
    threadId: string,
    lastAssistantText: string | null,
    options: { document?: unknown; turnId?: string } = {},
  ): Promise<PresentOutcome> {
    const cancel = new AbortController();
    let pending = this.cancels.get(threadId);
    if (!pending) this.cancels.set(threadId, (pending = new Set()));
    pending.add(cancel);
    const release = () => {
      pending.delete(cancel);
      if (!pending.size && this.cancels.get(threadId) === pending)
        this.cancels.delete(threadId);
    };
    try {
      const found = await findFinalMessage(
        this.deps.sdk(),
        threadId,
        options.turnId ? null : lastAssistantText,
        {
          signal: AbortSignal.any([this.controller.signal, cancel.signal]),
          ...(options.turnId ? { turnId: options.turnId } : {}),
        },
      );
      if (cancel.signal.aborted)
        return { kind: "skipped", reason: "The thread is gone." };
      if (!found.ok) return { kind: "skipped", reason: found.reason };
      const message = found.message;
      if (this.deps.store.has(message.messageId))
        return { kind: "skipped", reason: "This response already has one." };
      const running = this.running.get(message.messageId);
      if (running) return await running;
      if (options.document === undefined && this.running.size >= CONCURRENT)
        return { kind: "skipped", reason: "Other compositions are running." };
      const work = this.compose(message, options.document, cancel).finally(() =>
        this.running.delete(message.messageId),
      );
      this.running.set(message.messageId, work);
      return await work;
    } catch (error) {
      if (cancel.signal.aborted)
        return { kind: "skipped", reason: "The thread is gone." };
      throw error;
    } finally {
      release();
    }
  }

  private async compose(
    message: FinalMessage,
    injected: unknown,
    cancel: AbortController,
  ): Promise<PresentOutcome> {
    if (isReplyBlock(message.text))
      return {
        kind: "skipped",
        reason: "The response is a reply block; it is drawn as one.",
      };
    if (message.text.length > PRESENTATION_LIMITS.responseChars)
      return {
        kind: "skipped",
        reason: `The response is longer than ${PRESENTATION_LIMITS.responseChars.toLocaleString("en-US")} characters.`,
      };
    const topic = this.deps.topic(message.threadId);
    const result: ComposeResult =
      injected !== undefined
        ? { kind: "document", document: injected }
        : await this.deps.compose({
            response: message.text,
            title: this.deps
              .title(message.threadId)
              .slice(0, PRESENTATION_LIMITS.titleChars),
            topic,
            prefs: this.deps.prefs(),
            signal: AbortSignal.any([this.controller.signal, cancel.signal]),
          });
    if (cancel.signal.aborted || this.controller.signal.aborted)
      return { kind: "skipped", reason: "The thread is gone." };
    if (result.kind !== "document")
      return { kind: "skipped", reason: result.reason };
    // The host validated against the same rules; this copy is the authority.
    const valid = validateDocument(result.document);
    if (!valid.ok)
      return {
        kind: "skipped",
        reason: `The document is invalid: ${summarizeIssues(valid.issues)}`,
      };
    const entry: StoredPresentation = {
      messageId: message.messageId,
      threadId: message.threadId,
      turnId: message.turnId,
      topic,
      document: valid.document,
      createdAt: Date.now(),
    };
    if (cancel.signal.aborted)
      return { kind: "skipped", reason: "The thread is gone." };
    if (!this.deps.store.save(entry))
      return { kind: "skipped", reason: "This response already has one." };
    this.deps.changed(message.threadId);
    return { kind: "stored", messageId: message.messageId };
  }

  /** The thread was deleted: stop its compositions and drop its documents. */
  forget(threadId: string): void {
    for (const cancel of this.cancels.get(threadId) ?? []) cancel.abort();
    if (this.deps.store.forget(threadId)) this.deps.changed(threadId);
  }

  dispose(): void {
    this.controller.abort();
  }
}
