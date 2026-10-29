/**
 * Agent recaps: the recap tool, its per-thread store, and the
 * bounded corrections that ask an agent for a recap when a turn ends without
 * one.
 *
 * A recap belongs to the turn that reported it. Any fresh input clears it, so
 * a stored recap always describes the thread's latest turn. A pending question
 * card also ends a turn properly; it stores no recap.
 *
 * BB applies a tool set only when it constructs a provider session, and
 * `configure` can't tell a session start from a turn submit. So reminders go
 * only to threads whose session demonstrably has the tool: threads created
 * since agents started getting it, and threads whose agent has called it. A
 * fork continues its source's session, so it counts from the first thread in
 * its fork chain.
 *
 * BB reports turn completion as an observation, not a veto: the turn's final
 * reply is already visible when a correction asks for the recap. Corrections
 * carry an epoch and a token that `message.dispatch` checks, so input that
 * arrives first cancels a stale correction.
 */
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  RECAP_INSTRUCTIONS,
  RECAP_TOOL,
  RECAP_TOOL_DESCRIPTION,
  recapInputSchema,
  recapToolSchema,
  recapMarkdown,
  recapSchema,
  toRecap,
  type Recap,
} from "../domain/recap.ts";
import type { RecapPrefs } from "../domain/recapPrefs.ts";
import { parse as parseReply } from "../domain/reply.ts";
import { replyInstructions } from "../domain/replyInstructions.ts";
import {
  recapInputFromCard,
  type ReplyRecapProblem,
} from "../domain/replyRecap.ts";
import { lastReplyBlock } from "../domain/replyText.ts";
import type { Database } from "./db.ts";
import { UserError } from "./service.ts";
import { ASK_USER_QUESTION_RENDERER_ID } from "./questions/contracts.ts";
import { ToolFailureGuard } from "./toolFailureGuard.ts";

type Row = {
  thread_id: string;
  epoch: number;
  intercepts: number;
  checked_seq: number;
  accepted_turn: string | null;
  recap: string | null;
  dismissed: number;
  enrolled: number;
  capped: number;
  correction_token: string | null;
  input_key: string | null;
  /** The thread's agent has called the tool, so its session has it. */
  proven: number;
  waiting_nudged: number;
  waiting_cancelled: number;
};
/** Why a turn's reply block yielded no recap; the correction names it. */
type BlockProblem = "block" | "no-state" | ReplyRecapProblem;
const BLOCK_PROBLEMS: Record<BlockProblem, string> = {
  block: "your reply had no readable `:::reply` block",
  "no-state": "its `:::reply` opener had no `state`",
  state: "its `state` was not complete, review or waiting",
  headline: "it had no `# ` headline line",
  invalid: "its card could not be read",
};

type DispatchContext = Parameters<
  Parameters<BbPluginApi["experimental_hooks"]["on"]>[1]
>[0];

const CORRECTION_MARKER = /^\[Workstreams recap ([a-f0-9-]+) (\d+) (\d+)\]/;
const correctionSchema = z.object({
  recapCorrection: z.object({
    epoch: z.number().int(),
    completedSeq: z.number().int(),
    token: z.string().uuid(),
  }),
});

/** Interactions that put a question to the user and end the turn properly. */
function asksUser(
  interaction: {
    payload: { kind: string };
    origin?: { kind: string; pluginId?: string; rendererId?: string } | null;
  },
  pluginId: string,
): boolean {
  return (
    interaction.payload.kind === "user_question" ||
    (interaction.origin?.kind === "plugin" &&
      interaction.origin.pluginId === pluginId &&
      interaction.origin.rendererId === ASK_USER_QUESTION_RENDERER_ID)
  );
}

