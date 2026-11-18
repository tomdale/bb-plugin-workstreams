/**
 * Answers to plan documents. A plan's Approve sends `PLAN_APPROVAL_MESSAGE` to
 * its thread as the user's message, and a suggested reply sends its own text;
 * either one settles the plan, and every view then draws the settled form.
 *
 * A plan stays open until a message reaches its thread after the plan's turn:
 * one the user typed, another thread's, or any other turn request, except the
 * recap reminders and waiting checks Workstreams sends on its own. Then the plan is marked superseded, so an old plan's
 * Approve never lands on work that has moved on. The outcome is recorded
 * before the message is sent, which keeps two clicks or two windows from both
 * sending, and removed again when the send fails.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  isPlanDocument,
  PLAN_APPROVAL_MESSAGE,
} from "../../domain/postTurn/document.ts";
import type { PlanOutcome } from "../../domain/postTurn/message.ts";
import { UserError } from "../service.ts";
import type { PresentationStore } from "./store.ts";

type Sdk = BbPluginApi["sdk"];

/** The turn requests Workstreams' recap reminders and waiting checks send. */
const AUTOMATIC_REQUEST = /^\[Workstreams (?:recap|waiting) /;

/** Requests read back from the newest when checking whether a plan is current. */
const LOOKBACK = 100;

export type PlanAnswer =
  { kind: "approve" } | { kind: "reply"; message: string };

export class PlanOutcomes {
  constructor(
    private readonly deps: {
      sdk: () => Sdk;
      store: PresentationStore;
      enabled: () => boolean;
      /** A thread's documents or their outcomes changed. */
      changed: (threadId: string) => void;
    },
  ) {}

  async answer(
    threadId: string,
    messageId: string,
    answer: PlanAnswer,
  ): Promise<PlanOutcome> {
    if (!this.deps.enabled())
      throw new UserError("Enhanced responses are off.");
    const entry = this.deps.store.get(messageId);
    if (
      !entry ||
      entry.threadId !== threadId ||
      !isPlanDocument(entry.document)
    )
      throw new UserError("This plan is no longer available.");
    if (
      answer.kind === "reply" &&
      !(entry.document.plan.replies ?? []).includes(answer.message)
    )
      throw new UserError("This plan doesn't offer that reply.");
    if (this.deps.store.outcomes(threadId).has(messageId))
      throw new UserError("This plan has already been answered.");
    if (await this.passed(threadId, entry.turnId)) {
      if (this.deps.store.settle(threadId, messageId, { kind: "superseded" }))
        this.deps.changed(threadId);
      throw new UserError("A newer turn has replaced this plan.");
    }
    const outcome: PlanOutcome =
      answer.kind === "approve"
        ? { kind: "approved" }
        : { kind: "replied", message: answer.message };
    if (!this.deps.store.settle(threadId, messageId, outcome))
      throw new UserError("This plan has already been answered.");
    this.deps.changed(threadId);
    try {
      await this.deps.sdk().threads.send({
        threadId,
        mode: "queue-if-active",
        input: [
          {
            type: "text",
            text:
              answer.kind === "approve"
                ? PLAN_APPROVAL_MESSAGE
                : answer.message,
            mentions: [],
          },
        ],
      });
    } catch (error) {
      this.deps.store.unsettle(messageId);
      this.deps.changed(threadId);
      throw error;
    }
    return outcome;
  }

  /**
   * A turn started in the thread. An open plan is superseded once any turn
   * request other than Workstreams' own reminders arrived after its turn.
   * Never throws.
   */
  async onActive(threadId: string): Promise<void> {
    let marked = false;
    try {
      for (const plan of this.deps.store.openPlans(threadId))
        if (
          (await this.passed(threadId, plan.turnId)) &&
          this.deps.store.settle(threadId, plan.messageId, {
            kind: "superseded",
          })
        )
          marked = true;
    } catch {
      // An unreadable event log leaves the plan open; answering checks again.
    } finally {
      if (marked) this.deps.changed(threadId);
    }
  }

  /**
   * Whether a turn request other than Workstreams' own reminders arrived
   * after the plan's turn started. A plan whose turn is out of reach counts
   * as passed.
   */
  private async passed(threadId: string, turnId: string): Promise<boolean> {
    const events = await this.deps.sdk().threads.events.list({
      threadId,
      types: ["turn/started", "client/turn/requested"],
      order: "desc",
      limit: String(LOOKBACK),
    });
    for (const event of events) {
      if (event.type === "turn/started") {
        if (event.scope.kind === "turn" && event.scope.turnId === turnId)
          return false;
        continue;
      }
      const input = (event.data as { input?: unknown }).input;
      const first = Array.isArray(input) ? (input[0] as unknown) : null;
      const text =
        first && typeof first === "object" && "text" in first
          ? String((first as { text: unknown }).text)
          : "";
      if (!AUTOMATIC_REQUEST.test(text)) return true;
    }
    return true;
  }
}
