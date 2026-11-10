/**
 * What a queue item's card shows for a thread, from the thread's state.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { NextAction, Recap } from "../../../domain/recap.ts";
import type { WorkView } from "../../../domain/status.ts";
import { statusRole, workStateLabel } from "../../../domain/presentation.ts";
import type { Sent } from "./useQueueActions.ts";

export type QueueCard =
  | { kind: "recap"; recap: Recap }
  | { kind: "sent"; sent: Sent }
  | { kind: "working"; line: string | null }
  | { kind: "needs"; line: string | null }
  | { kind: "failed" }
  | { kind: "line"; label: string; line: string | null };

/**
 * A message sent from the page shows until its turn ends; a turn underway
 * shows Working; a question or decision waits on the user; a failed turn says
 * so. Otherwise the agent's recap, or failing that the one-line analysis
 * recap in a neutral card.
 */
export function cardOf(
  thread: PluginSidebarThread,
  work: WorkView,
  recap: Recap | undefined,
  sent: Sent | undefined,
  running: boolean,
): QueueCard {
  const analysis =
    work.kind === "current"
      ? work.analysis
      : work.kind === "pending"
        ? work.previous
        : null;
  if (sent) return { kind: "sent", sent };
  if (running || statusRole(thread.indicator) === "working")
    return { kind: "working", line: analysis?.recap ?? null };
  if (
    thread.hasPendingInteraction ||
    (work.kind === "current" && work.analysis.state === "needs_decision")
  )
    return {
      kind: "needs",
      line:
        (work.kind === "current" ? work.analysis.needsYou : null) ??
        analysis?.recap ??
        null,
    };
  if (thread.status === "error") return { kind: "failed" };
  if (recap && thread.status === "idle") return { kind: "recap", recap };
  const state =
    work.kind === "current"
      ? workStateLabel(work.analysis.state, work.reported)
      : "No recap";
  return { kind: "line", label: state, line: analysis?.recap ?? null };
}

/** The agent's proposed replies, at most three (keys 1–3). */
export const nextActionsOf = (card: QueueCard): NextAction[] =>
  card.kind === "recap" && card.recap.state !== "waiting"
    ? card.recap.next.slice(0, 3)
    : [];

/** The message a next action sends, which the queue shows in full. */
export const actionMessage = (action: NextAction) =>
  typeof action === "string" ? action : action.message;