export class AgentRecaps {
  private readonly controller = new AbortController();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly repeat = new Set<string>();
  private readonly failureGuard: ToolFailureGuard;
  private readonly waitingTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly waitingChecks = new Set<Promise<void>>();
  /**
   * Per thread, from the latest `configure`: whether the reply block carries
   * the recap card (the recap is on) or is a reply alone.
   */
  private readonly replyModes = new Map<string, boolean>();
  /**
   * Per thread, from the latest `configure`: whether the session got reply
   * blocks for its recap instead of the recap tool.
   */
  private readonly blockSessions = new Map<string, boolean>();
  /**
   * Whether the latest client report said this bb draws reply blocks. Only
   * the tomdale/bb fork does; on upstream bb no client reports it, so
   * Structured replies stays off and agents keep the recap tool. Kept in
   * memory: a restart, possibly onto another bb build, waits for a new
   * report.
   */
  private messageBlocks = false;
  /** Each thread's latest idle text, for the coalesced idle work. */
  private readonly idleText = new Map<string, string | null>();
  /** Why the thread's latest turn's block gave no recap, for its correction. */
  private readonly blockProblems = new Map<
    string,
    { turnId: string; problem: BlockProblem }
  >();

  constructor(
    private readonly deps: {
      bb: BbPluginApi;
      db: Database;
      prefs: () => RecapPrefs;
      /** See `recapToolSince` in recapPrefs.ts. */
      since: () => number;
      onChange: () => void;
    },
  ) {
    this.failureGuard = new ToolFailureGuard({
      bb: deps.bb,
      enabled: (threadId) =>
        deps.prefs().required && this.row(threadId).enrolled === 1,
      onLoop: (threadId) => {
        deps.db
          .prepare("UPDATE ws_agent_recap SET capped = 1 WHERE thread_id = ?")
          .run(threadId);
        deps.onChange();
      },
    });
  }

  /** The tool's registration and the instructions that go with it. */
  register(): void {
    for (const [threadId, recap] of Object.entries(this.all()))
      this.scheduleWaiting(threadId, recap);
    this.deps.bb.events.on(
      "experimental_thread.events",
      ({ thread, sequence }) => {
        if (thread.status === "active")
          return this.failureGuard.observe(thread.id, sequence);
      },
    );
    this.deps.bb.agents.registerTool({
      name: RECAP_TOOL,
      description: RECAP_TOOL_DESCRIPTION,
      // Tool instructions have their own budget; sharing `configure`'s with
      // the question instructions would cut these short.
      instructions: RECAP_INSTRUCTIONS,
      // A visible row keeps each recap in the thread's timeline. BB renders
      // plugin tool rows itself, so the title is fixed and the recap is the
      // row's output.
      presentation: {
        label: { pending: "Writing recap", completed: "Recap" },
        tint: { light: "#0284c7", dark: "#38bdf8" },
      },
      parameters: recapToolSchema,
      execute: async (input, ctx) => {
        const validated = recapInputSchema.parse(input);
        const epoch = this.row(ctx.threadId).epoch;
        this.deps.db
          .prepare("UPDATE ws_agent_recap SET proven = 1 WHERE thread_id = ?")
          .run(ctx.threadId);
        const turnId = await this.latestTurn(ctx.threadId, ctx.signal);
        const recap = toRecap(validated, {
          id: randomUUID(),
          turnId,
          at: Date.now(),
        });
        if (!this.accept(ctx.threadId, epoch, turnId, recap))
          throw new Error(
            "The conversation changed; report the recap for the current turn.",
          );
        this.scheduleWaiting(ctx.threadId, recap);
        this.deps.onChange();
        return recapMarkdown(recap);
      },
    });
  }

  /**
   * Called from `configure` at every session start and turn submit: whether
   * the session gets the tool. Enrollment follows the latest answer.
   */
  configure(threadId: string, enabled: boolean) {
    const prefs = this.deps.prefs();
    const on = enabled && prefs.required;
    this.row(threadId);
    this.deps.db
      .prepare("UPDATE ws_agent_recap SET enrolled = ? WHERE thread_id = ?")
      .run(Number(on), threadId);
    // Structured replies needs a bb that draws reply blocks.
    const replies = enabled && prefs.replies && this.messageBlocks;
    if (replies) this.replyModes.set(threadId, on);
    else this.replyModes.delete(threadId);
    // With Structured replies on, the recap comes from the reply block.
    const blocks = on && replies;
    this.blockSessions.set(threadId, blocks);
    return { tools: on && !blocks ? [RECAP_TOOL] : [] };
  }

