import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const FAILURE_LIMIT = 5;
const REPEAT_LIMIT = 5;
type State = {
  cursor: number;
  turnId: string;
  /** The last failure seen, and how many in a row share it. */
  failure: string | null;
  failures: number;
  /** The last successful tool call, and how many in a row repeat it. */
  repeat: string | null;
  repeats: number;
  stopped: boolean;
};

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * Stops active turns that spin on the same call: five failures in a row with
 * the same error, or five successful tool calls in a row with the same
 * arguments and the same output.
 *
 * The repeat case is a turn that keeps asking a question whose answer cannot
 * change, which happens when an agent has nothing left to emit but cannot end
 * the turn without a tool call: an agent-only reminder that asks for a single
 * call leaves a model that honors it with no other move. Shell commands are
 * left out because polling with `sleep`, `curl`, or `bb thread wait` repeats
 * the same command on purpose.
 *
 * Event history includes provider-side validation failures that never reach a
 * plugin tool's execute handler. Argument wording does not reset a failure
 * count.
 */
export class ToolLoopGuard {
  private readonly controller = new AbortController();
  private readonly states = new Map<string, State>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly sequences = new Map<string, number>();
  private readonly scans = new Map<string, symbol>();

  constructor(
    private readonly deps: {
      bb: BbPluginApi;
      enabled: (threadId: string) => boolean;
      onLoop: (threadId: string) => void;
    },
  ) {}

  forget(threadId: string) {
    this.states.delete(threadId);
    this.sequences.delete(threadId);
    this.scans.delete(threadId);
  }

  observe(threadId: string, sequence: number): Promise<void> {
    if (!this.deps.enabled(threadId) || this.controller.signal.aborted)
      return Promise.resolve();
    this.sequences.set(
      threadId,
      Math.max(sequence, this.sequences.get(threadId) ?? 0),
    );
    const running = this.pending.get(threadId);
    if (running) return running;
    const work = this.check(threadId)
      .catch((error: unknown) => {
        if (!this.controller.signal.aborted)
          this.deps.bb.log.warn(
            `Tool failure guard failed for ${threadId}: ${String(error)}`,
          );
      })
      .finally(() => {
        this.pending.delete(threadId);
      });
    this.pending.set(threadId, work);
    return work;
  }

  async dispose() {
    this.controller.abort();
    await Promise.allSettled(this.pending.values());
    this.states.clear();
    this.sequences.clear();
    this.scans.clear();
  }

  private async check(threadId: string) {
    const { bb } = this.deps;
    const signal = this.controller.signal;
    const scan = Symbol();
    this.scans.set(threadId, scan);
    const [start] = await bb.sdk.threads.events.list({
      threadId,
      types: ["turn/started"],
      order: "desc",
      limit: "1",
      signal,
    });
    if (
      !start ||
      start.scope.kind !== "turn" ||
      signal.aborted ||
      this.scans.get(threadId) !== scan ||
      !this.deps.enabled(threadId)
    )
      return;
    const turnId = start.scope.turnId;
    let state = this.states.get(threadId);
    if (!state || state.turnId !== turnId) {
      state = {
        cursor: start.seq,
        turnId,
        failure: null,
        failures: 0,
        repeat: null,
        repeats: 0,
        stopped: false,
      };
      this.states.set(threadId, state);
    }
    while (
      !state.stopped &&
      !signal.aborted &&
      state.cursor < (this.sequences.get(threadId) ?? 0)
    ) {
      const events = await bb.sdk.threads.events.list({
        threadId,
        afterSeq: String(state.cursor),
        order: "asc",
        limit: "100",
        signal,
      });
      if (this.states.get(threadId) !== state || !this.deps.enabled(threadId))
        return;
      if (!events.length) return;
      for (const event of events) {
        state.cursor = event.seq;
        if (
          event.type === "turn/started" ||
          event.type === "turn/completed" ||
          event.type === "client/turn/requested"
        ) {
          this.forget(threadId);
          return;
        }
        if (event.type !== "item/completed") continue;
        const item = event.data.item;
        if (item.type !== "toolCall" && item.type !== "commandExecution")
          continue;
        let reason: string | null = null;
        if (item.type !== "toolCall" || item.status !== "failed") {
          state.failure = null;
          state.failures = 0;
          const call = item.type === "toolCall" ? item : null;
          const repeat = call
            ? digest([call.tool, call.arguments, call.result])
            : null;
          if (repeat !== null && repeat === state.repeat) state.repeats += 1;
          else {
            state.repeat = repeat;
            state.repeats = 1;
          }
          if (call && state.repeats >= REPEAT_LIMIT)
            reason = `${REPEAT_LIMIT} identical calls to ${call.tool}`;
        } else {
          const failure = digest([item.tool, item.result]);
          state.failures = state.failure === failure ? state.failures + 1 : 1;
          state.failure = failure;
          state.repeat = null;
          state.repeats = 0;
          if (state.failures >= FAILURE_LIMIT)
            reason = `${FAILURE_LIMIT} consecutive failures from ${item.tool}`;
        }
        if (reason === null) continue;
        const thread = await bb.sdk.threads.get({ threadId, signal });
        const [latest] = await bb.sdk.threads.events.list({
          threadId,
          types: ["turn/started", "turn/completed"],
          order: "desc",
          limit: "1",
          signal,
        });
        if (
          this.states.get(threadId) !== state ||
          signal.aborted ||
          !this.deps.enabled(threadId) ||
          latest?.type !== "turn/started" ||
          latest.scope.kind !== "turn" ||
          latest.scope.turnId !== turnId ||
          thread.status !== "active" ||
          thread.archivedAt !== null
        )
          return;
        // Suppress recap reminders before stopping, so the guard cannot cause
        // another mandatory recap turn to repeat the same loop.
        state.stopped = true;
        this.deps.onLoop(threadId);
        bb.log.warn(`Stopped ${threadId}: ${reason}`);
        try {
          await bb.sdk.threads.stop({ threadId, signal });
        } catch (error) {
          state.stopped = false;
          throw error;
        }
        return;
      }
    }
  }
}