  /** A client's report of what its bb draws; the latest report wins. */
  reportClient(report: { messageBlocks: boolean }) {
    this.messageBlocks = report.messageBlocks;
  }

  /**
   * The reply block instruction for the resolution `configure` just decided,
   * or null. With the recap on it is the whole recap contract, since the
   * session has no recap tool. bb calls `contributeInstructions` after
   * `configure` in each resolution and gives it a 4,096-character budget of
   * its own. Null while no client has reported that it draws reply
   * blocks (see `reportClient`).
   */
  replyInstructions(threadId: string): string | null {
    const withRecap = this.replyModes.get(threadId);
    return withRecap === undefined ? null : replyInstructions(withRecap);
  }

  /**
   * The `message.dispatch` decision for a correction this class sent, or null
   * for any other input, which clears the thread's recap.
   */
  async onDispatch(ctx: DispatchContext) {
    const queuedWait = ctx.queuedMessages.length
      ? /^\[Workstreams waiting ([a-f0-9-]+)\]/.exec(ctx.input.text)
      : null;
    const submission = ctx.experimental_submission;
    const waitingId =
      submission?.pluginId === this.deps.bb.pluginId
        ? z.object({ waitingRecapId: z.string() }).safeParse(submission.data)
        : null;
    const recapId =
      queuedWait?.[1] ??
      (waitingId?.success ? waitingId.data.waitingRecapId : null);
    if (recapId) {
      const turnId = await this.latestTurn(
        ctx.thread.id,
        this.controller.signal,
      ).catch(() => null);
      const stored = this.get(ctx.thread.id);
      const recap = stored?.recap;
      if (
        recap?.id !== recapId ||
        recap.state !== "waiting" ||
        recap.turnId !== turnId ||
        this.row(ctx.thread.id).waiting_nudged !== 1 ||
        stored?.waitingCancelled ||
        ctx.thread.status !== "idle" ||
        ctx.thread.archivedAt !== null ||
        ctx.thread.visibility !== "visible" ||
        ctx.thread.queuedMessageCount > ctx.queuedMessages.length
      )
        return {
          action: "reject",
          message: "Waiting check cancelled because the conversation changed.",
        } as const;
      this.reset(ctx.thread.id, null);
      this.deps.onChange();
      return { action: "proceed" } as const;
    }
    const queued =
      ctx.queuedMessages.length > 0
        ? CORRECTION_MARKER.exec(ctx.input.text)
        : null;
    const submitted =
      ctx.experimental_submission?.pluginId === this.deps.bb.pluginId
        ? correctionSchema.safeParse(ctx.experimental_submission.data)
        : null;
    if (queued || submitted?.success) {
      // Submission metadata is transient; a queued retry keeps the marker in
      // its text instead.
      const marker = queued
        ? {
            token: queued[1]!,
            epoch: Number(queued[2]),
            completedSeq: Number(queued[3]),
          }
        : submitted!.data!.recapCorrection;
      const row = this.row(ctx.thread.id);
      const current =
        this.deps.prefs().required &&
        row.enrolled === 1 &&
        row.capped === 0 &&
        ctx.thread.status === "idle" &&
        ctx.thread.archivedAt === null &&
        ctx.thread.visibility === "visible" &&
        ctx.thread.queuedMessageCount <= ctx.queuedMessages.length &&
        row.correction_token === marker.token &&
        row.epoch === marker.epoch &&
        row.checked_seq === marker.completedSeq;
      return current
        ? ({ action: "proceed" } as const)
        : ({
            action: "reject",
            message:
              "Recap correction cancelled because the conversation changed.",
          } as const);
    }
    this.reset(
      ctx.thread.id,
      ctx.queuedMessages.length
        ? ctx.queuedMessages.map((row) => row.id).join(",")
        : null,
    );
    this.deps.onChange();
    return null;
  }

  async onInteractionPending(
    threadId: string,
    interaction: Parameters<typeof asksUser>[0] & { turnId?: string | null },
  ) {
    if (
      !this.row(threadId).enrolled ||
      !asksUser(interaction, this.deps.bb.pluginId)
    )
      return;
    const epoch = this.row(threadId).epoch;
    // A plugin's form opened from a detached tool call has no turn of its own.
    const turnId =
      interaction.turnId ??
      (await this.latestTurn(threadId, this.controller.signal).catch(
        () => null,
      ));
    if (turnId) this.accept(threadId, epoch, turnId, null);
    this.deps.onChange();
  }

  /**
   * Coalesces idle events per thread; a repeat during a check runs again.
   * `lastAssistantText` is the turn's final message, read for a reply block
   * when Structured replies is on.
   */
  onIdle(
    threadId: string,
    lastAssistantText: string | null = null,
  ): Promise<void> {
    this.idleText.set(threadId, lastAssistantText);
    const recap = this.get(threadId)?.recap;
    if (recap) this.scheduleWaiting(threadId, recap);
    this.failureGuard.forget(threadId);
    const running = this.pending.get(threadId);
    if (running) {
      this.repeat.add(threadId);
      return running;
    }
    const work = (async () => {
      do {
        this.repeat.delete(threadId);
        await this.recordReply(threadId);
        await this.enforce(threadId);
      } while (this.repeat.has(threadId) && !this.controller.signal.aborted);
    })()
      .catch((error: unknown) => {
        if (!this.controller.signal.aborted)
          this.deps.bb.log.warn(
            `Recap correction failed for ${threadId}: ${String(error)}`,
          );
      })
      .finally(() => {
        this.pending.delete(threadId);
        this.repeat.delete(threadId);
      });
    this.pending.set(threadId, work);
    return work;
  }

  onArchived(threadId: string) {
    this.cancelWaitingTimer(threadId);
    this.failureGuard.forget(threadId);
    this.deps.db
      .prepare("UPDATE ws_agent_recap SET enrolled = 0 WHERE thread_id = ?")
      .run(threadId);
  }

  forget(threadId: string) {
    this.cancelWaitingTimer(threadId);
    this.failureGuard.forget(threadId);
    this.deps.db
      .prepare("DELETE FROM ws_agent_recap WHERE thread_id = ?")
      .run(threadId);
  }

  /** The thread's recap for its latest turn, dismissed or not. */
  get(
    threadId: string,
  ): { recap: Recap; dismissed: boolean; waitingCancelled: boolean } | null {
    const row = this.deps.db
      .prepare(
        "SELECT recap, dismissed, waiting_cancelled FROM ws_agent_recap WHERE thread_id = ?",
      )
      .get(threadId) as
      Pick<Row, "recap" | "dismissed" | "waiting_cancelled"> | undefined;
    const recap = parse(row?.recap ?? null);
    return recap
      ? {
          recap,
          dismissed: row!.dismissed === 1,
          waitingCancelled: row!.waiting_cancelled === 1,
        }
      : null;
  }

  /** Every stored recap, for the sidebar's work state. */
  all(): Record<string, Recap> {
    const rows = this.deps.db
      .prepare(
        "SELECT thread_id, recap FROM ws_agent_recap WHERE recap IS NOT NULL",
      )
      .all() as Pick<Row, "thread_id" | "recap">[];
    const out: Record<string, Recap> = {};
    for (const row of rows) {
      const recap = parse(row.recap);
      if (recap) out[row.thread_id] = recap;
    }
    return out;
  }

  /** Ids of stored recaps whose card is dismissed. */
  dismissedIds(): string[] {
    return (
      this.deps.db
        .prepare(
          "SELECT json_extract(recap, '$.id') AS id FROM ws_agent_recap WHERE dismissed = 1 AND recap IS NOT NULL",
        )
        .all() as { id: string | null }[]
    )
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string");
  }

  /** Whether corrections ran out for this thread's latest turn. */
  capped(threadId: string): { capped: boolean; corrections: number } {
    const row = this.row(threadId);
    const { required } = this.deps.prefs();
    return {
      capped: required && row.capped === 1,
      corrections: row.intercepts,
    };
  }

  /**
   * Hides the card on every client; the sidebar keeps the recap's state.
   * Dismissing a waiting card also cancels its status check, durably, so a
   * restored card stays cancelled.
   */
  dismiss(threadId: string, recapId: string) {
    if (this.get(threadId)?.recap.state === "waiting") {
      if (this.get(threadId)?.recap.id !== recapId)
        throw new Error("This recap is no longer current.");
      this.cancelWaitingTimer(threadId);
      this.deps.db
        .prepare(
          "UPDATE ws_agent_recap SET waiting_cancelled = 1 WHERE thread_id = ?",
        )
        .run(threadId);
    }
    this.setDismissed(threadId, recapId, true);
  }

  /** Restores the current recap card on every client. */
  restore(threadId: string, recapId: string) {
    this.setDismissed(threadId, recapId, false);
  }

  /**
   * Sends one of the current recap's suggested next actions as the user's
   * message, queued behind any running turn. Queued behind, because the card
   * is only shown while the thread is idle; the message dispatches as fresh
   * input, which clears the recap like any user message.
   */
  async sendNext(threadId: string, recapId: string, action: string) {
    const stored = this.get(threadId);
    if (stored?.recap.id !== recapId)
      throw new UserError("This recap is no longer current.");
    if (
      !stored.recap.next.some((suggestion) =>
        typeof suggestion === "string"
          ? suggestion === action
          : suggestion.message === action,
      )
    )
      throw new UserError("This suggestion is no longer offered.");
    await this.deps.bb.sdk.threads.send({
      threadId,
      mode: "queue-if-active",
      input: [{ type: "text", text: action, mentions: [] }],
    });
  }

  private setDismissed(threadId: string, recapId: string, dismissed: boolean) {
    if (this.get(threadId)?.recap.id !== recapId)
      throw new Error("This recap is no longer current.");
    this.deps.db
      .prepare("UPDATE ws_agent_recap SET dismissed = ? WHERE thread_id = ?")
      .run(dismissed ? 1 : 0, threadId);
    this.deps.onChange();
  }

  async dispose() {
    this.controller.abort();
    for (const threadId of this.waitingTimers.keys())
      this.cancelWaitingTimer(threadId);
    await Promise.allSettled([
      ...this.waitingChecks,
      ...this.pending.values(),
      this.failureGuard.dispose(),
    ]);
  }

  private row(threadId: string): Row {
    this.deps.db
      .prepare("INSERT OR IGNORE INTO ws_agent_recap (thread_id) VALUES (?)")
      .run(threadId);
    return this.deps.db
      .prepare("SELECT * FROM ws_agent_recap WHERE thread_id = ?")
      .get(threadId) as Row;
  }

  private async latestTurn(threadId: string, signal: AbortSignal) {
    const [start] = await this.deps.bb.sdk.threads.events.list({
      threadId,
      types: ["turn/started"],
      order: "desc",
      limit: "1",
      signal,
    });
    if (!start || start.scope.kind !== "turn")
      throw new Error("No current agent turn.");
    return start.scope.turnId;
  }

  /**
   * Whether the thread's provider session may predate the recap tool. A fork
   * carries on its source's session, so the session dates from the first
   * thread in the fork chain. A chain that can't be read counts as predating.
   */
  private async sessionPredatesTool(
    thread: {
      createdAt: number;
      originKind: string | null;
      sourceThreadId: string | null;
    },
    signal: AbortSignal,
  ): Promise<boolean> {
    const since = this.deps.since();
    let current = thread;
    for (let depth = 0; depth < 16; depth++) {
      if (current.createdAt < since) return true;
      if (current.originKind !== "fork" || !current.sourceThreadId)
        return false;
      try {
        current = await this.deps.bb.sdk.threads.get({
          threadId: current.sourceThreadId,
          signal,
        });
      } catch {
        return true;
      }
    }
    return true;
  }

  /** Records the turn's ending, unless fresh input arrived since `epoch`. */
  private accept(
    threadId: string,
    epoch: number,
    turnId: string,
    recap: Recap | null,
  ): boolean {
    return (
      this.deps.db
        .prepare(
          `UPDATE ws_agent_recap SET accepted_turn = ?, capped = 0,
             recap = COALESCE(?, recap),
             waiting_nudged = CASE WHEN ? IS NULL THEN waiting_nudged ELSE 0 END,
             waiting_cancelled = CASE WHEN ? IS NULL THEN waiting_cancelled ELSE 0 END,
             dismissed = CASE WHEN ? IS NULL THEN dismissed ELSE 0 END
           WHERE thread_id = ? AND epoch = ?`,
        )
        .run(
          turnId,
          recap ? JSON.stringify(recap) : null,
          recap ? 1 : null,
          recap ? 1 : null,
          recap ? 1 : null,
          threadId,
          epoch,
        ).changes === 1
    );
  }

  /** Fresh input: a new epoch, a fresh correction budget, and no recap. */
  private reset(threadId: string, inputKey: string | null) {
    const row = this.row(threadId);
    // A queued group dispatches more than once; only its first attempt is new.
    if (inputKey !== null && row.input_key === inputKey) return;
    this.cancelWaitingTimer(threadId);
    this.failureGuard.forget(threadId);
    this.deps.db
      .prepare(
        `UPDATE ws_agent_recap SET epoch = epoch + 1, intercepts = 0, capped = 0,
           accepted_turn = NULL, recap = NULL, dismissed = 0, waiting_nudged = 0, waiting_cancelled = 0, correction_token = NULL, input_key = ?
         WHERE thread_id = ?`,
      )
      .run(inputKey, threadId);
  }

  private cancelWaitingTimer(threadId: string) {
    const timer = this.waitingTimers.get(threadId);
    if (timer) clearTimeout(timer);
    this.waitingTimers.delete(threadId);
  }

  private scheduleWaiting(threadId: string, recap: Recap) {
    this.cancelWaitingTimer(threadId);
    if (
      recap.state !== "waiting" ||
      !recap.timeout ||
      this.get(threadId)?.waitingCancelled ||
      this.deps.db
        .prepare(
          "SELECT 1 FROM ws_agent_recap WHERE thread_id = ? AND waiting_nudged = 1",
        )
        .get(threadId)
    )
      return;
    const timer = setTimeout(
      () => {
        this.waitingTimers.delete(threadId);
        const check = this.checkWaiting(threadId, recap)
          .catch((error: unknown) => {
            if (!this.controller.signal.aborted)
              this.deps.bb.log.warn(
                `Waiting check failed for ${threadId}: ${String(error)}`,
              );
          })
          .finally(() => this.waitingChecks.delete(check));
        this.waitingChecks.add(check);
      },
      Math.max(0, recap.at + recap.timeout * 1000 - Date.now()),
    );
    timer.unref();
    this.waitingTimers.set(threadId, timer);
  }

  private async checkWaiting(threadId: string, recap: Recap) {
    const signal = this.controller.signal;
    const sdk = this.deps.bb.sdk;
    if ((await this.latestTurn(threadId, signal)) !== recap.turnId) return;
    const thread = await sdk.threads.get({ threadId, signal });
    if (
      signal.aborted ||
      thread.status !== "idle" ||
      thread.archivedAt !== null ||
      thread.visibility !== "visible" ||
      thread.queuedMessageCount > 0 ||
      this.get(threadId)?.recap.id !== recap.id ||
      this.get(threadId)?.waitingCancelled
    )
      return;
    // Reserve once durably before sending; a reload cannot duplicate the prompt.
    const reserved = this.deps.db
      .prepare(
        `UPDATE ws_agent_recap SET waiting_nudged = 1
      WHERE thread_id = ? AND waiting_nudged = 0 AND waiting_cancelled = 0
        AND json_extract(recap, '$.id') = ?`,
      )
      .run(threadId, recap.id).changes;
    if (!reserved) return;
    await sdk.threads.send({
      threadId,
      mode: "start",
      pluginSubmission: {
        pluginId: this.deps.bb.pluginId,
        data: { waitingRecapId: recap.id },
      },
      input: [
        {
          type: "text",
          visibility: "agent-only",
          mentions: [],
          text: `[Workstreams waiting ${recap.id}]\nThe waiting timeout expired. Check the status of the async task you reported, continue authorized work if ready, and report a recap. If it is still running, report waiting with a realistic timeout.`,
        },
      ],
    });
  }

  /** What a correction asks for: a recap call, or a reply block's missing part. */
  private correctionText(threadId: string, turnId: string): string {
    // The session's own mode decides; after a restart, the current one.
    const blocks =
      this.blockSessions.get(threadId) ??
      (this.deps.prefs().replies && this.messageBlocks);
    if (!blocks)
      return `Your turn ended without a recap. Finish any remaining authorized work, then call ${RECAP_TOOL}, or ask the user through a question card if you need their input.`;
    const found = this.blockProblems.get(threadId);
    const problem =
      BLOCK_PROBLEMS[found?.turnId === turnId ? found.problem : "block"];
    return `Your turn ended without a recap: ${problem}. Finish any remaining authorized work, then end with a \`:::reply{state="…"}\` block that starts with a \`# \` headline. If you need the user's input instead, ask through a question card; it is then the reply.`;
  }

  /**
   * With Structured replies on, records the recap a turn's reply block
   * carries, through the same path as a tool call. It reads blocks whether
   * or not a client has reported drawing them, so a session that got the
   * block instruction keeps its recaps across a restart. The final message comes
   * first; without a block there, the turn's other top-level messages are
   * read, newest first. A turn already ended by a recap or a question card
   * is left alone, so repeated idle events change nothing.
   */
  private async recordReply(threadId: string) {
    const { required, replies } = this.deps.prefs();
    if (!required || !replies) return;
    const row = this.row(threadId);
    if (!row.enrolled) return;
    const signal = this.controller.signal;
    const turnId = await this.latestTurn(threadId, signal).catch(() => null);
    if (!turnId || row.accepted_turn === turnId) return;
    const found = await this.replyRecap(
      threadId,
      turnId,
      this.idleText.get(threadId) ?? null,
      signal,
    );
    if (!found.ok) {
      this.blockProblems.set(threadId, { turnId, problem: found.problem });
      return;
    }
    this.blockProblems.delete(threadId);
    const recap = toRecap(found.input, {
      id: randomUUID(),
      turnId,
      at: Date.now(),
    });
    if (!this.accept(threadId, row.epoch, turnId, recap)) return;
    // The session demonstrably follows the block contract.
    this.deps.db
      .prepare("UPDATE ws_agent_recap SET proven = 1 WHERE thread_id = ?")
      .run(threadId);
    this.scheduleWaiting(threadId, recap);
    this.deps.onChange();
  }

  private async replyRecap(
    threadId: string,
    turnId: string,
    lastText: string | null,
    signal: AbortSignal,
  ) {
    let block = lastText ? lastReplyBlock(lastText) : null;
    if (!block) {
      const events = await this.deps.bb.sdk.threads.events
        .list({
          threadId,
          types: ["item/completed"],
          order: "desc",
          limit: "50",
          signal,
        })
        .catch(() => []);
      for (const event of events as unknown as {
        scope: { kind: string; turnId?: string };
        data: {
          item?: { type?: string; text?: string; parentToolCallId?: string };
        };
      }[]) {
        const item = event.data.item;
        if (
          event.scope.kind !== "turn" ||
          event.scope.turnId !== turnId ||
          item?.type !== "agentMessage" ||
          item.parentToolCallId ||
          !item.text
        )
          continue;
        block = lastReplyBlock(item.text);
        if (block) break;
      }
    }
    if (!block) return { ok: false, problem: "block" } as const;
    const read = parseReply(block, { status: block.status });
    if (!read.ok) return { ok: false, problem: "block" } as const;
    if (!read.data.card) return { ok: false, problem: "no-state" } as const;
    return recapInputFromCard(read.data.card);
  }

  private async enforce(threadId: string) {
    const { required, corrections } = this.deps.prefs();
    // A durable question remains a valid turn ending after BB loses its waiter.
    if (
      this.deps.db
        .prepare(
          "SELECT 1 FROM ws_question WHERE thread_id = ? AND status IN ('pending', 'sending')",
        )
        .get(threadId)
    )
      return;
    const row = this.row(threadId);
    if (!required || corrections === 0 || !row.enrolled || row.capped) return;
    const signal = this.controller.signal;
    const sdk = this.deps.bb.sdk;
    const [completed] = await sdk.threads.events.list({
      threadId,
      types: ["turn/completed"],
      order: "desc",
      limit: "1",
      signal,
    });
    if (
      !completed ||
      completed.type !== "turn/completed" ||
      completed.data.status !== "completed" ||
      completed.scope.kind !== "turn" ||
      completed.seq <= row.checked_seq
    )
      return;
    if ((await this.latestTurn(threadId, signal)) !== completed.scope.turnId)
      return;
    if (row.accepted_turn === completed.scope.turnId) {
      this.deps.db
        .prepare(
          "UPDATE ws_agent_recap SET checked_seq = ? WHERE thread_id = ?",
        )
        .run(completed.seq, threadId);
      return;
    }
    const thread = await sdk.threads.get({ threadId, signal });
    if (
      thread.status !== "idle" ||
      thread.archivedAt !== null ||
      thread.visibility !== "visible" ||
      thread.queuedMessageCount > 0 ||
      signal.aborted
    )
      return;
    // A session constructed before the tool existed can't call it.
    if (!row.proven && (await this.sessionPredatesTool(thread, signal))) return;
    const token = randomUUID();
    // Reserved before sending, so a reload or a repeated idle event can't
    // refund a correction.
    const reserved =
      this.deps.db
        .prepare(
          `UPDATE ws_agent_recap SET intercepts = intercepts + 1, checked_seq = ?, correction_token = ?
           WHERE thread_id = ? AND epoch = ? AND checked_seq < ? AND intercepts < ? AND enrolled = 1`,
        )
        .run(
          completed.seq,
          token,
          threadId,
          row.epoch,
          completed.seq,
          corrections,
        ).changes === 1;
    if (!reserved) {
      this.deps.db
        .prepare(
          "UPDATE ws_agent_recap SET capped = 1, checked_seq = ? WHERE thread_id = ? AND epoch = ? AND intercepts >= ?",
        )
        .run(completed.seq, threadId, row.epoch, corrections);
      this.deps.onChange();
      return;
    }
    this.deps.onChange();
    await sdk.threads.send({
      threadId,
      mode: "start",
      pluginSubmission: {
        pluginId: this.deps.bb.pluginId,
        data: {
          recapCorrection: {
            epoch: row.epoch,
            completedSeq: completed.seq,
            token,
          },
        },
      },
      input: [
        {
          type: "text",
          visibility: "agent-only",
          text: `[Workstreams recap ${token} ${row.epoch} ${completed.seq}]\n${this.correctionText(threadId, completed.scope.turnId)} Correction ${row.intercepts + 1} of ${corrections}.`,
          mentions: [],
        },
      ],
    });
  }
}

function parse(raw: string | null): Recap | null {
  if (!raw) return null;
  try {
    const parsed = recapSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
